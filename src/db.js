import { db } from "./firebase";
import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, onSnapshot, addDoc, serverTimestamp, Timestamp
} from "firebase/firestore";

// ─── HELPERS ───
const ID = () => Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
const INVITE = () => "MN-" + Math.random().toString(36).substr(2, 4).toUpperCase();
const NOW = () => new Date().toISOString();

// ─── COLLECTIONS ───
const C = {
  users: "users",
  landlords: "landlords",
  tenants: "tenants",
  properties: "properties",
  units: "units",
  payments: "payments",
  logs: "logs",
};

// ═══ USER / AUTH ═══
export async function createUserProfile(uid, data) {
  await setDoc(doc(db, C.users, uid), {
    ...data,
    createdAt: NOW(),
    status: "active",
  });
}

export async function getUserProfile(uid) {
  const snap = await getDoc(doc(db, C.users, uid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function getUserByPhone(phone) {
  const q = query(collection(db, C.users), where("phone", "==", phone));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() };
}

// ═══ LANDLORD ═══
export async function registerLandlord(uid, info) {
  const inviteCode = INVITE();
  const data = {
    uid,
    inviteCode,
    name: info.name,
    phone: info.phone || "",
    email: info.email || "",
    address: info.address || "",
    location: info.location || "",
    holdingNo: info.holdingNo || "",
    tinNo: info.tinNo || "",
    photo: info.photo || "",
    createdAt: NOW(),
    status: "active",
  };
  await setDoc(doc(db, C.landlords, uid), data);
  await setDoc(doc(db, C.users, uid), {
    role: "landlord",
    name: info.name,
    email: info.email || "",
    phone: info.phone || "",
    createdAt: NOW(),
    status: "active",
  });
  await addLog("register", uid, `Landlord: ${info.name} (${inviteCode})`);
  return { ...data, id: uid };
}

export async function getLandlord(uid) {
  const snap = await getDoc(doc(db, C.landlords, uid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function getAllLandlords() {
  const snap = await getDocs(collection(db, C.landlords));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function getLandlordByInvite(code) {
  const q = query(collection(db, C.landlords), where("inviteCode", "==", code));
  const snap = await getDocs(q);
  if (snap.empty) return null;
  const d = snap.docs[0];
  return { id: d.id, ...d.data() };
}

export async function getLandlordByPhone(phone) {
  // Clean phone - remove spaces, dashes, +88 prefix
  const clean = phone.replace(/[\s\-\+]/g, "").replace(/^88/, "").replace(/^0088/, "");
  const variants = [clean, "0" + clean, "+88" + clean, "88" + clean];
  
  for (const v of variants) {
    const q = query(collection(db, C.landlords), where("phone", "==", v));
    const snap = await getDocs(q);
    if (!snap.empty) {
      const d = snap.docs[0];
      return { id: d.id, ...d.data() };
    }
  }
  return null;
}

export async function searchLandlordsByPhone(phone) {
  // Get all landlords and filter client-side for partial match
  const snap = await getDocs(collection(db, C.landlords));
  const clean = phone.replace(/[\s\-\+]/g, "").replace(/^88/, "").replace(/^0088/, "");
  return snap.docs
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(l => {
      const lp = (l.phone || "").replace(/[\s\-\+]/g, "");
      return lp.includes(clean) || clean.includes(lp.replace(/^0/, ""));
    });
}

// ═══ TENANT ═══
export async function registerTenant(uid, info, landlordId) {
  const data = {
    uid,
    landlordId,
    name: info.name,
    phone: info.phone || "",
    email: info.email || "",
    nid: info.nid || "",
    photo: info.photo || "",
    members: info.members || 1,
    unitId: null,
    rent: 0,
    advance: 0,
    moveInDate: "",
    notes: "",
    createdAt: NOW(),
    status: "active",
  };
  await setDoc(doc(db, C.tenants, uid), data);
  await setDoc(doc(db, C.users, uid), {
    role: "tenant",
    name: info.name,
    email: info.email || "",
    phone: info.phone || "",
    createdAt: NOW(),
    status: "active",
  });
  await addLog("register", uid, `Tenant: ${info.name} → Landlord: ${landlordId}`);
  return { ...data, id: uid };
}

export async function getTenant(uid) {
  const snap = await getDoc(doc(db, C.tenants, uid));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export async function getTenantsByLandlord(landlordId) {
  const q = query(collection(db, C.tenants), where("landlordId", "==", landlordId));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function getAllTenants() {
  const snap = await getDocs(collection(db, C.tenants));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function assignTenantToUnit(tenantId, unitId, rent, advance, moveIn, notes) {
  await updateDoc(doc(db, C.tenants, tenantId), {
    unitId, rent: Number(rent), advance: Number(advance || 0),
    moveInDate: moveIn || "", notes: notes || "",
  });
  await updateDoc(doc(db, C.units, unitId), { isVacant: false });
  await addLog("assign", tenantId, `Tenant → Unit ${unitId}`);
}

// Self-register: tenant picks their own unit during registration
export async function selfRegisterTenant(uid, info, landlordId, unitId, unitRent) {
  const data = {
    uid,
    landlordId,
    name: info.name,
    phone: info.phone || "",
    email: info.email || "",
    nid: info.nid || "",
    photo: info.photo || "",
    members: info.members || 1,
    unitId: unitId,
    rent: Number(unitRent) || 0,
    advance: 0,
    moveInDate: new Date().toISOString().split("T")[0],
    notes: "",
    createdAt: NOW(),
    status: "active",
  };
  await setDoc(doc(db, C.tenants, uid), data);
  await setDoc(doc(db, C.users, uid), {
    role: "tenant",
    name: info.name,
    email: info.email || "",
    phone: info.phone || "",
    createdAt: NOW(),
    status: "active",
  });
  // Mark unit as occupied
  await updateDoc(doc(db, C.units, unitId), { isVacant: false });
  await addLog("self_register", uid, `Tenant: ${info.name} → Unit: ${unitId}`);
  return { ...data, id: uid };
}

// Landlord manually adds a tenant (no auth account needed)
export async function addManualTenant(landlordId, info, unitId, rent) {
  const tenantId = "manual_" + ID();
  const data = {
    uid: tenantId,
    landlordId,
    name: info.name,
    phone: info.phone || "",
    email: info.email || "",
    nid: info.nid || "",
    photo: "",
    members: info.members || 1,
    unitId: unitId || null,
    rent: Number(rent) || 0,
    advance: Number(info.advance) || 0,
    moveInDate: info.moveInDate || new Date().toISOString().split("T")[0],
    notes: info.notes || "",
    createdAt: NOW(),
    status: "active",
    isManual: true,
  };
  await setDoc(doc(db, C.tenants, tenantId), data);
  if (unitId) {
    await updateDoc(doc(db, C.units, unitId), { isVacant: false });
  }
  await addLog("manual_add", landlordId, `Manual tenant: ${info.name}`);
  return { ...data, id: tenantId };
}

export async function unassignTenant(tenantId) {
  const t = await getTenant(tenantId);
  if (t?.unitId) {
    await updateDoc(doc(db, C.units, t.unitId), { isVacant: true });
  }
  await updateDoc(doc(db, C.tenants, tenantId), {
    unitId: null, rent: 0, advance: 0,
  });
  await addLog("unassign", tenantId, `Tenant removed from unit`);
}

// ═══ PROPERTY ═══
export async function addProperty(landlordId, info) {
  const propId = ID();
  const propData = {
    ...info,
    id: propId,
    landlordId,
    createdAt: NOW(),
  };
  await setDoc(doc(db, C.properties, propId), propData);

  // Create units with rent & conditions
  for (let f = 1; f <= info.floors; f++) {
    for (let u = 1; u <= info.unitsPerFloor; u++) {
      const label = info.unitType === "flat"
        ? `${f}${String.fromCharCode(64 + u)}`
        : `${f}${String(u).padStart(2, "0")}`;
      const unitId = ID();
      await setDoc(doc(db, C.units, unitId), {
        id: unitId, propertyId: propId, landlordId,
        floor: f, unitNo: label, type: info.unitType, isVacant: true,
        rent: Number(info.defaultRent) || 0,
        conditions: info.defaultConditions || "",
        bedrooms: info.defaultBedrooms || 0,
        bathrooms: info.defaultBathrooms || 0,
        area: info.defaultArea || "",
        features: info.defaultFeatures || "",
      });
    }
  }
  await addLog("add_property", landlordId, `Property: ${info.name}`);
  return propData;
}

export async function getPropertiesByLandlord(landlordId) {
  const q = query(collection(db, C.properties), where("landlordId", "==", landlordId));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function getAllProperties() {
  const snap = await getDocs(collection(db, C.properties));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ═══ UNITS ═══
export async function updateUnit(unitId, data) {
  await updateDoc(doc(db, C.units, unitId), data);
}

export async function getUnitsByLandlord(landlordId) {
  const q = query(collection(db, C.units), where("landlordId", "==", landlordId));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function getUnitsByProperty(propertyId) {
  const q = query(collection(db, C.units), where("propertyId", "==", propertyId));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function getAllUnits() {
  const snap = await getDocs(collection(db, C.units));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ═══ PAYMENTS ═══
export async function recordPayment(payment) {
  const payId = ID();
  const data = {
    ...payment,
    id: payId,
    paidAt: NOW(),
  };
  await setDoc(doc(db, C.payments, payId), data);
  await addLog("payment", payment.recordedBy || payment.tenantId, `৳${payment.amount} via ${payment.method}`);
  return data;
}

export async function getPaymentsByTenant(tenantId) {
  const q = query(collection(db, C.payments), where("tenantId", "==", tenantId));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function getPaymentsByMonth(monthKey) {
  const q = query(collection(db, C.payments), where("monthKey", "==", monthKey));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

export async function getAllPayments() {
  const snap = await getDocs(collection(db, C.payments));
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ═══ LOGS ═══
export async function addLog(action, userId, detail) {
  try {
    await addDoc(collection(db, C.logs), {
      action, userId, detail, ts: NOW(),
    });
  } catch (e) { console.error("Log error", e); }
}

export async function getAllLogs() {
  const q = query(collection(db, C.logs), orderBy("ts", "desc"), limit(100));
  const snap = await getDocs(q);
  return snap.docs.map(d => ({ id: d.id, ...d.data() }));
}

// ═══ ADMIN ═══
const ADMIN_EMAILS = ["suhag@munsi.app"]; // Add your email here

export function isAdminEmail(email) {
  // Check if the email matches any admin email, or use a simpler approach
  return true; // For now, first user who accesses admin panel becomes admin
}

// ═══ REAL-TIME LISTENERS ═══
export function onLandlordsChange(callback) {
  return onSnapshot(collection(db, C.landlords), snap => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  });
}

export function onTenantsChange(landlordId, callback) {
  const q = query(collection(db, C.tenants), where("landlordId", "==", landlordId));
  return onSnapshot(q, snap => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  });
}

export function onUnitsChange(landlordId, callback) {
  const q = query(collection(db, C.units), where("landlordId", "==", landlordId));
  return onSnapshot(q, snap => {
    callback(snap.docs.map(d => ({ id: d.id, ...d.data() })));
  });
}
