import { db } from "./firebase";
import {
  collection, doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc,
  query, where, orderBy, limit, onSnapshot, addDoc, serverTimestamp, Timestamp
} from "firebase/firestore";

const ID = () => Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
const INVITE = () => "MN-" + Math.random().toString(36).substr(2, 4).toUpperCase();
const NOW = () => new Date().toISOString();
const C = { users:"users", landlords:"landlords", tenants:"tenants", properties:"properties", units:"units", payments:"payments", logs:"logs", notices:"notices", agreements:"agreements", expenses:"expenses" };

// ═══ USER ═══
export async function createUserProfile(uid, data) { await setDoc(doc(db,C.users,uid),{...data,createdAt:NOW(),status:"active"}); }
export async function getUserProfile(uid) { const s=await getDoc(doc(db,C.users,uid)); return s.exists()?{id:s.id,...s.data()}:null; }
export async function getUserByPhone(phone) { const q=query(collection(db,C.users),where("phone","==",phone)); const s=await getDocs(q); return s.empty?null:{id:s.docs[0].id,...s.docs[0].data()}; }

// ═══ LANDLORD ═══
export async function registerLandlord(uid, info) {
  const inviteCode=INVITE();
  const data={uid,inviteCode,name:info.name,phone:info.phone||"",email:info.email||"",address:info.address||"",location:info.location||"",holdingNo:info.holdingNo||"",tinNo:info.tinNo||"",photo:info.photo||"",createdAt:NOW(),status:"active"};
  await setDoc(doc(db,C.landlords,uid),data);
  await setDoc(doc(db,C.users,uid),{role:"landlord",name:info.name,email:info.email||"",phone:info.phone||"",createdAt:NOW(),status:"active"});
  await addLog("register",uid,`Landlord: ${info.name}`);
  return {...data,id:uid};
}
export async function getLandlord(uid) { const s=await getDoc(doc(db,C.landlords,uid)); return s.exists()?{id:s.id,...s.data()}:null; }
export async function getAllLandlords() { const s=await getDocs(collection(db,C.landlords)); return s.docs.map(d=>({id:d.id,...d.data()})); }
export async function getLandlordByInvite(code) { const q=query(collection(db,C.landlords),where("inviteCode","==",code)); const s=await getDocs(q); return s.empty?null:{id:s.docs[0].id,...s.docs[0].data()}; }
export async function getLandlordByPhone(phone) {
  const clean=phone.replace(/[\s\-\+]/g,"").replace(/^88/,"").replace(/^0088/,"");
  for(const v of [clean,"0"+clean,"+88"+clean,"88"+clean]){const q=query(collection(db,C.landlords),where("phone","==",v));const s=await getDocs(q);if(!s.empty)return{id:s.docs[0].id,...s.docs[0].data()};}
  return null;
}
export async function searchLandlordsByPhone(phone) {
  const s=await getDocs(collection(db,C.landlords));const clean=phone.replace(/[\s\-\+]/g,"").replace(/^88/,"").replace(/^0088/,"");
  return s.docs.map(d=>({id:d.id,...d.data()})).filter(l=>{const lp=(l.phone||"").replace(/[\s\-\+]/g,"");return lp.includes(clean)||clean.includes(lp.replace(/^0/,""));});
}

// ═══ TENANT ═══
export async function registerTenant(uid, info, landlordId) {
  const data={uid,landlordId,name:info.name,phone:info.phone||"",email:info.email||"",nid:info.nid||"",photo:info.photo||"",members:info.members||1,unitId:null,rent:0,advance:0,moveInDate:"",notes:"",rentHistory:[],createdAt:NOW(),status:"active"};
  await setDoc(doc(db,C.tenants,uid),data);
  await setDoc(doc(db,C.users,uid),{role:"tenant",name:info.name,email:info.email||"",phone:info.phone||"",createdAt:NOW(),status:"active"});
  await addLog("register",uid,`Tenant: ${info.name}`);return{...data,id:uid};
}
export async function getTenant(uid) { const s=await getDoc(doc(db,C.tenants,uid)); return s.exists()?{id:s.id,...s.data()}:null; }
export async function getTenantsByLandlord(lid) { const q=query(collection(db,C.tenants),where("landlordId","==",lid)); const s=await getDocs(q); return s.docs.map(d=>({id:d.id,...d.data()})); }
export async function getAllTenants() { const s=await getDocs(collection(db,C.tenants)); return s.docs.map(d=>({id:d.id,...d.data()})); }
export async function assignTenantToUnit(tid, uid, rent, advance, moveIn, notes) {
  const t=await getTenant(tid); const prev=t?.rentHistory||[];
  await updateDoc(doc(db,C.tenants,tid),{unitId:uid,rent:Number(rent),advance:Number(advance||0),moveInDate:moveIn||"",notes:notes||"",rentHistory:[...prev,{rent:Number(rent),date:NOW(),reason:"initial"}]});
  await updateDoc(doc(db,C.units,uid),{isVacant:false});
  await addLog("assign",tid,`Tenant → Unit ${uid}`);
}
export async function selfRegisterTenant(uid, info, landlordId, unitId, unitRent) {
  const data={uid,landlordId,name:info.name,phone:info.phone||"",email:info.email||"",nid:info.nid||"",photo:info.photo||"",members:info.members||1,unitId,rent:Number(unitRent)||0,advance:0,moveInDate:new Date().toISOString().split("T")[0],notes:"",rentHistory:[{rent:Number(unitRent)||0,date:NOW(),reason:"initial"}],createdAt:NOW(),status:"active"};
  await setDoc(doc(db,C.tenants,uid),data);
  await setDoc(doc(db,C.users,uid),{role:"tenant",name:info.name,email:info.email||"",phone:info.phone||"",createdAt:NOW(),status:"active"});
  await updateDoc(doc(db,C.units,unitId),{isVacant:false});
  await addLog("self_register",uid,`Tenant: ${info.name}`);return{...data,id:uid};
}
export async function addManualTenant(landlordId, info, unitId, rent) {
  const tid="manual_"+ID();
  const data={uid:tid,landlordId,name:info.name,phone:info.phone||"",email:info.email||"",nid:info.nid||"",photo:"",members:info.members||1,unitId:unitId||null,rent:Number(rent)||0,advance:Number(info.advance)||0,moveInDate:info.moveInDate||new Date().toISOString().split("T")[0],notes:info.notes||"",rentHistory:[{rent:Number(rent)||0,date:NOW(),reason:"initial"}],createdAt:NOW(),status:"active",isManual:true};
  await setDoc(doc(db,C.tenants,tid),data);
  if(unitId)await updateDoc(doc(db,C.units,unitId),{isVacant:false});
  await addLog("manual_add",landlordId,`Manual: ${info.name}`);return{...data,id:tid};
}
export async function unassignTenant(tid) {
  const t=await getTenant(tid);if(t?.unitId)await updateDoc(doc(db,C.units,t.unitId),{isVacant:true});
  await updateDoc(doc(db,C.tenants,tid),{unitId:null,rent:0,advance:0});
  await addLog("unassign",tid,"Removed from unit");
}
// Feature #3: Rent Change History
export async function updateTenantRent(tid, newRent, reason) {
  const t=await getTenant(tid);const prev=t?.rentHistory||[];
  await updateDoc(doc(db,C.tenants,tid),{rent:Number(newRent),rentHistory:[...prev,{rent:Number(newRent),date:NOW(),reason:reason||"adjustment",prevRent:t?.rent||0}]});
  await addLog("rent_change",tid,`৳${t?.rent}→৳${newRent}`);
}

// ═══ PROPERTY ═══
export async function addProperty(landlordId, info) {
  const pid=ID();const pd={...info,id:pid,landlordId,createdAt:NOW()};
  await setDoc(doc(db,C.properties,pid),pd);
  for(let f=1;f<=info.floors;f++)for(let u=1;u<=info.unitsPerFloor;u++){
    const label=info.unitType==="flat"?`${f}${String.fromCharCode(64+u)}`:`${f}${String(u).padStart(2,"0")}`;
    const uid=ID();await setDoc(doc(db,C.units,uid),{id:uid,propertyId:pid,landlordId,floor:f,unitNo:label,type:info.unitType,isVacant:true,rent:Number(info.defaultRent)||0,conditions:info.defaultConditions||"",bedrooms:info.defaultBedrooms||0,bathrooms:info.defaultBathrooms||0,area:info.defaultArea||"",features:info.defaultFeatures||""});
  }
  await addLog("add_property",landlordId,`Property: ${info.name}`);return pd;
}
export async function getPropertiesByLandlord(lid) { const q=query(collection(db,C.properties),where("landlordId","==",lid));const s=await getDocs(q);return s.docs.map(d=>({id:d.id,...d.data()})); }
export async function getAllProperties() { const s=await getDocs(collection(db,C.properties));return s.docs.map(d=>({id:d.id,...d.data()})); }

// ═══ UNITS ═══
export async function updateUnit(uid,data){await updateDoc(doc(db,C.units,uid),data);}
export async function getUnitsByLandlord(lid){const q=query(collection(db,C.units),where("landlordId","==",lid));const s=await getDocs(q);return s.docs.map(d=>({id:d.id,...d.data()}));}
export async function getUnitsByProperty(pid){const q=query(collection(db,C.units),where("propertyId","==",pid));const s=await getDocs(q);return s.docs.map(d=>({id:d.id,...d.data()}));}
export async function getAllUnits(){const s=await getDocs(collection(db,C.units));return s.docs.map(d=>({id:d.id,...d.data()}));}

// ═══ PAYMENTS ═══
export async function recordPayment(p){const id=ID();const d={...p,id,paidAt:NOW()};await setDoc(doc(db,C.payments,id),d);await addLog("payment",p.recordedBy||p.tenantId,`৳${p.amount} [${p.type||"rent"}]`);return d;}
export async function updatePayment(id,u){await updateDoc(doc(db,C.payments,id),u);await addLog("edit_payment",id,"Updated");}
export async function deletePayment(id){await deleteDoc(doc(db,C.payments,id));await addLog("delete_payment",id,"Deleted");}
export async function getPaymentsByTenant(tid){const q=query(collection(db,C.payments),where("tenantId","==",tid));const s=await getDocs(q);return s.docs.map(d=>({id:d.id,...d.data()}));}
export async function getPaymentsByMonth(mk){const q=query(collection(db,C.payments),where("monthKey","==",mk));const s=await getDocs(q);return s.docs.map(d=>({id:d.id,...d.data()}));}
export async function getAllPayments(){const s=await getDocs(collection(db,C.payments));return s.docs.map(d=>({id:d.id,...d.data()}));}

// ═══ Feature #1: AGREEMENTS ═══
export async function createAgreement(data){const id=ID();const a={...data,id,createdAt:NOW(),status:"active"};await setDoc(doc(db,C.agreements,id),a);await addLog("agreement",data.landlordId,`Agreement: ${data.tenantName}`);return a;}
export async function getAgreementsByLandlord(lid){const q=query(collection(db,C.agreements),where("landlordId","==",lid));const s=await getDocs(q);return s.docs.map(d=>({id:d.id,...d.data()}));}
export async function getAgreementsByTenant(tid){const q=query(collection(db,C.agreements),where("tenantId","==",tid));const s=await getDocs(q);return s.docs.map(d=>({id:d.id,...d.data()}));}
export async function updateAgreement(id,data){await updateDoc(doc(db,C.agreements,id),data);}

// ═══ Feature #7: EXPENSES ═══
export async function addExpense(data){const id=ID();const e={...data,id,createdAt:NOW()};await setDoc(doc(db,C.expenses,id),e);await addLog("expense",data.landlordId,`৳${data.amount} (${data.category})`);return e;}
export async function getExpensesByLandlord(lid){const q=query(collection(db,C.expenses),where("landlordId","==",lid));const s=await getDocs(q);return s.docs.map(d=>({id:d.id,...d.data()}));}
export async function updateExpense(id,data){await updateDoc(doc(db,C.expenses,id),data);}
export async function deleteExpense(id){await deleteDoc(doc(db,C.expenses,id));await addLog("delete_expense",id,"Deleted");}

// ═══ NOTICES ═══
export async function sendNotice(n){const id=ID();const d={...n,id,createdAt:NOW(),read:false,status:"open",statusNote:"",statusHistory:[],replies:[]};await setDoc(doc(db,C.notices,id),d);await addLog("notice",n.fromId,`Notice: ${n.subject?.slice(0,40)}`);return d;}
export async function getNoticesForUser(uid){
  const q1=query(collection(db,C.notices),where("toId","==",uid));const s1=await getDocs(q1);
  const q2=query(collection(db,C.notices),where("fromId","==",uid));const s2=await getDocs(q2);
  const all=[...s1.docs,...s2.docs].map(d=>({id:d.id,...d.data()}));const seen=new Set();
  return all.filter(n=>{if(seen.has(n.id))return false;seen.add(n.id);return true;}).sort((a,b)=>(b.createdAt||"").localeCompare(a.createdAt||""));
}
export async function markNoticeRead(nid){await updateDoc(doc(db,C.notices,nid),{read:true,readAt:NOW()});}
export async function updateNoticeStatus(nid,status,note,by){
  const n=await getDoc(doc(db,C.notices,nid));const prev=n.data()?.statusHistory||[];
  await updateDoc(doc(db,C.notices,nid),{status,statusNote:note||"",statusHistory:[...prev,{status,note,by,at:NOW()}]});
  await addLog("notice_status",by,`${status}: ${note?.slice(0,30)}`);
}
export async function replyToNotice(nid, reply){
  const n=await getDoc(doc(db,C.notices,nid));const prev=n.data()?.replies||[];
  const r={...reply, id:ID(), at:NOW()};
  await updateDoc(doc(db,C.notices,nid),{replies:[...prev, r], hasNewReply:true, lastReplyBy:reply.fromId});
  await addLog("notice_reply",reply.fromId,`Reply: ${reply.text?.slice(0,30)}`);
  return r;
}
export async function markNoticeReplyRead(nid, byId){
  const n=await getDoc(doc(db,C.notices,nid));const d=n.data();
  if(d?.lastReplyBy !== byId) await updateDoc(doc(db,C.notices,nid),{hasNewReply:false});
}

// ═══ LOGS ═══
export async function addLog(action,userId,detail){try{await addDoc(collection(db,C.logs),{action,userId,detail,ts:NOW()});}catch(e){console.error("Log",e);}}
export async function getAllLogs(){const q=query(collection(db,C.logs),orderBy("ts","desc"),limit(100));const s=await getDocs(q);return s.docs.map(d=>({id:d.id,...d.data()}));}
export function isAdminEmail(e){return true;}

// ═══ LISTENERS ═══
export function onLandlordsChange(cb){return onSnapshot(collection(db,C.landlords),s=>cb(s.docs.map(d=>({id:d.id,...d.data()}))));}
export function onTenantsChange(lid,cb){return onSnapshot(query(collection(db,C.tenants),where("landlordId","==",lid)),s=>cb(s.docs.map(d=>({id:d.id,...d.data()}))));}
export function onUnitsChange(lid,cb){return onSnapshot(query(collection(db,C.units),where("landlordId","==",lid)),s=>cb(s.docs.map(d=>({id:d.id,...d.data()}))));}

// Realtime notice listener — watches both toId and fromId
export function onNoticesChange(uid, cb) {
  const toQ = query(collection(db,C.notices),where("toId","==",uid));
  const fromQ = query(collection(db,C.notices),where("fromId","==",uid));
  let toResults = [], fromResults = [];
  const merge = () => {
    const all = [...toResults, ...fromResults];
    const seen = new Set();
    const deduped = all.filter(n => { if(seen.has(n.id)) return false; seen.add(n.id); return true; });
    cb(deduped.sort((a,b) => (b.createdAt||"").localeCompare(a.createdAt||"")));
  };
  const unsub1 = onSnapshot(toQ, s => { toResults = s.docs.map(d=>({id:d.id,...d.data()})); merge(); });
  const unsub2 = onSnapshot(fromQ, s => { fromResults = s.docs.map(d=>({id:d.id,...d.data()})); merge(); });
  return () => { unsub1(); unsub2(); };
}