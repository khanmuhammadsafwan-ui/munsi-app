import { useState, useEffect, useRef, useCallback } from "react";
import { auth, googleProvider } from "./firebase";
import {
  signInWithPopup, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  onAuthStateChanged, signOut, updateProfile, linkWithCredential, EmailAuthProvider,
  RecaptchaVerifier, signInWithPhoneNumber
} from "firebase/auth";
import * as DB from "./db";

// ─── PHONE AUTH HELPERS (inline) ───
let _recaptchaVerifier = null;
function setupRecaptcha(buttonId) {
  if (_recaptchaVerifier) { try { _recaptchaVerifier.clear(); } catch(e) {} _recaptchaVerifier = null; }
  _recaptchaVerifier = new RecaptchaVerifier(auth, buttonId, { size: "invisible", callback: () => {}, "expired-callback": () => { _recaptchaVerifier = null; } });
  return _recaptchaVerifier;
}
async function sendPhoneOTP(phone) {
  const f = phone.replace(/[^0-9]/g, "");
  const intl = f.startsWith("88") ? `+${f}` : `+88${f}`;
  if (!_recaptchaVerifier) throw new Error("Recaptcha not initialized");
  return await signInWithPhoneNumber(auth, intl, _recaptchaVerifier);
}

// ─── CONSTANTS ───
const MK = (m, y) => `${y}-${String(m + 1).padStart(2, "0")}`;
const FM = (n) => (n || 0).toLocaleString("bn-BD");
const FE = (n) => (n || 0).toLocaleString("en-BD");
const MBN = ["জানুয়ারি","ফেব্রুয়ারি","মার্চ","এপ্রিল","মে","জুন","জুলাই","আগস্ট","সেপ্টেম্বর","অক্টোবর","নভেম্বর","ডিসেম্বর"];
const MEN = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const PAY = [
  { k: "bkash", l: "bKash", i: "🟪", c: "#E2136E" },
  { k: "nagad", l: "Nagad", i: "🟧", c: "#F6921E" },
  { k: "rocket", l: "Rocket", i: "🟣", c: "#8E24AA" },
  { k: "bank", l: "Bank Transfer", i: "🏛️", c: "#2196F3" },
  { k: "cash", l: "Hand Cash", i: "💵", c: "#43A047" },
];
const ADMIN_PIN = "2024";
const TODAY = () => new Date().toISOString().split("T")[0];

// ═══════════════════════════════════════
// MAIN APP
// ═══════════════════════════════════════
export default function App() {
  const [user, setUser] = useState(null); // Firebase auth user
  const [profile, setProfile] = useState(null); // DB profile { role, ... }
  const [loading, setLoading] = useState(true);
  const [screen, setScreen] = useState("welcome");
  const [lang, setLang] = useState("bn");
  const [toast, setToast] = useState(null);
  const [selM, setSelM] = useState(new Date().getMonth());
  const [selY, setSelY] = useState(new Date().getFullYear());
  const bn = lang === "bn";
  const mk = MK(selM, selY);

  // ─── Data state ───
  const [landlords, setLandlords] = useState([]);
  const [tenants, setTenants] = useState([]);
  const [properties, setProperties] = useState([]);
  const [units, setUnits] = useState([]);
  const [payments, setPayments] = useState([]);
  const [logs, setLogs] = useState([]);
  const [myLandlord, setMyLandlord] = useState(null);
  const [myTenant, setMyTenant] = useState(null);
  const [notices, setNotices] = useState([]);
  const [agreements, setAgreements] = useState([]);
  const [expenses, setExpenses] = useState([]);
  const [meters, setMeters] = useState([]);
  const [successInfo, setSuccessInfo] = useState(null);
  const noticeUnsubRef = useRef(null);

  const notify = (m) => { setToast(m); setTimeout(() => setToast(null), 2800); };

  // ─── REALTIME NOTICE LISTENER ───
  useEffect(() => {
    if (user?.uid && (profile?.role === "landlord" || profile?.role === "tenant")) {
      // Clean up previous listener
      if (noticeUnsubRef.current) noticeUnsubRef.current();
      // Start realtime listener
      noticeUnsubRef.current = DB.onNoticesChange(user.uid, (newNotices) => {
        setNotices(newNotices);
      });
    }
    return () => { if (noticeUnsubRef.current) { noticeUnsubRef.current(); noticeUnsubRef.current = null; } };
  }, [user?.uid, profile?.role]);

  // ─── AUTH LISTENER ───
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      if (u) {
        const p = await DB.getUserProfile(u.uid);
        setProfile(p);
        if (p?.role === "landlord") {
          setScreen("landlord");
          await loadLandlordData(u.uid);
        } else if (p?.role === "tenant") {
          setScreen("tenant");
          await loadTenantData(u.uid);
        } else if (p?.role === "admin") {
          setScreen("admin");
          await loadAdminData();
        } else {
          setScreen("choose-role");
        }
      } else {
        setProfile(null);
        setScreen("welcome");
      }
      setLoading(false);
    });
    return () => unsub();
  }, []);

  // ─── DATA LOADERS ───
  const loadLandlordData = async (uid) => {
    const [ll, t, p, u, pay] = await Promise.all([
      DB.getLandlord(uid),
      DB.getTenantsByLandlord(uid),
      DB.getPropertiesByLandlord(uid),
      DB.getUnitsByLandlord(uid),
      DB.getAllPayments(),
    ]);
    setMyLandlord(ll);
    setTenants(t);
    setProperties(p);
    setUnits(u);
    setPayments(pay);
    const [agrs, exps, mtrs] = await Promise.all([
      DB.getAgreementsByLandlord(uid),
      DB.getExpensesByLandlord(uid),
      DB.getMeterReadingsByLandlord(uid),
    ]);
    setAgreements(agrs);
    setExpenses(exps);
    setMeters(mtrs);
  };

  const loadTenantData = async (uid) => {
    const t = await DB.getTenant(uid);
    setMyTenant(t);
    if (t?.landlordId) {
      const ll = await DB.getLandlord(t.landlordId);
      setMyLandlord(ll);
    }
    const [pay, allU, allP, agrs] = await Promise.all([
      DB.getPaymentsByTenant(uid),
      DB.getAllUnits(),
      DB.getAllProperties(),
      DB.getAgreementsByTenant(uid),
    ]);
    setPayments(pay);
    setUnits(allU);
    setProperties(allP);
    setAgreements(agrs);
    // Load meter readings for tenant's unit
    if (t?.unitId) {
      const mtrs = await DB.getMeterReadingsByUnit(t.unitId);
      setMeters(mtrs);
    }
  };

  const loadAdminData = async () => {
    const [ll, t, p, u, pay, lg] = await Promise.all([
      DB.getAllLandlords(), DB.getAllTenants(), DB.getAllProperties(),
      DB.getAllUnits(), DB.getAllPayments(), DB.getAllLogs(),
    ]);
    setLandlords(ll); setTenants(t); setProperties(p);
    setUnits(u); setPayments(pay); setLogs(lg);
  };

  const refresh = async () => {
    if (profile?.role === "landlord") await loadLandlordData(user.uid);
    else if (profile?.role === "tenant") await loadTenantData(user.uid);
    else if (profile?.role === "admin") await loadAdminData();
  };

  // ─── GOOGLE SIGN IN ───
  const googleSignIn = async () => {
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (e) {
      if (e.code !== "auth/popup-closed-by-user") notify("❌ " + e.message);
    }
  };

  // ─── EMAIL / PHONE SIGN IN / REGISTER ───
  const emailAuth = async (emailOrPhone, password, isNew) => {
    try {
      // Auto-detect phone number: if starts with 0 and all digits, append @munsi.app
      let loginEmail = emailOrPhone;
      const cleaned = emailOrPhone.replace(/[^0-9]/g, "");
      if (/^0[0-9]{9,10}$/.test(cleaned) || /^880[0-9]{10}$/.test(cleaned)) {
        loginEmail = cleaned + "@munsi.app";
      }
      if (isNew) {
        await createUserWithEmailAndPassword(auth, loginEmail, password);
      } else {
        await signInWithEmailAndPassword(auth, loginEmail, password);
      }
      return true;
    } catch (e) {
      notify("❌ " + (e.code === "auth/invalid-credential" ? (bn ? "ভুল তথ্য!" : "Invalid!") : e.message));
      return false;
    }
  };

  // ─── REGISTER AS LANDLORD ───
  const regLandlord = async (info) => {
    try {
      const ll = await DB.registerLandlord(user.uid, { ...info, email: user.email || info.email });
      setMyLandlord(ll);
      setProfile({ role: "landlord" });
      setScreen("landlord");
      await loadLandlordData(user.uid);
      notify(bn ? "✓ বাড়িওয়ালা নিবন্ধন সফল!" : "✓ Landlord registered!");
    } catch (e) { notify("❌ " + e.message); }
  };

  // ─── REGISTER AS TENANT (self-select unit) ───
  const regTenant = async (info, landlordId, unitId, unitRent) => {
    try {
      if (unitId) {
        const t = await DB.selfRegisterTenant(user.uid, { ...info, email: user.email || info.email }, landlordId, unitId, unitRent);
        setMyTenant(t);
      } else {
        const t = await DB.registerTenant(user.uid, { ...info, email: user.email || info.email }, landlordId);
        setMyTenant(t);
      }
      const llFull = await DB.getLandlord(landlordId);
      setMyLandlord(llFull);
      setProfile({ role: "tenant" });
      setScreen("tenant");
      await loadTenantData(user.uid);
      notify(bn ? "✓ ভাড়াটিয়া নিবন্ধন সফল!" : "✓ Tenant registered!");
      return true;
    } catch (e) { notify("❌ " + e.message); return false; }
  };

  // ─── MANUAL ADD TENANT (by landlord) ───
  const manualAddTenant = async (info, unitId, rent) => {
    try {
      await DB.addManualTenant(user.uid, info, unitId, rent);
      await loadLandlordData(user.uid);
      notify(bn ? "✓ ভাড়াটিয়া যোগ হয়েছে" : "✓ Tenant added");
    } catch (e) { notify("❌ " + e.message); }
  };

  // ─── ADMIN LOGIN ───
  const adminLogin = async (pin) => {
    if (pin !== ADMIN_PIN) { notify(bn ? "❌ ভুল PIN!" : "❌ Wrong PIN!"); return; }
    await DB.createUserProfile(user.uid, { role: "admin", name: "Admin", email: user.email || "" });
    setProfile({ role: "admin" });
    setScreen("admin");
    await loadAdminData();
    notify(bn ? "✓ অ্যাডমিন লগইন সফল!" : "✓ Admin login!");
  };

  // ─── PROPERTY ───
  const handleAddProperty = async (info) => {
    try {
      await DB.addProperty(user.uid, info);
      await loadLandlordData(user.uid);
      notify(bn ? "✓ বাড়ি যোগ হয়েছে" : "✓ Property added");
    } catch (e) {
      console.error("addProperty error:", e);
      notify("❌ " + (bn ? "সমস্যা হয়েছে: " : "Error: ") + e.message);
    }
  };

  // ─── ASSIGN/UNASSIGN ───
  const handleAssign = async (tenantId, unitId, rent, adv, date, notes) => {
    await DB.assignTenantToUnit(tenantId, unitId, rent, adv, date, notes);
    await loadLandlordData(user.uid);
    notify(bn ? "✓ নির্ধারিত" : "✓ Assigned");
  };

  const handleUnassign = async (tenantId) => {
    await DB.unassignTenant(tenantId);
    await loadLandlordData(user.uid);
    notify(bn ? "সরানো হয়েছে" : "Removed");
  };

  // ─── PAYMENT ───
  const handlePayment = async (p) => {
    await DB.recordPayment({ ...p, recordedBy: user.uid });
    await refresh();
    // Find tenant info for success screen
    const t = [...(myLandlord ? tenants : [])].find(x => x.id === p.tenantId) || myTenant;
    setSuccessInfo({ amount: p.amount, name: t?.name || "", type: p.type || "rent", month: p.monthKey, phone: t?.phone });
    setTimeout(() => setSuccessInfo(null), 3500);
  };

  const handleDeletePayment = async (payId) => {
    try {
      await DB.deletePayment(payId);
      await refresh();
      notify(bn ? "✓ মুছে ফেলা হয়েছে" : "✓ Deleted");
    } catch (e) { notify("❌ " + e.message); }
  };

  const handleEditPayment = async (payId, data) => {
    try {
      await DB.updatePayment(payId, data);
      await refresh();
      notify(bn ? "✓ আপডেট হয়েছে" : "✓ Updated");
    } catch (e) { notify("❌ " + e.message); }
  };

  const handleSendNotice = async (notice) => {
    try {
      await DB.sendNotice(notice);
      await refresh();
      notify(bn ? "✓ নোটিশ পাঠানো হয়েছে" : "✓ Notice sent");
    } catch (e) { notify("❌ " + e.message); }
  };

  const handleUpdateNoticeStatus = async (noticeId, status, statusNote) => {
    try {
      await DB.updateNoticeStatus(noticeId, status, statusNote, user.uid);
      await refresh();
      notify(bn ? "✓ স্ট্যাটাস আপডেট" : "✓ Status updated");
    } catch (e) { notify("❌ " + e.message); }
  };

  const handleMarkNoticeRead = async (noticeId) => {
    try { await DB.markNoticeRead(noticeId); await refresh(); } catch (e) { /* silent */ }
  };

  const handleReplyNotice = async (noticeId, replyData) => {
    try {
      await DB.replyToNotice(noticeId, replyData);
      await refresh();
      notify(bn ? "✓ রিপ্লাই পাঠানো হয়েছে" : "✓ Reply sent");
    } catch (e) { notify("❌ " + e.message); }
  };

  const handleMarkReplyRead = async (noticeId) => {
    try { await DB.markNoticeReplyRead(noticeId, user.uid); await refresh(); } catch (e) { /* silent */ }
  };

  // Feature #1: Agreements
  const handleCreateAgreement = async (data) => {
    try { await DB.createAgreement(data); await refresh(); notify(bn ? "✓ চুক্তি তৈরি" : "✓ Agreement created"); } catch (e) { notify("❌ " + e.message); }
  };
  // Feature #3: Rent Change
  const handleRentChange = async (tenantId, newRent, reason) => {
    try { await DB.updateTenantRent(tenantId, newRent, reason); await refresh(); notify(bn ? "✓ ভাড়া আপডেট" : "✓ Rent updated"); } catch (e) { notify("❌ " + e.message); }
  };
  // Feature #7: Expenses
  const handleAddExpense = async (data) => {
    try { await DB.addExpense({ ...data, landlordId: user.uid }); await refresh(); notify(bn ? "✓ খরচ যোগ" : "✓ Expense added"); } catch (e) { notify("❌ " + e.message); }
  };
  const handleDeleteExpense = async (id) => {
    try { await DB.deleteExpense(id); await refresh(); notify(bn ? "✓ মুছে ফেলা হয়েছে" : "✓ Deleted"); } catch (e) { notify("❌ " + e.message); }
  };
  // Move-out with settlement
  const handleMoveOut = async (tenantId, settlement) => {
    try { await DB.moveOutTenant(tenantId, settlement); await refresh(); notify(bn ? "✓ স্থানান্তর সম্পন্ন" : "✓ Move-out complete"); } catch (e) { notify("❌ " + e.message); }
  };
  // Meter reading
  const handleAddMeterReading = async (data) => {
    try { await DB.addMeterReading({ ...data, landlordId: user.uid }); await refresh(); notify(bn ? "✓ মিটার রিডিং যোগ" : "✓ Meter reading added"); } catch (e) { notify("❌ " + e.message); }
  };
  // Update deposit
  const handleUpdateDeposit = async (tenantId, amount, note) => {
    try { await DB.updateTenantDeposit(tenantId, amount, note); await refresh(); notify(bn ? "✓ অগ্রিম আপডেট" : "✓ Deposit updated"); } catch (e) { notify("❌ " + e.message); }
  };
  // Update landlord payment info
  const handleUpdateLandlordProfile = async (data) => {
    try { await DB.updateLandlordProfile(user.uid, data); await refresh(); notify(bn ? "✓ আপডেট হয়েছে" : "✓ Updated"); } catch (e) { notify("❌ " + e.message); }
  };

  const handleLogout = async () => { await signOut(auth); };

  if (loading) return <SplashScreen />;

  return (
    <div style={{ minHeight: "100vh", background: "#060B16", fontFamily: "'Hind Siliguri',system-ui,sans-serif", color: "#CBD5E1" }}>
      <link href="https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
      <CSS />
      {toast && <div className="toast">{toast}</div>}

      {/* ═══ SUCCESS ANIMATION ═══ */}
      {successInfo && <div className="success-ov" onClick={() => setSuccessInfo(null)}>
        <div className="success-card" onClick={e => e.stopPropagation()}>
          <div style={{ fontSize: 56, marginBottom: 12 }}>✅</div>
          <div style={{ fontSize: 22, fontWeight: 800, color: "#34D399", marginBottom: 6 }}>{bn ? "পেমেন্ট সফল!" : "Payment Recorded!"}</div>
          <div style={{ fontSize: 32, fontWeight: 800, color: "#fff", marginBottom: 12 }}>৳{Number(successInfo.amount).toLocaleString()}</div>
          <div style={{ fontSize: 14, color: "#94A3B8", marginBottom: 4 }}>{successInfo.name}</div>
          <div style={{ fontSize: 13, color: "#64748B" }}>{successInfo.type === "rent" ? (bn ? "🏠 ভাড়া" : "🏠 Rent") : successInfo.type} • {successInfo.month}</div>
          {successInfo.phone && <button className="btn" style={{ marginTop: 16, background: "rgba(37,211,102,.1)", border: "1px solid rgba(37,211,102,.2)", color: "#25D366", fontSize: 13, width: "100%" }} onClick={() => {
            const ph = (successInfo.phone || "").replace(/[^0-9]/g, "").replace(/^0/, "88");
            const msg = `📒 মুন্সী রসিদ\n━━━━━━━━━━\n✅ ৳${Number(successInfo.amount).toLocaleString()} — ${successInfo.type === "rent" ? "ভাড়া" : successInfo.type}\n📅 ${successInfo.month}\n👤 ${successInfo.name}\n\nধন্যবাদ!`;
            window.open(`https://wa.me/${ph}?text=${encodeURIComponent(msg)}`, "_blank");
          }}>💬 WhatsApp {bn ? "এ রসিদ পাঠান" : "Receipt"}</button>}
        </div>
      </div>}

      {screen === "welcome" && <WelcomeScreen bn={bn} lang={lang} setLang={setLang} onGoogle={googleSignIn} onEmail={emailAuth} onSetScreen={setScreen} />}

      {screen === "choose-role" && <ChooseRole bn={bn} user={user} onLandlord={() => setScreen("reg-landlord")} onTenant={() => setScreen("reg-tenant")} onAdmin={() => setScreen("admin-pin")} onLogout={handleLogout} />}

      {screen === "admin-pin" && <AdminPinScreen bn={bn} onSubmit={adminLogin} onBack={() => setScreen("choose-role")} />}
      {screen === "reg-landlord" && <RegLandlord bn={bn} user={user} onReg={regLandlord} onBack={() => setScreen("choose-role")} />}
      {screen === "reg-tenant" && <RegTenant bn={bn} user={user} onReg={regTenant} onBack={() => setScreen("choose-role")} />}

      {screen === "admin" && profile?.role === "admin" && (
        <AdminPanel db={{ landlords, tenants, properties, units, payments, logs }}
          notices={notices} agreements={agreements} expenses={expenses} meters={meters}
          bn={bn} lang={lang} setLang={setLang} onLogout={handleLogout}
          onDeletePayment={handleDeletePayment} onEditPayment={handleEditPayment}
          selM={selM} setSelM={setSelM} selY={selY} setSelY={setSelY} mk={mk} onRefresh={loadAdminData} />
      )}

      {screen === "landlord" && profile?.role === "landlord" && (
        <LandlordPanel me={myLandlord} tenants={tenants} properties={properties} units={units} payments={payments}
          bn={bn} lang={lang} setLang={setLang} onLogout={handleLogout}
          addProperty={handleAddProperty} assignTenant={handleAssign} unassignTenant={handleUnassign}
          recordPayment={handlePayment} manualAddTenant={manualAddTenant}
          onDeletePayment={handleDeletePayment} onEditPayment={handleEditPayment}
          notices={notices} onSendNotice={handleSendNotice}
          onUpdateNoticeStatus={handleUpdateNoticeStatus} onMarkNoticeRead={handleMarkNoticeRead}
          onReplyNotice={handleReplyNotice} onMarkReplyRead={handleMarkReplyRead}
          agreements={agreements} onCreateAgreement={handleCreateAgreement}
          expenses={expenses} onAddExpense={handleAddExpense} onDeleteExpense={handleDeleteExpense}
          onRentChange={handleRentChange} meters={meters} onAddMeterReading={handleAddMeterReading}
          onMoveOut={handleMoveOut} onUpdateDeposit={handleUpdateDeposit} onUpdateProfile={handleUpdateLandlordProfile}
          selM={selM} setSelM={setSelM} selY={selY} setSelY={setSelY} mk={mk} onRefresh={() => loadLandlordData(user.uid)} />
      )}

      {screen === "tenant" && profile?.role === "tenant" && (
        <TenantPanel me={myTenant} landlord={myLandlord} units={units} properties={properties} payments={payments}
          bn={bn} lang={lang} setLang={setLang} onLogout={handleLogout}
          recordPayment={handlePayment} selM={selM} setSelM={setSelM} selY={selY} setSelY={setSelY} mk={mk}
          onDeletePayment={handleDeletePayment} onEditPayment={handleEditPayment}
          onSendNotice={handleSendNotice} notices={notices}
          onUpdateNoticeStatus={handleUpdateNoticeStatus}
          onMarkNoticeRead={handleMarkNoticeRead}
          onReplyNotice={handleReplyNotice} onMarkReplyRead={handleMarkReplyRead}
          agreements={agreements} meters={meters} />
      )}
    </div>
  );
}

// ═══ CSS ═══
function CSS() {
  return <style>{`
    *{box-sizing:border-box;margin:0;padding:0}
    html{-webkit-text-size-adjust:100%;-webkit-tap-highlight-color:transparent}
    body{overscroll-behavior-y:contain}
    @keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
    @keyframes slideUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
    @keyframes slideFromBottom{from{opacity:0;transform:translateY(100%)}to{opacity:1;transform:translateY(0)}}
    @keyframes pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.05)}}
    @keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}
    .toast{position:fixed;top:env(safe-area-inset-top,14px);left:50%;transform:translateX(-50%);z-index:9999;background:linear-gradient(135deg,#10B981,#059669);color:#fff;padding:12px 28px;border-radius:14px;font-weight:700;font-size:14px;box-shadow:0 8px 30px rgba(16,185,129,.35);animation:slideUp .3s;max-width:90vw;text-align:center}
    .G{background:rgba(255,255,255,.025);border:1px solid rgba(255,255,255,.05);border-radius:16px}
    .G2{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);border-radius:20px}
    .CH{transition:all .2s;cursor:pointer}.CH:hover{transform:translateY(-2px);border-color:rgba(255,255,255,.12);box-shadow:0 6px 24px rgba(0,0,0,.2)}
    .btn{padding:10px 20px;border-radius:12px;border:none;cursor:pointer;font-family:inherit;font-weight:600;font-size:14px;transition:all .15s;display:inline-flex;align-items:center;gap:8px;justify-content:center;min-height:44px}
    .btn:active{transform:scale(.96);opacity:.85}
    .bp{background:linear-gradient(135deg,#10B981,#059669);color:#fff}.bp:hover{box-shadow:0 4px 16px rgba(16,185,129,.3)}
    .bg{background:rgba(255,255,255,.04);color:#94A3B8;border:1px solid rgba(255,255,255,.07)}.bg:hover{background:rgba(255,255,255,.08);color:#fff}
    .bd{background:rgba(239,68,68,.08);color:#EF4444;border:1px solid rgba(239,68,68,.12)}
    .bs{padding:7px 14px;font-size:12px;border-radius:10px;min-height:36px}
    .inp{width:100%;padding:14px 16px;border-radius:12px;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.06);color:#E2E8F0;font-family:inherit;font-size:16px;transition:border-color .2s}
    .inp:focus{outline:none;border-color:#10B981;box-shadow:0 0 0 3px rgba(16,185,129,.08)}
    .inp::placeholder{color:rgba(255,255,255,.18)}
    select.inp{appearance:none;padding-right:36px;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' fill='%2364748B' viewBox='0 0 16 16'%3E%3Cpath d='M8 12L2 6h12z'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 14px center}
    select.inp option{background:#1a2235;color:#E2E8F0}
    textarea.inp{resize:vertical;min-height:70px}
    .lbl{font-size:13px;font-weight:700;color:#64748B;margin-bottom:5px;display:block}
    .badge{padding:4px 12px;border-radius:20px;font-size:12px;font-weight:700;display:inline-flex;align-items:center;gap:4px}
    .bP{background:rgba(16,185,129,.1);color:#34D399}.bD{background:rgba(245,158,11,.1);color:#F59E0B}.bPa{background:rgba(249,115,22,.1);color:#F97316}
    .bV{background:rgba(59,130,246,.1);color:#60A5FA}.bA{background:rgba(16,185,129,.1);color:#34D399}
    .ov{position:fixed;inset:0;background:rgba(0,0,0,.6);backdrop-filter:blur(4px);display:flex;align-items:flex-end;justify-content:center;z-index:1000;animation:fadeIn .12s;padding:0}
    .mdl{background:linear-gradient(155deg,#1a2540,#111a2e);border:1px solid rgba(255,255,255,.07);border-radius:22px 22px 0 0;padding:24px 20px calc(24px + env(safe-area-inset-bottom,0px));width:100%;max-width:500px;max-height:92vh;overflow-y:auto;animation:slideFromBottom .25s}
    .mdl::-webkit-scrollbar{width:3px}.mdl::-webkit-scrollbar-thumb{background:rgba(255,255,255,.06);border-radius:3px}
    .mdl-handle{width:40px;height:4px;background:rgba(255,255,255,.12);border-radius:2px;margin:0 auto 16px}
    .av{width:48px;height:48px;border-radius:14px;background:rgba(255,255,255,.04);display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;overflow:hidden}
    .av img{width:100%;height:100%;object-fit:cover}
    .row{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.025);transition:background .12s;min-height:56px}
    .row:active{background:rgba(255,255,255,.03)}
    .uc{padding:14px;border-radius:14px;text-align:center;cursor:pointer;transition:all .15s;border:1px solid transparent;min-height:80px}
    .uc:active{transform:scale(.97)}.uv{background:rgba(59,130,246,.03);border-color:rgba(59,130,246,.1)}.uo{background:rgba(16,185,129,.03);border-color:rgba(16,185,129,.1)}
    .invite-box{background:linear-gradient(135deg,rgba(16,185,129,.08),rgba(59,130,246,.06));border:2px dashed rgba(16,185,129,.25);border-radius:16px;padding:20px;text-align:center}
    .code{font-size:32px;font-weight:800;letter-spacing:4px;color:#34D399;font-family:monospace}
    .gbtn{width:100%;padding:14px 20px;border-radius:14px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.03);color:#E2E8F0;cursor:pointer;font-family:inherit;font-size:15px;font-weight:600;display:flex;align-items:center;justify-content:center;gap:12px;transition:all .15s;min-height:52px}
    .gbtn:active{background:rgba(255,255,255,.06);border-color:rgba(255,255,255,.15)}
    .gbtn img{width:20px;height:20px}
    .search-bar{width:100%;padding:14px 16px 14px 42px;border-radius:14px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);color:#E2E8F0;font-family:inherit;font-size:16px}
    .search-bar:focus{outline:none;border-color:#10B981;box-shadow:0 0 0 3px rgba(16,185,129,.08)}
    .search-bar::placeholder{color:rgba(255,255,255,.2)}
    .main-tab{padding:12px 20px;border-radius:14px;cursor:pointer;font-size:14px;font-weight:700;white-space:nowrap;transition:all .15s;border:1px solid transparent;flex:1;text-align:center;min-height:44px;display:flex;align-items:center;justify-content:center}
    .main-tab.active{background:rgba(16,185,129,.1);color:#34D399;border-color:rgba(16,185,129,.2)}
    .main-tab:not(.active){color:#64748B}
    .quick-act{display:flex;flex-direction:column;align-items:center;gap:6px;padding:16px 8px;border-radius:14px;cursor:pointer;transition:all .15s;flex:1;text-align:center;min-height:72px}
    .quick-act:active{transform:scale(.95);opacity:.85}
    .success-ov{position:fixed;inset:0;background:rgba(0,0,0,.7);z-index:9999;display:flex;align-items:center;justify-content:center;animation:fadeIn .2s}
    .success-card{background:linear-gradient(155deg,#1a2540,#111a2e);border:2px solid rgba(16,185,129,.3);border-radius:24px;padding:40px 24px;text-align:center;animation:slideUp .3s;max-width:360px;width:92%}
    /* ═══ BOTTOM NAV ═══ */
    .btm-nav{position:fixed;bottom:0;left:0;right:0;z-index:200;background:rgba(6,11,22,.97);backdrop-filter:blur(20px);border-top:1px solid rgba(255,255,255,.05);padding:6px 8px calc(6px + env(safe-area-inset-bottom,0px));display:flex;justify-content:space-around;align-items:center}
    .btm-nav-item{display:flex;flex-direction:column;align-items:center;gap:2px;padding:6px 12px;border-radius:12px;cursor:pointer;transition:all .15s;position:relative;min-width:60px}
    .btm-nav-item.active{background:rgba(16,185,129,.08)}
    .btm-nav-item .nav-icon{font-size:20px;line-height:1}
    .btm-nav-item .nav-label{font-size:10px;font-weight:600;color:#64748B}
    .btm-nav-item.active .nav-label{color:#34D399}
    .btm-nav-badge{position:absolute;top:0;right:6px;width:16px;height:16px;border-radius:50%;background:#EF4444;color:#fff;font-size:9px;font-weight:800;display:flex;align-items:center;justify-content:center}
    /* ═══ TOP BAR MOBILE ═══ */
    .top-bar{position:sticky;top:0;z-index:100;background:rgba(6,11,22,.95);backdrop-filter:blur(20px);border-bottom:1px solid rgba(255,255,255,.04);padding:10px 16px env(safe-area-inset-top,0px)}
    .top-bar-inner{max-width:1100px;margin:0 auto;display:flex;justify-content:space-between;align-items:center;gap:8px}
    /* ═══ ACCORDION MENU ═══ */
    .acc-item{border-radius:16px;overflow:hidden;margin-bottom:8px;border:1px solid rgba(255,255,255,.04);transition:all .2s}
    .acc-item.open{border-color:rgba(16,185,129,.12)}
    .acc-head{display:flex;align-items:center;justify-content:space-between;padding:16px 18px;cursor:pointer;min-height:56px;transition:background .15s}
    .acc-head:active{background:rgba(255,255,255,.03)}
    .acc-head-left{display:flex;align-items:center;gap:12px}
    .acc-icon{width:40px;height:40px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0}
    .acc-arrow{font-size:12px;color:#475569;transition:transform .2s}
    .acc-item.open .acc-arrow{transform:rotate(90deg);color:#34D399}
    .acc-body{padding:0 18px 16px;animation:fadeIn .2s}
    .acc-sub{margin-left:12px;padding-left:12px;border-left:2px solid rgba(255,255,255,.04)}
    .acc-sub-item{padding:12px 14px;border-radius:12px;margin-bottom:4px;display:flex;align-items:center;justify-content:space-between;background:rgba(255,255,255,.015);min-height:48px}
    .acc-sub-item:active{background:rgba(255,255,255,.04)}
    .acc-label{font-size:13px;color:#94A3B8;font-weight:600}
    .acc-value{font-size:14px;color:#E2E8F0;font-weight:600;text-align:right}
    /* ═══ CONTENT AREA ═══ */
    .content-area{max-width:1100px;margin:0 auto;padding:14px 14px calc(80px + env(safe-area-inset-bottom,0px))}
    /* ═══ MOBILE RESPONSIVE ═══ */
    @media(max-width:640px){
      .rg{grid-template-columns:1fr!important}
      .rg2{grid-template-columns:1fr 1fr!important}
      .main-tab{padding:10px 14px;font-size:13px}
      .mdl{border-radius:20px 20px 0 0;max-height:94vh;padding:20px 16px calc(20px + env(safe-area-inset-bottom,0px))}
      .ov{align-items:flex-end}
      .quick-act{padding:12px 4px}
      .hide-mobile{display:none!important}
      .top-bar{padding:8px 12px}
    }
    @media(min-width:641px){
      .hide-desktop{display:none!important}
      .ov{align-items:center;padding:16px}
      .mdl{border-radius:22px;max-height:88vh}
      .btm-nav{display:none}
      .content-area{padding:16px 16px 40px}
    }
  `}</style>;
}

function SplashScreen() {
  return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#060B16" }}>
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 56, marginBottom: 12, animation: "pulse 1.5s infinite" }}>📒</div>
      <div style={{ fontSize: 28, fontWeight: 800, background: "linear-gradient(135deg,#34D399,#60A5FA)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>মুন্সী</div>
      <div style={{ fontSize: 12, color: "#475569", marginTop: 8, letterSpacing: 3 }}>SMART RENT MANAGER</div>
      <div style={{ marginTop: 24, width: 20, height: 20, border: "2px solid #10B981", borderTopColor: "transparent", borderRadius: "50%", animation: "spin .8s linear infinite", margin: "24px auto 0" }} />
    </div>
  </div>;
}

// ═══ WELCOME / LOGIN ═══
function WelcomeScreen({ bn, lang, setLang, onGoogle, onEmail, onSetScreen }) {
  const [mode, setMode] = useState("main"); // main, email-login, phone-reg, phone-login-wa
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [pass2, setPass2] = useState("");
  const [phone, setPhone] = useState("");
  const [otp, setOtp] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [otpVerified, setOtpVerified] = useState(false);
  const [confirmResult, setConfirmResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const handleEmail = async (isNew) => {
    if (!email || !pass) return;
    setBusy(true);
    await onEmail(email, pass, isNew);
    setBusy(false);
  };

  // Send OTP via Firebase Phone Auth
  const handleSendOTP = async () => {
    if (!phone || phone.length < 10) { setError(bn ? "সঠিক মোবাইল নম্বর দিন" : "Enter valid phone number"); return; }
    setBusy(true); setError("");
    try {
      const recaptcha = setupRecaptcha("recaptcha-container");
      const result = await sendPhoneOTP(phone);
      setConfirmResult(result);
      setOtpSent(true);
    } catch (e) {
      console.error(e);
      setError(e.code === "auth/too-many-requests" 
        ? (bn ? "অনেক চেষ্টা হয়েছে। কিছুক্ষণ পর আবার চেষ্টা করুন।" : "Too many attempts. Try later.")
        : (bn ? "OTP পাঠাতে ব্যর্থ: " + e.message : "Failed to send OTP: " + e.message));
    }
    setBusy(false);
  };

  // Verify OTP
  const handleVerifyOTP = async () => {
    if (!otp || otp.length < 4) { setError(bn ? "OTP দিন" : "Enter OTP"); return; }
    setBusy(true); setError("");
    try {
      if (mode === "phone-login-wa") {
        // WhatsApp/Phone direct login — OTP verification signs in directly
        await confirmResult.confirm(otp);
        // Firebase auto-logs in after phone verification
      } else {
        // Registration flow — verify OTP, then create with email+password
        const credential = await confirmResult.confirm(otp);
        setOtpVerified(true);
        // Phone user is now signed in temporarily, we'll link email/password
      }
    } catch (e) {
      setError(bn ? "ভুল OTP! আবার চেষ্টা করুন।" : "Wrong OTP! Try again.");
    }
    setBusy(false);
  };

  // Complete registration: Link email/password to phone-verified account
  const handlePhoneRegister = async () => {
    if (!pass || pass.length < 6) { setError(bn ? "পাসওয়ার্ড কমপক্ষে ৬ অক্ষর" : "Password min 6 characters"); return; }
    if (pass !== pass2) { setError(bn ? "পাসওয়ার্ড মিলছে না" : "Passwords don't match"); return; }
    setBusy(true); setError("");
    try {
      // Create a fake email from phone number for email/password login later
      const fakeEmail = phone.replace(/[^0-9]/g, "") + "@munsi.app";
      const emailCred = EmailAuthProvider.credential(fakeEmail, pass);
      await linkWithCredential(auth.currentUser, emailCred);
      // Done — user is now logged in with phone + has email/password linked
    } catch (e) {
      if (e.code === "auth/email-already-in-use") {
        setError(bn ? "এই নম্বর দিয়ে আগেই অ্যাকাউন্ট আছে!" : "Account already exists with this number!");
      } else {
        setError(e.message);
      }
    }
    setBusy(false);
  };

  const resetState = () => {
    setPhone(""); setOtp(""); setOtpSent(false); setOtpVerified(false);
    setConfirmResult(null); setPass(""); setPass2(""); setEmail(""); setError("");
  };

  return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, background: "radial-gradient(ellipse at 20% 20%,rgba(16,185,129,.05) 0%,transparent 50%),radial-gradient(ellipse at 80% 80%,rgba(59,130,246,.05) 0%,transparent 50%),#060B16" }}>
    <div style={{ width: "100%", maxWidth: 420, animation: "fadeIn .5s" }}>
      <div style={{ textAlign: "center", marginBottom: 36 }}>
        <div style={{ fontSize: 60, marginBottom: 8 }}>📒</div>
        <div style={{ fontSize: 34, fontWeight: 800, background: "linear-gradient(135deg,#34D399,#60A5FA)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>মুন্সী</div>
        <div style={{ fontSize: 13, color: "#64748B", marginTop: 4 }}>{bn ? "আপনার ডিজিটাল হিসাবরক্ষক" : "Your Digital Rent Keeper"}</div>
      </div>

      {/* Invisible reCAPTCHA container */}
      <div id="recaptcha-container"></div>

      {/* Error display */}
      {error && <div style={{ padding: "10px 14px", marginBottom: 12, borderRadius: 10, background: "rgba(239,68,68,.08)", border: "1px solid rgba(239,68,68,.15)", color: "#FCA5A5", fontSize: 12, textAlign: "center" }}>⚠️ {error}</div>}

      {/* ═══ MAIN SCREEN ═══ */}
      {mode === "main" && <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <button className="gbtn" onClick={onGoogle}>
          <svg width="20" height="20" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
          {bn ? "Google দিয়ে চালিয়ে যান" : "Continue with Google"}
        </button>

        {/* WhatsApp / Phone Login */}
        <button className="btn" style={{ width: "100%", padding: 14, borderRadius: 14, fontSize: 14, background: "rgba(37,211,102,.08)", border: "1px solid rgba(37,211,102,.2)", color: "#25D366" }} onClick={() => { resetState(); setMode("phone-login-wa"); }}>
          📱 {bn ? "মোবাইল নম্বর দিয়ে লগইন" : "Continue with Phone"}
        </button>

        <div style={{ textAlign: "center", margin: "4px 0", color: "#334155", fontSize: 12 }}>— {bn ? "অথবা" : "or"} —</div>

        <button className="btn bg" style={{ width: "100%", padding: 14, borderRadius: 14, fontSize: 14 }} onClick={() => { resetState(); setMode("phone-reg"); }}>
          📝 {bn ? "নতুন অ্যাকাউন্ট তৈরি" : "Create Account"}
        </button>
      </div>}

      {/* ═══ PHONE LOGIN (WhatsApp/Phone) ═══ */}
      {mode === "phone-login-wa" && <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, color: "#fff", textAlign: "center" }}>
          📱 {bn ? "মোবাইল দিয়ে লগইন" : "Phone Login"}
        </h3>

        {!otpSent ? <>
          <div><label className="lbl">{bn ? "মোবাইল নম্বর" : "Mobile Number"}</label>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontSize: 13, color: "#64748B", padding: "10px 8px", background: "rgba(255,255,255,.03)", borderRadius: 8, border: "1px solid rgba(255,255,255,.06)" }}>🇧🇩 +88</span>
              <input className="inp" style={{ flex: 1 }} type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="01XXXXXXXXX" maxLength={11} />
            </div>
          </div>
          <button className="btn bp" style={{ width: "100%", padding: 14, fontSize: 15 }} onClick={handleSendOTP} disabled={busy}>
            {busy ? "⏳ OTP পাঠানো হচ্ছে..." : (bn ? "📩 OTP পাঠান" : "📩 Send OTP")}
          </button>
        </> : <>
          <div style={{ padding: 12, borderRadius: 10, background: "rgba(37,211,102,.06)", border: "1px solid rgba(37,211,102,.12)", textAlign: "center", fontSize: 12, color: "#25D366" }}>
            ✅ {bn ? `${phone} নম্বরে OTP পাঠানো হয়েছে` : `OTP sent to ${phone}`}
          </div>
          <div><label className="lbl">OTP</label>
            <input className="inp" type="text" value={otp} onChange={e => setOtp(e.target.value)} placeholder="••••••" maxLength={6}
              style={{ textAlign: "center", fontSize: 22, letterSpacing: 8, fontFamily: "monospace" }} onKeyDown={e => e.key === "Enter" && handleVerifyOTP()} />
          </div>
          <button className="btn bp" style={{ width: "100%", padding: 14, fontSize: 15 }} onClick={handleVerifyOTP} disabled={busy}>
            {busy ? "⏳" : (bn ? "✓ যাচাই করুন" : "✓ Verify & Login")}
          </button>
          <button className="btn bg bs" onClick={() => { setOtpSent(false); setOtp(""); setConfirmResult(null); }} style={{ alignSelf: "center", fontSize: 11 }}>🔄 {bn ? "আবার পাঠান" : "Resend OTP"}</button>
        </>}
        <button className="btn bg bs" onClick={() => { resetState(); setMode("main"); }} style={{ alignSelf: "center" }}>← {bn ? "পিছনে" : "Back"}</button>
      </div>}

      {/* ═══ PHONE REGISTRATION (New Account) ═══ */}
      {mode === "phone-reg" && <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, color: "#fff", textAlign: "center" }}>
          📝 {bn ? "নতুন অ্যাকাউন্ট" : "Create Account"}
        </h3>

        {/* Step 1: Phone + OTP */}
        {!otpVerified ? <>
          {!otpSent ? <>
            <div><label className="lbl">{bn ? "মোবাইল নম্বর" : "Mobile Number"}</label>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ fontSize: 13, color: "#64748B", padding: "10px 8px", background: "rgba(255,255,255,.03)", borderRadius: 8, border: "1px solid rgba(255,255,255,.06)" }}>🇧🇩 +88</span>
                <input className="inp" style={{ flex: 1 }} type="tel" value={phone} onChange={e => setPhone(e.target.value)} placeholder="01XXXXXXXXX" maxLength={11} />
              </div>
            </div>
            <button className="btn bp" style={{ width: "100%", padding: 14, fontSize: 15 }} onClick={handleSendOTP} disabled={busy}>
              {busy ? "⏳ OTP পাঠানো হচ্ছে..." : (bn ? "📩 OTP পাঠান" : "📩 Send OTP")}
            </button>
          </> : <>
            <div style={{ padding: 12, borderRadius: 10, background: "rgba(37,211,102,.06)", border: "1px solid rgba(37,211,102,.12)", textAlign: "center", fontSize: 12, color: "#25D366" }}>
              ✅ {bn ? `${phone} নম্বরে OTP পাঠানো হয়েছে` : `OTP sent to ${phone}`}
            </div>
            <div><label className="lbl">OTP</label>
              <input className="inp" type="text" value={otp} onChange={e => setOtp(e.target.value)} placeholder="••••••" maxLength={6}
                style={{ textAlign: "center", fontSize: 22, letterSpacing: 8, fontFamily: "monospace" }} onKeyDown={e => e.key === "Enter" && handleVerifyOTP()} />
            </div>
            <button className="btn bp" style={{ width: "100%", padding: 14, fontSize: 15 }} onClick={handleVerifyOTP} disabled={busy}>
              {busy ? "⏳" : (bn ? "✓ OTP যাচাই করুন" : "✓ Verify OTP")}
            </button>
            <button className="btn bg bs" onClick={() => { setOtpSent(false); setOtp(""); setConfirmResult(null); }} style={{ alignSelf: "center", fontSize: 11 }}>🔄 {bn ? "আবার পাঠান" : "Resend OTP"}</button>
          </>}
        </> :
        /* Step 2: Set Password (after OTP verified) */
        <>
          <div style={{ padding: 12, borderRadius: 10, background: "rgba(16,185,129,.06)", border: "1px solid rgba(16,185,129,.12)", textAlign: "center", fontSize: 12, color: "#34D399" }}>
            ✅ {bn ? `${phone} নম্বর যাচাই সম্পন্ন!` : `${phone} verified!`}
          </div>
          <div><label className="lbl">{bn ? "পাসওয়ার্ড সেট করুন" : "Set Password"}</label>
            <input className="inp" type="password" value={pass} onChange={e => setPass(e.target.value)} placeholder={bn ? "কমপক্ষে ৬ অক্ষর" : "Min 6 characters"} />
          </div>
          <div><label className="lbl">{bn ? "পাসওয়ার্ড নিশ্চিত করুন" : "Confirm Password"}</label>
            <input className="inp" type="password" value={pass2} onChange={e => setPass2(e.target.value)} placeholder={bn ? "আবার পাসওয়ার্ড দিন" : "Re-enter password"} onKeyDown={e => e.key === "Enter" && handlePhoneRegister()} />
          </div>
          {pass && pass2 && pass === pass2 && <div style={{ fontSize: 11, color: "#34D399", textAlign: "center" }}>✅ {bn ? "পাসওয়ার্ড মিলেছে" : "Passwords match"}</div>}
          {pass && pass2 && pass !== pass2 && <div style={{ fontSize: 11, color: "#EF4444", textAlign: "center" }}>❌ {bn ? "পাসওয়ার্ড মিলছে না" : "Passwords don't match"}</div>}
          <button className="btn bp" style={{ width: "100%", padding: 14, fontSize: 15 }} onClick={handlePhoneRegister} disabled={busy}>
            {busy ? "⏳" : (bn ? "✓ অ্যাকাউন্ট তৈরি করুন →" : "✓ Create Account →")}
          </button>
        </>}

        <button className="btn bg bs" onClick={() => { resetState(); setMode("main"); }} style={{ alignSelf: "center" }}>← {bn ? "পিছনে" : "Back"}</button>
      </div>}

      <div style={{ textAlign: "center", marginTop: 20 }}>
        <button className="btn bg bs" onClick={() => setLang(bn ? "en" : "bn")}>🌐 {bn ? "English" : "বাংলা"}</button>
      </div>
    </div>
  </div>;
}

// ═══ CHOOSE ROLE (after first sign in) ═══
function ChooseRole({ bn, user, onLandlord, onTenant, onAdmin, onLogout }) {
  return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, background: "#060B16" }}>
    <div style={{ width: "100%", maxWidth: 440, animation: "fadeIn .4s" }}>
      <div style={{ textAlign: "center", marginBottom: 28 }}>
        <div style={{ fontSize: 48, marginBottom: 8 }}>📒</div>
        <h2 style={{ fontSize: 20, fontWeight: 800, color: "#fff" }}>{bn ? "স্বাগতম!" : "Welcome!"}</h2>
        <p style={{ fontSize: 13, color: "#64748B", marginTop: 4 }}>{user?.email}</p>
        <p style={{ fontSize: 14, color: "#94A3B8", marginTop: 12 }}>{bn ? "আপনি কীভাবে ব্যবহার করতে চান?" : "How do you want to use Munsi?"}</p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <button className="btn" style={{ width: "100%", padding: "18px 20px", background: "linear-gradient(135deg,rgba(16,185,129,.12),rgba(16,185,129,.06))", color: "#34D399", border: "1px solid rgba(16,185,129,.2)", borderRadius: 16, fontSize: 16 }} onClick={onLandlord}>
          🏠 {bn ? "বাড়িওয়ালা / মালিক" : "Landlord / Owner"}
        </button>
        <button className="btn" style={{ width: "100%", padding: "18px 20px", background: "linear-gradient(135deg,rgba(59,130,246,.12),rgba(59,130,246,.06))", color: "#60A5FA", border: "1px solid rgba(59,130,246,.2)", borderRadius: 16, fontSize: 16 }} onClick={onTenant}>
          👤 {bn ? "ভাড়াটিয়া" : "Tenant"}
        </button>
        <div style={{ textAlign: "center", marginTop: 8 }}>
          <button className="btn bg bs" onClick={onAdmin}>👑 Admin</button>
          <button className="btn bg bs" onClick={onLogout} style={{ marginLeft: 8 }}>🚪 {bn ? "বের হন" : "Logout"}</button>
        </div>
      </div>
    </div>
  </div>;
}

// ═══ ADMIN PIN ═══
function AdminPinScreen({ bn, onSubmit, onBack }) {
  const [pin, setPin] = useState("");
  return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, background: "#060B16" }}>
    <div style={{ width: "100%", maxWidth: 380, animation: "fadeIn .4s" }}>
      <button className="btn bg bs" onClick={onBack} style={{ marginBottom: 16 }}>← {bn ? "পিছনে" : "Back"}</button>
      <div className="G2" style={{ padding: 32, textAlign: "center" }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>👑</div>
        <h2 style={{ fontSize: 20, fontWeight: 800, color: "#fff", marginBottom: 20 }}>Admin PIN</h2>
        <input className="inp" type="password" maxLength={6} value={pin} onChange={e => setPin(e.target.value)} placeholder="••••"
          style={{ textAlign: "center", fontSize: 28, letterSpacing: 10, fontFamily: "monospace", padding: 16 }}
          onKeyDown={e => e.key === "Enter" && onSubmit(pin)} />
        <button className="btn bp" style={{ width: "100%", padding: 14, marginTop: 16, fontSize: 15 }} onClick={() => onSubmit(pin)}>
          👑 {bn ? "প্রবেশ" : "Enter"} →
        </button>
      </div>
    </div>
  </div>;
}

// ═══ REGISTER LANDLORD ═══
function RegLandlord({ bn, user, onReg, onBack }) {
  const [f, sF] = useState({ name: user?.displayName || "", phone: "", email: user?.email || "", address: "", location: "", holdingNo: "", tinNo: "", photo: user?.photoURL || "" });
  const set = (k, v) => sF(o => ({ ...o, [k]: v }));

  return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, background: "#060B16" }}>
    <div style={{ width: "100%", maxWidth: 500, animation: "fadeIn .4s" }}>
      <button className="btn bg bs" onClick={onBack} style={{ marginBottom: 12 }}>← {bn ? "পিছনে" : "Back"}</button>
      <div className="G2" style={{ padding: 28 }}>
        <h2 style={{ fontSize: 20, fontWeight: 800, color: "#fff", textAlign: "center", marginBottom: 4 }}>🏠 {bn ? "বাড়িওয়ালা তথ্য" : "Landlord Info"}</h2>
        <p style={{ fontSize: 12, color: "#64748B", textAlign: "center", marginBottom: 20 }}>{bn ? "নিবন্ধন করলে ভাড়াটিয়াদের জন্য একটি ইনভাইট কোড পাবেন" : "You'll get an invite code for tenants"}</p>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div><label className="lbl">{bn ? "নাম" : "Name"} *</label><input className="inp" value={f.name} onChange={e => set("name", e.target.value)} /></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div><label className="lbl">{bn ? "ফোন" : "Phone"} *</label><input className="inp" value={f.phone} onChange={e => set("phone", e.target.value)} placeholder="01XXXXXXXXX" /></div>
            <div><label className="lbl">{bn ? "ইমেইল" : "Email"}</label><input className="inp" value={f.email} onChange={e => set("email", e.target.value)} /></div>
          </div>
          <div><label className="lbl">{bn ? "ঠিকানা" : "Address"} *</label><textarea className="inp" style={{ minHeight: 50 }} value={f.address} onChange={e => set("address", e.target.value)} placeholder={bn ? "বাড়ি, রোড, এলাকা" : "House, Road, Area"} /></div>
          <div><label className="lbl">{bn ? "এলাকা" : "Location"} *</label><input className="inp" value={f.location} onChange={e => set("location", e.target.value)} placeholder={bn ? "ধানমন্ডি, ঢাকা" : "Area, City"} /></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div><label className="lbl">{bn ? "হোল্ডিং নং" : "Holding No."}</label><input className="inp" value={f.holdingNo} onChange={e => set("holdingNo", e.target.value)} /></div>
            <div><label className="lbl">TIN ({bn ? "ঐচ্ছিক" : "optional"})</label><input className="inp" value={f.tinNo} onChange={e => set("tinNo", e.target.value)} /></div>
          </div>
          <button className="btn bp" style={{ width: "100%", padding: 14, marginTop: 6, fontSize: 15 }}
            onClick={() => { if (f.name && f.phone && f.address && f.location) onReg(f); else alert(bn ? "সব * চিহ্নিত তথ্য দিন" : "Fill required fields"); }}>
            {bn ? "নিবন্ধন করুন" : "Register"} →
          </button>
        </div>
      </div>
    </div>
  </div>;
}

// ═══ REGISTER TENANT (Multi-step: Phone Search → Browse → Select → Register) ═══
function RegTenant({ bn, user, onReg, onBack }) {
  const [step, setStep] = useState(1); // 1=search, 2=browse, 3=confirm
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [landlord, setLandlord] = useState(null);
  const [searchResults, setSearchResults] = useState([]);
  const [searched, setSearched] = useState(false);
  const [properties, setProperties] = useState([]);
  const [units, setUnits] = useState([]);
  const [selProp, setSelProp] = useState(null);
  const [selUnit, setSelUnit] = useState(null);
  const [f, sF] = useState({ name: user?.displayName || "", phone: "", email: user?.email || "", nid: "", photo: user?.photoURL || "", members: 1, permanentAddress: "" });
  const set = (k, v) => sF(o => ({ ...o, [k]: v }));

  // Step 1: Search landlord by phone
  const searchLandlord = async () => {
    if (!phone || phone.length < 5) return;
    setBusy(true);
    setSearched(true);
    try {
      const results = await DB.searchLandlordsByPhone(phone);
      setSearchResults(results);
      // If exact match, auto-select
      if (results.length === 1) {
        selectLandlord(results[0]);
      }
    } catch (e) { alert("❌ " + e.message); }
    setBusy(false);
  };

  // Select a landlord and load properties
  const selectLandlord = async (ll) => {
    setBusy(true);
    setLandlord(ll);
    try {
      const props = await DB.getPropertiesByLandlord(ll.id);
      setProperties(props);
      const allUnits = await DB.getUnitsByLandlord(ll.id);
      setUnits(allUnits);
      setStep(2);
    } catch (e) { alert("❌ " + e.message); }
    setBusy(false);
  };

  // Step 3: Final registration
  const handleRegister = async () => {
    if (!f.name) { alert(bn ? "নাম দিন" : "Enter name"); return; }
    setBusy(true);
    await onReg(f, landlord.id, selUnit?.id, selUnit?.rent);
    setBusy(false);
  };

  const prop = selProp ? properties.find(p => p.id === selProp) : null;
  const propUnits = selProp ? units.filter(u => u.propertyId === selProp) : [];
  const vacantUnits = propUnits.filter(u => u.isVacant);
  const floors = prop ? [...new Set(propUnits.map(u => u.floor))].sort((a, b) => a - b) : [];

  return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, background: "#060B16" }}>
    <div style={{ width: "100%", maxWidth: 600, animation: "fadeIn .4s" }}>
      <button className="btn bg bs" onClick={step === 1 ? onBack : step === 3 ? () => setStep(2) : () => { setSelProp(null); setSelUnit(null); setStep(step > 1 ? step - 1 : 1); }} style={{ marginBottom: 12 }}>← {bn ? "পিছনে" : "Back"}</button>

      {/* STEP INDICATOR */}
      <div style={{ display: "flex", gap: 4, marginBottom: 16, justifyContent: "center" }}>
        {[1,2,3].map(s => <div key={s} style={{ width: s === step ? 30 : 10, height: 4, borderRadius: 2, background: s <= step ? "#34D399" : "rgba(255,255,255,.06)", transition: "all .3s" }} />)}
      </div>

      {/* ── STEP 1: SEARCH BY PHONE ── */}
      {step === 1 && <div className="G2" style={{ padding: 28 }}>
        <div style={{ textAlign: "center", marginBottom: 20 }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>📞</div>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: "#fff" }}>{bn ? "বাড়িওয়ালা খুঁজুন" : "Find Your Landlord"}</h2>
          <p style={{ fontSize: 12, color: "#64748B", marginTop: 4 }}>{bn ? "বাড়িওয়ালার মোবাইল নম্বর দিয়ে সার্চ করুন" : "Search by landlord's phone number"}</p>
        </div>

        <div style={{ display: "flex", gap: 8 }}>
          <input className="inp" value={phone} onChange={e => setPhone(e.target.value)} placeholder={bn ? "01XXXXXXXXX" : "01XXXXXXXXX"}
            style={{ fontSize: 18, fontWeight: 700, letterSpacing: 1, fontFamily: "monospace", flex: 1 }}
            onKeyDown={e => e.key === "Enter" && searchLandlord()} />
          <button className="btn bp" style={{ padding: "12px 20px", fontSize: 15 }} onClick={searchLandlord} disabled={busy}>
            {busy ? "⏳" : "🔍"}
          </button>
        </div>

        {/* Search Results */}
        {searched && !busy && searchResults.length === 0 && <div style={{ marginTop: 16, padding: 16, borderRadius: 12, background: "rgba(239,68,68,.05)", border: "1px solid rgba(239,68,68,.1)", textAlign: "center" }}>
          <div style={{ fontSize: 28, marginBottom: 6 }}>😔</div>
          <div style={{ color: "#EF4444", fontWeight: 600, fontSize: 13 }}>{bn ? "এই নম্বরে কোনো বাড়িওয়ালা পাওয়া যায়নি" : "No landlord found with this number"}</div>
          <div style={{ color: "#475569", fontSize: 11, marginTop: 4 }}>{bn ? "নম্বর ঠিক আছে কিনা যাচাই করুন" : "Please verify the number"}</div>
        </div>}

        {searchResults.length > 1 && <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#94A3B8", marginBottom: 8 }}>{bn ? "বাড়িওয়ালা পাওয়া গেছে:" : "Landlords found:"}</div>
          {searchResults.map(ll => <div key={ll.id} className="G CH" style={{ padding: 16, marginBottom: 8 }} onClick={() => selectLandlord(ll)}>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              <div className="av" style={{ background: "rgba(16,185,129,.08)", borderColor: "rgba(16,185,129,.15)" }}>🏠</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 700, color: "#fff", fontSize: 15 }}>{ll.name}</div>
                <div style={{ fontSize: 11, color: "#64748B" }}>📞 {ll.phone} • 📍 {ll.location || ll.address}</div>
              </div>
              <div style={{ color: "#34D399", fontSize: 18 }}>→</div>
            </div>
          </div>)}
        </div>}
      </div>}

      {/* ── STEP 2: BROWSE PROPERTIES & UNITS ── */}
      {step === 2 && <div>
        {/* Landlord profile card */}
        <div style={{ background: "linear-gradient(135deg,rgba(16,185,129,.08),rgba(59,130,246,.06))", border: "1px solid rgba(16,185,129,.15)", borderRadius: 16, padding: 20, marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <div style={{ width: 56, height: 56, borderRadius: 16, background: "rgba(16,185,129,.1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28 }}>🏠</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 800, color: "#fff", fontSize: 18 }}>{landlord?.name}</div>
              <div style={{ fontSize: 12, color: "#64748B", marginTop: 2 }}>📞 {landlord?.phone}</div>
              <div style={{ fontSize: 11, color: "#475569", marginTop: 1 }}>📍 {landlord?.location || landlord?.address}</div>
            </div>
            <span className="badge bA">✓ {bn ? "যাচাইকৃত" : "Verified"}</span>
          </div>
        </div>

        {!selProp ? <>
          <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 12 }}>{bn ? "🏘️ বাড়ি বাছাই করুন" : "🏘️ Select Property"}</h3>
          {properties.length === 0 ? <div className="G2" style={{ padding: 40, textAlign: "center", color: "#475569" }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>🏗️</div>
            {bn ? "এই বাড়িওয়ালার কোনো বাড়ি এখনো যোগ করা হয়নি" : "No properties listed yet"}
          </div> :
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }} className="rg">
            {properties.map(p => {
              const pu = units.filter(u => u.propertyId === p.id);
              const vac = pu.filter(u => u.isVacant).length;
              return <div key={p.id} className="G CH" style={{ padding: 18, position: "relative", overflow: "hidden", opacity: vac === 0 ? .4 : 1 }} onClick={() => vac > 0 && setSelProp(p.id)}>
                <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg,${p.color || "#10B981"},transparent)` }} />
                <div style={{ fontWeight: 700, fontSize: 15, color: "#fff", marginBottom: 2 }}>{p.name}</div>
                <div style={{ fontSize: 11, color: "#475569", marginBottom: 8 }}>📍 {p.address}</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                  <span className="badge bV">{vac} {bn ? "খালি" : "vacant"}</span>
                  <span className="badge" style={{ background: "rgba(255,255,255,.04)", color: "#64748B" }}>{pu.length} {bn ? "ইউনিট" : "units"}</span>
                </div>
                {vac === 0 && <div style={{ fontSize: 12, color: "#EF4444", marginTop: 6 }}>{bn ? "কোনো ইউনিট খালি নেই" : "No vacancies"}</div>}
              </div>;
            })}
          </div>}
        </> : <>
          {/* Property selected — show vacant units */}
          <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#475569", marginBottom: 14 }}>
            <span style={{ cursor: "pointer", color: "#34D399" }} onClick={() => setSelProp(null)}>🏘️ {bn ? "সব বাড়ি" : "All"}</span>
            <span style={{ opacity: .3 }}>›</span>
            <span style={{ color: "#E2E8F0" }}>{prop?.name}</span>
          </div>

          {prop?.address && <div style={{ fontSize: 11, color: "#475569", marginBottom: 12 }}>📍 {prop.address}</div>}

          <h3 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>{bn ? "🚪 খালি ইউনিট বাছাই করুন" : "🚪 Choose a vacant unit"}</h3>

          {vacantUnits.length === 0 ? <div className="G2" style={{ padding: 30, textAlign: "center", color: "#475569" }}>{bn ? "কোনো খালি ইউনিট নেই" : "No vacant units"}</div> :
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {floors.map(fl => {
              const flUnits = propUnits.filter(u => u.floor === fl && u.isVacant);
              if (flUnits.length === 0) return null;
              return <div key={fl}>
                <div style={{ fontSize: 11, fontWeight: 700, color: "#475569", marginBottom: 6 }}>{bn ? `${fl} তলা` : `Floor ${fl}`}</div>
                <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", gap: 8 }}>
                  {flUnits.map(u => <div key={u.id} className="G CH" onClick={() => { setSelUnit(u); setStep(3); }}
                    style={{ padding: 14, borderRadius: 14, textAlign: "center", border: "1px solid rgba(59,130,246,.1)", background: "rgba(59,130,246,.02)" }}>
                    <div style={{ fontSize: 24, marginBottom: 4 }}>🚪</div>
                    <div style={{ fontSize: 18, fontWeight: 800, color: "#fff" }}>{u.unitNo}</div>
                    <div style={{ fontSize: 12, color: "#64748B", marginTop: 2 }}>{u.type === "flat" ? (bn ? "ফ্ল্যাট" : "Flat") : (bn ? "রুম" : "Room")}</div>
                    {u.rent > 0 && <div style={{ fontWeight: 800, color: "#34D399", fontSize: 14, marginTop: 6 }}>৳{bn ? FM(u.rent) : FE(u.rent)}<span style={{ fontSize: 11, color: "#475569" }}>/{bn ? "মাস" : "mo"}</span></div>}
                    {u.bedrooms > 0 && <div style={{ fontSize: 12, color: "#64748B", marginTop: 2 }}>🛏️ {u.bedrooms} 🚿 {u.bathrooms || 0}</div>}
                    {u.conditions && <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 4, padding: "3px 6px", background: "rgba(255,255,255,.02)", borderRadius: 6 }}>📋 {u.conditions.slice(0, 40)}{u.conditions.length > 40 ? "..." : ""}</div>}
                  </div>)}
                </div>
              </div>;
            })}
          </div>}
        </>}
      </div>}

      {/* ── STEP 3: CONFIRM & FILL INFO ── */}
      {step === 3 && selUnit && <div className="G2" style={{ padding: 28 }}>
        {/* Selected unit summary */}
        <div style={{ background: "rgba(16,185,129,.06)", border: "1px solid rgba(16,185,129,.15)", borderRadius: 14, padding: 16, marginBottom: 20, textAlign: "center" }}>
          <div style={{ fontSize: 11, color: "#34D399", fontWeight: 700 }}>{bn ? "আপনার নির্বাচিত ইউনিট" : "Your Selected Unit"}</div>
          <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 16, marginTop: 8 }}>
            <div>
              <div style={{ fontSize: 28, fontWeight: 800, color: "#fff" }}>{selUnit.unitNo}</div>
              <div style={{ fontSize: 11, color: "#64748B" }}>{prop?.name} • {bn ? `${selUnit.floor} তলা` : `Floor ${selUnit.floor}`}</div>
            </div>
            {selUnit.rent > 0 && <div style={{ borderLeft: "1px solid rgba(255,255,255,.06)", paddingLeft: 16 }}>
              <div style={{ fontSize: 24, fontWeight: 800, color: "#34D399" }}>৳{bn ? FM(selUnit.rent) : FE(selUnit.rent)}</div>
              <div style={{ fontSize: 12, color: "#475569" }}>/{bn ? "মাস" : "month"}</div>
            </div>}
          </div>
          {selUnit.conditions && <div style={{ marginTop: 10, padding: "8px 12px", background: "rgba(255,255,255,.03)", borderRadius: 8, fontSize: 11, color: "#94A3B8", textAlign: "left" }}>
            📋 <strong>{bn ? "শর্ত:" : "Terms:"}</strong> {selUnit.conditions}
          </div>}
        </div>

        <h3 style={{ fontSize: 16, fontWeight: 700, color: "#fff", textAlign: "center", marginBottom: 14 }}>👤 {bn ? "আপনার তথ্য দিন" : "Your Information"}</h3>

        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div><label className="lbl">{bn ? "নাম" : "Name"} *</label><input className="inp" value={f.name} onChange={e => set("name", e.target.value)} /></div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div><label className="lbl">{bn ? "ফোন" : "Phone"}</label><input className="inp" value={f.phone} onChange={e => set("phone", e.target.value)} placeholder="01XXXXXXXXX" /></div>
            <div><label className="lbl">NID</label><input className="inp" value={f.nid} onChange={e => set("nid", e.target.value)} /></div>
          </div>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <div><label className="lbl">{bn ? "পরিবারের সদস্য" : "Family Members"}</label><input className="inp" type="number" min="1" value={f.members} onChange={e => set("members", Number(e.target.value))} /></div>
            <div><label className="lbl">{bn ? "ইমেইল" : "Email"}</label><input className="inp" value={f.email} onChange={e => set("email", e.target.value)} /></div>
          </div>
          <div><label className="lbl">🏡 {bn ? "স্থায়ী ঠিকানা" : "Permanent Address"}</label><textarea className="inp" style={{ minHeight: 45 }} value={f.permanentAddress} onChange={e => set("permanentAddress", e.target.value)} placeholder={bn ? "গ্রাম/মহল্লা, উপজেলা, জেলা" : "Village/Area, Upazila, District"} /></div>
          <button className="btn bp" style={{ width: "100%", padding: 14, marginTop: 8, fontSize: 15 }} onClick={handleRegister} disabled={busy}>
            {busy ? "⏳ ..." : (bn ? "✓ নিবন্ধন করুন" : "✓ Register")}
          </button>
        </div>
      </div>}
    </div>
  </div>;
}

// ═══ TOP BAR ═══
function Bar({ bn, lang, setLang, label, icon, user, onLogout, onRefresh, children }) {
  return <div className="top-bar">
    <div className="top-bar-inner">
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 20 }}>📒</span>
        <div><div style={{ fontSize: 14, fontWeight: 800, background: "linear-gradient(135deg,#34D399,#60A5FA)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", lineHeight: 1 }}>মুন্সী</div>
          <div style={{ fontSize: 11, color: "#475569", fontWeight: 600 }}>{icon} {label}</div></div>
      </div>
      <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
        {children}
        <span className="hide-mobile" style={{ fontSize: 11, color: "#64748B", padding: "4px 8px", background: "rgba(255,255,255,.025)", borderRadius: 8 }}>{icon} {user}</span>
        {onRefresh && <button className="btn bg bs" onClick={onRefresh} title="Refresh">🔄</button>}
        <button className="btn bg bs" onClick={() => setLang(bn ? "en" : "bn")} style={{ padding: "6px 10px" }}>{bn ? "EN" : "বাং"}</button>
        <button className="btn bd bs" onClick={onLogout} style={{ padding: "6px 10px" }}>{bn ? "🚪" : "🚪"}</button>
      </div>
    </div>
  </div>;
}

// ═══ ADMIN PANEL ═══
function AdminPanel({ db, notices, agreements, expenses, meters, bn, lang, setLang, onLogout, onDeletePayment, onEditPayment, selM, setSelM, selY, setSelY, mk, onRefresh }) {
  const [tab, setTab] = useState("overview");
  const [search, setSearch] = useState("");
  const [selItem, setSelItem] = useState(null);
  const [detailType, setDetailType] = useState(null);
  const { landlords, tenants, properties, units, payments, logs } = db;

  // ─── COMPUTED STATS ───
  const mPay = payments.filter(p => p.monthKey === mk);
  const totCol = mPay.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const mRent = mPay.filter(p => !p.type || p.type === "rent");
  const mUtil = mPay.filter(p => p.type && p.type !== "rent");
  const rentCol = mRent.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const utilCol = mUtil.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const mExp = (expenses || []).filter(e => (e.date || e.createdAt || "").startsWith(`${selY}-${String(selM + 1).padStart(2, "0")}`));
  const totalExpenses = mExp.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const netProfit = totCol - totalExpenses;
  const occ = units.filter(u => !u.isVacant).length;
  const vac = units.filter(u => u.isVacant).length;
  const occRate = units.length ? Math.round((occ / units.length) * 100) : 0;
  const activeTenants = tenants.filter(t => t.unitId && t.status !== "moved_out");
  const movedOut = tenants.filter(t => t.status === "moved_out");

  // 6-month revenue trend
  const months6 = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(selY, selM - i);
    const m = d.getMonth(); const y = d.getFullYear();
    const k = MK(m, y);
    const mp = payments.filter(p => p.monthKey === k);
    const rev = mp.reduce((s, p) => s + (Number(p.amount) || 0), 0);
    months6.push({ label: (bn ? MBN : MEN)[m], key: k, rev });
  }
  const maxRev = Math.max(...months6.map(m => m.rev), 1);

  // Search filter
  const sq = search.toLowerCase();
  const filteredLandlords = sq ? landlords.filter(l => (l.name || "").toLowerCase().includes(sq) || (l.phone || "").includes(sq)) : landlords;
  const filteredTenants = sq ? tenants.filter(t => (t.name || "").toLowerCase().includes(sq) || (t.phone || "").includes(sq)) : tenants;

  // Helper
  const getLL = (lid) => landlords.find(l => l.id === lid);
  const getUnit = (uid) => units.find(u => u.id === uid);
  const getProp = (pid) => properties.find(p => p.id === pid);

  return <div>
    <Bar bn={bn} lang={lang} setLang={setLang} label={bn ? "মাস্টার কন্ট্রোল" : "MASTER CONTROL"} icon="🛡️" user="Admin" onLogout={onLogout} onRefresh={onRefresh}>
      <select className="inp" style={{ width: "auto", padding: "5px 28px 5px 8px", fontSize: 12 }} value={selM} onChange={e => setSelM(Number(e.target.value))}>
        {(bn ? MBN : MEN).map((m, i) => <option key={i} value={i}>{m}</option>)}
      </select>
      <select className="inp" style={{ width: "auto", padding: "5px 28px 5px 8px", fontSize: 12 }} value={selY} onChange={e => setSelY(Number(e.target.value))}>
        {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
      </select>
    </Bar>
    <div className="content-area" style={{ maxWidth: 1200 }}>

      {/* ═══ TAB NAV ═══ */}
      <div style={{ display: "flex", gap: 4, marginBottom: 20, overflowX: "auto", paddingBottom: 4 }}>
        {[{ k: "overview", l: bn ? "📊 সারসংক্ষেপ" : "📊 Overview" },
          { k: "landlords", l: `🏠 ${bn ? "বাড়িওয়ালা" : "Landlords"} (${landlords.length})` },
          { k: "tenants", l: `👤 ${bn ? "ভাড়াটিয়া" : "Tenants"} (${tenants.length})` },
          { k: "properties", l: `🏘️ ${bn ? "বাড়ি" : "Properties"} (${properties.length})` },
          { k: "payments", l: `💰 ${bn ? "পেমেন্ট" : "Payments"} (${mPay.length})` },
          { k: "logs", l: `📋 ${bn ? "লগ" : "Logs"}` },
        ].map(t => <div key={t.k} onClick={() => { setTab(t.k); setSelItem(null); setDetailType(null); }} style={{ padding: "10px 18px", borderRadius: 12, cursor: "pointer", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", background: tab === t.k ? "rgba(139,92,246,.12)" : "transparent", color: tab === t.k ? "#A78BFA" : "#64748B", border: `1px solid ${tab === t.k ? "rgba(139,92,246,.2)" : "transparent"}` }}>{t.l}</div>)}
      </div>

      {/* Global Search */}
      {tab !== "overview" && tab !== "logs" && <div style={{ position: "relative", marginBottom: 16 }}>
        <span style={{ position: "absolute", left: 14, top: "50%", transform: "translateY(-50%)", fontSize: 16, opacity: .4 }}>🔍</span>
        <input className="search-bar" placeholder={bn ? "নাম বা ফোন দিয়ে খুঁজুন..." : "Search by name or phone..."} value={search} onChange={e => setSearch(e.target.value)} />
        {search && <span onClick={() => setSearch("")} style={{ position: "absolute", right: 14, top: "50%", transform: "translateY(-50%)", cursor: "pointer", opacity: .4 }}>✕</span>}
      </div>}

      {/* ═══════════════════════════════════ */}
      {/* ═══ OVERVIEW TAB ═══ */}
      {/* ═══════════════════════════════════ */}
      {tab === "overview" && <div style={{ animation: "fadeIn .3s" }}>

        {/* KPI Cards — 2 rows */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 20 }} className="rg2">
          {[{ i: "💰", l: bn ? "মোট আদায়" : "Total Collected", v: `৳${bn ? FM(totCol) : FE(totCol)}`, c: "#34D399", sub: `${bn ? "ভাড়া" : "Rent"}: ৳${bn ? FM(rentCol) : FE(rentCol)} | ${bn ? "বিল" : "Bills"}: ৳${bn ? FM(utilCol) : FE(utilCol)}` },
            { i: "📈", l: bn ? "নেট মুনাফা" : "Net Profit", v: `৳${bn ? FM(netProfit) : FE(netProfit)}`, c: netProfit >= 0 ? "#10B981" : "#EF4444", sub: `${bn ? "খরচ" : "Expenses"}: ৳${bn ? FM(totalExpenses) : FE(totalExpenses)}` },
            { i: "🏠", l: bn ? "দখল হার" : "Occupancy", v: `${occRate}%`, c: occRate > 80 ? "#10B981" : occRate > 50 ? "#F59E0B" : "#EF4444", sub: `${occ} ${bn ? "ভাড়া" : "occ"} / ${vac} ${bn ? "খালি" : "vac"}` },
            { i: "👥", l: bn ? "সক্রিয় ব্যবহারকারী" : "Active Users", v: `${landlords.length + activeTenants.length}`, c: "#6366F1", sub: `${landlords.length} ${bn ? "বাড়িওয়ালা" : "LL"} + ${activeTenants.length} ${bn ? "ভাড়াটিয়া" : "T"}` },
          ].map((s, i) => <div key={i} className="G" style={{ padding: 18, animation: `fadeIn .3s ease-out ${i * .05}s both` }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
              <span style={{ fontSize: 22 }}>{s.i}</span>
              <span style={{ fontSize: 12, color: "#64748B" }}>{s.l}</span>
            </div>
            <div style={{ fontSize: 24, fontWeight: 800, color: s.c }}>{s.v}</div>
            {s.sub && <div style={{ fontSize: 11, color: "#475569", marginTop: 4 }}>{s.sub}</div>}
          </div>)}
        </div>

        {/* More KPIs row 2 */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 20 }} className="rg2">
          {[{ i: "🏘️", l: bn ? "বাড়ি" : "Properties", v: properties.length, c: "#8B5CF6" },
            { i: "🚪", l: bn ? "মোট ইউনিট" : "Total Units", v: units.length, c: "#06B6D4" },
            { i: "📜", l: bn ? "চুক্তি" : "Agreements", v: (agreements || []).length, c: "#F97316" },
            { i: "📨", l: bn ? "নোটিশ" : "Notices", v: (notices || []).length, c: "#EC4899" },
          ].map((s, i) => <div key={i} className="G CH" style={{ padding: 16 }} onClick={() => setTab(s.i === "🏘️" ? "properties" : s.i === "📨" ? "logs" : "overview")}>
            <div style={{ fontSize: 18 }}>{s.i}</div>
            <div style={{ fontSize: 22, fontWeight: 800, color: s.c, marginTop: 4 }}>{s.v}</div>
            <div style={{ fontSize: 12, color: "#64748B" }}>{s.l}</div>
          </div>)}
        </div>

        {/* 6-Month Revenue Chart */}
        <div className="G" style={{ padding: 20, marginBottom: 16 }}>
          <h4 style={{ fontSize: 15, fontWeight: 700, marginBottom: 16, color: "#fff" }}>📊 {bn ? "৬ মাসের আয়ের ট্রেন্ড" : "6-Month Revenue Trend"}</h4>
          <div style={{ display: "flex", alignItems: "flex-end", gap: 10, height: 140 }}>
            {months6.map((m, i) => <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "#A78BFA" }}>৳{m.rev >= 1000 ? `${Math.round(m.rev / 1000)}K` : m.rev}</div>
              <div style={{ width: "100%", borderRadius: "6px 6px 0 0", background: i === 5 ? "linear-gradient(180deg,#A78BFA,#6366F1)" : "rgba(139,92,246,.15)", height: `${Math.max((m.rev / maxRev) * 100, 4)}%`, transition: "height .5s", minHeight: 4 }} />
              <div style={{ fontSize: 11, color: "#64748B" }}>{m.label}</div>
            </div>)}
          </div>
        </div>

        {/* Two-column: Recent Payments + Recent Logs */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }} className="rg">
          <div className="G" style={{ padding: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h4 style={{ fontSize: 14, fontWeight: 700 }}>💰 {bn ? "সাম্প্রতিক পেমেন্ট" : "Recent Payments"}</h4>
              <span className="badge bA" onClick={() => setTab("payments")} style={{ cursor: "pointer" }}>{bn ? "সব দেখুন →" : "View all →"}</span>
            </div>
            {mPay.slice(0, 6).map(p => {
              const t = tenants.find(x => x.id === p.tenantId);
              return <div key={p.id} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid rgba(255,255,255,.02)", fontSize: 13 }}>
                <div>
                  <span style={{ fontWeight: 600, color: "#E2E8F0" }}>{t?.name || "?"}</span>
                  <span style={{ color: "#475569", marginLeft: 6, fontSize: 11 }}>{p.paidAt?.split("T")[0]}</span>
                </div>
                <span style={{ fontWeight: 700, color: "#34D399" }}>৳{bn ? FM(p.amount) : FE(p.amount)}</span>
              </div>;
            })}
            {mPay.length === 0 && <div style={{ padding: 20, textAlign: "center", color: "#475569" }}>{bn ? "এই মাসে পেমেন্ট নেই" : "No payments this month"}</div>}
          </div>

          <div className="G" style={{ padding: 18 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
              <h4 style={{ fontSize: 14, fontWeight: 700 }}>📋 {bn ? "সাম্প্রতিক কার্যকলাপ" : "Recent Activity"}</h4>
              <span className="badge bA" onClick={() => setTab("logs")} style={{ cursor: "pointer" }}>{bn ? "সব দেখুন →" : "View all →"}</span>
            </div>
            {logs.slice(0, 6).map(l => <div key={l.id} style={{ padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,.02)" }}>
              <div style={{ fontSize: 12, color: "#94A3B8" }}>{l.detail}</div>
              <div style={{ fontSize: 11, color: "#334155" }}>{l.action} • {l.ts ? new Date(l.ts).toLocaleString("bn-BD") : ""}</div>
            </div>)}
            {logs.length === 0 && <div style={{ padding: 20, textAlign: "center", color: "#475569" }}>{bn ? "কোনো কার্যকলাপ নেই" : "No activity"}</div>}
          </div>
        </div>

        {/* Payment Method Breakdown */}
        {mPay.length > 0 && <div className="G" style={{ padding: 18, marginTop: 14 }}>
          <h4 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>💳 {bn ? "পেমেন্ট মাধ্যম ব্রেকডাউন" : "Payment Method Breakdown"}</h4>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            {PAY.map(m => {
              const ct = mPay.filter(p => p.method === m.k);
              const amt = ct.reduce((s, p) => s + (Number(p.amount) || 0), 0);
              if (ct.length === 0) return null;
              return <div key={m.k} style={{ flex: "1 1 120px", padding: 14, borderRadius: 12, background: `${m.c}08`, border: `1px solid ${m.c}20` }}>
                <div style={{ fontSize: 18, marginBottom: 4 }}>{m.i}</div>
                <div style={{ fontSize: 13, fontWeight: 700, color: m.c }}>{m.l}</div>
                <div style={{ fontSize: 18, fontWeight: 800, color: "#fff", marginTop: 4 }}>৳{bn ? FM(amt) : FE(amt)}</div>
                <div style={{ fontSize: 11, color: "#64748B" }}>{ct.length} {bn ? "টি লেনদেন" : "transactions"}</div>
              </div>;
            })}
          </div>
        </div>}
      </div>}

      {/* ═══════════════════════════════════ */}
      {/* ═══ LANDLORDS TAB ═══ */}
      {/* ═══════════════════════════════════ */}
      {tab === "landlords" && <div style={{ animation: "fadeIn .3s" }}>
        {!selItem ? <>
          {filteredLandlords.length === 0 ? <div className="G2" style={{ padding: 40, textAlign: "center" }}>
            <div style={{ fontSize: 48, marginBottom: 8 }}>🏠</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#64748B" }}>{search ? (bn ? "খুঁজে পাওয়া যায়নি" : "Not found") : (bn ? "কোনো বাড়িওয়ালা নেই" : "No landlords")}</div>
          </div> : <div className="G" style={{ overflow: "hidden" }}>
            {filteredLandlords.map(l => {
              const lTenants = tenants.filter(t => t.landlordId === l.id && t.unitId);
              const lProps = properties.filter(p => p.landlordId === l.id);
              const lPay = mPay.filter(p => {
                const t = tenants.find(x => x.id === p.tenantId);
                return t?.landlordId === l.id;
              });
              const lRev = lPay.reduce((s, p) => s + (Number(p.amount) || 0), 0);
              return <div key={l.id} className="row" style={{ cursor: "pointer", padding: 16 }} onClick={() => { setSelItem(l); setDetailType("landlord"); }}>
                <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1 }}>
                  <div className="av" style={{ width: 44, height: 44, borderRadius: 12, background: "rgba(139,92,246,.08)", fontSize: 18 }}>🏠</div>
                  <div>
                    <div style={{ fontWeight: 700, color: "#fff", fontSize: 15 }}>{l.name}</div>
                    <div style={{ fontSize: 12, color: "#64748B" }}>📞 {l.phone} • 📍 {l.location || l.address || "—"}</div>
                    <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                      <span className="badge bA" style={{ fontSize: 10 }}>{lProps.length} {bn ? "বাড়ি" : "props"}</span>
                      <span className="badge bA" style={{ fontSize: 10 }}>{lTenants.length} {bn ? "ভাড়াটিয়া" : "tenants"}</span>
                    </div>
                  </div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontWeight: 800, color: "#34D399", fontSize: 16 }}>৳{bn ? FM(lRev) : FE(lRev)}</div>
                  <div style={{ fontSize: 11, color: "#64748B" }}>{bn ? "এই মাসে" : "this month"}</div>
                  <div style={{ fontFamily: "monospace", fontSize: 13, color: "#A78BFA", marginTop: 4, letterSpacing: 1 }}>{l.inviteCode}</div>
                </div>
              </div>;
            })}
          </div>}
        </> : detailType === "landlord" && <div>
          {/* Landlord Detail View */}
          <button className="btn bg bs" onClick={() => { setSelItem(null); setDetailType(null); }} style={{ marginBottom: 16 }}>← {bn ? "ফিরে যান" : "Back"}</button>
          <div className="G2" style={{ padding: 20, marginBottom: 16 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 14, marginBottom: 16 }}>
              <div className="av" style={{ width: 56, height: 56, fontSize: 24, background: "rgba(139,92,246,.08)" }}>🏠</div>
              <div>
                <h3 style={{ fontSize: 20, fontWeight: 800, color: "#fff" }}>{selItem.name}</h3>
                <div style={{ fontSize: 13, color: "#64748B" }}>📞 {selItem.phone} • ✉️ {selItem.email || "—"}</div>
                <div style={{ fontSize: 12, color: "#475569" }}>📍 {selItem.address || selItem.location || "—"} • 🆔 {selItem.inviteCode}</div>
              </div>
            </div>
            {/* Landlord's Properties */}
            <h4 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10, color: "#A78BFA" }}>🏘️ {bn ? "বাড়িসমূহ" : "Properties"}</h4>
            {properties.filter(p => p.landlordId === selItem.id).map(p => {
              const pu = units.filter(u => u.propertyId === p.id);
              return <div key={p.id} className="G" style={{ padding: 14, marginBottom: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div>
                    <div style={{ fontWeight: 700, color: "#fff", fontSize: 14 }}>{p.name}</div>
                    <div style={{ fontSize: 12, color: "#475569" }}>{p.address} • {pu.length} {bn ? "ইউনিট" : "units"}</div>
                  </div>
                  <div style={{ display: "flex", gap: 4 }}>
                    <span className="badge bA">{pu.filter(u => !u.isVacant).length} {bn ? "ভাড়া" : "occ"}</span>
                    <span className="badge bV">{pu.filter(u => u.isVacant).length} {bn ? "খালি" : "vac"}</span>
                  </div>
                </div>
              </div>;
            })}
            {/* Landlord's Tenants */}
            <h4 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10, marginTop: 16, color: "#34D399" }}>👤 {bn ? "ভাড়াটিয়া" : "Tenants"}</h4>
            {tenants.filter(t => t.landlordId === selItem.id).map(t => {
              const u = getUnit(t.unitId);
              return <div key={t.id} className="row" style={{ background: "rgba(255,255,255,.01)", borderRadius: 10, marginBottom: 4 }}>
                <div>
                  <div style={{ fontWeight: 600, color: "#E2E8F0", fontSize: 13 }}>{t.name}</div>
                  <div style={{ fontSize: 12, color: "#475569" }}>📞 {t.phone} • {u?.unitNo || (bn ? "অ্যাসাইন নেই" : "Unassigned")}</div>
                </div>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontWeight: 700, color: "#34D399" }}>৳{bn ? FM(t.rent) : FE(t.rent)}</div>
                  <span className={`badge ${t.unitId ? "bA" : "bD"}`} style={{ fontSize: 10 }}>{t.unitId ? "✓ Active" : "⏳"}</span>
                </div>
              </div>;
            })}
          </div>
        </div>}
      </div>}

      {/* ═══════════════════════════════════ */}
      {/* ═══ TENANTS TAB ═══ */}
      {/* ═══════════════════════════════════ */}
      {tab === "tenants" && <div style={{ animation: "fadeIn .3s" }}>
        {/* Status filter */}
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <span className="badge bA">{activeTenants.length} {bn ? "সক্রিয়" : "Active"}</span>
          <span className="badge bD">{tenants.filter(t => !t.unitId && t.status !== "moved_out").length} {bn ? "অ্যাসাইন নেই" : "Unassigned"}</span>
          {movedOut.length > 0 && <span className="badge" style={{ background: "rgba(255,255,255,.04)", color: "#475569" }}>{movedOut.length} {bn ? "চলে গেছে" : "Moved out"}</span>}
        </div>
        {filteredTenants.length === 0 ? <div className="G2" style={{ padding: 40, textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>👤</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#64748B" }}>{search ? (bn ? "খুঁজে পাওয়া যায়নি" : "Not found") : (bn ? "কোনো ভাড়াটিয়া নেই" : "No tenants")}</div>
        </div> : <div className="G" style={{ overflow: "hidden" }}>
          {filteredTenants.map(t => {
            const ll = getLL(t.landlordId);
            const u = getUnit(t.unitId);
            const p = u ? getProp(u.propertyId) : null;
            const tPay = mPay.filter(x => x.tenantId === t.id);
            const paid = tPay.reduce((s, x) => s + (Number(x.amount) || 0), 0);
            const isMoved = t.status === "moved_out";
            return <div key={t.id} className="row" style={{ padding: 14, opacity: isMoved ? .5 : 1 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1 }}>
                <div className="av" style={{ width: 40, height: 40, borderRadius: 10, fontSize: 16 }}>👤</div>
                <div>
                  <div style={{ fontWeight: 700, color: "#fff", fontSize: 14 }}>{t.name} {isMoved && <span style={{ fontSize: 11, color: "#EF4444" }}>({bn ? "চলে গেছে" : "moved out"})</span>}</div>
                  <div style={{ fontSize: 12, color: "#64748B" }}>📞 {t.phone} • 🏠 {ll?.name || "?"} • {u?.unitNo || "—"} {p ? `(${p.name})` : ""}</div>
                  <div style={{ display: "flex", gap: 6, marginTop: 4 }}>
                    {t.unitId && <span className="badge bA" style={{ fontSize: 10 }}>{bn ? "সক্রিয়" : "Active"}</span>}
                    {t.advance > 0 && <span className="badge bV" style={{ fontSize: 10 }}>💵 ৳{t.advance}</span>}
                    {t.moveInDate && <span style={{ fontSize: 11, color: "#475569" }}>📅 {t.moveInDate}</span>}
                  </div>
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontWeight: 800, color: "#34D399", fontSize: 16 }}>৳{bn ? FM(t.rent) : FE(t.rent)}</div>
                {!isMoved && <div style={{ fontSize: 12, color: paid >= t.rent ? "#34D399" : "#F59E0B", fontWeight: 600 }}>
                  {paid >= t.rent ? `✅ ${bn ? "পেইড" : "Paid"}` : `⏳ ৳${bn ? FM(paid) : FE(paid)}/${bn ? FM(t.rent) : FE(t.rent)}`}
                </div>}
              </div>
            </div>;
          })}
        </div>}
      </div>}

      {/* ═══════════════════════════════════ */}
      {/* ═══ PROPERTIES TAB ═══ */}
      {/* ═══════════════════════════════════ */}
      {tab === "properties" && <div style={{ animation: "fadeIn .3s" }}>
        {properties.length === 0 ? <div className="G2" style={{ padding: 40, textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>🏘️</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#64748B" }}>{bn ? "কোনো বাড়ি নেই" : "No properties"}</div>
        </div> : properties.map(p => {
          const ll = getLL(p.landlordId);
          const pu = units.filter(u => u.propertyId === p.id);
          const occU = pu.filter(u => !u.isVacant);
          const vacU = pu.filter(u => u.isVacant);
          const pTenants = tenants.filter(t => pu.some(u => u.id === t.unitId));
          const totalRent = pTenants.reduce((s, t) => s + (Number(t.rent) || 0), 0);
          return <div key={p.id} className="G2" style={{ padding: 18, marginBottom: 12, borderLeft: `3px solid ${p.color || "#8B5CF6"}` }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 12 }}>
              <div>
                <div style={{ fontWeight: 800, color: "#fff", fontSize: 17 }}>{p.name}</div>
                <div style={{ fontSize: 13, color: "#64748B" }}>📍 {p.address} • 🏠 {ll?.name || "?"}</div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontWeight: 800, color: "#A78BFA", fontSize: 16 }}>৳{bn ? FM(totalRent) : FE(totalRent)}</div>
                <div style={{ fontSize: 11, color: "#475569" }}>{bn ? "মাসিক ভাড়া" : "monthly rent"}</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
              <span className="badge bA">{occU.length} {bn ? "ভাড়া" : "occupied"}</span>
              <span className="badge bV">{vacU.length} {bn ? "খালি" : "vacant"}</span>
              <span className="badge" style={{ background: "rgba(255,255,255,.04)", color: "#94A3B8" }}>{p.floors} {bn ? "তলা" : "floors"}</span>
            </div>
            {/* Unit grid */}
            <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(pu.length, 6)}, 1fr)`, gap: 6 }}>
              {pu.map(u => {
                const t = tenants.find(x => x.unitId === u.id);
                return <div key={u.id} style={{ padding: "8px 6px", borderRadius: 8, textAlign: "center", background: u.isVacant ? "rgba(59,130,246,.04)" : "rgba(16,185,129,.04)", border: `1px solid ${u.isVacant ? "rgba(59,130,246,.1)" : "rgba(16,185,129,.1)"}`, fontSize: 11 }}>
                  <div style={{ fontWeight: 800, color: "#fff", fontSize: 13 }}>{u.unitNo}</div>
                  {t ? <div style={{ fontSize: 10, color: "#34D399", marginTop: 2 }}>{t.name?.split(" ")[0]}</div>
                    : <div style={{ fontSize: 10, color: "#60A5FA" }}>{bn ? "খালি" : "Vacant"}</div>}
                </div>;
              })}
            </div>
          </div>;
        })}
      </div>}

      {/* ═══════════════════════════════════ */}
      {/* ═══ PAYMENTS TAB ═══ */}
      {/* ═══════════════════════════════════ */}
      {tab === "payments" && <div style={{ animation: "fadeIn .3s" }}>
        {/* Monthly summary */}
        <div className="G" style={{ padding: 16, marginBottom: 14 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 12, color: "#64748B" }}>{bn ? "ভাড়া" : "Rent"}</div>
              <div style={{ fontWeight: 800, color: "#34D399", fontSize: 18 }}>৳{bn ? FM(rentCol) : FE(rentCol)}</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 12, color: "#64748B" }}>{bn ? "বিল" : "Bills"}</div>
              <div style={{ fontWeight: 800, color: "#FBBF24", fontSize: 18 }}>৳{bn ? FM(utilCol) : FE(utilCol)}</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ fontSize: 12, color: "#64748B" }}>{bn ? "মোট" : "Total"}</div>
              <div style={{ fontWeight: 800, color: "#fff", fontSize: 18 }}>৳{bn ? FM(totCol) : FE(totCol)}</div>
            </div>
          </div>
        </div>

        {mPay.length === 0 ? <div className="G2" style={{ padding: 40, textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>💰</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#64748B" }}>{bn ? "এই মাসে কোনো পেমেন্ট নেই" : "No payments this month"}</div>
        </div> : <div className="G" style={{ overflow: "hidden" }}>
          {mPay.sort((a, b) => (b.paidAt || "").localeCompare(a.paidAt || "")).map(p => {
            const t = tenants.find(x => x.id === p.tenantId);
            const ll = t ? getLL(t.landlordId) : null;
            const pm = PAY.find(m => m.k === p.method);
            const isRent = !p.type || p.type === "rent";
            return <div key={p.id} className="row" style={{ padding: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, flex: 1 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: isRent ? "rgba(16,185,129,.06)" : "rgba(251,191,36,.06)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>
                  {isRent ? "🏠" : "📄"}
                </div>
                <div>
                  <div style={{ fontWeight: 700, color: "#fff", fontSize: 14 }}>{t?.name || "?"}</div>
                  <div style={{ fontSize: 12, color: "#64748B" }}>{isRent ? (bn ? "ভাড়া" : "Rent") : p.type} • {p.paidAt?.split("T")[0]} • {pm?.i} {pm?.l}</div>
                  <div style={{ fontSize: 11, color: "#475569" }}>{bn ? "বাড়িওয়ালা" : "Landlord"}: {ll?.name || "?"}</div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ textAlign: "right" }}>
                  <div style={{ fontWeight: 800, color: "#fff", fontSize: 16 }}>৳{bn ? FM(p.amount) : FE(p.amount)}</div>
                  <span className="badge bP" style={{ fontSize: 10 }}>{p.status === "paid" ? "✅" : "◐"}</span>
                </div>
                {onDeletePayment && <button className="btn bd" style={{ padding: "6px 10px", fontSize: 11 }} onClick={() => { if (confirm(bn ? "এই পেমেন্ট মুছে ফেলবেন?" : "Delete this payment?")) onDeletePayment(p.id); }}>🗑️</button>}
              </div>
            </div>;
          })}
        </div>}
      </div>}

      {/* ═══════════════════════════════════ */}
      {/* ═══ LOGS TAB ═══ */}
      {/* ═══════════════════════════════════ */}
      {tab === "logs" && <div style={{ animation: "fadeIn .3s" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700 }}>📋 {bn ? "কার্যকলাপ লগ" : "Activity Logs"}</h3>
          <span style={{ fontSize: 12, color: "#64748B" }}>{bn ? "সর্বশেষ ১০০টি" : "Latest 100"}</span>
        </div>
        {logs.length === 0 ? <div className="G2" style={{ padding: 40, textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>📋</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#64748B" }}>{bn ? "কোনো লগ নেই" : "No logs"}</div>
        </div> : <div className="G" style={{ overflow: "hidden" }}>
          {logs.slice(0, 100).map(l => <div key={l.id} className="row" style={{ padding: "10px 16px" }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 13, color: "#E2E8F0", fontWeight: 600 }}>{l.detail}</div>
              <div style={{ fontSize: 12, color: "#475569" }}>
                <span className="badge" style={{ fontSize: 10, padding: "2px 8px", background: "rgba(139,92,246,.08)", color: "#A78BFA" }}>{l.action}</span>
              </div>
            </div>
            <span style={{ fontSize: 12, color: "#475569", whiteSpace: "nowrap" }}>{l.ts ? new Date(l.ts).toLocaleString("bn-BD") : ""}</span>
          </div>)}
        </div>}
      </div>}

    </div>
  </div>;
}

// ═══ LANDLORD PANEL ═══
function LandlordPanel({ me, tenants, properties, units, payments, bn, lang, setLang, onLogout, addProperty, assignTenant, unassignTenant, recordPayment, manualAddTenant, onDeletePayment, onEditPayment, notices, onSendNotice, onUpdateNoticeStatus, onMarkNoticeRead, onReplyNotice, onMarkReplyRead, agreements, onCreateAgreement, expenses, onAddExpense, onDeleteExpense, onRentChange, meters, onAddMeterReading, onMoveOut, onUpdateDeposit, onUpdateProfile, selM, setSelM, selY, setSelY, mk, onRefresh }) {
  const [modal, setModal] = useState(null);
  const [selProp, setSelProp] = useState(null);
  const [selFloor, setSelFloor] = useState(null);
  const [edit, setEdit] = useState(null);
  const [tab2, setTab2] = useState("dashboard");
  const [subTab, setSubTab] = useState("properties");
  const [selNotice, setSelNotice] = useState(null);
  const [searchQ, setSearchQ] = useState("");
  const [openAcc, setOpenAcc] = useState({});
  const [openProp, setOpenProp] = useState(null);
  const toggleAcc = (k) => setOpenAcc(o => ({ ...o, [k]: !o[k] }));

  // Generate User ID
  const userId = me?.id ? `BA${(me.id).slice(-8).toUpperCase().padStart(8, "X")}` : "BAXXXXXXXX";

  const UTIL_TYPES = [
    { k: "electricity", l: bn ? "বিদ্যুৎ" : "Electricity", i: "⚡", c: "#FBBF24" },
    { k: "water", l: bn ? "পানি" : "Water", i: "💧", c: "#38BDF8" },
    { k: "gas", l: bn ? "গ্যাস" : "Gas", i: "🔥", c: "#F97316" },
    { k: "service", l: bn ? "সার্ভিস" : "Service", i: "🔧", c: "#A78BFA" },
    { k: "internet", l: bn ? "ইন্টারনেট" : "Internet", i: "🌐", c: "#34D399" },
    { k: "other", l: bn ? "অন্যান্য" : "Other", i: "📦", c: "#94A3B8" },
  ];

  const STATUS_MAP = [
    { k: "open", l: bn ? "নতুন" : "Open", i: "🔴", c: "#EF4444" },
    { k: "in_progress", l: bn ? "কাজ চলছে" : "In Progress", i: "🟡", c: "#F59E0B" },
    { k: "resolved", l: bn ? "সমাধান" : "Resolved", i: "🟢", c: "#10B981" },
  ];

  const myTenantIds = new Set(tenants.map(t => t.id));
  const myPayments = payments.filter(p => myTenantIds.has(p.tenantId));
  const mPay = myPayments.filter(p => p.monthKey === mk);
  const mRent = mPay.filter(p => !p.type || p.type === "rent");
  const mUtil = mPay.filter(p => p.type && p.type !== "rent");
  const rentCollected = mRent.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const utilCollected = mUtil.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const totalCollected = rentCollected + utilCollected;
  const paidSet = new Set(mRent.filter(p => p.status === "paid").map(p => p.tenantId));
  const dueT = tenants.filter(t => !paidSet.has(t.id) && t.unitId);
  const unassigned = tenants.filter(t => !t.unitId);
  const unreadNotices = (notices || []).filter(n => n.toId === me?.id && !n.read);
  const newReplies = (notices || []).filter(n => n.fromId === me?.id && n.hasNewReply && n.lastReplyBy !== me?.id);
  const totalAlerts = unreadNotices.length + newReplies.length;
  const openNotices = (notices || []).filter(n => n.toId === me?.id && n.status !== "resolved");

  // Expenses this month
  const mExp = (expenses || []).filter(e => (e.date || e.createdAt || "").startsWith(`${selY}-${String(selM + 1).padStart(2, "0")}`));
  const totalExpenses = mExp.reduce((s, e) => s + (Number(e.amount) || 0), 0);
  const netProfit = totalCollected - totalExpenses;

  const prop = selProp ? properties.find(p => p.id === selProp) : null;
  const pUnits = selProp ? units.filter(u => u.propertyId === selProp) : [];
  const floors = prop ? [...new Set(pUnits.map(u => u.floor))].sort((a, b) => a - b) : [];
  const fUnits = selFloor ? pUnits.filter(u => u.floor === selFloor) : [];

  // Helper: find tenant info for a notice
  const getNoticeTenant = (n) => {
    const t = tenants.find(x => x.uid === n.fromId || x.id === n.fromId);
    const u = t ? units.find(x => x.id === t.unitId) : null;
    const p = u ? properties.find(x => x.id === u.propertyId) : null;
    return { tenant: t, unit: u, prop: p };
  };

  // Filtered tenants by search
  const filteredTenants = searchQ ? tenants.filter(t => t.unitId && (t.name || "").toLowerCase().includes(searchQ.toLowerCase())) : [];

  return <div>
    <Bar bn={bn} lang={lang} setLang={setLang} label={bn ? "বাড়িওয়ালা" : "LANDLORD"} icon="🏠" user={me?.name} onLogout={onLogout} onRefresh={onRefresh}>
    </Bar>

    {/* ═══ BOTTOM NAV (mobile) ═══ */}
    <div className="btm-nav">
      {[{ k: "dashboard", i: "🏠", l: bn ? "হোম" : "Home" },
        { k: "hisab", i: "💼", l: bn ? "হিসাব" : "Accounts" },
        { k: "notices", i: "📨", l: bn ? "নোটিশ" : "Notices", badge: totalAlerts },
      ].map(t => <div key={t.k} className={`btm-nav-item${tab2 === t.k ? " active" : ""}`} onClick={() => { setTab2(t.k); setSelProp(null); setSelFloor(null); setSelNotice(null); }}>
        <span className="nav-icon">{t.i}</span>
        <span className="nav-label">{t.l}</span>
        {t.badge > 0 && <span className="btm-nav-badge">{t.badge}</span>}
      </div>)}
    </div>

    <div className="content-area">

      {/* ═══ 3 MAIN TABS (desktop) ═══ */}
      <div className="hide-mobile" style={{ display: "flex", gap: 6, marginBottom: 18 }}>
        {[{ k: "dashboard", l: bn ? "🏠 ড্যাশবোর্ড" : "🏠 Dashboard" },
          { k: "hisab", l: bn ? "💼 হিসাব-নিকাশ" : "💼 Accounts" },
          { k: "notices", l: `📨 ${bn ? "নোটিশ" : "Notices"}${totalAlerts ? ` (${totalAlerts})` : ""}` },
        ].map(t => <div key={t.k} className={`main-tab${tab2 === t.k ? " active" : ""}`} onClick={() => { setTab2(t.k); setSelProp(null); setSelFloor(null); setSelNotice(null); }}>{t.l}</div>)}
      </div>

      {/* ═══════════════════════════════ */}
      {/* ═══ DASHBOARD / PROFILE TAB ═══ */}
      {/* ═══════════════════════════════ */}
      {tab2 === "dashboard" && <div style={{ animation: "fadeIn .3s" }}>

        {/* ═══ USER ID BADGE ═══ */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 16, padding: "16px 18px", borderRadius: 16, background: "linear-gradient(135deg, rgba(16,185,129,.06), rgba(59,130,246,.04))", border: "1px solid rgba(16,185,129,.1)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <div className="av" style={{ width: 48, height: 48, background: "rgba(16,185,129,.08)", fontSize: 22 }}>🏠</div>
            <div>
              <div style={{ fontWeight: 800, color: "#fff", fontSize: 16 }}>{me?.name || "—"}</div>
              <div style={{ fontSize: 12, color: "#34D399", fontFamily: "monospace", letterSpacing: 1 }}>🆔 {userId}</div>
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {totalAlerts > 0 && <div onClick={() => setTab2("notices")} style={{ position: "relative", cursor: "pointer", padding: 8 }}>
              <span style={{ fontSize: 20 }}>🔔</span>
              <span style={{ position: "absolute", top: 2, right: 2, width: 18, height: 18, borderRadius: "50%", background: "#EF4444", color: "#fff", fontSize: 10, fontWeight: 800, display: "flex", alignItems: "center", justifyContent: "center" }}>{totalAlerts}</span>
            </div>}
            <div onClick={() => window.open("https://wa.me/8801700000000", "_blank")} style={{ cursor: "pointer", padding: 8 }}>
              <span style={{ fontSize: 18 }}>💬</span>
            </div>
          </div>
        </div>

        {/* ═══ 1. নাম / প্রফাইল (with photo) ═══ */}
        <div className={`acc-item${openAcc.profile ? " open" : ""}`} style={{ background: openAcc.profile ? "rgba(16,185,129,.02)" : "rgba(255,255,255,.02)" }}>
          <div className="acc-head" onClick={() => toggleAcc("profile")}>
            <div className="acc-head-left">
              <div className="acc-icon" style={{ background: "rgba(99,102,241,.08)", borderRadius: 14 }}>
                {me?.photoURL ? <img src={me.photoURL} alt="" style={{ width: 40, height: 40, borderRadius: 14, objectFit: "cover" }} /> : "👤"}
              </div>
              <div>
                <div style={{ fontWeight: 700, color: "#fff", fontSize: 15 }}>{bn ? "নাম / প্রফাইল" : "Name / Profile"}</div>
                <div style={{ fontSize: 12, color: "#475569" }}>{me?.name || "—"}</div>
              </div>
            </div>
            <span className="acc-arrow">▶</span>
          </div>
          {openAcc.profile && <div className="acc-body">
            <div className="acc-sub">
              <div className="acc-sub-item">
                <span className="acc-label">📞 {bn ? "মোবাইল নাম্বার" : "Mobile Number"}</span>
                <span className="acc-value">{me?.phone || "—"}</span>
              </div>
              <div className="acc-sub-item">
                <span className="acc-label">🪪 NID {bn ? "নাম্বার" : "Number"}</span>
                <span className="acc-value">{me?.nid || "—"}</span>
              </div>
              <div className="acc-sub-item">
                <span className="acc-label">📋 LICENSE / TIN {bn ? "নাম্বার" : "Number"}</span>
                <span className="acc-value">{me?.tinNo || me?.holdingNo || "—"}</span>
              </div>

              {/* লেনদেনের মাধ্যম — nested sub-menu inside profile */}
              <div className={`acc-item${openAcc.lenden ? " open" : ""}`} style={{ margin: "6px 0 0", background: openAcc.lenden ? "rgba(251,191,36,.03)" : "rgba(255,255,255,.015)" }}>
                <div className="acc-head" onClick={() => toggleAcc("lenden")} style={{ padding: "12px 14px", minHeight: 48 }}>
                  <div className="acc-head-left">
                    <span style={{ fontSize: 16 }}>💳</span>
                    <span style={{ fontWeight: 700, color: "#E2E8F0", fontSize: 14 }}>{bn ? "লেনদেনের মাধ্যম" : "Payment Methods"}</span>
                  </div>
                  <span className="acc-arrow">▶</span>
                </div>
                {openAcc.lenden && <div className="acc-body" style={{ paddingTop: 0 }}>
                  <div className="acc-sub-item" style={{ marginBottom: 4 }}>
                    <span className="acc-label">📱 bKash</span>
                    <span className="acc-value" style={{ color: "#E2136E" }}>{me?.bkash || "—"}</span>
                  </div>
                  <div className="acc-sub-item" style={{ marginBottom: 4 }}>
                    <span className="acc-label">📱 Nagad</span>
                    <span className="acc-value" style={{ color: "#F6921E" }}>{me?.nagad || "—"}</span>
                  </div>
                  <div className="acc-sub-item">
                    <span className="acc-label">🏦 Bank Account</span>
                    <span className="acc-value" style={{ fontSize: 12 }}>{me?.bank || "—"}</span>
                  </div>
                </div>}
              </div>

              <button className="btn bp" style={{ width: "100%", marginTop: 10 }} onClick={() => setModal("editProfile")}>✏️ {bn ? "প্রফাইল সম্পাদনা" : "Edit Profile"}</button>
            </div>
          </div>}
        </div>

        {/* ═══ 2. বাড়ির বিবরণ ═══ */}
        <div className={`acc-item${openAcc.bari ? " open" : ""}`} style={{ background: openAcc.bari ? "rgba(139,92,246,.02)" : "rgba(255,255,255,.02)" }}>
          <div className="acc-head" onClick={() => toggleAcc("bari")}>
            <div className="acc-head-left">
              <div className="acc-icon" style={{ background: "rgba(139,92,246,.08)" }}>🏘️</div>
              <div>
                <div style={{ fontWeight: 700, color: "#fff", fontSize: 15 }}>{bn ? "বাড়ির বিবরণ" : "Property Details"} <span className="badge bA" style={{ fontSize: 10 }}>{properties.length}{bn ? "টি" : ""}</span></div>
                <div style={{ fontSize: 12, color: "#475569" }}>{units.length} {bn ? "ইউনিট" : "units"} • {units.filter(u => !u.isVacant).length} {bn ? "ভাড়া" : "occ"} • {units.filter(u => u.isVacant).length} {bn ? "খালি" : "vacant"}</div>
              </div>
            </div>
            <span className="acc-arrow">▶</span>
          </div>
          {openAcc.bari && <div className="acc-body">
            {properties.length === 0 ? <div style={{ textAlign: "center", padding: 24 }}>
              <div style={{ fontSize: 36, marginBottom: 8 }}>🏠</div>
              <p style={{ color: "#475569", fontSize: 13, marginBottom: 12 }}>{bn ? "এখনো কোনো বাড়ি যোগ করেননি" : "No properties yet"}</p>
              <button className="btn bp" onClick={() => setModal("addProp")}>➕ {bn ? "বাড়ি যোগ করুন" : "Add Property"}</button>
            </div> : <div className="acc-sub">
              {/* বাড়ি-১ / বাড়ি-২ / বাড়ি-৩ — row, click to expand units */}
              {properties.map(p => {
                const pu = units.filter(u => u.propertyId === p.id);
                const occU = pu.filter(u => !u.isVacant).length;
                const vacU = pu.filter(u => u.isVacant).length;
                const pFloors = [...new Set(pu.map(u => u.floor))].sort((a, b) => a - b);
                const isOpen = openProp === p.id;
                const typeLabel = pFloors.length > 1 ? `${pFloors.length} ${bn ? "তলা" : "floors"}` : (pu.length > 10 ? (bn ? "টিন শেড" : "Tin Shed") : `${pFloors.length} ${bn ? "তলা" : "floor"}`);

                return <div key={p.id} style={{ marginBottom: 6 }}>
                  {/* Property header — click to toggle */}
                  <div className="acc-sub-item CH" onClick={() => setOpenProp(isOpen ? null : p.id)} style={{ cursor: "pointer", borderLeft: `3px solid ${p.color || "#8B5CF6"}`, background: isOpen ? "rgba(139,92,246,.04)" : undefined, padding: "14px 16px" }}>
                    <div>
                      <div style={{ fontWeight: 700, color: "#fff", fontSize: 14 }}>{p.name}</div>
                      <div style={{ fontSize: 12, color: "#475569" }}>({typeLabel}, {pu.length}{bn ? "টি " : " "}{pu.length > 10 ? (bn ? "রুম" : "rooms") : (bn ? "ফ্ল্যাট" : "flats")})</div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span className="badge bA" style={{ fontSize: 10, padding: "2px 8px" }}>{occU}</span>
                      <span className="badge bV" style={{ fontSize: 10, padding: "2px 8px" }}>{vacU}</span>
                      <span className="acc-arrow" style={{ transform: isOpen ? "rotate(90deg)" : "none", color: isOpen ? "#A78BFA" : "#475569" }}>▶</span>
                    </div>
                  </div>

                  {/* ═══ Units inside — নির্দেশিকা: ইউনিট নাম্বার + ভাড়াটিয়ার নাম + সবুজ/লাল ═══ */}
                  {isOpen && <div style={{ marginLeft: 16, paddingLeft: 12, borderLeft: "2px solid rgba(139,92,246,.1)", animation: "fadeIn .2s", marginTop: 4 }}>
                    {pu.map(u => {
                      const t = tenants.find(x => x.unitId === u.id);
                      const isPaid = t ? paidSet.has(t.id) : false;
                      return <div key={u.id} className="acc-sub-item" style={{ marginBottom: 3, cursor: "pointer", padding: "10px 14px" }} onClick={() => { if (t) { setEdit(t); setModal("detail"); } else { setEdit({ unitId: u.id }); setModal("assign"); } }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                          <div style={{ width: 32, height: 32, borderRadius: 8, background: u.isVacant ? "rgba(59,130,246,.06)" : "rgba(16,185,129,.06)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, fontWeight: 800, color: u.isVacant ? "#60A5FA" : "#34D399" }}>{u.unitNo}</div>
                          <div>
                            {t ? <div style={{ fontWeight: 600, color: "#E2E8F0", fontSize: 13 }}>{t.name}</div>
                              : <div style={{ fontSize: 12, color: "#60A5FA", fontStyle: "italic" }}>{bn ? "খালি" : "Vacant"}</div>}
                          </div>
                        </div>
                        {t ? <div style={{ width: 22, height: 22, borderRadius: "50%", background: isPaid ? "rgba(16,185,129,.15)" : "rgba(239,68,68,.15)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11 }}>
                          {isPaid ? "✅" : "🔴"}
                        </div> : <span style={{ fontSize: 14, color: "#60A5FA" }}>➕</span>}
                      </div>;
                    })}
                  </div>}
                </div>;
              })}
              <button className="btn bp" style={{ width: "100%", marginTop: 8 }} onClick={() => setModal("addProp")}>➕ {bn ? "নতুন বাড়ি যোগ" : "Add Property"}</button>
            </div>}
          </div>}
        </div>

        {/* ═══ 3. ভাড়াটিয়া যোগ করুণ ═══ */}
        <div className={`acc-item${openAcc.addTenant ? " open" : ""}`} style={{ background: openAcc.addTenant ? "rgba(59,130,246,.02)" : "rgba(255,255,255,.02)" }}>
          <div className="acc-head" onClick={() => toggleAcc("addTenant")}>
            <div className="acc-head-left">
              <div className="acc-icon" style={{ background: "rgba(59,130,246,.08)" }}>➕</div>
              <div>
                <div style={{ fontWeight: 700, color: "#fff", fontSize: 15 }}>{bn ? "ভাড়াটিয়া যোগ করুণ" : "Add Tenant"}</div>
                <div style={{ fontSize: 12, color: "#475569" }}>{tenants.filter(t => t.unitId).length} {bn ? "জন বর্তমান" : "active"} • {unassigned.length} {bn ? "জন অপেক্ষায়" : "pending"}</div>
              </div>
            </div>
            <span className="acc-arrow">▶</span>
          </div>
          {openAcc.addTenant && <div className="acc-body">
            <div className="acc-sub">
              {/* Form-like sub items */}
              <div className="acc-sub-item">
                <span className="acc-label">📅 {bn ? "তারিখ" : "Date"}</span>
                <span className="acc-value" style={{ fontSize: 12, color: "#475569" }}>{bn ? "ফর্মে দিন" : "In form"}</span>
              </div>
              <div className="acc-sub-item">
                <span className="acc-label">🏠 {bn ? "বাড়ি / ফ্ল্যাট / রুম নাম্বার" : "House / Flat / Room No"}</span>
                <span className="acc-value" style={{ fontSize: 12, color: "#475569" }}>{bn ? "নির্বাচন করুন" : "Select"}</span>
              </div>
              <div className="acc-sub-item">
                <span className="acc-label">👤 {bn ? "ভাড়াটিয়ার নাম" : "Tenant Name"}</span>
              </div>
              <div className="acc-sub-item">
                <span className="acc-label">📞 {bn ? "ভাড়াটিয়ার মোবাইল নাম্বার" : "Tenant Mobile"}</span>
              </div>
              <div className="acc-sub-item">
                <span className="acc-label">🪪 {bn ? "ভাড়াটিয়ার NID নাম্বার" : "Tenant NID"}</span>
              </div>
              <div className="acc-sub-item">
                <span className="acc-label">📷 {bn ? "ভাড়াটিয়ার ছবি" : "Tenant Photo"}</span>
              </div>

              {/* মাসিক ভাড়া ও অন্যান্য — nested sub-menu */}
              <div className={`acc-item${openAcc.monthlyRent ? " open" : ""}`} style={{ margin: "6px 0 0", background: openAcc.monthlyRent ? "rgba(16,185,129,.03)" : "rgba(255,255,255,.015)" }}>
                <div className="acc-head" onClick={() => toggleAcc("monthlyRent")} style={{ padding: "12px 14px", minHeight: 48 }}>
                  <div className="acc-head-left">
                    <span style={{ fontSize: 16 }}>💰</span>
                    <span style={{ fontWeight: 700, color: "#E2E8F0", fontSize: 14 }}>{bn ? "মাসিক ভাড়া ও অন্যান্য" : "Monthly Rent & Others"}</span>
                  </div>
                  <span className="acc-arrow">▶</span>
                </div>
                {openAcc.monthlyRent && <div className="acc-body" style={{ paddingTop: 0 }}>
                  <div className="acc-sub-item" style={{ marginBottom: 4 }}>
                    <span className="acc-label">🏠 {bn ? "মাসিক ভাড়া" : "Monthly Rent"}</span>
                  </div>
                  <div className="acc-sub-item" style={{ marginBottom: 4 }}>
                    <span className="acc-label">💵 {bn ? "অগ্রিম জমা" : "Advance Deposit"}</span>
                  </div>
                  <div className="acc-sub-item" style={{ marginBottom: 4 }}>
                    <span className="acc-label">🔥 {bn ? "গ্যাস বিল" : "Gas Bill"}</span>
                  </div>

                  {/* বিদ্যুৎ বিল — nested inside monthly */}
                  <div className={`acc-item${openAcc.elec ? " open" : ""}`} style={{ margin: "4px 0", background: openAcc.elec ? "rgba(251,191,36,.03)" : "rgba(255,255,255,.01)" }}>
                    <div className="acc-head" onClick={() => toggleAcc("elec")} style={{ padding: "10px 12px", minHeight: 42 }}>
                      <div className="acc-head-left">
                        <span style={{ fontSize: 14 }}>⚡</span>
                        <span className="acc-label">{bn ? "বিদ্যুৎ বিল" : "Electricity Bill"}</span>
                      </div>
                      <span className="acc-arrow">▶</span>
                    </div>
                    {openAcc.elec && <div className="acc-body" style={{ paddingTop: 0 }}>
                      <div className="acc-sub-item" style={{ marginBottom: 3 }}>
                        <span className="acc-label">{bn ? "প্রতি ইউনিট মূল্য" : "Per Unit Price"}</span>
                      </div>
                      <div className="acc-sub-item" style={{ marginBottom: 3 }}>
                        <span className="acc-label">{bn ? "বর্তমান ইউনিট" : "Current Reading"}</span>
                      </div>
                      <div className="acc-sub-item">
                        <span className="acc-label">{bn ? "গত মাসের ইউনিট" : "Previous Reading"}</span>
                      </div>
                    </div>}
                  </div>

                  <div className="acc-sub-item">
                    <span className="acc-label">🔧 {bn ? "সার্ভিস চার্জ" : "Service Charge"}</span>
                  </div>
                </div>}
              </div>

              <button className="btn bp" style={{ width: "100%", marginTop: 12 }} onClick={() => setModal("manualAdd")}>👤 {bn ? "ভাড়াটিয়া যোগ করুণ" : "Add Tenant"}</button>
            </div>
          </div>}
        </div>

        {/* ═══ মাস সিলেক্টর ═══ */}
        <div style={{ display: "flex", gap: 8, margin: "12px 0", padding: "0 4px" }}>
          <select className="inp" style={{ flex: 1, fontSize: 14 }} value={selM} onChange={e => setSelM(Number(e.target.value))}>
            {(bn ? MBN : MEN).map((m, i) => <option key={i} value={i}>{m}</option>)}
          </select>
          <select className="inp" style={{ width: 90, fontSize: 14 }} value={selY} onChange={e => setSelY(Number(e.target.value))}>
            {[2024, 2025, 2026, 2027].map(y => <option key={y} value={y}>{y}</option>)}
          </select>
        </div>

        {/* ═══ 4. ভাড়ার হিসাব নিকাশ ═══ */}
        <div className={`acc-item${openAcc.hisab ? " open" : ""}`} style={{ background: openAcc.hisab ? "rgba(16,185,129,.02)" : "rgba(255,255,255,.02)" }}>
          <div className="acc-head" onClick={() => toggleAcc("hisab")}>
            <div className="acc-head-left">
              <div className="acc-icon" style={{ background: "rgba(16,185,129,.08)" }}>📊</div>
              <div>
                <div style={{ fontWeight: 700, color: "#fff", fontSize: 15 }}>{bn ? "ভাড়ার হিসাব নিকাশ" : "Rent Accounting"}</div>
                <div style={{ fontSize: 12, color: "#34D399", fontWeight: 700 }}>৳{bn ? FM(totalCollected) : FE(totalCollected)} {bn ? "আদায়" : "collected"}</div>
              </div>
            </div>
            <span className="acc-arrow">▶</span>
          </div>
          {openAcc.hisab && <div className="acc-body">
            <div className="acc-sub">
              {/* আদায় — sub */}
              <div className={`acc-item${openAcc.collected ? " open" : ""}`} style={{ margin: "4px 0", background: openAcc.collected ? "rgba(16,185,129,.03)" : "rgba(255,255,255,.015)" }}>
                <div className="acc-head" onClick={() => toggleAcc("collected")} style={{ padding: "12px 14px" }}>
                  <div className="acc-head-left">
                    <span style={{ fontSize: 16 }}>✅</span>
                    <div>
                      <span style={{ fontWeight: 700, color: "#E2E8F0", fontSize: 14 }}>{bn ? "আদায়" : "Collected"}</span>
                      <div style={{ fontSize: 11, color: "#34D399" }}>{paidSet.size} {bn ? "জন দিয়েছে" : "paid"}</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span className="acc-value" style={{ color: "#34D399" }}>৳{bn ? FM(rentCollected) : FE(rentCollected)}</span>
                    <span className="acc-arrow">▶</span>
                  </div>
                </div>
                {openAcc.collected && <div className="acc-body">
                  {[...paidSet].map(tid => {
                    const t = tenants.find(x => x.id === tid);
                    if (!t) return null;
                    const pay = mRent.find(p => p.tenantId === tid);
                    return <div key={tid} className="acc-sub-item" style={{ marginBottom: 3 }}>
                      <div><div style={{ fontWeight: 600, fontSize: 13 }}>{t.name}</div><div style={{ fontSize: 11, color: "#475569" }}>{pay?.paidAt?.split("T")[0]}</div></div>
                      <span style={{ fontWeight: 700, color: "#34D399" }}>৳{bn ? FM(pay?.amount) : FE(pay?.amount)}</span>
                    </div>;
                  })}
                  {paidSet.size === 0 && <div style={{ padding: 14, textAlign: "center", color: "#475569", fontSize: 13 }}>{bn ? "কেউ দেয়নি" : "None yet"}</div>}
                </div>}
              </div>

              {/* বাকি — sub */}
              <div className={`acc-item${openAcc.due ? " open" : ""}`} style={{ margin: "4px 0", background: openAcc.due ? "rgba(239,68,68,.03)" : "rgba(255,255,255,.015)" }}>
                <div className="acc-head" onClick={() => toggleAcc("due")} style={{ padding: "12px 14px" }}>
                  <div className="acc-head-left">
                    <span style={{ fontSize: 16 }}>🔴</span>
                    <div>
                      <span style={{ fontWeight: 700, color: "#E2E8F0", fontSize: 14 }}>{bn ? "বাকি" : "Due"}</span>
                      <div style={{ fontSize: 11, color: "#EF4444" }}>{dueT.length} {bn ? "জনের বকেয়া" : "unpaid"}</div>
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span className="acc-value" style={{ color: "#EF4444" }}>৳{bn ? FM(dueT.reduce((s, t) => s + (Number(t.rent) || 0), 0)) : FE(dueT.reduce((s, t) => s + (Number(t.rent) || 0), 0))}</span>
                    <span className="acc-arrow">▶</span>
                  </div>
                </div>
                {openAcc.due && <div className="acc-body">
                  {dueT.map(t => <div key={t.id} className="acc-sub-item" style={{ marginBottom: 3 }}>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 13 }}>{t.name}</div>
                      <div style={{ fontSize: 11, color: "#475569" }}>{t.phone}</div>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ fontWeight: 700, color: "#EF4444" }}>৳{bn ? FM(t.rent) : FE(t.rent)}</span>
                      <button className="btn bp bs" onClick={(e) => { e.stopPropagation(); setEdit(t); setModal("pay"); }} style={{ padding: "4px 10px", fontSize: 11, minHeight: 30 }}>💰</button>
                    </div>
                  </div>)}
                  {dueT.length === 0 && <div style={{ padding: 14, textAlign: "center", color: "#34D399", fontSize: 14 }}>🎉 {bn ? "সবাই পরিশোধ করেছে!" : "All paid!"}</div>}
                </div>}
              </div>
            </div>
          </div>}
        </div>

        {/* ═══ 5. নোটিশ দিন ═══ */}
        <div className={`acc-item`} style={{ background: "rgba(255,255,255,.02)" }}>
          <div className="acc-head" onClick={() => setTab2("notices")}>
            <div className="acc-head-left">
              <div className="acc-icon" style={{ background: "rgba(236,72,153,.08)" }}>📨</div>
              <div>
                <div style={{ fontWeight: 700, color: "#fff", fontSize: 15 }}>{bn ? "নোটিশ দিন" : "Send Notice"}</div>
                <div style={{ fontSize: 12, color: "#475569" }}>{(notices || []).length} {bn ? "টি নোটিশ" : "notices"}{totalAlerts > 0 ? ` • ${totalAlerts} ${bn ? "নতুন" : "new"}` : ""}</div>
              </div>
            </div>
            <span style={{ fontSize: 14, color: "#64748B" }}>→</span>
          </div>
        </div>

      </div>}

      {/* ═══════════════════════════════ */}
      {/* ═══ হিসাব-নিকাশ TAB ═══ */}
      {/* ═══════════════════════════════ */}
      {tab2 === "hisab" && <div style={{ animation: "fadeIn .3s" }}>

        {/* Sub-tabs inside hisab */}
        <div style={{ display: "flex", gap: 4, marginBottom: 16, overflowX: "auto", paddingBottom: 4 }}>
          {[{ k: "properties", l: bn ? "🏘️ বাড়ি" : "🏘️ Properties" },
            { k: "payments", l: bn ? "💰 পেমেন্ট" : "💰 Payments" },
            { k: "meters", l: bn ? "⚡ মিটার" : "⚡ Meters" },
            { k: "analytics", l: bn ? "📊 বিশ্লেষণ" : "📊 Analytics" },
            { k: "expenses", l: bn ? "🧾 খরচ" : "🧾 Expenses" },
            { k: "agreements", l: bn ? "📜 চুক্তি" : "📜 Agreements" },
          ].map(t => <div key={t.k} onClick={() => { setSubTab(t.k); setSelProp(null); setSelFloor(null); }} style={{ padding: "8px 14px", borderRadius: 10, cursor: "pointer", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap", background: subTab === t.k ? "rgba(16,185,129,.1)" : "transparent", color: subTab === t.k ? "#34D399" : "#64748B", border: `1px solid ${subTab === t.k ? "rgba(16,185,129,.2)" : "transparent"}` }}>{t.l}</div>)}
        </div>

      {selProp && subTab === "properties" && <div style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#64748B" }}>
        <span style={{ cursor: "pointer", color: "#34D399" }} onClick={() => { setSelProp(null); setSelFloor(null); }}>🏘️ {bn ? "সব" : "All"}</span>
        <span style={{ opacity: .3 }}>›</span>
        <span style={{ cursor: selFloor ? "pointer" : "default", color: selFloor ? "#34D399" : "#E2E8F0" }} onClick={() => setSelFloor(null)}>{prop?.name}</span>
        {selFloor && <><span style={{ opacity: .3 }}>›</span><span style={{ color: "#E2E8F0" }}>{bn ? `${selFloor} তলা` : `Floor ${selFloor}`}</span></>}
      </div>}

      {/* ═══ PROPERTIES TAB ═══ */}
      {subTab === "properties" && <>
      {!selProp && <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700 }}>🏘️ {bn ? "বাড়িসমূহ" : "Properties"}</h3>
          <div style={{ display: "flex", gap: 6 }}>
            <button className="btn bg bs" onClick={() => setModal("manualTenant")}>👤➕ {bn ? "ভাড়াটিয়া যোগ" : "Add Tenant"}</button>
            <button className="btn bp bs" onClick={() => setModal("addProp")}>🏘️➕ {bn ? "বাড়ি যোগ" : "Add"}</button>
          </div>
        </div>
        {properties.length === 0 ? <div className="G2" style={{ padding: 50, textAlign: "center" }}>
          <div style={{ fontSize: 44, marginBottom: 8 }}>🏘️</div>
          <div style={{ color: "#475569", marginBottom: 14 }}>{bn ? "প্রথমে বাড়ি যোগ করুন" : "Add a property"}</div>
          <button className="btn bp" onClick={() => setModal("addProp")}>➕ {bn ? "প্রথম বাড়ি" : "First Property"}</button>
        </div> :
        <div className="rg" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
          {properties.map(p => {
            const pu = units.filter(u => u.propertyId === p.id);
            const pv = pu.filter(u => u.isVacant).length;
            return <div key={p.id} className="G CH" style={{ padding: 18, position: "relative", overflow: "hidden" }} onClick={() => setSelProp(p.id)}>
              <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg,${p.color || "#10B981"},transparent)` }} />
              <div style={{ fontWeight: 700, fontSize: 15, color: "#fff", marginBottom: 2 }}>{p.name}</div>
              <div style={{ fontSize: 11, color: "#475569", marginBottom: 10 }}>📍 {p.address}</div>
              <div style={{ display: "flex", gap: 6 }}><span className="badge bA">{pu.length - pv} {bn ? "ভাড়া" : "occ."}</span><span className="badge bV">{pv} {bn ? "খালি" : "vacant"}</span></div>
            </div>;
          })}
        </div>}

        {dueT.length > 0 && <div style={{ marginTop: 20 }}>
          <h4 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>🔔 {bn ? "বাকি" : "Due"} <span className="badge bD">{dueT.length}</span></h4>
          <div className="G">{dueT.map(t => {
            const u = units.find(x => x.id === t.unitId);
            return <div key={t.id} className="row">
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div className="av" style={{ width: 32, height: 32, borderRadius: 8, fontSize: 14 }}>👤</div>
                <div><div style={{ fontWeight: 600, fontSize: 12 }}>{t.name}</div><div style={{ fontSize: 12, color: "#475569" }}>{u?.unitNo}</div></div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontWeight: 800, color: "#F59E0B" }}>৳{bn ? FM(t.rent) : FE(t.rent)}</span>
                <button className="btn bp bs" style={{ padding: "5px 10px" }} onClick={() => { setEdit(t); setModal("pay"); }}>💰</button>
              </div>
            </div>;
          })}</div>
        </div>}
      </div>}

      {selProp && !selFloor && floors.map(f => {
        const fu = pUnits.filter(u => u.floor === f); const fo = fu.filter(u => !u.isVacant).length;
        return <div key={f} className="G CH" style={{ padding: 16, marginBottom: 8 }} onClick={() => setSelFloor(f)}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <div style={{ width: 32, height: 32, borderRadius: 8, background: `${prop?.color || "#10B981"}15`, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, color: prop?.color || "#10B981", fontSize: 14 }}>{f}</div>
              <div><div style={{ fontWeight: 700, fontSize: 13 }}>{bn ? `${f} তলা` : `Floor ${f}`}</div><div style={{ fontSize: 12, color: "#475569" }}>{fu.length} {bn ? "ইউনিট" : "units"} • {fo} {bn ? "ভাড়া" : "occ."}</div></div>
            </div>
          </div>
        </div>;
      })}

      {selFloor && <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(fUnits.length, 4)}, 1fr)`, gap: 8 }}>
        {fUnits.map(u => {
          const t = tenants.find(x => x.unitId === u.id);
          const pay = mRent.find(p => p.tenantId === t?.id);
          return <div key={u.id} className={`uc ${u.isVacant ? "uv" : "uo"}`} onClick={() => {
            if (u.isVacant && unassigned.length > 0) { setEdit({ unitId: u.id }); setModal("assign"); }
            else if (t) { setEdit(t); setModal("detail"); }
          }}>
            <div style={{ fontSize: 24, marginBottom: 4 }}>{u.isVacant ? "🚪" : "🏠"}</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: "#fff" }}>{u.unitNo}</div>
            {u.isVacant ? <span className="badge bV" style={{ marginTop: 6 }}>{bn ? "খালি" : "Vacant"}</span> : t && <>
              <div style={{ fontWeight: 600, fontSize: 11, marginTop: 4 }}>{t.name}</div>
              <div style={{ fontWeight: 800, color: "#34D399", fontSize: 12, marginTop: 2 }}>৳{bn ? FM(t.rent) : FE(t.rent)}</div>
              {pay ? <span className={`badge ${pay.status === "paid" ? "bP" : "bPa"}`} style={{ marginTop: 4, fontSize: 9 }}>✓</span>
                : <span className="badge bD" style={{ marginTop: 4, fontSize: 9 }}>✗ {bn ? "বাকি" : "Due"}</span>}
            </>}
          </div>;
        })}
      </div>}
      </>}

      {/* ═══ PAYMENTS TAB ═══ */}
      {subTab === "payments" && <div>
        {/* Monthly summary */}
        <div className="G" style={{ padding: 18, marginBottom: 14 }}>
          <h4 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>📊 {(bn ? MBN : MEN)[selM]} {bn ? "সারাংশ" : "Summary"}</h4>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
            <div style={{ padding: 10, background: "rgba(16,185,129,.04)", borderRadius: 10, textAlign: "center" }}>
              <div style={{ fontSize: 12, color: "#475569" }}>🏠 {bn ? "ভাড়া" : "Rent"}</div>
              <div style={{ fontWeight: 800, color: "#34D399", fontSize: 16 }}>৳{bn ? FM(rentCollected) : FE(rentCollected)}</div>
            </div>
            <div style={{ padding: 10, background: "rgba(251,191,36,.04)", borderRadius: 10, textAlign: "center" }}>
              <div style={{ fontSize: 12, color: "#475569" }}>📄 {bn ? "ইউটিলিটি" : "Utility"}</div>
              <div style={{ fontWeight: 800, color: "#FBBF24", fontSize: 16 }}>৳{bn ? FM(utilCollected) : FE(utilCollected)}</div>
            </div>
            <div style={{ padding: 10, background: "rgba(99,102,241,.04)", borderRadius: 10, textAlign: "center" }}>
              <div style={{ fontSize: 12, color: "#475569" }}>💰 {bn ? "মোট" : "Total"}</div>
              <div style={{ fontWeight: 800, color: "#818CF8", fontSize: 16 }}>৳{bn ? FM(totalCollected) : FE(totalCollected)}</div>
            </div>
          </div>
        </div>

        {/* All payments list */}
        <h4 style={{ fontSize: 14, fontWeight: 700, marginBottom: 10 }}>📋 {bn ? "সব পেমেন্ট" : "All Payments"} <span className="badge" style={{ background: "rgba(255,255,255,.04)" }}>{mPay.length}</span></h4>
        {mPay.length === 0 ? <div className="G2" style={{ padding: 40, textAlign: "center" }}>
          <div style={{ fontSize: 44, marginBottom: 8 }}>💰</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#64748B", marginBottom: 12 }}>{bn ? "এই মাসে কোনো পেমেন্ট নেই" : "No payments this month"}</div>
          {dueT.length > 0 && <button className="btn bp" onClick={() => { setEdit(dueT[0]); setModal("pay"); }}>💰 {bn ? "প্রথম আদায় করুন" : "Collect First Payment"}</button>}
        </div> :
        <div className="G" style={{ overflow: "hidden" }}>
          {mPay.sort((a, b) => (b.paidAt || "").localeCompare(a.paidAt || "")).map(p => {
            const t = tenants.find(x => x.id === p.tenantId);
            const pm = PAY.find(m => m.k === p.method);
            const isRent = !p.type || p.type === "rent";
            const ut = UTIL_TYPES.find(u => u.k === p.type);
            return <div key={p.id} className="row">
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 32, height: 32, borderRadius: 8, background: isRent ? "rgba(16,185,129,.08)" : `${ut?.c || "#666"}10`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>
                  {isRent ? "🏠" : (ut?.i || "📦")}
                </div>
                <div>
                  <div style={{ fontWeight: 600, fontSize: 12 }}>{t?.name || "?"}</div>
                  <div style={{ fontSize: 11, color: "#475569" }}>{isRent ? (bn ? "ভাড়া" : "Rent") : (ut?.l || p.type)} • {p.paidAt?.split("T")[0]}</div>
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontWeight: 800, color: isRent ? "#34D399" : (ut?.c || "#fff") }}>৳{bn ? FM(p.amount) : FE(p.amount)}</div>
                <span style={{ padding: "1px 6px", borderRadius: 4, fontSize: 8, fontWeight: 700, background: `${pm?.c || "#666"}12`, color: pm?.c }}>{pm?.i} {pm?.l}</span>
              </div>
            </div>;
          })}
        </div>}
      </div>}

      {/* ═══ METER READINGS TAB ═══ */}
      {subTab === "meters" && <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700 }}>⚡ {bn ? "মিটার রিডিং" : "Meter Readings"}</h3>
          <button className="btn bp" onClick={() => setModal("addMeter")}>+ {bn ? "রিডিং যোগ" : "Add Reading"}</button>
        </div>

        {/* Latest readings by unit */}
        {units.filter(u => !u.isVacant).map(u => {
          const t = tenants.find(x => x.unitId === u.id);
          const uMeters = (meters||[]).filter(m => m.unitId === u.id).sort((a,b) => (b.createdAt||"").localeCompare(a.createdAt||""));
          const latest = uMeters[0];
          const p = properties.find(x => x.id === u.propertyId);
          return <div key={u.id} className="G" style={{ padding: 16, marginBottom: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
              <div>
                <div style={{ fontWeight: 700, color: "#fff", fontSize: 13 }}>{u.unitNo} • {p?.name}</div>
                <div style={{ fontSize: 11, color: "#475569" }}>{t?.name || (bn ? "খালি" : "Vacant")}</div>
              </div>
              {latest && <div style={{ textAlign: "right" }}>
                <div style={{ fontSize: 12, color: "#475569" }}>{bn ? "শেষ রিডিং" : "Last reading"}</div>
                <div style={{ fontWeight: 700, color: "#FBBF24", fontSize: 14 }}>{latest.currentReading}</div>
              </div>}
            </div>
            {uMeters.length > 0 ? <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {uMeters.slice(0, 4).map(m => <div key={m.id} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 10px", borderRadius: 8, background: "rgba(255,255,255,.02)", fontSize: 11 }}>
                <span style={{ color: "#64748B" }}>{m.monthKey || m.createdAt?.split("T")[0]}</span>
                <span>{m.prevReading} → <strong style={{ color: "#FBBF24" }}>{m.currentReading}</strong></span>
                <span style={{ color: "#34D399", fontWeight: 700 }}>{m.currentReading - m.prevReading} {bn ? "ইউনিট" : "units"}</span>
                <span style={{ color: "#fff", fontWeight: 700 }}>৳{bn ? FM((m.currentReading - m.prevReading) * (u.electricityRate || 0)) : FE((m.currentReading - m.prevReading) * (u.electricityRate || 0))}</span>
              </div>)}
            </div> : <div style={{ textAlign: "center", padding: 16, color: "#334155", fontSize: 12 }}>
              {bn ? "এখনো কোনো রিডিং নেই" : "No readings yet"}
            </div>}
          </div>;
        })}
      </div>}

      {/* ═══ ANALYTICS TAB (Feature #4) ═══ */}
      {subTab === "analytics" && <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700 }}>📊 {bn ? "বিশ্লেষণ" : "Analytics"} — {(bn ? MBN : MEN)[selM]}</h3>
          <button className="btn bg bs" onClick={() => {
            const w = window.open("", "_blank", "width=800,height=900");
            const rpt = `<html><head><meta charset="utf-8"><title>${bn ? "মুন্সী — মাসিক রিপোর্ট" : "Munsi Monthly Report"}</title>
            <style>body{font-family:sans-serif;padding:30px;color:#222}h1{color:#10B981;margin-bottom:4px}table{width:100%;border-collapse:collapse;margin:16px 0}th,td{border:1px solid #ddd;padding:8px;text-align:left;font-size:13px}th{background:#f5f5f5;font-weight:700}.amt{text-align:right;font-weight:700}.green{color:#10B981}.red{color:#EF4444}.orange{color:#F97316}.badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600}</style></head><body>
            <h1>🏠 ${bn ? "মুন্সী — মাসিক রিপোর্ট" : "Munsi — Monthly Report"}</h1>
            <p>${(bn ? MBN : MEN)[selM]} ${selY} • ${me?.name}</p>
            <h3>${bn ? "সারাংশ" : "Summary"}</h3>
            <table><tr><th>${bn ? "বিষয়" : "Item"}</th><th class="amt">${bn ? "পরিমাণ" : "Amount"}</th></tr>
            <tr><td>${bn ? "ভাড়া আদায়" : "Rent Collected"}</td><td class="amt green">৳${rentCollected.toLocaleString()}</td></tr>
            <tr><td>${bn ? "বিল আদায়" : "Utility Bills"}</td><td class="amt green">৳${utilCollected.toLocaleString()}</td></tr>
            <tr><td>${bn ? "মোট আয়" : "Total Income"}</td><td class="amt green">৳${totalCollected.toLocaleString()}</td></tr>
            <tr><td>${bn ? "মোট খরচ" : "Total Expenses"}</td><td class="amt orange">৳${totalExpenses.toLocaleString()}</td></tr>
            <tr style="font-size:15px"><td><strong>${bn ? "নেট মুনাফা" : "Net Profit"}</strong></td><td class="amt ${netProfit >= 0 ? "green" : "red"}"><strong>৳${netProfit.toLocaleString()}</strong></td></tr></table>
            <h3>${bn ? "ভাড়াটিয়া অবস্থা" : "Tenant Status"}</h3>
            <table><tr><th>${bn ? "নাম" : "Name"}</th><th>${bn ? "ইউনিট" : "Unit"}</th><th class="amt">${bn ? "ভাড়া" : "Rent"}</th><th class="amt">${bn ? "পরিশোধ" : "Paid"}</th><th>${bn ? "অবস্থা" : "Status"}</th></tr>
            ${tenants.filter(t => t.unitId).map(t => {
              const tPay = mRent.filter(p => p.tenantId === t.id);
              const paid = tPay.reduce((s, p) => s + (Number(p.amount) || 0), 0);
              const u = units.find(x => x.id === t.unitId);
              const ok = paid >= t.rent;
              return `<tr><td>${t.name}</td><td>${u?.unitNo || "—"}</td><td class="amt">৳${t.rent?.toLocaleString()}</td><td class="amt">৳${paid.toLocaleString()}</td><td><span class="badge" style="background:${ok ? "#D1FAE5" : "#FEE2E2"};color:${ok ? "#065F46" : "#991B1B"}">${ok ? (bn ? "✅ পরিশোধিত" : "✅ Paid") : (bn ? "⏳ বাকি" : "⏳ Due")}</span></td></tr>`;
            }).join("")}</table>
            <p style="text-align:center;color:#999;font-size:11px;margin-top:30px">${bn ? "মুন্সী — বাড়িওয়ালা ম্যানেজমেন্ট সিস্টেম" : "Munsi — Property Management System"} • ${new Date().toLocaleDateString()}</p>
            <script>window.print();</script></body></html>`;
            w.document.write(rpt);
            w.document.close();
          }}>🖨️ {bn ? "রিপোর্ট প্রিন্ট" : "Print Report"}</button>
        </div>

        {/* Summary Cards */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 20 }} className="rg2">
          {[{ l: bn ? "মোট আদায়" : "Total Income", v: totalCollected, c: "#34D399", i: "💰" },
            { l: bn ? "মোট খরচ" : "Expenses", v: totalExpenses, c: "#F97316", i: "🧾" },
            { l: bn ? "নেট মুনাফা" : "Net Profit", v: netProfit, c: netProfit >= 0 ? "#10B981" : "#EF4444", i: netProfit >= 0 ? "📈" : "📉" },
            { l: bn ? "দখলকৃত" : "Occupied", v: `${units.filter(u => !u.isVacant).length}/${units.length}`, c: "#6366F1", i: "🏠" },
          ].map((s, i) => <div key={i} className="G" style={{ padding: 14, textAlign: "center" }}>
            <div style={{ fontSize: 22, marginBottom: 4 }}>{s.i}</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: s.c }}>{typeof s.v === "number" ? `৳${bn ? FM(s.v) : FE(s.v)}` : s.v}</div>
            <div style={{ fontSize: 12, color: "#475569" }}>{s.l}</div>
          </div>)}
        </div>

        {/* 6-Month Trend */}
        <div className="G" style={{ padding: 18, marginBottom: 14 }}>
          <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 14 }}>📈 {bn ? "৬ মাসের ট্রেন্ড" : "6-Month Trend"}</h4>
          {(() => {
            const months = [];
            for (let i = 5; i >= 0; i--) {
              let m = selM - i, y = selY;
              if (m < 0) { m += 12; y--; }
              const key = MK(m, y);
              const mP = myPayments.filter(p => p.monthKey === key);
              const inc = mP.reduce((s, p) => s + (Number(p.amount) || 0), 0);
              const exp = (expenses || []).filter(e => (e.date || e.createdAt || "").startsWith(`${y}-${String(m + 1).padStart(2, "0")}`)).reduce((s, e) => s + (Number(e.amount) || 0), 0);
              months.push({ label: (bn ? MBN : MEN)[m].slice(0, 3), inc, exp, net: inc - exp });
            }
            const maxV = Math.max(...months.map(m => Math.max(m.inc, m.exp)), 1);
            return <div>
              <div style={{ display: "flex", gap: 4, alignItems: "flex-end", height: 120, marginBottom: 8 }}>
                {months.map((m, i) => <div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                  <div style={{ display: "flex", gap: 1, alignItems: "flex-end", width: "100%", justifyContent: "center" }}>
                    <div style={{ width: "40%", height: Math.max((m.inc / maxV) * 100, 2), background: "#34D399", borderRadius: "3px 3px 0 0", transition: "height .5s" }} />
                    <div style={{ width: "40%", height: Math.max((m.exp / maxV) * 100, 2), background: "#F97316", borderRadius: "3px 3px 0 0", transition: "height .5s" }} />
                  </div>
                </div>)}
              </div>
              <div style={{ display: "flex", gap: 4 }}>
                {months.map((m, i) => <div key={i} style={{ flex: 1, textAlign: "center" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#475569" }}>{m.label}</div>
                  <div style={{ fontSize: 8, color: m.net >= 0 ? "#10B981" : "#EF4444", fontWeight: 600 }}>{m.net >= 0 ? "+" : ""}৳{Math.abs(m.net) > 999 ? `${(m.net / 1000).toFixed(0)}k` : m.net}</div>
                </div>)}
              </div>
              <div style={{ display: "flex", gap: 14, justifyContent: "center", marginTop: 10, fontSize: 12, color: "#64748B" }}>
                <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: "#34D399", marginRight: 4 }} />{bn ? "আয়" : "Income"}</span>
                <span><span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 2, background: "#F97316", marginRight: 4 }} />{bn ? "খরচ" : "Expense"}</span>
              </div>
            </div>;
          })()}
        </div>

        {/* Income Breakdown */}
        <div className="G" style={{ padding: 18, marginBottom: 14 }}>
          <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>💰 {bn ? "আয়ের বিভাজন" : "Income Breakdown"}</h4>
          {(() => {
            const barW = (v, max) => max ? `${Math.max((v / max) * 100, 2)}%` : "2%";
            const maxV = Math.max(rentCollected, utilCollected, 1);
            return [{ l: bn ? "ভাড়া" : "Rent", v: rentCollected, c: "#34D399" }, { l: bn ? "ইউটিলিটি" : "Utility", v: utilCollected, c: "#FBBF24" }].map((b, i) =>
              <div key={i} style={{ marginBottom: 10 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 4 }}>
                  <span style={{ color: "#94A3B8" }}>{b.l}</span><span style={{ fontWeight: 700, color: b.c }}>৳{bn ? FM(b.v) : FE(b.v)}</span>
                </div>
                <div style={{ height: 8, borderRadius: 4, background: "rgba(255,255,255,.03)" }}>
                  <div style={{ height: 8, borderRadius: 4, background: b.c, width: barW(b.v, maxV), transition: "width .5s" }} />
                </div>
              </div>
            );
          })()}
        </div>

        {/* Tenant Payment Status */}
        <div className="G" style={{ padding: 18, marginBottom: 14 }}>
          <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>👥 {bn ? "ভাড়াটিয়ার অবস্থা" : "Tenant Status"}</h4>
          {tenants.filter(t => t.unitId).map(t => {
            const tPays = mPay.filter(p => p.tenantId === t.id && (!p.type || p.type === "rent"));
            const paid = tPays.reduce((s, p) => s + (Number(p.amount) || 0), 0);
            const remaining = Math.max(t.rent - paid, 0);
            const pct = t.rent ? Math.min((paid / t.rent) * 100, 100) : 0;
            const u = units.find(x => x.id === t.unitId);
            return <div key={t.id} style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 4 }}>
                <span style={{ fontWeight: 600 }}>{t.name} <span style={{ color: "#475569" }}>({u?.unitNo})</span></span>
                <span>৳{bn ? FM(paid) : FE(paid)} / ৳{bn ? FM(t.rent) : FE(t.rent)} {remaining > 0 && <span style={{ color: "#F59E0B" }}>({bn ? "বাকি" : "due"}: ৳{bn ? FM(remaining) : FE(remaining)})</span>}</span>
              </div>
              <div style={{ height: 6, borderRadius: 3, background: "rgba(255,255,255,.03)" }}>
                <div style={{ height: 6, borderRadius: 3, background: pct >= 100 ? "#10B981" : pct > 0 ? "#F59E0B" : "#EF4444", width: `${Math.max(pct, 2)}%` }} />
              </div>
            </div>;
          })}
        </div>

        {/* Property Occupancy */}
        <div className="G" style={{ padding: 18 }}>
          <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>🏘️ {bn ? "দখল অবস্থা" : "Occupancy"}</h4>
          {properties.map(p => {
            const pu = units.filter(u => u.propertyId === p.id);
            const occ = pu.filter(u => !u.isVacant).length;
            const pct = pu.length ? (occ / pu.length) * 100 : 0;
            return <div key={p.id} style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 4 }}>
                <span style={{ fontWeight: 600, color: p.color || "#34D399" }}>{p.name}</span>
                <span>{occ}/{pu.length} ({Math.round(pct)}%)</span>
              </div>
              <div style={{ height: 6, borderRadius: 3, background: "rgba(255,255,255,.03)" }}>
                <div style={{ height: 6, borderRadius: 3, background: p.color || "#10B981", width: `${Math.max(pct, 2)}%` }} />
              </div>
            </div>;
          })}
        </div>

        {/* Auto Reminder (Feature #5) */}
        {dueT.length > 0 && <div className="G" style={{ padding: 18, marginTop: 14 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <h4 style={{ fontSize: 13, fontWeight: 700 }}>🔔 {bn ? "অটো রিমাইন্ডার" : "Auto Reminder"}</h4>
              <div style={{ fontSize: 11, color: "#475569" }}>{dueT.length} {bn ? "জনের ভাড়া বাকি" : "tenants have dues"}</div>
            </div>
            <button className="btn bp" onClick={async () => {
              const notices = dueT.map(t => ({
                fromId: me?.id, toId: t.uid || t.id,
                subject: bn ? `${(bn ? MBN : MEN)[selM]} মাসের ভাড়া বাকি` : `${(bn ? MBN : MEN)[selM]} rent due`,
                message: bn ? `প্রিয় ${t.name}, আপনার ${(bn ? MBN : MEN)[selM]} মাসের ভাড়া ৳${t.rent} এখনো পরিশোধ হয়নি। অনুগ্রহ করে দ্রুত পরিশোধ করুন।` : `Dear ${t.name}, your rent ৳${t.rent} for ${MEN[selM]} is pending. Please pay soon.`,
                toAll: false,
              }));
              for (const n of notices) await onSendNotice(n);
            }}>📨 {bn ? `সবাইকে রিমাইন্ডার (${dueT.length})` : `Remind All (${dueT.length})`}</button>
          </div>
        </div>}
      </div>}

      {/* ═══ EXPENSES TAB (Feature #7) ═══ */}
      {subTab === "expenses" && <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700 }}>🧾 {bn ? "খরচ" : "Expenses"}</h3>
          <button className="btn bp bs" onClick={() => setModal("addExpense")}>➕ {bn ? "খরচ যোগ" : "Add"}</button>
        </div>

        {/* Monthly summary */}
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 16 }}>
          <div className="G" style={{ padding: 14, textAlign: "center" }}>
            <div style={{ fontSize: 12, color: "#475569" }}>💰 {bn ? "আদায়" : "Income"}</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: "#34D399" }}>৳{bn ? FM(totalCollected) : FE(totalCollected)}</div>
          </div>
          <div className="G" style={{ padding: 14, textAlign: "center" }}>
            <div style={{ fontSize: 12, color: "#475569" }}>🧾 {bn ? "খরচ" : "Expenses"}</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: "#F97316" }}>৳{bn ? FM(totalExpenses) : FE(totalExpenses)}</div>
          </div>
          <div className="G" style={{ padding: 14, textAlign: "center" }}>
            <div style={{ fontSize: 12, color: "#475569" }}>{netProfit >= 0 ? "📈" : "📉"} {bn ? "মুনাফা" : "Profit"}</div>
            <div style={{ fontSize: 16, fontWeight: 800, color: netProfit >= 0 ? "#10B981" : "#EF4444" }}>৳{bn ? FM(netProfit) : FE(netProfit)}</div>
          </div>
        </div>

        {/* Expense category breakdown */}
        {(() => {
          const EXP_CATS = [
            { k: "repair", l: bn ? "মেরামত" : "Repair", i: "🔧", c: "#F97316" },
            { k: "paint", l: bn ? "রং/সাজসজ্জা" : "Paint/Decor", i: "🎨", c: "#EC4899" },
            { k: "plumbing", l: bn ? "প্লাম্বিং" : "Plumbing", i: "🚿", c: "#38BDF8" },
            { k: "electric", l: bn ? "ইলেক্ট্রিক্যাল" : "Electrical", i: "⚡", c: "#FBBF24" },
            { k: "cleaning", l: bn ? "পরিষ্কার" : "Cleaning", i: "🧹", c: "#34D399" },
            { k: "tax", l: bn ? "কর/ফি" : "Tax/Fee", i: "🏛️", c: "#A78BFA" },
            { k: "other", l: bn ? "অন্যান্য" : "Other", i: "📦", c: "#94A3B8" },
          ];
          return <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginBottom: 14 }}>
            {EXP_CATS.map(cat => {
              const catExp = mExp.filter(e => e.category === cat.k);
              const total = catExp.reduce((s, e) => s + (Number(e.amount) || 0), 0);
              if (total === 0) return null;
              return <div key={cat.k} style={{ padding: "8px 12px", borderRadius: 10, background: `${cat.c}08`, border: `1px solid ${cat.c}12` }}>
                <span style={{ fontSize: 14 }}>{cat.i}</span> <span style={{ fontSize: 11, color: cat.c, fontWeight: 600 }}>{cat.l}</span>
                <div style={{ fontSize: 14, fontWeight: 800, color: "#fff" }}>৳{bn ? FM(total) : FE(total)}</div>
              </div>;
            })}
          </div>;
        })()}

        {/* Expense list */}
        <div className="G" style={{ overflow: "hidden" }}>
          {(expenses || []).sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")).slice(0, 30).map(e => <div key={e.id} className="row">
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ fontSize: 16 }}>{e.category === "repair" ? "🔧" : e.category === "paint" ? "🎨" : e.category === "plumbing" ? "🚿" : e.category === "electric" ? "⚡" : e.category === "cleaning" ? "🧹" : e.category === "tax" ? "🏛️" : "📦"}</div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 12 }}>{e.description || e.category}</div>
                <div style={{ fontSize: 11, color: "#475569" }}>{(e.date || e.createdAt || "").split("T")[0]} {e.propertyName ? `• ${e.propertyName}` : ""}</div>
              </div>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ fontWeight: 800, color: "#F97316" }}>৳{bn ? FM(e.amount) : FE(e.amount)}</span>
              <span style={{ cursor: "pointer", fontSize: 12, opacity: .5 }} onClick={() => { if (confirm(bn ? "মুছবেন?" : "Delete?")) onDeleteExpense(e.id); }}>🗑️</span>
            </div>
          </div>)}
          {(!expenses || expenses.length === 0) && <div className="G2" style={{ padding: 40, textAlign: "center" }}>
            <div style={{ fontSize: 44, marginBottom: 8 }}>🧾</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#64748B", marginBottom: 12 }}>{bn ? "কোনো খরচ যোগ করা হয়নি" : "No expenses added"}</div>
            <button className="btn bp" onClick={() => setModal("addExpense")}>+ {bn ? "প্রথম খরচ যোগ করুন" : "Add First Expense"}</button>
          </div>}
        </div>
      </div>}

      {/* ═══ AGREEMENTS TAB (Feature #1) ═══ */}
      {subTab === "agreements" && <div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
          <h3 style={{ fontSize: 16, fontWeight: 700 }}>📜 {bn ? "চুক্তিপত্র" : "Agreements"}</h3>
          <button className="btn bp bs" onClick={() => setModal("addAgreement")}>➕ {bn ? "নতুন চুক্তি" : "New"}</button>
        </div>
        {(!agreements || agreements.length === 0) ? <div className="G2" style={{ padding: 40, textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 8 }}>📜</div>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#64748B", marginBottom: 12 }}>{bn ? "কোনো চুক্তি নেই" : "No agreements yet"}</div>
          <p style={{ fontSize: 13, color: "#475569", marginBottom: 16 }}>{bn ? "ভাড়াটিয়ার সাথে চুক্তি তৈরি ও সংরক্ষণ করুন" : "Create and store rental agreements"}</p>
          <button className="btn bp" onClick={() => setModal("addAgreement")}>📜 {bn ? "প্রথম চুক্তি তৈরি" : "Create First Agreement"}</button>
        </div> :
          agreements.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")).map(a => {
            const t = tenants.find(x => x.id === a.tenantId);
            const u = t ? units.find(x => x.id === t.unitId) : null;
            return <div key={a.id} className="G" style={{ padding: 16, marginBottom: 10, borderLeft: `3px solid ${a.status === "active" ? "#10B981" : "#475569"}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                <div>
                  <div style={{ fontWeight: 700, color: "#fff", fontSize: 14 }}>{a.tenantName || t?.name}</div>
                  <div style={{ fontSize: 11, color: "#475569" }}>{u?.unitNo || ""} • 📞 {a.tenantPhone || t?.phone}</div>
                </div>
                <span className="badge" style={{ background: a.status === "active" ? "rgba(16,185,129,.1)" : "rgba(255,255,255,.04)", color: a.status === "active" ? "#34D399" : "#475569" }}>{a.status === "active" ? (bn ? "সক্রিয়" : "Active") : (bn ? "বাতিল" : "Ended")}</span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 10 }}>
                <div style={{ padding: "6px 10px", background: "rgba(255,255,255,.02)", borderRadius: 8 }}>
                  <div style={{ fontSize: 11, color: "#475569" }}>{bn ? "ভাড়া" : "Rent"}</div>
                  <div style={{ fontWeight: 700, color: "#34D399", fontSize: 13 }}>৳{bn ? FM(a.rent) : FE(a.rent)}</div>
                </div>
                <div style={{ padding: "6px 10px", background: "rgba(255,255,255,.02)", borderRadius: 8 }}>
                  <div style={{ fontSize: 11, color: "#475569" }}>{bn ? "অগ্রিম" : "Advance"}</div>
                  <div style={{ fontWeight: 700, fontSize: 13 }}>৳{bn ? FM(a.advance || 0) : FE(a.advance || 0)}</div>
                </div>
                <div style={{ padding: "6px 10px", background: "rgba(255,255,255,.02)", borderRadius: 8 }}>
                  <div style={{ fontSize: 11, color: "#475569" }}>{bn ? "শুরু" : "Start"}</div>
                  <div style={{ fontWeight: 600, fontSize: 11 }}>{a.startDate}</div>
                </div>
              </div>
              {a.terms && <div style={{ marginTop: 8, fontSize: 11, color: "#64748B", padding: "8px 10px", background: "rgba(255,255,255,.01)", borderRadius: 8, lineHeight: 1.5 }}>📝 {a.terms}</div>}
            </div>;
          })}
      </div>}

      </div>}
      {/* end of hisab tab */}

      {/* ═══ NOTICES TAB ═══ */}
      {tab2 === "notices" && <div>
        {!selNotice ? <>
          {/* Notice list */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700 }}>📨 {bn ? "নোটিশ" : "Notices"} {totalAlerts > 0 && <span className="badge bD" style={{ fontSize: 11 }}>{totalAlerts} {bn ? "নতুন" : "new"}</span>}</h3>
            <button className="btn bp bs" onClick={() => setModal("llNotice")}>✏️ {bn ? "নোটিশ পাঠান" : "Send Notice"}</button>
          </div>
          {(!notices || notices.length === 0) ? <div className="G2" style={{ padding: 40, textAlign: "center" }}>
            <div style={{ fontSize: 48, marginBottom: 8 }}>📨</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#64748B", marginBottom: 12 }}>{bn ? "কোনো নোটিশ নেই" : "No notices yet"}</div>
            <p style={{ fontSize: 13, color: "#475569", marginBottom: 16 }}>{bn ? "ভাড়াটিয়াদের রিমাইন্ডার বা নোটিশ পাঠান" : "Send reminders or notices to tenants"}</p>
            <button className="btn bp" onClick={() => setModal("llNotice")}>📨 {bn ? "প্রথম নোটিশ পাঠান" : "Send First Notice"}</button>
          </div> :
            notices.map(n => {
              const isSent = n.fromId === me?.id;
              const { tenant: nt, unit: nu, prop: np } = getNoticeTenant(isSent ? { ...n, fromId: n.toId } : n);
              const st = STATUS_MAP.find(s => s.k === n.status) || STATUS_MAP[0];
              const hasNewReply = isSent && n.hasNewReply && n.lastReplyBy !== me?.id;
              return <div key={n.id} className="G CH" style={{ padding: 16, marginBottom: 8, borderLeft: `3px solid ${hasNewReply ? "#A78BFA" : isSent ? "#6366F1" : st.c}`, background: hasNewReply ? "rgba(167,139,250,.03)" : (!isSent && !n.read) ? "rgba(239,68,68,.02)" : undefined }} onClick={async () => {
                setSelNotice(n);
                if (!n.read && !isSent && onMarkNoticeRead) await onMarkNoticeRead(n.id);
                if (hasNewReply && onMarkReplyRead) await onMarkReplyRead(n.id);
              }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 36, height: 36, borderRadius: 10, background: isSent ? "rgba(99,102,241,.08)" : "rgba(59,130,246,.08)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>{isSent ? "📤" : "👤"}</div>
                    <div>
                      {isSent ? <>
                        <div style={{ fontWeight: 700, color: "#A78BFA", fontSize: 12 }}>{bn ? "📤 আমার পাঠানো" : "📤 Sent"}</div>
                        <div style={{ fontSize: 12, color: "#475569" }}>{bn ? "প্রাপক:" : "To:"} {n.toAll ? (bn ? "সব ভাড়াটিয়া" : "All tenants") : (nt?.name || "—")} {nu ? `› ${nu.unitNo}` : ""}</div>
                      </> : <>
                        <div style={{ fontWeight: 700, color: "#fff", fontSize: 13 }}>{nt?.name || (bn ? "ভাড়াটিয়া" : "Tenant")}</div>
                        <div style={{ fontSize: 12, color: "#475569" }}>{np?.name || ""} › {nu?.unitNo || ""} {nu ? `(${bn ? `${nu.floor} তলা` : `Floor ${nu.floor}`})` : ""}</div>
                      </>}
                    </div>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                    {hasNewReply && <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#A78BFA", animation: "pulse 2s infinite", boxShadow: "0 0 6px rgba(167,139,250,.5)" }} />}
                    {!isSent && !n.read && <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#EF4444", animation: "pulse 2s infinite" }} />}
                    {!isSent && n.read && <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#10B981" }} />}
                    {(n.replies?.length || 0) > 0 && <span style={{ fontSize: 11, color: hasNewReply ? "#A78BFA" : "#475569" }}>💬{n.replies.length}</span>}
                    <span className="badge" style={{ background: `${st.c}15`, color: st.c, fontSize: 9 }}>{st.i} {st.l}</span>
                  </div>
                </div>
                <div style={{ fontWeight: 700, color: "#E2E8F0", fontSize: 14, marginBottom: 2 }}>{n.subject}</div>
                <div style={{ fontSize: 11, color: "#64748B", lineHeight: 1.4 }}>{n.message?.slice(0, 80)}{n.message?.length > 80 ? "..." : ""}</div>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 6 }}>
                  <span style={{ fontSize: 11, color: "#334155" }}>{n.createdAt?.split("T")[0]}</span>
                  {hasNewReply && <span className="badge" style={{ background: "rgba(167,139,250,.1)", color: "#A78BFA", fontSize: 11, animation: "pulse 2s infinite" }}>💬 {bn ? "নতুন রিপ্লাই" : "New reply"}</span>}
                </div>
              </div>;
            })}
        </> :
        /* ═══ NOTICE DETAIL VIEW ═══ */
        (() => {
          const { tenant: nt, unit: nu, prop: np } = getNoticeTenant(selNotice);
          const st = STATUS_MAP.find(s => s.k === selNotice.status) || STATUS_MAP[0];
          return <div style={{ animation: "fadeIn .3s" }}>
            <button className="btn bg bs" onClick={() => setSelNotice(null)} style={{ marginBottom: 14 }}>← {bn ? "পিছনে" : "Back"}</button>

            {/* Tenant info card */}
            <div className="G2" style={{ padding: 20, marginBottom: 14 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <div style={{ width: 52, height: 52, borderRadius: 14, background: "rgba(59,130,246,.08)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 24 }}>👤</div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 800, color: "#fff", fontSize: 17 }}>{nt?.name || (bn ? "ভাড়াটিয়া" : "Tenant")}</div>
                  <div style={{ fontSize: 12, color: "#64748B" }}>📞 {nt?.phone || "—"}</div>
                </div>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginTop: 12 }}>
                <div style={{ padding: "8px 12px", background: "rgba(255,255,255,.02)", borderRadius: 8 }}>
                  <div style={{ fontSize: 11, color: "#475569" }}>{bn ? "বাড়ি" : "Property"}</div>
                  <div style={{ fontWeight: 600, fontSize: 12 }}>{np?.name || "—"}</div>
                </div>
                <div style={{ padding: "8px 12px", background: "rgba(255,255,255,.02)", borderRadius: 8 }}>
                  <div style={{ fontSize: 11, color: "#475569" }}>{bn ? "ইউনিট" : "Unit"}</div>
                  <div style={{ fontWeight: 600, fontSize: 12 }}>{nu?.unitNo || "—"} {nu ? `(${nu.floor}F)` : ""}</div>
                </div>
                <div style={{ padding: "8px 12px", background: "rgba(255,255,255,.02)", borderRadius: 8 }}>
                  <div style={{ fontSize: 11, color: "#475569" }}>{bn ? "ভাড়া" : "Rent"}</div>
                  <div style={{ fontWeight: 600, fontSize: 12, color: "#34D399" }}>৳{bn ? FM(nt?.rent || 0) : FE(nt?.rent || 0)}</div>
                </div>
              </div>
            </div>

            {/* Issue details */}
            <div className="G" style={{ padding: 20, marginBottom: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: "#fff" }}>{selNotice.subject}</h3>
                <span className="badge" style={{ background: `${st.c}15`, color: st.c, padding: "4px 12px" }}>{st.i} {st.l}</span>
              </div>
              <div style={{ fontSize: 13, color: "#CBD5E1", lineHeight: 1.6, marginBottom: 12, padding: 14, background: "rgba(255,255,255,.02)", borderRadius: 10, borderLeft: "3px solid rgba(255,255,255,.06)" }}>{selNotice.message}</div>
              <div style={{ fontSize: 12, color: "#334155" }}>📅 {selNotice.createdAt?.split("T")[0]}</div>
            </div>

            {/* Status update buttons */}
            {selNotice.status !== "resolved" && <div className="G" style={{ padding: 18, marginBottom: 14 }}>
              <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>🔄 {bn ? "স্ট্যাটাস আপডেট" : "Update Status"}</h4>
              <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                {STATUS_MAP.filter(s => s.k !== selNotice.status).map(s => <button key={s.k} className="btn bg" style={{ borderColor: `${s.c}30`, color: s.c }}
                  onClick={() => {
                    const note = prompt(bn ? `${s.l} — নোট লিখুন (ঐচ্ছিক):` : `${s.l} — Add note (optional):`);
                    if (note !== null && onUpdateNoticeStatus) onUpdateNoticeStatus(selNotice.id, s.k, note);
                  }}>{s.i} {s.l}</button>)}
              </div>
            </div>}

            {/* Status history / timeline */}
            {selNotice.statusHistory?.length > 0 && <div className="G" style={{ padding: 18, marginBottom: 14 }}>
              <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>📋 {bn ? "আপডেট ইতিহাস" : "Status History"}</h4>
              {selNotice.statusHistory.map((h, i) => {
                const hs = STATUS_MAP.find(s => s.k === h.status) || STATUS_MAP[0];
                return <div key={i} style={{ display: "flex", gap: 10, marginBottom: 10, paddingBottom: 10, borderBottom: "1px solid rgba(255,255,255,.03)" }}>
                  <div style={{ width: 28, height: 28, borderRadius: 8, background: `${hs.c}12`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, flexShrink: 0 }}>{hs.i}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, color: hs.c, fontSize: 12 }}>{hs.l}</div>
                    {h.note && <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 2 }}>{h.note}</div>}
                    <div style={{ fontSize: 11, color: "#334155", marginTop: 2 }}>{h.at?.split("T")[0]} {h.at?.split("T")[1]?.slice(0, 5)}</div>
                  </div>
                </div>;
              })}
            </div>}

            {/* ═══ REPLIES / CONVERSATION ═══ */}
            <div className="G" style={{ padding: 18 }}>
              <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>💬 {bn ? "কথোপকথন" : "Conversation"} {(selNotice.replies?.length || 0) > 0 && `(${selNotice.replies.length})`}</h4>

              {/* Reply list */}
              {(selNotice.replies || []).map((r, i) => {
                const isMe = r.fromId === me?.id;
                return <div key={r.id || i} style={{ display: "flex", flexDirection: isMe ? "row-reverse" : "row", gap: 8, marginBottom: 10 }}>
                  <div style={{ width: 30, height: 30, borderRadius: 10, background: isMe ? "rgba(16,185,129,.1)" : "rgba(59,130,246,.1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, flexShrink: 0 }}>{isMe ? "🏠" : "👤"}</div>
                  <div style={{ maxWidth: "75%", padding: "10px 14px", borderRadius: isMe ? "14px 4px 14px 14px" : "4px 14px 14px 14px", background: isMe ? "rgba(16,185,129,.08)" : "rgba(59,130,246,.06)", border: `1px solid ${isMe ? "rgba(16,185,129,.12)" : "rgba(59,130,246,.1)"}` }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: isMe ? "#34D399" : "#60A5FA", marginBottom: 2 }}>{isMe ? (bn ? "আমি" : "Me") : (r.fromName || (bn ? "ভাড়াটিয়া" : "Tenant"))}</div>
                    <div style={{ fontSize: 12, color: "#CBD5E1", lineHeight: 1.5 }}>{r.text}</div>
                    <div style={{ fontSize: 8, color: "#334155", marginTop: 4, textAlign: isMe ? "left" : "right" }}>{r.at?.split("T")[0]} {r.at?.split("T")[1]?.slice(0, 5)}</div>
                  </div>
                </div>;
              })}

              {/* Reply input */}
              {(() => {
                const [rText, setRText] = [selNotice._rText || "", (v) => setSelNotice({ ...selNotice, _rText: v })];
                return <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
                  <input className="inp" value={rText} onChange={e => setRText(e.target.value)} placeholder={bn ? "রিপ্লাই লিখুন..." : "Type reply..."} style={{ flex: 1, fontSize: 12 }} onKeyDown={e => {
                    if (e.key === "Enter" && rText.trim() && onReplyNotice) {
                      onReplyNotice(selNotice.id, { fromId: me?.id, fromName: me?.name || (bn ? "বাড়িওয়ালা" : "Landlord"), text: rText.trim() });
                      setRText("");
                    }
                  }} />
                  <button className="btn bp" disabled={!rText.trim()} onClick={() => {
                    if (rText.trim() && onReplyNotice) {
                      onReplyNotice(selNotice.id, { fromId: me?.id, fromName: me?.name || (bn ? "বাড়িওয়ালা" : "Landlord"), text: rText.trim() });
                      setRText("");
                    }
                  }}>📩</button>
                </div>;
              })()}
            </div>
          </div>;
        })()}
      </div>}
    </div>

    {modal === "addProp" && <AddPropModal bn={bn} onSave={async (p) => { await addProperty(p); setModal(null); }} onClose={() => setModal(null)} />}
    {modal === "assign" && edit && <AssignModal bn={bn} unitId={edit.unitId} tenants={unassigned}
      onSave={async (tid, rent, adv, date, notes) => { await assignTenant(tid, edit.unitId, rent, adv, date, notes); setModal(null); }} onClose={() => setModal(null)} />}
    {modal === "pay" && edit && <PayModal bn={bn} tenant={edit} mk={mk}
      onSave={async (p) => { await recordPayment(p); setModal(null); }} onClose={() => setModal(null)} />}
    {modal === "detail" && edit && <div className="ov" onClick={() => setModal(null)}>
      <div className="mdl" onClick={e => e.stopPropagation()} style={{ maxWidth: 440 }}><div className="mdl-handle" />
        <h3 style={{ fontSize: 17, fontWeight: 800, color: "#fff", marginBottom: 8 }}>👤 {edit.name}</h3>
        <div style={{ fontSize: 12, color: "#475569", marginBottom: 12 }}>📞 {edit.phone} {edit.nid ? `• NID: ${edit.nid}` : ""}</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
          {[{ l: bn ? "ভাড়া" : "Rent", v: `৳${bn ? FM(edit.rent) : FE(edit.rent)}` }, { l: bn ? "সদস্য" : "Members", v: edit.members || "—" }]
            .map((it, i) => <div key={i} style={{ background: "rgba(255,255,255,.02)", borderRadius: 10, padding: "8px 12px" }}>
              <div style={{ fontSize: 12, color: "#475569" }}>{it.l}</div><div style={{ fontSize: 13, fontWeight: 600 }}>{it.v}</div>
            </div>)}
        </div>

        {/* Partial Payment Tracking (Feature #6) */}
        {(() => {
          const tPays = mPay.filter(p => p.tenantId === edit.id);
          const tRent = tPays.filter(p => !p.type || p.type === "rent");
          const totalPaid = tRent.reduce((s, p) => s + (Number(p.amount) || 0), 0);
          const remaining = Math.max(edit.rent - totalPaid, 0);
          const pct = edit.rent ? Math.min((totalPaid / edit.rent) * 100, 100) : 0;
          return <div style={{ marginBottom: 14, padding: 12, background: "rgba(255,255,255,.02)", borderRadius: 10 }}>
            <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, marginBottom: 6 }}>
              <span style={{ color: "#94A3B8" }}>{(bn ? MBN : MEN)[selM]} {bn ? "পেমেন্ট" : "payment"}</span>
              <span>৳{bn ? FM(totalPaid) : FE(totalPaid)} / ৳{bn ? FM(edit.rent) : FE(edit.rent)}</span>
            </div>
            <div style={{ height: 8, borderRadius: 4, background: "rgba(255,255,255,.04)", marginBottom: 6 }}>
              <div style={{ height: 8, borderRadius: 4, background: pct >= 100 ? "#10B981" : "#F59E0B", width: `${Math.max(pct, 2)}%` }} />
            </div>
            {remaining > 0 && <div style={{ fontSize: 11, color: "#F59E0B", fontWeight: 600 }}>⚠️ {bn ? "বাকি" : "Remaining"}: ৳{bn ? FM(remaining) : FE(remaining)}</div>}
            {tPays.length > 0 && tPays.map(p => {
              const isR = !p.type || p.type === "rent";
              const ut = UTIL_TYPES.find(u => u.k === p.type);
              return <div key={p.id} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderTop: "1px solid rgba(255,255,255,.02)", fontSize: 11, marginTop: 4 }}>
                <span>{isR ? "🏠" : (ut?.i || "📦")} {isR ? (bn ? "ভাড়া" : "Rent") : (ut?.l || p.type)} • {p.paidAt?.split("T")[0]}</span>
                <span style={{ fontWeight: 700, color: isR ? "#34D399" : (ut?.c || "#fff") }}>৳{bn ? FM(p.amount) : FE(p.amount)}</span>
              </div>;
            })}
          </div>;
        })()}

        {/* Rent History (Feature #3) */}
        {edit.rentHistory?.length > 1 && <div style={{ marginBottom: 14 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: "#A78BFA", marginBottom: 6 }}>📋 {bn ? "ভাড়ার ইতিহাস" : "Rent History"}</div>
          {edit.rentHistory.slice().reverse().map((h, i) => <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 12, padding: "3px 0", color: "#64748B" }}>
            <span>{h.date?.split("T")[0]} — {h.reason}</span>
            <span style={{ fontWeight: 700 }}>{h.prevRent ? `৳${h.prevRent} →` : ""} ৳{h.rent}</span>
          </div>)}
        </div>}

        {/* Deposit / Advance Tracking */}
        <div style={{ marginBottom: 14, padding: 12, background: "rgba(59,130,246,.04)", borderRadius: 10, border: "1px solid rgba(59,130,246,.1)" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: "#60A5FA" }}>💵 {bn ? "জামানত / অগ্রিম" : "Security Deposit"}</div>
            <button className="btn bg bs" style={{ fontSize: 12, padding: "3px 8px" }} onClick={() => {
              const amt = prompt(bn ? "নতুন অগ্রিম পরিমাণ:" : "New deposit amount:", edit.advance || 0);
              if (amt !== null && Number(amt) !== edit.advance) {
                const note = prompt(bn ? "নোট:" : "Note:", bn ? "অগ্রিম আপডেট" : "Deposit update");
                if (note !== null) onUpdateDeposit(edit.id, Number(amt), note);
              }
            }}>✏️</button>
          </div>
          <div style={{ fontSize: 20, fontWeight: 800, color: "#60A5FA" }}>৳{bn ? FM(edit.advance || 0) : FE(edit.advance || 0)}</div>
          {edit.depositHistory?.length > 0 && <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid rgba(255,255,255,.04)" }}>
            {edit.depositHistory.slice(-3).reverse().map((h, i) => <div key={i} style={{ fontSize: 12, color: "#64748B", padding: "2px 0" }}>
              {h.date?.split("T")[0]} — ৳{h.prev || 0} → ৳{h.amount} {h.note && `(${h.note})`}
            </div>)}
          </div>}
        </div>

        <div style={{ display: "flex", gap: 6 }}>
          <button className="btn bp" style={{ flex: 1 }} onClick={() => setModal("pay")}>💰 {bn ? "আদায়" : "Collect"}</button>
          <button className="btn bg" style={{ flex: 1 }} onClick={() => {
            const nr = prompt(bn ? "নতুন ভাড়া:" : "New rent:", edit.rent);
            if (nr && Number(nr) !== edit.rent) {
              const reason = prompt(bn ? "কারণ:" : "Reason:", bn ? "বার্ষিক বৃদ্ধি" : "Annual increase");
              if (reason !== null) onRentChange(edit.id, Number(nr), reason);
            }
          }}>📝 {bn ? "ভাড়া বদল" : "Change Rent"}</button>
          <button className="btn bd" style={{ flex: 0 }} onClick={() => { setEdit(edit); setModal("moveOut"); }}>🚪</button>
        </div>
      </div>
    </div>}
    {modal === "manualTenant" && <ManualAddTenantModal bn={bn} units={units.filter(u => u.isVacant)} properties={properties}
      onSave={async (info, unitId, rent) => { await manualAddTenant(info, unitId, rent); setModal(null); }} onClose={() => setModal(null)} />}
    {modal === "llNotice" && <LandlordNoticeModal bn={bn} tenants={tenants.filter(t => t.unitId)} units={units} properties={properties} fromId={me?.id}
      onSave={async (notices) => { for (const n of notices) await onSendNotice(n); setModal(null); }} onClose={() => setModal(null)} />}
    {modal === "addExpense" && <AddExpenseModal bn={bn} properties={properties}
      onSave={async (d) => { await onAddExpense(d); setModal(null); }} onClose={() => setModal(null)} />}
    {modal === "addAgreement" && <AddAgreementModal bn={bn} tenants={tenants.filter(t => t.unitId)} units={units} properties={properties} landlordId={me?.id}
      onSave={async (d) => { await onCreateAgreement(d); setModal(null); }} onClose={() => setModal(null)} />}
    {modal === "addMeter" && <MeterReadingModal bn={bn} units={units} tenants={tenants} properties={properties} meters={meters}
      onSave={async (d) => { await onAddMeterReading(d); setModal(null); }} onClose={() => setModal(null)} />}
    {modal === "moveOut" && edit && <MoveOutModal bn={bn} tenant={edit} payments={payments}
      onMoveOut={async (tid, s) => { await onMoveOut(tid, s); setModal(null); setEdit(null); }} onClose={() => setModal(null)} />}
    {modal === "paymentInfo" && <div className="ov" onClick={() => setModal(null)}><div className="mdl" onClick={e => e.stopPropagation()}><div className="mdl-handle" />
      <h2 style={{ fontSize: 18, fontWeight: 800, color: "#fff", marginBottom: 16 }}>💳 {bn ? "পেমেন্ট তথ্য" : "Payment Info"}</h2>
      <p style={{ fontSize: 11, color: "#475569", marginBottom: 14 }}>{bn ? "ভাড়াটিয়ারা এই তথ্য দেখতে পাবে" : "Tenants will see this info"}</p>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <div><label className="lbl">bKash {bn ? "নম্বর" : "Number"}</label>
          <input className="inp" defaultValue={me?.bkashNo || ""} placeholder="01XXXXXXXXX" id="pi-bkash" /></div>
        <div><label className="lbl">Nagad {bn ? "নম্বর" : "Number"}</label>
          <input className="inp" defaultValue={me?.nagadNo || ""} placeholder="01XXXXXXXXX" id="pi-nagad" /></div>
        <div><label className="lbl">Rocket {bn ? "নম্বর" : "Number"}</label>
          <input className="inp" defaultValue={me?.rocketNo || ""} placeholder="01XXXXXXXXX" id="pi-rocket" /></div>
        <div><label className="lbl">{bn ? "ব্যাংক তথ্য" : "Bank Details"}</label>
          <textarea className="inp" defaultValue={me?.bankInfo || ""} placeholder={bn ? "ব্যাংক নাম, হিসাব নং..." : "Bank name, account no..."} id="pi-bank" style={{ minHeight: 50 }} /></div>
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
        <button className="btn bg" style={{ flex: 1 }} onClick={() => setModal(null)}>{bn ? "বাতিল" : "Cancel"}</button>
        <button className="btn bp" style={{ flex: 1 }} onClick={() => {
          onUpdateProfile({
            bkashNo: document.getElementById("pi-bkash").value,
            nagadNo: document.getElementById("pi-nagad").value,
            rocketNo: document.getElementById("pi-rocket").value,
            bankInfo: document.getElementById("pi-bank").value,
          });
          setModal(null);
        }}>✓ {bn ? "সেভ করুন" : "Save"}</button>
      </div>
    </div></div>}
  </div>;
}
function TenantPanel({ me, landlord, units, properties, payments, bn, lang, setLang, onLogout, recordPayment, selM, setSelM, selY, setSelY, mk, onDeletePayment, onEditPayment, onSendNotice, notices, onUpdateNoticeStatus, onMarkNoticeRead, onReplyNotice, onMarkReplyRead, agreements, meters }) {
  const [modal, setModal] = useState(null);
  const [tab, setTab] = useState("home");
  const [selPay, setSelPay] = useState(null);
  const [selNotice, setSelNotice] = useState(null);
  const [replyText, setReplyText] = useState("");
  const [showProfile, setShowProfile] = useState(false);
  const [showContact, setShowContact] = useState(false);
  const [waMsg, setWaMsg] = useState("");
  const unit = me?.unitId ? units.find(u => u.id === me.unitId) : null;
  const prop = unit ? properties.find(p => p.id === unit.propertyId) : null;

  const STATUS_MAP = [
    { k: "open", l: bn ? "নতুন" : "Open", i: "🔴", c: "#EF4444" },
    { k: "in_progress", l: bn ? "কাজ চলছে" : "In Progress", i: "🟡", c: "#F59E0B" },
    { k: "resolved", l: bn ? "সমাধান" : "Resolved", i: "🟢", c: "#10B981" },
  ];

  // ═══ ROBUST NOTICE DETECTION ═══
  // getNoticesForUser() already returns only notices where toId==me OR fromId==me
  // So "incoming" = any notice I did NOT send (don't re-check toId, avoids ID mismatch)
  const myIds = [me?.uid, me?.id].filter(Boolean);
  const isMe = (id) => myIds.includes(id);
  const allNotices = notices || [];
  const incomingNotices = allNotices.filter(n => !isMe(n.fromId));
  const sentNotices = allNotices.filter(n => isMe(n.fromId));
  const unreadCount = incomingNotices.filter(n => !n.read).length;
  const newReplyCount = sentNotices.filter(n => n.hasNewReply && !isMe(n.lastReplyBy)).length;
  const totalAlerts = unreadCount + newReplyCount;

  // Separate rent and utility payments
  const rentPays = payments.filter(p => !p.type || p.type === "rent");
  const utilPays = payments.filter(p => p.type && p.type !== "rent");
  const curRentPay = rentPays.find(p => p.monthKey === mk);
  const curUtilPays = utilPays.filter(p => p.monthKey === mk);

  const UTIL_TYPES = [
    { k: "electricity", l: bn ? "বিদ্যুৎ বিল" : "Electricity", i: "⚡", c: "#FBBF24" },
    { k: "water", l: bn ? "পানি বিল" : "Water", i: "💧", c: "#38BDF8" },
    { k: "gas", l: bn ? "গ্যাস বিল" : "Gas", i: "🔥", c: "#F97316" },
    { k: "service", l: bn ? "সার্ভিস চার্জ" : "Service Charge", i: "🔧", c: "#A78BFA" },
    { k: "internet", l: bn ? "ইন্টারনেট" : "Internet", i: "🌐", c: "#34D399" },
    { k: "other", l: bn ? "অন্যান্য" : "Other", i: "📦", c: "#94A3B8" },
  ];

  const tabs = [
    { k: "home", l: bn ? "হোম" : "Home", i: "🏠" },
    { k: "bills", l: bn ? "বিল" : "Bills", i: "📄" },
    { k: "meters", l: bn ? "মিটার" : "Meter", i: "⚡" },
    { k: "history", l: bn ? "ইতিহাস" : "History", i: "📋" },
    { k: "agreement", l: bn ? "চুক্তি" : "Agreement", i: "📜" },
    { k: "notices", l: bn ? "নোটিশ" : "Notices", i: "📨", badge: totalAlerts },
  ];

  return <div>
    <Bar bn={bn} lang={lang} setLang={setLang} label={bn ? "ভাড়াটিয়া" : "TENANT"} icon="👤" onLogout={onLogout}>
      {/* 👤 User Profile */}
      <div style={{ position: "relative" }}>
        <div onClick={() => setShowProfile(!showProfile)} style={{ cursor: "pointer", padding: "4px 10px", background: showProfile ? "rgba(16,185,129,.08)" : "rgba(255,255,255,.025)", borderRadius: 8, fontSize: 12, color: "#94A3B8", display: "flex", alignItems: "center", gap: 4, minHeight: 32 }}>
          👤 {me?.name?.split(" ")[0]}
        </div>
        {showProfile && <div style={{ position: "absolute", top: "100%", right: 0, marginTop: 6, width: 280, background: "#111827", border: "1px solid rgba(255,255,255,.06)", borderRadius: 14, padding: 18, zIndex: 200, boxShadow: "0 12px 40px rgba(0,0,0,.5)", animation: "fadeIn .2s" }} onClick={e => e.stopPropagation()}>
          <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14, paddingBottom: 12, borderBottom: "1px solid rgba(255,255,255,.04)" }}>
            <div style={{ width: 44, height: 44, borderRadius: 12, background: "linear-gradient(135deg,#34D399,#60A5FA)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>👤</div>
            <div><div style={{ fontWeight: 700, color: "#fff", fontSize: 14 }}>{me?.name || "—"}</div>
              <div style={{ fontSize: 12, color: "#34D399" }}>{bn ? "ভাড়াটিয়া" : "Tenant"}</div></div>
          </div>
          {[
            { i: "📞", l: bn ? "মোবাইল" : "Mobile", v: me?.phone || "—" },
            { i: "🪪", l: "NID", v: me?.nid || "—" },
            { i: "🏡", l: bn ? "স্থায়ী ঠিকানা" : "Permanent Address", v: me?.permanentAddress || "—" },
            { i: "📧", l: bn ? "ইমেইল" : "Email", v: me?.email || "—" },
            { i: "👥", l: bn ? "সদস্য সংখ্যা" : "Members", v: me?.members || "—" },
          ].map((it, i) => <div key={i} style={{ display: "flex", gap: 10, padding: "7px 0", borderBottom: i < 4 ? "1px solid rgba(255,255,255,.02)" : "none" }}>
            <span style={{ fontSize: 13, width: 22, textAlign: "center" }}>{it.i}</span>
            <div style={{ flex: 1 }}>
              <div style={{ fontSize: 11, color: "#475569", fontWeight: 600 }}>{it.l}</div>
              <div style={{ fontSize: 12, color: "#CBD5E1", wordBreak: "break-word" }}>{it.v}</div>
            </div>
          </div>)}
          <button className="btn bg" style={{ width: "100%", marginTop: 10, fontSize: 11 }} onClick={() => setShowProfile(false)}>✕ {bn ? "বন্ধ করুন" : "Close"}</button>
        </div>}
      </div>
    </Bar>

    {/* ═══ BOTTOM NAV (mobile) ═══ */}
    {me?.unitId && <div className="btm-nav">
      {[{ k: "home", i: "🏠", l: bn ? "হোম" : "Home" },
        { k: "bills", i: "📄", l: bn ? "বিল" : "Bills" },
        { k: "meters", i: "⚡", l: bn ? "মিটার" : "Meter" },
        { k: "history", i: "📋", l: bn ? "ইতিহাস" : "History" },
        { k: "notices", i: "📨", l: bn ? "নোটিশ" : "Notices", badge: totalAlerts },
      ].map(t => <div key={t.k} className={`btm-nav-item${tab === t.k ? " active" : ""}`} onClick={() => setTab(t.k)}>
        <span className="nav-icon">{t.i}</span>
        <span className="nav-label">{t.l}</span>
        {t.badge > 0 && <span className="btm-nav-badge">{t.badge}</span>}
      </div>)}
    </div>}

    <div className="content-area" style={{ maxWidth: 700 }}>
      {/* Desktop tabs */}
      {me?.unitId && <div className="hide-mobile" style={{ display: "flex", gap: 4, marginBottom: 16, overflowX: "auto", paddingBottom: 4 }}>
        {tabs.map(t => <div key={t.k} onClick={() => setTab(t.k)} style={{ padding: "8px 14px", borderRadius: 10, cursor: "pointer", fontSize: 13, fontWeight: 600, whiteSpace: "nowrap", background: tab === t.k ? "rgba(16,185,129,.1)" : "transparent", color: tab === t.k ? "#34D399" : "#64748B", border: `1px solid ${tab === t.k ? "rgba(16,185,129,.2)" : "transparent"}`, position: "relative" }}>
          {t.i} {t.l}
          {t.badge > 0 && <span style={{ marginLeft: 4, padding: "1px 6px", borderRadius: 8, background: "#EF4444", color: "#fff", fontSize: 10, fontWeight: 800 }}>{t.badge}</span>}
        </div>)}
      </div>}

      {!me?.unitId ? <div className="G2" style={{ padding: 50, textAlign: "center", animation: "fadeIn .4s" }}>
        <div style={{ fontSize: 52, marginBottom: 12 }}>🏠</div>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: "#fff", marginBottom: 6 }}>{bn ? "স্বাগতম!" : "Welcome!"}</h2>
        <p style={{ fontSize: 13, color: "#475569" }}>{bn ? "বাড়িওয়ালা আপনাকে ইউনিট নির্ধারণ করলে এখানে দেখতে পাবেন" : "Waiting for unit assignment"}</p>
        {landlord && <div style={{ marginTop: 16, padding: 12, borderRadius: 12, background: "rgba(255,255,255,.02)" }}>
          <div style={{ fontSize: 11, color: "#475569", marginBottom: 4 }}>🏠 {bn ? "বাড়িওয়ালা" : "Landlord"}</div>
          <div style={{ fontWeight: 700, color: "#E2E8F0" }}>{landlord.name} • {landlord.phone}</div>
        </div>}
      </div> :
      <div style={{ animation: "fadeIn .4s" }}>

        {/* ═══ HOME TAB ═══ */}
        {tab === "home" && <>
          {/* Unread notice banner */}
          {totalAlerts > 0 && <div onClick={() => setTab("notices")} className="CH" style={{ padding: "14px 18px", marginBottom: 14, borderRadius: 14, background: "linear-gradient(135deg, rgba(239,68,68,.08), rgba(239,68,68,.02))", border: "1px solid rgba(239,68,68,.15)", cursor: "pointer", display: "flex", alignItems: "center", gap: 12, animation: "fadeIn .4s" }}>
            <div style={{ width: 42, height: 42, borderRadius: 12, background: "rgba(239,68,68,.1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20, animation: "pulse 2s infinite" }}>🔔</div>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700, color: "#FCA5A5", fontSize: 13 }}>
                {unreadCount > 0 && `${unreadCount} ${bn ? "টি নতুন নোটিশ" : ` new notice${unreadCount > 1 ? "s" : ""}`}`}
                {unreadCount > 0 && newReplyCount > 0 && " + "}
                {newReplyCount > 0 && `${newReplyCount} ${bn ? "টি নতুন রিপ্লাই" : ` new repl${newReplyCount > 1 ? "ies" : "y"}`}`}
              </div>
              <div style={{ fontSize: 11, color: "#64748B" }}>{incomingNotices[0]?.subject || sentNotices[0]?.subject || ""}</div>
            </div>
            <span style={{ fontSize: 16, color: "#475569" }}>→</span>
          </div>}

          {/* ═══ সারি ১: বাড়িওয়ালার তথ্য + যোগাযোগ ═══ */}
          {landlord && <div className="G2" style={{ padding: 18, marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                <div style={{ width: 42, height: 42, borderRadius: 12, background: "rgba(99,102,241,.08)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 20 }}>🏠</div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: "#475569" }}>{bn ? "বাড়িওয়ালা" : "LANDLORD"}</div>
                  <div style={{ fontWeight: 700, color: "#fff", fontSize: 14 }}>{landlord.name}</div>
                </div>
              </div>
              <button className="btn bp bs" onClick={() => setShowContact(!showContact)} style={{ fontSize: 11 }}>
                📞 {bn ? "যোগাযোগ" : "Contact"}
              </button>
            </div>

            {/* Contact Options */}
            {showContact && <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,.04)", animation: "fadeIn .2s" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
                {/* 💬 WhatsApp Message */}
                <div style={{ background: "rgba(37,211,102,.06)", border: "1px solid rgba(37,211,102,.12)", borderRadius: 12, padding: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#25D366", marginBottom: 8, display: "flex", alignItems: "center", gap: 4 }}>💬 {bn ? "WhatsApp মেসেজ" : "WhatsApp"}</div>
                  <textarea className="inp" value={waMsg} onChange={e => setWaMsg(e.target.value)} placeholder={bn ? "মেসেজ লিখুন..." : "Type message..."} style={{ minHeight: 60, fontSize: 11, marginBottom: 8 }} />
                  <a href={`https://wa.me/${(landlord.phone || "").replace(/[^0-9]/g, "").replace(/^0/, "88")}${waMsg ? `?text=${encodeURIComponent(waMsg)}` : ""}`}
                    target="_blank" rel="noopener noreferrer"
                    className="btn" style={{ display: "block", textAlign: "center", width: "100%", padding: "8px 0", background: "#25D366", color: "#fff", fontWeight: 700, fontSize: 12, borderRadius: 8, textDecoration: "none" }}>
                    📩 {bn ? "WhatsApp এ পাঠান" : "Send via WhatsApp"}
                  </a>
                </div>

                {/* 📞 Phone Call */}
                <div style={{ background: "rgba(59,130,246,.06)", border: "1px solid rgba(59,130,246,.12)", borderRadius: 12, padding: 14 }}>
                  <div style={{ fontSize: 11, fontWeight: 700, color: "#60A5FA", marginBottom: 8 }}>📞 {bn ? "ফোনে কল করুন" : "Phone Call"}</div>
                  <div style={{ textAlign: "center", padding: "12px 0" }}>
                    <div style={{ fontSize: 28, marginBottom: 6 }}>📱</div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: "#fff", marginBottom: 4 }}>{landlord.phone}</div>
                  </div>
                  <a href={`tel:${landlord.phone}`}
                    className="btn" style={{ display: "block", textAlign: "center", width: "100%", padding: "8px 0", background: "#3B82F6", color: "#fff", fontWeight: 700, fontSize: 12, borderRadius: 8, textDecoration: "none" }}>
                    📞 {bn ? "কল করুন" : "Call Now"}
                  </a>
                </div>
              </div>
            </div>}

            {/* Landlord Payment Info (bKash/Nagad) */}
            {(landlord.bkashNo || landlord.nagadNo || landlord.rocketNo || landlord.bankInfo) && <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,.04)" }}>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#475569", marginBottom: 8 }}>💳 {bn ? "পেমেন্ট তথ্য" : "Payment Info"}</div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                {landlord.bkashNo && <div style={{ padding: "6px 10px", borderRadius: 8, background: "rgba(226,19,110,.06)", border: "1px solid rgba(226,19,110,.12)", fontSize: 11 }}>
                  🟪 bKash: <strong style={{ color: "#E2136E" }}>{landlord.bkashNo}</strong>
                </div>}
                {landlord.nagadNo && <div style={{ padding: "6px 10px", borderRadius: 8, background: "rgba(246,146,30,.06)", border: "1px solid rgba(246,146,30,.12)", fontSize: 11 }}>
                  🟧 Nagad: <strong style={{ color: "#F6921E" }}>{landlord.nagadNo}</strong>
                </div>}
                {landlord.rocketNo && <div style={{ padding: "6px 10px", borderRadius: 8, background: "rgba(142,36,170,.06)", border: "1px solid rgba(142,36,170,.12)", fontSize: 11 }}>
                  🟣 Rocket: <strong style={{ color: "#8E24AA" }}>{landlord.rocketNo}</strong>
                </div>}
                {landlord.bankInfo && <div style={{ padding: "6px 10px", borderRadius: 8, background: "rgba(33,150,243,.06)", border: "1px solid rgba(33,150,243,.12)", fontSize: 11, width: "100%" }}>
                  🏛️ {landlord.bankInfo}
                </div>}
              </div>
            </div>}
          </div>}

          {/* ═══ সারি ২: ইউনিট তথ্য + ভাড়া + সার্ভিস চার্জ + ইউটিলিটি ═══ */}
          <div className="G2" style={{ padding: 18, marginBottom: 12, position: "relative", overflow: "hidden" }}>
            <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg,${prop?.color || "#10B981"},transparent)` }} />
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
              {/* কলাম ১: ইউনিট */}
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#475569", marginBottom: 6 }}>{bn ? "আমার ইউনিট" : "MY UNIT"}</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: "#fff" }}>{unit?.unitNo}</div>
                <div style={{ fontSize: 11, color: "#64748B" }}>{bn ? `${unit?.floor} তলা` : `Floor ${unit?.floor}`} • {prop?.name}</div>
                <div style={{ fontSize: 12, color: "#475569", marginTop: 4 }}>📍 {prop?.address}</div>
                {me?.moveInDate && <div style={{ fontSize: 12, color: "#34D399", marginTop: 6, padding: "3px 8px", background: "rgba(16,185,129,.06)", borderRadius: 6, display: "inline-block" }}>📅 {bn ? "ভর্তি:" : "Since:"} {me.moveInDate}</div>}
              </div>
              {/* কলাম ২: ভাড়া + চার্জ */}
              <div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#475569", marginBottom: 6 }}>{bn ? "মাসিক খরচ" : "MONTHLY COST"}</div>
                {[
                  { l: bn ? "বাড়ি ভাড়া" : "Rent", v: me?.rent, c: "#34D399", i: "🏠" },
                  { l: bn ? "সার্ভিস চার্জ" : "Service", v: unit?.serviceCharge, c: "#A78BFA", i: "🔧" },
                  { l: bn ? "গ্যাস বিল" : "Gas", v: unit?.gasBill, c: "#F97316", i: "🔥" },
                ].filter(x => x.v > 0).map((x, i) => <div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: "1px solid rgba(255,255,255,.02)" }}>
                  <span style={{ fontSize: 11, color: "#64748B" }}>{x.i} {x.l}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: x.c }}>৳{bn ? FM(x.v) : FE(x.v)}</span>
                </div>)}
                {(unit?.electricityRate || 0) > 0 && <div style={{ display: "flex", justifyContent: "space-between", padding: "4px 0" }}>
                  <span style={{ fontSize: 11, color: "#64748B" }}>⚡ {bn ? "বিদ্যুৎ" : "Electric"}</span>
                  <span style={{ fontSize: 11, color: "#FBBF24" }}>৳{unit.electricityRate}/{bn ? "ইউনিট" : "unit"}</span>
                </div>}
                <div style={{ marginTop: 6, paddingTop: 6, borderTop: "1px solid rgba(255,255,255,.04)", display: "flex", justifyContent: "space-between" }}>
                  <span style={{ fontSize: 11, fontWeight: 700, color: "#94A3B8" }}>{bn ? "মোট (আনুমানিক)" : "Total (est.)"}</span>
                  <span style={{ fontSize: 14, fontWeight: 800, color: "#fff" }}>৳{bn ? FM((me?.rent || 0) + (unit?.serviceCharge || 0) + (unit?.gasBill || 0)) : FE((me?.rent || 0) + (unit?.serviceCharge || 0) + (unit?.gasBill || 0))}+</span>
                </div>
              </div>
            </div>
            {/* জামানত */}
            {(me?.advance || 0) > 0 && <div style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid rgba(255,255,255,.04)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: 12, color: "#64748B" }}>💵 {bn ? "জামানত / অগ্রিম" : "Security Deposit"}</span>
              <span style={{ fontSize: 15, fontWeight: 800, color: "#60A5FA" }}>৳{bn ? FM(me.advance) : FE(me.advance)}</span>
            </div>}
          </div>

          {/* ═══ সারি ৩: হালনাগাদ বিল — মাস + প্রতিটি বিলের স্ট্যাটাস ═══ */}
          {(() => {
            // Check if selected month is before move-in or in the future
            const moveIn = me?.moveInDate;
            let isBeforeMoveIn = false;
            let isFutureMonth = false;
            const now = new Date();
            const curMonth = new Date(now.getFullYear(), now.getMonth());
            const selDate = new Date(selY, selM);

            if (moveIn) {
              const miDate = new Date(moveIn);
              const miStart = new Date(miDate.getFullYear(), miDate.getMonth());
              isBeforeMoveIn = selDate < miStart;
            }
            isFutureMonth = selDate > curMonth;

            return <div className="G2" style={{ padding: 18, marginBottom: 12 }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 14 }}>
              <h3 style={{ fontSize: 14, fontWeight: 700 }}>📋 {bn ? "হালনাগাদ বিল" : "Bill Status"}</h3>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <button onClick={() => { const nm = selM === 0 ? 11 : selM - 1; const ny = selM === 0 ? selY - 1 : selY; setSelM(nm); setSelY(ny); }} style={{ background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.06)", borderRadius: 6, color: "#64748B", cursor: "pointer", padding: "4px 8px", fontSize: 12 }}>◀</button>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#34D399", padding: "4px 10px", background: "rgba(16,185,129,.06)", borderRadius: 8, minWidth: 100, textAlign: "center" }}>{(bn ? MBN : MEN)[selM]} {selY}</div>
                <button onClick={() => { const nm = selM === 11 ? 0 : selM + 1; const ny = selM === 11 ? selY + 1 : selY; setSelM(nm); setSelY(ny); }} style={{ background: "rgba(255,255,255,.04)", border: "1px solid rgba(255,255,255,.06)", borderRadius: 6, color: "#64748B", cursor: "pointer", padding: "4px 8px", fontSize: 12 }}>▶</button>
              </div>
            </div>

            {(isBeforeMoveIn || isFutureMonth) ? <div style={{ padding: 30, textAlign: "center", borderRadius: 12, background: "rgba(255,255,255,.02)", border: "1px solid rgba(255,255,255,.04)" }}>
                <div style={{ fontSize: 36, marginBottom: 8 }}>🚫</div>
                <div style={{ fontWeight: 700, color: "#94A3B8", fontSize: 13, marginBottom: 4 }}>{bn ? "প্রযোজ্য নয়" : "Not Applicable"}</div>
                <div style={{ fontSize: 11, color: "#475569" }}>{isBeforeMoveIn
                  ? (bn ? `আপনি এই ইউনিটে এসেছেন ${moveIn} তারিখে। এর আগের মাসের বিল নেই।` : `You moved in on ${moveIn}. No bills before that.`)
                  : (bn ? "এই মাস এখনো আসেনি। অগ্রিম মাসের বিল প্রযোজ্য নয়।" : "This month hasn't arrived yet.")
                }</div>
              </div>
            : <>
              {(() => {
                const billTypes = [
                  { k: "rent", l: bn ? "বাড়ি ভাড়া" : "Rent", i: "🏠", c: "#34D399", amount: me?.rent },
                  { k: "service", l: bn ? "সার্ভিস চার্জ" : "Service Charge", i: "🔧", c: "#A78BFA", amount: unit?.serviceCharge },
                  { k: "gas", l: bn ? "গ্যাস বিল" : "Gas Bill", i: "🔥", c: "#F97316", amount: unit?.gasBill },
                  { k: "electricity", l: bn ? "বিদ্যুৎ বিল" : "Electricity", i: "⚡", c: "#FBBF24", amount: null },
                  { k: "water", l: bn ? "পানি বিল" : "Water Bill", i: "💧", c: "#38BDF8", amount: null },
                  { k: "internet", l: bn ? "ইন্টারনেট" : "Internet", i: "🌐", c: "#34D399", amount: null },
                ].filter(b => b.amount > 0 || b.k === "rent" || payments.some(p => p.type === b.k && p.monthKey === mk));

                return <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {billTypes.map(bt => {
                    const paid = bt.k === "rent"
                      ? rentPays.find(p => p.monthKey === mk)
                      : payments.find(p => p.type === bt.k && p.monthKey === mk);
                    const isPaid = !!paid;
                    const paidAmt = paid ? Number(paid.amount) : 0;
                    return <div key={bt.k} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", borderRadius: 10, background: isPaid ? "rgba(16,185,129,.03)" : "rgba(245,158,11,.03)", border: `1px solid ${isPaid ? "rgba(16,185,129,.1)" : "rgba(245,158,11,.1)"}` }}>
                      <span style={{ fontSize: 18, width: 28, textAlign: "center" }}>{bt.i}</span>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: "#CBD5E1" }}>{bt.l}</div>
                        {bt.amount > 0 && <div style={{ fontSize: 12, color: "#475569" }}>৳{bn ? FM(bt.amount) : FE(bt.amount)}</div>}
                      </div>
                      <div style={{ textAlign: "right" }}>
                        {isPaid ? <>
                          <span className="badge bP" style={{ fontSize: 11 }}>✅ {bn ? "পেইড" : "Paid"}</span>
                          <div style={{ fontSize: 12, color: "#34D399", fontWeight: 700, marginTop: 2 }}>৳{bn ? FM(paidAmt) : FE(paidAmt)}</div>
                        </> : <span className="badge bD" style={{ fontSize: 11 }}>⏳ {bn ? "বাকি" : "Due"}</span>}
                      </div>
                    </div>;
                  })}
                </div>;
              })()}

              {/* Quick action buttons - only when bills are applicable */}
              <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
                {(!curRentPay || curRentPay.status !== "paid") && <button className="btn bp" style={{ flex: 1, fontSize: 12 }} onClick={() => setModal("payRent")}>💰 {bn ? "ভাড়া দিন" : "Pay Rent"}</button>}
                <button className="btn bg" style={{ flex: 1, fontSize: 12 }} onClick={() => setModal("payUtil")}>📄 {bn ? "বিল দিন" : "Pay Bill"}</button>
              </div>
            </>}
          </div>;
          })()}
        </>}

        {/* ═══ BILLS TAB ═══ */}
        {tab === "bills" && <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700 }}>📄 {bn ? "ইউটিলিটি বিল" : "Utility Bills"}</h3>
            <button className="btn bp bs" onClick={() => setModal("payUtil")}>➕ {bn ? "বিল দিন" : "Pay Bill"}</button>
          </div>
          {UTIL_TYPES.map(ut => {
            const ups = utilPays.filter(p => p.type === ut.k);
            if (ups.length === 0) return null;
            return <div key={ut.k} className="G" style={{ marginBottom: 10 }}>
              <div style={{ padding: "12px 16px", borderBottom: "1px solid rgba(255,255,255,.03)", display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 18 }}>{ut.i}</span>
                <span style={{ fontWeight: 700, color: ut.c, fontSize: 13 }}>{ut.l}</span>
                <span className="badge" style={{ background: `${ut.c}15`, color: ut.c, marginLeft: "auto" }}>{ups.length}</span>
              </div>
              {ups.sort((a, b) => (b.paidAt || "").localeCompare(a.paidAt || "")).map(p => <div key={p.id} className="row" style={{ cursor: "pointer" }} onClick={() => { setSelPay(p); setModal("receipt"); }}>
                <div><div style={{ fontSize: 11, fontWeight: 600 }}>{p.monthKey}</div><div style={{ fontSize: 11, color: "#334155" }}>{p.paidAt?.split("T")[0]}</div></div>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontWeight: 800, color: "#fff" }}>৳{bn ? FM(p.amount) : FE(p.amount)}</span>
                  <span style={{ fontSize: 12, color: "#475569" }}>🧾</span>
                </div>
              </div>)}
            </div>;
          })}
          {utilPays.length === 0 && <div className="G2" style={{ padding: 40, textAlign: "center" }}>
            <div style={{ fontSize: 48, marginBottom: 8 }}>📄</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#64748B" }}>{bn ? "কোনো ইউটিলিটি বিল নেই" : "No utility bills yet"}</div>
            <p style={{ fontSize: 13, color: "#475569", marginTop: 8 }}>{bn ? "বিদ্যুৎ, পানি, গ্যাস বিল পরিশোধের তথ্য এখানে দেখাবে" : "Utility bill payments will appear here"}</p>
          </div>}
        </>}

        {/* ═══ METER READINGS TAB (Tenant view) ═══ */}
        {tab === "meters" && <>
          <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>⚡ {bn ? "মিটার রিডিং" : "Meter Readings"}</h3>
          {(!meters || meters.length === 0) ? <div className="G2" style={{ padding: 40, textAlign: "center" }}>
            <div style={{ fontSize: 48, marginBottom: 8 }}>⚡</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#64748B" }}>{bn ? "এখনো কোনো মিটার রিডিং নেই" : "No meter readings yet"}</div>
            <p style={{ fontSize: 13, color: "#475569", marginTop: 8 }}>{bn ? "বাড়িওয়ালা মিটার রিডিং যোগ করলে এখানে দেখাবে" : "Meter readings will appear here once added by landlord"}</p>
          </div> : <div className="G" style={{ overflow: "hidden" }}>
            {meters.map(m => <div key={m.id} className="row">
              <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                <div style={{ width: 36, height: 36, borderRadius: 10, background: "rgba(251,191,36,.06)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>⚡</div>
                <div>
                  <div style={{ fontWeight: 700, fontSize: 13, color: "#fff" }}>{m.monthKey || m.createdAt?.split("T")[0]}</div>
                  <div style={{ fontSize: 12, color: "#64748B" }}>{m.prevReading} → {m.currentReading} ({m.currentReading - m.prevReading} {bn ? "ইউনিট" : "units"})</div>
                </div>
              </div>
              <div style={{ textAlign: "right" }}>
                <div style={{ fontWeight: 800, color: "#FBBF24", fontSize: 15 }}>৳{bn ? FM(m.billAmount || 0) : FE(m.billAmount || 0)}</div>
                <div style={{ fontSize: 12, color: "#475569" }}>৳{m.rate}/{bn ? "ইউনিট" : "unit"}</div>
              </div>
            </div>)}
          </div>}
        </>}

        {/* ═══ HISTORY TAB ═══ */}
        {tab === "history" && <>
          <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>📋 {bn ? "সব পেমেন্ট ইতিহাস" : "Payment History"}</h3>
          {payments.length === 0 ? <div className="G2" style={{ padding: 40, textAlign: "center" }}>
            <div style={{ fontSize: 48, marginBottom: 8 }}>📋</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#64748B" }}>{bn ? "এখনো কোনো পেমেন্ট ইতিহাস নেই" : "No payment history yet"}</div>
          </div> :
            <div className="G" style={{ overflow: "hidden" }}>
              {payments.sort((a, b) => (b.paidAt || "").localeCompare(a.paidAt || "")).map(p => {
                const ut = UTIL_TYPES.find(u => u.k === p.type);
                const pm = PAY.find(m => m.k === p.method);
                const isRent = !p.type || p.type === "rent";
                return <div key={p.id} className="row" style={{ cursor: "pointer" }} onClick={() => { setSelPay(p); setModal("receipt"); }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <div style={{ width: 32, height: 32, borderRadius: 8, background: isRent ? "rgba(16,185,129,.08)" : `${ut?.c || "#666"}10`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 16 }}>
                      {isRent ? "🏠" : (ut?.i || "📦")}
                    </div>
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 12 }}>{isRent ? (bn ? "ভাড়া" : "Rent") : (ut?.l || p.type)}</div>
                      <div style={{ fontSize: 11, color: "#334155" }}>{p.monthKey} • {p.paidAt?.split("T")[0]}</div>
                    </div>
                  </div>
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontWeight: 800, color: isRent ? "#34D399" : (ut?.c || "#fff") }}>৳{bn ? FM(p.amount) : FE(p.amount)}</div>
                    <div style={{ fontSize: 11, color: "#475569" }}>{pm?.l || p.method} 🧾</div>
                  </div>
                </div>;
              })}
            </div>}
        </>}

        {/* ═══ AGREEMENT TAB (Tenant view) ═══ */}
        {tab === "agreement" && <>
          <h3 style={{ fontSize: 16, fontWeight: 700, marginBottom: 16 }}>📜 {bn ? "চুক্তিপত্র" : "Agreements"}</h3>
          {(!agreements || agreements.length === 0) ? <div className="G2" style={{ padding: 40, textAlign: "center" }}>
            <div style={{ fontSize: 48, marginBottom: 8 }}>📜</div>
            <div style={{ fontSize: 15, fontWeight: 700, color: "#64748B" }}>{bn ? "কোনো চুক্তি নেই" : "No agreements yet"}</div>
            <p style={{ fontSize: 13, color: "#475569", marginTop: 8 }}>{bn ? "বাড়িওয়ালা চুক্তি তৈরি করলে এখানে দেখাবে" : "Agreements will appear once created by landlord"}</p>
          </div> :
            agreements.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || "")).map(a => <div key={a.id} className="G" style={{ padding: 16, marginBottom: 10, borderLeft: `3px solid ${a.status === "active" ? "#10B981" : "#475569"}` }}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
                <span style={{ fontWeight: 700, color: "#fff", fontSize: 15 }}>📜 {bn ? "ভাড়া চুক্তি" : "Rental Agreement"}</span>
                <span className="badge" style={{ background: a.status === "active" ? "rgba(16,185,129,.1)" : "rgba(255,255,255,.04)", color: a.status === "active" ? "#34D399" : "#475569" }}>
                  {a.status === "active" ? (bn ? "✅ সক্রিয়" : "✅ Active") : (bn ? "বাতিল" : "Ended")}
                </span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 10 }}>
                {[{ l: bn ? "মাসিক ভাড়া" : "Monthly Rent", v: `৳${bn ? FM(a.rent) : FE(a.rent)}`, c: "#34D399" },
                  { l: bn ? "অগ্রিম" : "Advance", v: `৳${bn ? FM(a.advance || 0) : FE(a.advance || 0)}` },
                  { l: bn ? "শুরুর তারিখ" : "Start Date", v: a.startDate || "—" },
                  { l: bn ? "মেয়াদ" : "Duration", v: a.duration ? `${a.duration} ${bn ? "মাস" : "months"}` : "—" },
                ].map((it, i) => <div key={i} style={{ padding: "8px 12px", background: "rgba(255,255,255,.02)", borderRadius: 8 }}>
                  <div style={{ fontSize: 11, color: "#475569" }}>{it.l}</div>
                  <div style={{ fontWeight: 700, fontSize: 13, color: it.c || "#E2E8F0" }}>{it.v}</div>
                </div>)}
              </div>
              {a.terms && <div style={{ padding: 12, background: "rgba(255,255,255,.01)", borderRadius: 8, fontSize: 12, color: "#94A3B8", lineHeight: 1.6, borderLeft: "2px solid rgba(255,255,255,.05)" }}>📝 {a.terms}</div>}
              {a.conditions && <div style={{ padding: 12, background: "rgba(255,255,255,.01)", borderRadius: 8, fontSize: 12, color: "#94A3B8", lineHeight: 1.6, marginTop: 6, borderLeft: "2px solid rgba(255,255,255,.05)" }}>⚖️ {a.conditions}</div>}
            </div>)}

          {/* Rent History */}
          {me?.rentHistory?.length > 0 && <div className="G" style={{ padding: 16, marginTop: 10 }}>
            <h4 style={{ fontSize: 13, fontWeight: 700, color: "#A78BFA", marginBottom: 10 }}>📋 {bn ? "ভাড়ার ইতিহাস" : "Rent History"}</h4>
            {me.rentHistory.slice().reverse().map((h, i) => <div key={i} style={{ display: "flex", justifyContent: "space-between", fontSize: 11, padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,.02)" }}>
              <div>
                <span style={{ color: "#64748B" }}>{h.date?.split("T")[0]}</span>
                <span style={{ color: "#475569", marginLeft: 8 }}>({h.reason})</span>
              </div>
              <div style={{ fontWeight: 700 }}>
                {h.prevRent ? <span style={{ color: "#F59E0B", textDecoration: "line-through", marginRight: 6 }}>৳{h.prevRent}</span> : null}
                <span style={{ color: "#34D399" }}>৳{h.rent}</span>
              </div>
            </div>)}
          </div>}
        </>}

        {/* ═══ NOTICES TAB ═══ */}
        {tab === "notices" && <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 16 }}>
            <h3 style={{ fontSize: 16, fontWeight: 700 }}>📨 {bn ? "নোটিশ" : "Notices"} {totalAlerts > 0 && <span className="badge bD" style={{ fontSize: 11 }}>{totalAlerts} {bn ? "নতুন" : "new"}</span>}</h3>
            <button className="btn bp bs" onClick={() => setModal("sendNotice")}>✏️ {bn ? "নোটিশ পাঠান" : "Send Notice"}</button>
          </div>

          {!selNotice ? <>
            {allNotices.length === 0 ? <div className="G2" style={{ padding: 40, textAlign: "center" }}>
              <div style={{ fontSize: 48, marginBottom: 8 }}>📨</div>
              <div style={{ fontSize: 15, fontWeight: 700, color: "#64748B" }}>{bn ? "কোনো নোটিশ নেই" : "No notices yet"}</div>
              <p style={{ fontSize: 13, color: "#475569", marginTop: 8, marginBottom: 16 }}>{bn ? "বাড়িওয়ালাকে মেরামত বা অন্যান্য বিষয়ে জানাতে নোটিশ পাঠান" : "Send notices for repairs or other issues"}</p>
              <button className="btn bp" onClick={() => setModal("sendNotice")}>📨 {bn ? "প্রথম নোটিশ পাঠান" : "Send First Notice"}</button>
            </div> :
              allNotices.map(n => {
                const st = STATUS_MAP.find(s => s.k === n.status) || STATUS_MAP[0];
                const isMine = isMe(n.fromId);
                const isUnread = !isMine && !n.read;
                const hasReply = isMine && n.hasNewReply && !isMe(n.lastReplyBy);
                return <div key={n.id} className="G CH" style={{ padding: 16, marginBottom: 8, borderLeft: `3px solid ${isUnread ? "#EF4444" : isMine ? st.c : (n.read ? "#10B981" : "#60A5FA")}`, background: isUnread ? "rgba(239,68,68,.03)" : hasReply ? "rgba(99,102,241,.03)" : undefined }}
                  onClick={async () => {
                    setSelNotice(n);
                    setReplyText("");
                    if (isUnread && onMarkNoticeRead) await onMarkNoticeRead(n.id);
                    if (hasReply && onMarkReplyRead) await onMarkReplyRead(n.id);
                  }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      {/* Read/Unread indicator */}
                      {isUnread ? <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#EF4444", flexShrink: 0, animation: "pulse 2s infinite", boxShadow: "0 0 6px rgba(239,68,68,.5)" }} />
                        : !isMine ? <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#10B981", flexShrink: 0 }} title={bn ? "পড়া হয়েছে" : "Read"} />
                        : hasReply ? <span style={{ width: 10, height: 10, borderRadius: "50%", background: "#A78BFA", flexShrink: 0, animation: "pulse 2s infinite" }} />
                        : null}
                      <span className="badge" style={{ background: isMine ? `${st.c}15` : isUnread ? "rgba(239,68,68,.1)" : "rgba(16,185,129,.1)", color: isMine ? st.c : isUnread ? "#EF4444" : "#10B981" }}>
                        {isMine ? (bn ? "📤 আমার পাঠানো" : "📤 Sent") : isUnread ? (bn ? "🔴 নতুন" : "🔴 New") : (bn ? "✅ পড়া হয়েছে" : "✅ Read")}
                      </span>
                    </div>
                    <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      {(n.replies?.length || 0) > 0 && <span style={{ fontSize: 11, color: "#A78BFA" }}>💬{n.replies.length}</span>}
                      <span className="badge" style={{ background: `${st.c}10`, color: st.c, fontSize: 9 }}>{st.i} {st.l}</span>
                    </div>
                  </div>
                  <div style={{ fontWeight: 700, color: isUnread ? "#fff" : "#CBD5E1", fontSize: 14, marginBottom: 2 }}>{n.subject}</div>
                  <div style={{ fontSize: 12, color: "#94A3B8", lineHeight: 1.4 }}>{n.message?.slice(0, 80)}{n.message?.length > 80 ? "..." : ""}</div>
                  <div style={{ fontSize: 11, color: "#334155", marginTop: 4 }}>{n.createdAt?.split("T")[0]} • {isMe(n.fromId) ? (bn ? "আমি → বাড়িওয়ালা" : "Me → Landlord") : (bn ? "বাড়িওয়ালা → আমি" : "Landlord → Me")}</div>
                </div>;
              })}
          </> :
          /* ═══ NOTICE DETAIL + REPLY ═══ */
          <div style={{ animation: "fadeIn .3s" }}>
            <button className="btn bg bs" onClick={() => { setSelNotice(null); setReplyText(""); }} style={{ marginBottom: 14 }}>← {bn ? "পিছনে" : "Back"}</button>

            {/* Notice content */}
            <div className="G" style={{ padding: 20, marginBottom: 14 }}>
              {(() => {
                const st = STATUS_MAP.find(s => s.k === selNotice.status) || STATUS_MAP[0];
                const isMine = isMe(selNotice.fromId);
                return <>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
                    <h3 style={{ fontSize: 16, fontWeight: 700, color: "#fff" }}>{selNotice.subject}</h3>
                    <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                      {!isMine && <span style={{ width: 10, height: 10, borderRadius: "50%", background: selNotice.read ? "#10B981" : "#EF4444" }} />}
                      <span className="badge" style={{ background: `${st.c}15`, color: st.c, padding: "4px 12px" }}>{st.i} {st.l}</span>
                    </div>
                  </div>
                  <div style={{ fontSize: 13, color: "#CBD5E1", lineHeight: 1.6, marginBottom: 12, padding: 14, background: "rgba(255,255,255,.02)", borderRadius: 10 }}>{selNotice.message}</div>
                  <div style={{ fontSize: 12, color: "#334155" }}>📅 {selNotice.createdAt?.split("T")[0]} • {isMine ? (bn ? "আমি পাঠিয়েছি" : "Sent by me") : (bn ? "বাড়িওয়ালা পাঠিয়েছে" : "From landlord")}</div>
                </>;
              })()}
            </div>

            {/* Resolve button (for tenant's own complaints) */}
            {isMe(selNotice.fromId) && selNotice.status !== "resolved" && <div className="G" style={{ padding: 14, marginBottom: 14 }}>
              <button className="btn bp" style={{ width: "100%" }} onClick={() => {
                if (onUpdateNoticeStatus) onUpdateNoticeStatus(selNotice.id, "resolved", bn ? "ভাড়াটিয়া সমস্যা সমাধান নিশ্চিত করেছে" : "Tenant confirmed resolved");
              }}>🟢 {bn ? "সমস্যা সমাধান হয়েছে" : "Mark as Resolved"}</button>
            </div>}

            {/* Status history */}
            {selNotice.statusHistory?.length > 0 && <div className="G" style={{ padding: 18, marginBottom: 14 }}>
              <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>📋 {bn ? "আপডেট ইতিহাস" : "Status History"}</h4>
              {selNotice.statusHistory.map((h, i) => {
                const hs = STATUS_MAP.find(s => s.k === h.status) || STATUS_MAP[0];
                return <div key={i} style={{ display: "flex", gap: 10, marginBottom: 10, paddingBottom: 10, borderBottom: "1px solid rgba(255,255,255,.03)" }}>
                  <div style={{ width: 28, height: 28, borderRadius: 8, background: `${hs.c}12`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 12, flexShrink: 0 }}>{hs.i}</div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 700, color: hs.c, fontSize: 12 }}>{hs.l}</div>
                    {h.note && <div style={{ fontSize: 11, color: "#94A3B8", marginTop: 2 }}>{h.note}</div>}
                    <div style={{ fontSize: 11, color: "#334155", marginTop: 2 }}>{h.at?.split("T")[0]}</div>
                  </div>
                </div>;
              })}
            </div>}

            {/* ═══ REPLY / CONVERSATION ═══ */}
            <div className="G" style={{ padding: 18 }}>
              <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 12 }}>💬 {bn ? "কথোপকথন" : "Conversation"} {(selNotice.replies?.length || 0) > 0 && <span style={{ color: "#475569", fontWeight: 400 }}>({selNotice.replies.length})</span>}</h4>

              {(selNotice.replies || []).length === 0 && <div style={{ padding: 16, textAlign: "center", color: "#334155", fontSize: 12 }}>{bn ? "এখনো কোনো রিপ্লাই নেই" : "No replies yet"}</div>}

              {(selNotice.replies || []).map((r, i) => {
                const rIsMe = isMe(r.fromId);
                return <div key={r.id || i} style={{ display: "flex", flexDirection: rIsMe ? "row-reverse" : "row", gap: 8, marginBottom: 10 }}>
                  <div style={{ width: 30, height: 30, borderRadius: 10, background: rIsMe ? "rgba(16,185,129,.1)" : "rgba(59,130,246,.1)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 13, flexShrink: 0 }}>{rIsMe ? "👤" : "🏠"}</div>
                  <div style={{ maxWidth: "75%", padding: "10px 14px", borderRadius: rIsMe ? "14px 4px 14px 14px" : "4px 14px 14px 14px", background: rIsMe ? "rgba(16,185,129,.06)" : "rgba(59,130,246,.06)", border: `1px solid ${rIsMe ? "rgba(16,185,129,.1)" : "rgba(59,130,246,.1)"}` }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: rIsMe ? "#34D399" : "#60A5FA", marginBottom: 2 }}>{rIsMe ? (bn ? "আমি" : "Me") : (r.fromName || (bn ? "বাড়িওয়ালা" : "Landlord"))}</div>
                    <div style={{ fontSize: 12, color: "#CBD5E1", lineHeight: 1.5 }}>{r.text}</div>
                    <div style={{ fontSize: 8, color: "#334155", marginTop: 4, textAlign: rIsMe ? "left" : "right" }}>{r.at?.split("T")[0]} {r.at?.split("T")[1]?.slice(0, 5)}</div>
                  </div>
                </div>;
              })}

              {/* Reply input */}
              <div style={{ display: "flex", gap: 6, marginTop: 10, paddingTop: 10, borderTop: "1px solid rgba(255,255,255,.04)" }}>
                <input className="inp" value={replyText} onChange={e => setReplyText(e.target.value)} placeholder={bn ? "রিপ্লাই লিখুন..." : "Type reply..."} style={{ flex: 1, fontSize: 12 }} onKeyDown={e => {
                  if (e.key === "Enter" && replyText.trim() && onReplyNotice) {
                    onReplyNotice(selNotice.id, { fromId: me?.uid || me?.id, fromName: me?.name || (bn ? "ভাড়াটিয়া" : "Tenant"), text: replyText.trim() });
                    setReplyText("");
                  }
                }} />
                <button className="btn bp" disabled={!replyText.trim()} onClick={() => {
                  if (replyText.trim() && onReplyNotice) {
                    onReplyNotice(selNotice.id, { fromId: me?.uid || me?.id, fromName: me?.name || (bn ? "ভাড়াটিয়া" : "Tenant"), text: replyText.trim() });
                    setReplyText("");
                  }
                }} style={{ padding: "8px 14px" }}>📩 {bn ? "পাঠান" : "Send"}</button>
              </div>
            </div>
          </div>}
        </>}

      </div>}
    </div>

    {/* ═══ MODALS ═══ */}
    {modal === "payRent" && me && <PayModal bn={bn} tenant={me} mk={mk} payType="rent"
      onSave={async (p) => { await recordPayment(p); setModal(null); }} onClose={() => setModal(null)} />}

    {modal === "payUtil" && me && <UtilityPayModal bn={bn} tenant={me} mk={mk} utilTypes={UTIL_TYPES}
      onSave={async (p) => { await recordPayment(p); setModal(null); }} onClose={() => setModal(null)} />}

    {modal === "receipt" && selPay && <ReceiptModal bn={bn} payment={selPay} tenant={me} landlord={landlord} unit={unit} prop={prop} utilTypes={UTIL_TYPES}
      onEdit={onEditPayment ? async (id, data) => { await onEditPayment(id, data); setModal(null); } : null}
      onDelete={onDeletePayment ? async (id) => { await onDeletePayment(id); setModal(null); } : null}
      onClose={() => { setModal(null); setSelPay(null); }} />}

    {modal === "sendNotice" && landlord && <NoticeModal bn={bn} fromId={me?.uid || me?.id} toId={landlord.uid || landlord.id}
      onSave={async (n) => { if (onSendNotice) await onSendNotice(n); setModal(null); }} onClose={() => setModal(null)} />}
  </div>;
}

// ═══ MODALS ═══
function AddPropModal({ bn, onSave, onClose }) {
  const [f, sF] = useState({ name: "", address: "", location: "", floors: 5, unitsPerFloor: 4, unitType: "flat", color: "#10B981", defaultRent: "", defaultConditions: "", defaultBedrooms: "", defaultBathrooms: "", defaultServiceCharge: "", electricityRate: "", defaultGasBill: "" });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => sF(o => ({ ...o, [k]: v }));
  const cols = ["#10B981", "#6366F1", "#F97316", "#EAB308", "#06B6D4", "#EC4899", "#3B82F6"];
  const handleSave = async () => {
    if (!f.name || !f.address || busy) return;
    setBusy(true);
    try { await onSave(f); } catch(e) { console.error(e); } finally { setBusy(false); }
  };
  return <div className="ov" onClick={onClose}><div className="mdl" onClick={e => e.stopPropagation()}><div className="mdl-handle" />
    <h2 style={{ fontSize: 18, fontWeight: 800, color: "#fff", marginBottom: 16 }}>🏘️ {bn ? "নতুন বাড়ি" : "New Property"}</h2>
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div><label className="lbl">{bn ? "নাম" : "Name"} *</label><input className="inp" value={f.name} onChange={e => set("name", e.target.value)} /></div>
      <div><label className="lbl">{bn ? "ঠিকানা" : "Address"} *</label><textarea className="inp" style={{ minHeight: 50 }} value={f.address} onChange={e => set("address", e.target.value)} /></div>
      <div><label className="lbl">{bn ? "এলাকা" : "Location"}</label><input className="inp" value={f.location} onChange={e => set("location", e.target.value)} /></div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        <div><label className="lbl">{bn ? "তলা" : "Floors"}</label><input className="inp" type="number" min="1" value={f.floors} onChange={e => set("floors", Number(e.target.value))} /></div>
        <div><label className="lbl">{bn ? "ইউনিট/তলা" : "Units/Floor"}</label><input className="inp" type="number" min="1" value={f.unitsPerFloor} onChange={e => set("unitsPerFloor", Number(e.target.value))} /></div>
        <div><label className="lbl">{bn ? "ধরন" : "Type"}</label><select className="inp" value={f.unitType} onChange={e => set("unitType", e.target.value)}>
          <option value="flat">{bn ? "ফ্ল্যাট" : "Flat"}</option><option value="room">{bn ? "রুম" : "Room"}</option>
        </select></div>
      </div>

      {/* Rent & Details */}
      <div style={{ borderTop: "1px solid rgba(255,255,255,.04)", paddingTop: 10, marginTop: 4 }}>
        <div style={{ fontSize: 11, fontWeight: 700, color: "#34D399", marginBottom: 8 }}>💰 {bn ? "ভাড়া ও তথ্য (সব ইউনিটে প্রযোজ্য)" : "Rent & Details (applies to all units)"}</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <div><label className="lbl">{bn ? "ভাড়া ৳/মাস" : "Rent ৳/mo"}</label><input className="inp" type="number" value={f.defaultRent} onChange={e => set("defaultRent", e.target.value)} placeholder="0" /></div>
          <div><label className="lbl">{bn ? "সার্ভিস চার্জ ৳" : "Service ৳"}</label><input className="inp" type="number" value={f.defaultServiceCharge} onChange={e => set("defaultServiceCharge", e.target.value)} placeholder="0" /></div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 6, marginTop: 8 }}>
          <div><label className="lbl">⚡ {bn ? "৳/ইউনিট" : "৳/unit"}</label><input className="inp" type="number" step="0.01" value={f.electricityRate} onChange={e => set("electricityRate", e.target.value)} placeholder="8" /></div>
          <div><label className="lbl">🔥 {bn ? "গ্যাস ৳" : "Gas ৳"}</label><input className="inp" type="number" value={f.defaultGasBill} onChange={e => set("defaultGasBill", e.target.value)} placeholder="0" /></div>
          <div><label className="lbl">🛏️</label><input className="inp" type="number" value={f.defaultBedrooms} onChange={e => set("defaultBedrooms", e.target.value)} placeholder="0" /></div>
          <div><label className="lbl">🚿</label><input className="inp" type="number" value={f.defaultBathrooms} onChange={e => set("defaultBathrooms", e.target.value)} placeholder="0" /></div>
        </div>
        <div style={{ marginTop: 8 }}><label className="lbl">📋 {bn ? "শর্ত / চুক্তি" : "Conditions"}</label><textarea className="inp" value={f.defaultConditions} onChange={e => set("defaultConditions", e.target.value)} placeholder={bn ? "যেমন: অগ্রিম ২ মাসের, পোষা প্রাণী নিষেধ..." : "e.g. 2 months advance, no pets..."} /></div>
      </div>

      <div><label className="lbl">{bn ? "রং" : "Color"}</label><div style={{ display: "flex", gap: 6 }}>
        {cols.map(c => <div key={c} onClick={() => set("color", c)} style={{ width: 24, height: 24, borderRadius: 6, background: c, cursor: "pointer", border: f.color === c ? "3px solid #fff" : "3px solid transparent" }} />)}
      </div></div>
    </div>
    <div style={{ display: "flex", gap: 8, marginTop: 20 }}>
      <button className="btn bg" style={{ flex: 1 }} onClick={onClose}>{bn ? "বাতিল" : "Cancel"}</button>
      <button className="btn bp" style={{ flex: 1 }} onClick={handleSave} disabled={busy}>{busy ? "⏳..." : (bn ? "যোগ করুন" : "Add")}</button>
    </div>
  </div></div>;
}

function ManualAddTenantModal({ bn, units, properties, onSave, onClose }) {
  const [f, sF] = useState({ name: "", phone: "", email: "", nid: "", members: 1, advance: "", moveInDate: new Date().toISOString().split("T")[0], notes: "", permanentAddress: "" });
  const [unitId, setUnitId] = useState("");
  const [rent, setRent] = useState("");
  const [busy, setBusy] = useState(false);
  const set = (k, v) => sF(o => ({ ...o, [k]: v }));

  const selUnit = units.find(u => u.id === unitId);
  const getPropName = (u) => { const p = properties.find(p => p.id === u.propertyId); return p ? p.name : ""; };

  // Auto-fill rent when unit selected
  const handleUnitChange = (id) => {
    setUnitId(id);
    const u = units.find(x => x.id === id);
    if (u?.rent) setRent(String(u.rent));
  };

  const handleSave = async () => {
    if (!f.name || busy) return;
    setBusy(true);
    try { await onSave(f, unitId || null, rent); } catch(e) { console.error(e); } finally { setBusy(false); }
  };

  return <div className="ov" onClick={onClose}><div className="mdl" onClick={e => e.stopPropagation()}><div className="mdl-handle" />
    <h2 style={{ fontSize: 18, fontWeight: 800, color: "#fff", marginBottom: 16 }}>👤➕ {bn ? "ম্যানুয়ালি ভাড়াটিয়া যোগ" : "Add Tenant Manually"}</h2>
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div><label className="lbl">{bn ? "নাম" : "Name"} *</label><input className="inp" value={f.name} onChange={e => set("name", e.target.value)} /></div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div><label className="lbl">{bn ? "ফোন" : "Phone"}</label><input className="inp" value={f.phone} onChange={e => set("phone", e.target.value)} placeholder="01XXXXXXXXX" /></div>
        <div><label className="lbl">NID</label><input className="inp" value={f.nid} onChange={e => set("nid", e.target.value)} /></div>
      </div>
      <div><label className="lbl">🏡 {bn ? "স্থায়ী ঠিকানা" : "Permanent Address"}</label><input className="inp" value={f.permanentAddress} onChange={e => set("permanentAddress", e.target.value)} placeholder={bn ? "গ্রাম, উপজেলা, জেলা" : "Village, Upazila, District"} /></div>

      {/* Unit selection */}
      <div style={{ borderTop: "1px solid rgba(255,255,255,.04)", paddingTop: 10 }}>
        <label className="lbl">🚪 {bn ? "ইউনিট নির্বাচন" : "Select Unit"}</label>
        <select className="inp" value={unitId} onChange={e => handleUnitChange(e.target.value)}>
          <option value="">— {bn ? "ইউনিট ছাড়াই যোগ করুন" : "Add without unit"} —</option>
          {units.map(u => <option key={u.id} value={u.id}>{getPropName(u)} › {u.unitNo} ({bn ? `${u.floor} তলা` : `Floor ${u.floor}`}){u.rent ? ` — ৳${u.rent}` : ""}</option>)}
        </select>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8 }}>
        <div><label className="lbl">{bn ? "ভাড়া ৳" : "Rent ৳"}</label><input className="inp" type="number" value={rent} onChange={e => setRent(e.target.value)} /></div>
        <div><label className="lbl">{bn ? "অগ্রিম ৳" : "Advance ৳"}</label><input className="inp" type="number" value={f.advance} onChange={e => set("advance", e.target.value)} /></div>
        <div><label className="lbl">{bn ? "সদস্য" : "Members"}</label><input className="inp" type="number" min="1" value={f.members} onChange={e => set("members", Number(e.target.value))} /></div>
      </div>
      <div><label className="lbl">{bn ? "শুরু" : "Move-in"}</label><input className="inp" type="date" value={f.moveInDate} onChange={e => set("moveInDate", e.target.value)} /></div>
      <div><label className="lbl">📝 {bn ? "নোট" : "Notes"}</label><textarea className="inp" value={f.notes} onChange={e => set("notes", e.target.value)} /></div>
    </div>
    <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
      <button className="btn bg" style={{ flex: 1 }} onClick={onClose}>{bn ? "বাতিল" : "Cancel"}</button>
      <button className="btn bp" style={{ flex: 1 }} onClick={handleSave} disabled={busy}>{busy ? "⏳..." : (bn ? "যোগ করুন" : "Add")}</button>
    </div>
  </div></div>;
}

function AssignModal({ bn, unitId, tenants, onSave, onClose }) {
  const [tid, setTid] = useState(""); const [rent, setRent] = useState(""); const [adv, setAdv] = useState(""); const [date, setDate] = useState(TODAY()); const [notes, setNotes] = useState("");
  return <div className="ov" onClick={onClose}><div className="mdl" onClick={e => e.stopPropagation()}><div className="mdl-handle" />
    <h2 style={{ fontSize: 18, fontWeight: 800, color: "#fff", marginBottom: 16 }}>👤 {bn ? "নির্ধারণ" : "Assign"}</h2>
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div><label className="lbl">{bn ? "ভাড়াটিয়া" : "Tenant"} *</label>
        <select className="inp" value={tid} onChange={e => setTid(e.target.value)}>
          <option value="">— {bn ? "বাছাই" : "Select"} —</option>
          {tenants.map(t => <option key={t.id} value={t.id}>{t.name} ({t.phone})</option>)}
        </select></div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div><label className="lbl">{bn ? "ভাড়া ৳" : "Rent ৳"} *</label><input className="inp" type="number" value={rent} onChange={e => setRent(e.target.value)} /></div>
        <div><label className="lbl">{bn ? "অগ্রিম ৳" : "Advance ৳"}</label><input className="inp" type="number" value={adv} onChange={e => setAdv(e.target.value)} /></div>
      </div>
      <div><label className="lbl">{bn ? "শুরু" : "Move-in"}</label><input className="inp" type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
      <div><label className="lbl">📝 {bn ? "নোট" : "Notes"}</label><textarea className="inp" value={notes} onChange={e => setNotes(e.target.value)} /></div>
    </div>
    <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
      <button className="btn bg" style={{ flex: 1 }} onClick={onClose}>{bn ? "বাতিল" : "Cancel"}</button>
      <button className="btn bp" style={{ flex: 1 }} onClick={() => { if (tid && rent) onSave(tid, rent, adv, date, notes); }}>{bn ? "নির্ধারণ" : "Assign"}</button>
    </div>
  </div></div>;
}

function PayModal({ bn, tenant, mk, onSave, onClose, payType }) {
  const [amt, setAmt] = useState(tenant.rent || "");
  const [method, setMethod] = useState("bkash");
  const [status, setStatus] = useState("paid");
  const [note, setNote] = useState("");
  return <div className="ov" onClick={onClose}><div className="mdl" onClick={e => e.stopPropagation()}><div className="mdl-handle" />
    <h2 style={{ fontSize: 18, fontWeight: 800, color: "#fff", marginBottom: 4 }}>💰 {bn ? "ভাড়া" : "Pay"}</h2>
    <div style={{ fontSize: 12, color: "#475569", marginBottom: 16 }}>{tenant.name}</div>
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div><label className="lbl">{bn ? "পরিমাণ ৳" : "Amount ৳"}</label><input className="inp" type="number" value={amt} onChange={e => setAmt(e.target.value)} style={{ fontSize: 18, fontWeight: 800, textAlign: "center" }} /></div>
      <div><label className="lbl">{bn ? "মাধ্যম" : "Method"}</label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          {PAY.map(m => <div key={m.k} onClick={() => setMethod(m.k)} style={{ padding: "10px 8px", borderRadius: 10, cursor: "pointer", textAlign: "center", background: method === m.k ? `${m.c}15` : "rgba(255,255,255,.015)", border: `1.5px solid ${method === m.k ? `${m.c}40` : "rgba(255,255,255,.04)"}` }}>
            <div style={{ fontSize: 16 }}>{m.i}</div>
            <div style={{ fontSize: 12, fontWeight: 700, color: method === m.k ? m.c : "#475569", marginTop: 2 }}>{m.l}</div>
          </div>)}
        </div>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        <button className={`btn bs ${status === "paid" ? "bp" : "bg"}`} style={{ flex: 1 }} onClick={() => setStatus("paid")}>✓ {bn ? "পূর্ণ" : "Full"}</button>
        <button className={`btn bs ${status === "partial" ? "" : "bg"}`} style={{ flex: 1, ...(status === "partial" ? { background: "rgba(249,115,22,.1)", color: "#F97316", border: "1px solid rgba(249,115,22,.2)" } : {}) }} onClick={() => setStatus("partial")}>◐ {bn ? "আংশিক" : "Partial"}</button>
      </div>
      <div><label className="lbl">{bn ? "নোট" : "Note"}</label><input className="inp" value={note} onChange={e => setNote(e.target.value)} /></div>
    </div>
    <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
      <button className="btn bg" style={{ flex: 1 }} onClick={onClose}>{bn ? "বাতিল" : "Cancel"}</button>
      <button className="btn bp" style={{ flex: 1 }} onClick={() => { if (amt) onSave({ tenantId: tenant.id, monthKey: mk, amount: Number(amt), method, status, note, type: payType || "rent" }); }}>💰 {bn ? "পরিশোধ" : "Pay"}</button>
    </div>
  </div></div>;
}

// ═══ UTILITY PAY MODAL ═══
function UtilityPayModal({ bn, tenant, mk, utilTypes, onSave, onClose }) {
  const [type, setType] = useState("electricity");
  const [amt, setAmt] = useState("");
  const [method, setMethod] = useState("bkash");
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  return <div className="ov" onClick={onClose}><div className="mdl" onClick={e => e.stopPropagation()}><div className="mdl-handle" />
    <h2 style={{ fontSize: 18, fontWeight: 800, color: "#fff", marginBottom: 16 }}>📄 {bn ? "ইউটিলিটি বিল" : "Utility Bill"}</h2>
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div><label className="lbl">{bn ? "বিলের ধরন" : "Bill Type"}</label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
          {utilTypes.map(u => <div key={u.k} onClick={() => setType(u.k)} style={{ padding: "10px 6px", borderRadius: 10, cursor: "pointer", textAlign: "center", background: type === u.k ? `${u.c}15` : "rgba(255,255,255,.015)", border: `1.5px solid ${type === u.k ? `${u.c}40` : "rgba(255,255,255,.04)"}` }}>
            <div style={{ fontSize: 20 }}>{u.i}</div>
            <div style={{ fontSize: 11, fontWeight: 700, color: type === u.k ? u.c : "#475569", marginTop: 2 }}>{u.l}</div>
          </div>)}
        </div>
      </div>
      <div><label className="lbl">{bn ? "পরিমাণ ৳" : "Amount ৳"}</label><input className="inp" type="number" value={amt} onChange={e => setAmt(e.target.value)} style={{ fontSize: 18, fontWeight: 800, textAlign: "center" }} placeholder="0" /></div>
      <div><label className="lbl">{bn ? "মাধ্যম" : "Method"}</label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          {PAY.map(m => <div key={m.k} onClick={() => setMethod(m.k)} style={{ padding: "8px 6px", borderRadius: 8, cursor: "pointer", textAlign: "center", background: method === m.k ? `${m.c}15` : "rgba(255,255,255,.015)", border: `1.5px solid ${method === m.k ? `${m.c}40` : "rgba(255,255,255,.04)"}`, fontSize: 11 }}>
            {m.i} {m.l}
          </div>)}
        </div>
      </div>
      <div><label className="lbl">{bn ? "নোট" : "Note"}</label><input className="inp" value={note} onChange={e => setNote(e.target.value)} placeholder={bn ? "মিটার নং, রেফারেন্স ইত্যাদি" : "Meter no, reference etc."} /></div>
    </div>
    <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
      <button className="btn bg" style={{ flex: 1 }} onClick={onClose}>{bn ? "বাতিল" : "Cancel"}</button>
      <button className="btn bp" style={{ flex: 1 }} disabled={busy} onClick={async () => { if (!amt) return; setBusy(true); await onSave({ tenantId: tenant.id, monthKey: mk, amount: Number(amt), method, status: "paid", note, type }); setBusy(false); }}>
        {busy ? "⏳" : (bn ? "📄 বিল দিন" : "📄 Pay Bill")}
      </button>
    </div>
  </div></div>;
}

// ═══ RECEIPT MODAL ═══
function ReceiptModal({ bn, payment, tenant, landlord, unit, prop, utilTypes, onEdit, onDelete, onClose }) {
  const [editing, setEditing] = useState(false);
  const [amt, setAmt] = useState(payment.amount || 0);
  const [note, setNote] = useState(payment.note || "");
  const isRent = !payment.type || payment.type === "rent";
  const ut = utilTypes?.find(u => u.k === payment.type);
  const pm = PAY.find(m => m.k === payment.method);

  return <div className="ov" onClick={onClose}><div className="mdl" onClick={e => e.stopPropagation()}><div className="mdl-handle" />
    {/* Receipt Header */}
    <div style={{ textAlign: "center", marginBottom: 20 }}>
      <div style={{ fontSize: 36, marginBottom: 4 }}>🧾</div>
      <h2 style={{ fontSize: 18, fontWeight: 800, color: "#fff" }}>{bn ? "পেমেন্ট রসিদ" : "Payment Receipt"}</h2>
    </div>

    <div style={{ background: "rgba(255,255,255,.02)", borderRadius: 14, padding: 16, marginBottom: 16 }}>
      {/* Type & Amount */}
      <div style={{ textAlign: "center", marginBottom: 16, paddingBottom: 16, borderBottom: "1px dashed rgba(255,255,255,.06)" }}>
        <div style={{ fontSize: 28 }}>{isRent ? "🏠" : (ut?.i || "📦")}</div>
        <div style={{ fontSize: 13, fontWeight: 700, color: isRent ? "#34D399" : (ut?.c || "#fff"), marginTop: 4 }}>{isRent ? (bn ? "বাড়ি ভাড়া" : "House Rent") : (ut?.l || payment.type)}</div>
        {!editing ? <div style={{ fontSize: 32, fontWeight: 800, color: "#fff", marginTop: 8 }}>৳{bn ? FM(payment.amount) : FE(payment.amount)}</div>
          : <input className="inp" type="number" value={amt} onChange={e => setAmt(e.target.value)} style={{ fontSize: 24, fontWeight: 800, textAlign: "center", marginTop: 8 }} />}
      </div>

      {/* Details */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {[
          { l: bn ? "মাস" : "Month", v: payment.monthKey },
          { l: bn ? "তারিখ" : "Date", v: payment.paidAt?.split("T")[0] },
          { l: bn ? "মাধ্যম" : "Method", v: `${pm?.i || ""} ${pm?.l || payment.method}` },
          { l: bn ? "অবস্থা" : "Status", v: payment.status === "paid" ? (bn ? "✓ পরিশোধিত" : "✓ Paid") : (bn ? "◐ আংশিক" : "◐ Partial") },
        ].map((r, i) => <div key={i} style={{ padding: "6px 0" }}>
          <div style={{ fontSize: 11, color: "#475569", fontWeight: 700 }}>{r.l}</div>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#E2E8F0" }}>{r.v}</div>
        </div>)}
      </div>

      {/* Note */}
      {!editing ? (payment.note && <div style={{ marginTop: 10, padding: "8px 12px", background: "rgba(255,255,255,.02)", borderRadius: 8, fontSize: 11, color: "#94A3B8" }}>📝 {payment.note}</div>)
        : <div style={{ marginTop: 10 }}><label className="lbl">📝 {bn ? "নোট" : "Note"}</label><input className="inp" value={note} onChange={e => setNote(e.target.value)} /></div>}

      {/* Tenant & Landlord */}
      <div style={{ marginTop: 14, paddingTop: 14, borderTop: "1px dashed rgba(255,255,255,.06)", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div><div style={{ fontSize: 11, color: "#475569" }}>{bn ? "ভাড়াটিয়া" : "Tenant"}</div><div style={{ fontSize: 11, fontWeight: 600 }}>{tenant?.name}</div></div>
        <div><div style={{ fontSize: 11, color: "#475569" }}>{bn ? "বাড়িওয়ালা" : "Landlord"}</div><div style={{ fontSize: 11, fontWeight: 600 }}>{landlord?.name}</div></div>
        {unit && <div><div style={{ fontSize: 11, color: "#475569" }}>{bn ? "ইউনিট" : "Unit"}</div><div style={{ fontSize: 11, fontWeight: 600 }}>{unit.unitNo} • {prop?.name}</div></div>}
      </div>
    </div>

    {/* Actions */}
    <div style={{ display: "flex", gap: 6 }}>
      {!editing ? <>
        <button className="btn bg" style={{ flex: 1 }} onClick={onClose}>{bn ? "বন্ধ" : "Close"}</button>
        {/* WhatsApp Receipt Share */}
        {tenant?.phone && <button className="btn" style={{ flex: 1, background: "rgba(37,211,102,.1)", border: "1px solid rgba(37,211,102,.2)", color: "#25D366", fontSize: 11 }} onClick={() => {
          const ph = (tenant.phone||"").replace(/[^0-9]/g,"").replace(/^0/, "88");
          const msg = `📒 *মুন্সী রসিদ*\n━━━━━━━━━━━\n${isRent ? "🏠 বাড়ি ভাড়া" : `${ut?.i||"📦"} ${ut?.l||payment.type}`}\n💰 *৳${payment.amount?.toLocaleString()}*\n📅 মাস: ${payment.monthKey}\n📅 তারিখ: ${payment.paidAt?.split("T")[0]}\n💳 মাধ্যম: ${pm?.l||payment.method}\n✅ অবস্থা: পরিশোধিত\n━━━━━━━━━━━\n👤 ${tenant.name}\n🏠 ${unit?.unitNo||""} • ${prop?.name||""}\n\n${bn ? "ধন্যবাদ!" : "Thank you!"}`;
          window.open(`https://wa.me/${ph}?text=${encodeURIComponent(msg)}`, "_blank");
        }}>💬 WhatsApp</button>}
        {onEdit && <button className="btn bg" style={{ flex: 1 }} onClick={() => setEditing(true)}>✏️ {bn ? "সম্পাদনা" : "Edit"}</button>}
        {onDelete && <button className="btn bd" style={{ flex: 0 }} onClick={() => { if (confirm(bn ? "মুছে ফেলবেন?" : "Delete?")) onDelete(payment.id); }}>🗑️</button>}
      </> : <>
        <button className="btn bg" style={{ flex: 1 }} onClick={() => setEditing(false)}>{bn ? "বাতিল" : "Cancel"}</button>
        <button className="btn bp" style={{ flex: 1 }} onClick={() => { if (onEdit) onEdit(payment.id, { amount: Number(amt), note }); }}>✓ {bn ? "সেভ" : "Save"}</button>
      </>}
    </div>
  </div></div>;
}

// ═══ NOTICE MODAL ═══
function NoticeModal({ bn, fromId, toId, onSave, onClose }) {
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const QUICK = bn
    ? ["মেরামত দরকার", "পানির সমস্যা", "বিদ্যুতের সমস্যা", "গেটের চাবি", "পরিষ্কার-পরিচ্ছন্নতা", "অন্যান্য"]
    : ["Repair needed", "Water issue", "Electricity issue", "Gate key", "Cleanliness", "Other"];

  return <div className="ov" onClick={onClose}><div className="mdl" onClick={e => e.stopPropagation()}><div className="mdl-handle" />
    <h2 style={{ fontSize: 18, fontWeight: 800, color: "#fff", marginBottom: 4 }}>📨 {bn ? "নোটিশ পাঠান" : "Send Notice"}</h2>
    <p style={{ fontSize: 11, color: "#475569", marginBottom: 16 }}>{bn ? "বাড়িওয়ালাকে একটি নোটিশ/অনুরোধ পাঠান" : "Send a notice to your landlord"}</p>
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div><label className="lbl">{bn ? "দ্রুত বিষয়" : "Quick Topics"}</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {QUICK.map(q => <span key={q} onClick={() => setSubject(q)} style={{ padding: "6px 12px", borderRadius: 20, fontSize: 11, fontWeight: 600, cursor: "pointer", background: subject === q ? "rgba(16,185,129,.12)" : "rgba(255,255,255,.03)", color: subject === q ? "#34D399" : "#64748B", border: `1px solid ${subject === q ? "rgba(16,185,129,.2)" : "rgba(255,255,255,.04)"}` }}>{q}</span>)}
        </div>
      </div>
      <div><label className="lbl">{bn ? "বিষয়" : "Subject"}</label><input className="inp" value={subject} onChange={e => setSubject(e.target.value)} /></div>
      <div><label className="lbl">{bn ? "বিস্তারিত" : "Details"}</label><textarea className="inp" style={{ minHeight: 90 }} value={message} onChange={e => setMessage(e.target.value)} placeholder={bn ? "আপনার সমস্যা বা অনুরোধ লিখুন..." : "Describe your issue..."} /></div>
    </div>
    <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
      <button className="btn bg" style={{ flex: 1 }} onClick={onClose}>{bn ? "বাতিল" : "Cancel"}</button>
      <button className="btn bp" style={{ flex: 1 }} disabled={busy} onClick={async () => {
        if (!subject || !message) { alert(bn ? "বিষয় ও বিস্তারিত লিখুন" : "Fill subject & details"); return; }
        setBusy(true); await onSave({ fromId, toId, subject, message }); setBusy(false);
      }}>📨 {busy ? "⏳" : (bn ? "পাঠান" : "Send")}</button>
    </div>
  </div></div>;
}

// ═══ LANDLORD NOTICE MODAL ═══
function LandlordNoticeModal({ bn, tenants, units, properties, fromId, onSave, onClose }) {
  const [mode, setMode] = useState("all");
  const [selected, setSelected] = useState(new Set());
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  const QUICK = bn
    ? ["ভাড়া পরিশোধের অনুরোধ", "মেরামত কাজের নোটিশ", "পানি/গ্যাস বন্ধ থাকবে", "বিল্ডিং মিটিং", "পরিষ্কার-পরিচ্ছন্নতা", "গুরুত্বপূর্ণ ঘোষণা"]
    : ["Rent reminder", "Repair notice", "Water/Gas outage", "Building meeting", "Cleanliness", "Announcement"];

  const toggle = (id) => { const s = new Set(selected); s.has(id) ? s.delete(id) : s.add(id); setSelected(s); };

  const handleSend = async () => {
    if (!subject || !message) { alert(bn ? "বিষয় ও বিস্তারিত লিখুন" : "Fill subject & details"); return; }
    setBusy(true);
    const targets = mode === "all" ? tenants : tenants.filter(t => selected.has(t.id));
    if (targets.length === 0) { alert(bn ? "ভাড়াটিয়া নির্বাচন করুন" : "Select tenant(s)"); setBusy(false); return; }
    const list = targets.map(t => ({ fromId, toId: t.uid || t.id, subject, message, toAll: mode === "all" }));
    await onSave(list);
    setBusy(false);
  };

  return <div className="ov" onClick={onClose}><div className="mdl" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}><div className="mdl-handle" />
    <h2 style={{ fontSize: 18, fontWeight: 800, color: "#fff", marginBottom: 4 }}>📨 {bn ? "ভাড়াটিয়াদের নোটিশ" : "Notice to Tenants"}</h2>
    <p style={{ fontSize: 11, color: "#475569", marginBottom: 14 }}>{bn ? "একজন বা সব ভাড়াটিয়াকে নোটিশ পাঠান" : "Send to one or all tenants"}</p>

    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {/* Recipient mode */}
      <div>
        <label className="lbl">{bn ? "প্রাপক" : "Recipients"}</label>
        <div style={{ display: "flex", gap: 6, marginBottom: 8 }}>
          <div onClick={() => setMode("all")} style={{ flex: 1, padding: "10px 8px", borderRadius: 10, cursor: "pointer", textAlign: "center", background: mode === "all" ? "rgba(16,185,129,.1)" : "rgba(255,255,255,.02)", border: `1.5px solid ${mode === "all" ? "rgba(16,185,129,.3)" : "rgba(255,255,255,.04)"}`, color: mode === "all" ? "#34D399" : "#475569", fontWeight: 700, fontSize: 12 }}>
            👥 {bn ? `সবাই (${tenants.length})` : `All (${tenants.length})`}
          </div>
          <div onClick={() => setMode("select")} style={{ flex: 1, padding: "10px 8px", borderRadius: 10, cursor: "pointer", textAlign: "center", background: mode === "select" ? "rgba(99,102,241,.1)" : "rgba(255,255,255,.02)", border: `1.5px solid ${mode === "select" ? "rgba(99,102,241,.3)" : "rgba(255,255,255,.04)"}`, color: mode === "select" ? "#A78BFA" : "#475569", fontWeight: 700, fontSize: 12 }}>
            👤 {bn ? "নির্বাচিত" : "Select"} {selected.size > 0 ? `(${selected.size})` : ""}
          </div>
        </div>
        {mode === "select" && <div style={{ maxHeight: 160, overflowY: "auto", borderRadius: 10, border: "1px solid rgba(255,255,255,.04)" }}>
          {tenants.map(t => {
            const u = units.find(x => x.id === t.unitId);
            const p = u ? properties.find(x => x.id === u.propertyId) : null;
            const on = selected.has(t.id);
            return <div key={t.id} onClick={() => toggle(t.id)} style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", cursor: "pointer", background: on ? "rgba(99,102,241,.06)" : "transparent", borderBottom: "1px solid rgba(255,255,255,.02)" }}>
              <div style={{ width: 20, height: 20, borderRadius: 6, border: `2px solid ${on ? "#A78BFA" : "rgba(255,255,255,.1)"}`, background: on ? "#A78BFA" : "transparent", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "#fff" }}>{on ? "✓" : ""}</div>
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, fontSize: 12, color: on ? "#E2E8F0" : "#94A3B8" }}>{t.name}</div>
                <div style={{ fontSize: 11, color: "#475569" }}>{p?.name} › {u?.unitNo} • 📞 {t.phone}</div>
              </div>
            </div>;
          })}
        </div>}
      </div>

      {/* Quick topics */}
      <div><label className="lbl">{bn ? "দ্রুত বিষয়" : "Quick"}</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
          {QUICK.map(q => <span key={q} onClick={() => setSubject(q)} style={{ padding: "4px 10px", borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: "pointer", background: subject === q ? "rgba(16,185,129,.12)" : "rgba(255,255,255,.03)", color: subject === q ? "#34D399" : "#64748B", border: `1px solid ${subject === q ? "rgba(16,185,129,.2)" : "rgba(255,255,255,.04)"}` }}>{q}</span>)}
        </div>
      </div>

      <div><label className="lbl">{bn ? "বিষয়" : "Subject"}</label><input className="inp" value={subject} onChange={e => setSubject(e.target.value)} /></div>
      <div><label className="lbl">{bn ? "বিস্তারিত" : "Message"}</label><textarea className="inp" style={{ minHeight: 70 }} value={message} onChange={e => setMessage(e.target.value)} placeholder={bn ? "নোটিশ লিখুন..." : "Write notice..."} /></div>
    </div>
    <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
      <button className="btn bg" style={{ flex: 1 }} onClick={onClose}>{bn ? "বাতিল" : "Cancel"}</button>
      <button className="btn bp" style={{ flex: 1 }} disabled={busy} onClick={handleSend}>
        📨 {busy ? "⏳" : (mode === "all" ? (bn ? `সবাইকে (${tenants.length})` : `All (${tenants.length})`) : (bn ? `পাঠান (${selected.size})` : `Send (${selected.size})`))}
      </button>
    </div>
  </div></div>;
}

// ═══ ADD EXPENSE MODAL ═══
function AddExpenseModal({ bn, properties, onSave, onClose }) {
  const [f, sF] = useState({ category: "repair", amount: "", description: "", date: new Date().toISOString().split("T")[0], propertyId: "", propertyName: "" });
  const [busy, setBusy] = useState(false);
  const CATS = [
    { k: "repair", l: bn ? "🔧 মেরামত" : "🔧 Repair", c: "#F97316" },
    { k: "paint", l: bn ? "🎨 রং" : "🎨 Paint", c: "#EC4899" },
    { k: "plumbing", l: bn ? "🚿 প্লাম্বিং" : "🚿 Plumbing", c: "#38BDF8" },
    { k: "electric", l: bn ? "⚡ ইলেক্ট্রিক" : "⚡ Electric", c: "#FBBF24" },
    { k: "cleaning", l: bn ? "🧹 পরিষ্কার" : "🧹 Cleaning", c: "#34D399" },
    { k: "tax", l: bn ? "🏛️ কর/ফি" : "🏛️ Tax", c: "#A78BFA" },
    { k: "other", l: bn ? "📦 অন্যান্য" : "📦 Other", c: "#94A3B8" },
  ];
  return <div className="ov" onClick={onClose}><div className="mdl" onClick={e => e.stopPropagation()}><div className="mdl-handle" />
    <h2 style={{ fontSize: 18, fontWeight: 800, color: "#fff", marginBottom: 14 }}>🧾 {bn ? "খরচ যোগ" : "Add Expense"}</h2>
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div><label className="lbl">{bn ? "ক্যাটাগরি" : "Category"}</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 5 }}>
          {CATS.map(c => <span key={c.k} onClick={() => sF({ ...f, category: c.k })} style={{ padding: "5px 10px", borderRadius: 20, fontSize: 12, fontWeight: 600, cursor: "pointer", background: f.category === c.k ? `${c.c}15` : "rgba(255,255,255,.03)", color: f.category === c.k ? c.c : "#64748B", border: `1px solid ${f.category === c.k ? `${c.c}30` : "rgba(255,255,255,.04)"}` }}>{c.l}</span>)}
        </div>
      </div>
      <div><label className="lbl">{bn ? "পরিমাণ (৳)" : "Amount (৳)"}</label>
        <input className="inp" type="number" value={f.amount} onChange={e => sF({ ...f, amount: e.target.value })} placeholder="5000" /></div>
      <div><label className="lbl">{bn ? "বিবরণ" : "Description"}</label>
        <input className="inp" value={f.description} onChange={e => sF({ ...f, description: e.target.value })} placeholder={bn ? "কী খরচ..." : "What expense..."} /></div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div><label className="lbl">{bn ? "তারিখ" : "Date"}</label>
          <input className="inp" type="date" value={f.date} onChange={e => sF({ ...f, date: e.target.value })} /></div>
        <div><label className="lbl">{bn ? "বাড়ি" : "Property"}</label>
          <select className="inp" value={f.propertyId} onChange={e => { const p = properties.find(x => x.id === e.target.value); sF({ ...f, propertyId: e.target.value, propertyName: p?.name || "" }); }}>
            <option value="">{bn ? "— সব —" : "— All —"}</option>
            {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select></div>
      </div>
    </div>
    <div style={{ display: "flex", gap: 8, marginTop: 18 }}>
      <button className="btn bg" style={{ flex: 1 }} onClick={onClose}>{bn ? "বাতিল" : "Cancel"}</button>
      <button className="btn bp" style={{ flex: 1 }} disabled={busy} onClick={async () => {
        if (!f.amount) { alert(bn ? "পরিমাণ লিখুন" : "Enter amount"); return; }
        setBusy(true); await onSave({ ...f, amount: Number(f.amount) }); setBusy(false);
      }}>💾 {busy ? "⏳" : (bn ? "সংরক্ষণ" : "Save")}</button>
    </div>
  </div></div>;
}

// ═══ ADD AGREEMENT MODAL ═══
function AddAgreementModal({ bn, tenants, units, properties, landlordId, onSave, onClose }) {
  const [tid, setTid] = useState("");
  const [f, sF] = useState({ rent: "", advance: "", startDate: new Date().toISOString().split("T")[0], duration: "12", terms: "", conditions: "" });
  const [busy, setBusy] = useState(false);
  const sel = tenants.find(t => t.id === tid);
  const selU = sel ? units.find(u => u.id === sel.unitId) : null;
  const selP = selU ? properties.find(p => p.id === selU.propertyId) : null;

  const TERMS = bn
    ? ["ভাড়া প্রতি মাসের ১-৫ তারিখে পরিশোধযোগ্য", "৩ মাসের নোটিশ ছাড়া বাতিল নয়", "ক্ষতি হলে ভাড়াটিয়া দায়ী", "পোষা প্রাণী নিষেধ", "সাব-লেট নিষেধ"]
    : ["Rent due 1st-5th monthly", "3 months notice for termination", "Tenant liable for damages", "No pets", "No subletting"];

  return <div className="ov" onClick={onClose}><div className="mdl" onClick={e => e.stopPropagation()} style={{ maxWidth: 520 }}><div className="mdl-handle" />
    <h2 style={{ fontSize: 18, fontWeight: 800, color: "#fff", marginBottom: 4 }}>📜 {bn ? "নতুন চুক্তিপত্র" : "New Agreement"}</h2>
    <p style={{ fontSize: 11, color: "#475569", marginBottom: 14 }}>{bn ? "ভাড়াটিয়ার সাথে চুক্তি তৈরি করুন" : "Create rental agreement"}</p>
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div><label className="lbl">{bn ? "ভাড়াটিয়া" : "Tenant"}</label>
        <select className="inp" value={tid} onChange={e => { const t = tenants.find(x => x.id === e.target.value); setTid(e.target.value); if (t) sF({ ...f, rent: String(t.rent || ""), advance: String(t.advance || "") }); }}>
          <option value="">{bn ? "— নির্বাচন —" : "— Select —"}</option>
          {tenants.map(t => { const u = units.find(x => x.id === t.unitId); return <option key={t.id} value={t.id}>{t.name} ({u?.unitNo || "—"})</option>; })}
        </select></div>
      {sel && <div style={{ padding: 8, borderRadius: 8, background: "rgba(255,255,255,.02)", fontSize: 12, color: "#64748B" }}>👤 {sel.name} • 📞 {sel.phone} • 🏠 {selP?.name} › {selU?.unitNo}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div><label className="lbl">{bn ? "ভাড়া (৳)" : "Rent (৳)"}</label><input className="inp" type="number" value={f.rent} onChange={e => sF({ ...f, rent: e.target.value })} /></div>
        <div><label className="lbl">{bn ? "অগ্রিম (৳)" : "Advance"}</label><input className="inp" type="number" value={f.advance} onChange={e => sF({ ...f, advance: e.target.value })} /></div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div><label className="lbl">{bn ? "শুরু" : "Start"}</label><input className="inp" type="date" value={f.startDate} onChange={e => sF({ ...f, startDate: e.target.value })} /></div>
        <div><label className="lbl">{bn ? "মেয়াদ (মাস)" : "Months"}</label><input className="inp" type="number" value={f.duration} onChange={e => sF({ ...f, duration: e.target.value })} /></div>
      </div>
      <div><label className="lbl">{bn ? "শর্তাবলী" : "Terms"}</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 6 }}>
          {TERMS.map((t, i) => <span key={i} onClick={() => sF({ ...f, terms: f.terms ? f.terms + "\n• " + t : "• " + t })} style={{ padding: "3px 8px", borderRadius: 12, fontSize: 11, cursor: "pointer", background: "rgba(255,255,255,.03)", color: "#64748B", border: "1px solid rgba(255,255,255,.04)" }}>+ {t.slice(0, 25)}...</span>)}
        </div>
        <textarea className="inp" style={{ minHeight: 50, fontSize: 11 }} value={f.terms} onChange={e => sF({ ...f, terms: e.target.value })} /></div>
      <div><label className="lbl">{bn ? "বিশেষ শর্ত" : "Conditions"}</label>
        <textarea className="inp" style={{ minHeight: 36, fontSize: 11 }} value={f.conditions} onChange={e => sF({ ...f, conditions: e.target.value })} /></div>
    </div>
    <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
      <button className="btn bg" style={{ flex: 1 }} onClick={onClose}>{bn ? "বাতিল" : "Cancel"}</button>
      <button className="btn bp" style={{ flex: 1 }} disabled={busy} onClick={async () => {
        if (!tid || !f.rent) { alert(bn ? "ভাড়াটিয়া ও ভাড়া দিন" : "Select tenant & rent"); return; }
        setBusy(true);
        await onSave({ landlordId, tenantId: tid, tenantName: sel?.name, tenantPhone: sel?.phone, unitId: sel?.unitId, propertyId: selU?.propertyId, propertyName: selP?.name, unitNo: selU?.unitNo, rent: Number(f.rent), advance: Number(f.advance || 0), startDate: f.startDate, duration: Number(f.duration || 12), terms: f.terms, conditions: f.conditions, status: "active" });
        setBusy(false);
      }}>📜 {busy ? "⏳" : (bn ? "চুক্তি তৈরি" : "Create")}</button>
    </div>
  </div></div>;
}

// ═══ METER READING MODAL ═══
function MeterReadingModal({ bn, units, tenants, properties, meters, onSave, onClose }) {
  const [uid, setUid] = useState("");
  const [prev, setPrev] = useState("");
  const [curr, setCurr] = useState("");
  const [busy, setBusy] = useState(false);
  const occUnits = units.filter(u => !u.isVacant);
  const selUnit = units.find(u => u.id === uid);
  const rate = selUnit?.electricityRate || 0;
  const consumed = (Number(curr) || 0) - (Number(prev) || 0);
  const bill = consumed * rate;
  const now = new Date();
  const monthKey = MK(now.getMonth(), now.getFullYear());

  // Auto-fill previous reading from latest meter reading
  useEffect(() => {
    if (uid && meters) {
      const uMeters = meters.filter(m => m.unitId === uid).sort((a,b) => (b.createdAt||"").localeCompare(a.createdAt||""));
      if (uMeters[0]) setPrev(String(uMeters[0].currentReading));
      else setPrev("");
    }
  }, [uid, meters]);

  return <div className="ov" onClick={onClose}><div className="mdl" onClick={e => e.stopPropagation()}><div className="mdl-handle" />
    <h2 style={{ fontSize: 18, fontWeight: 800, color: "#fff", marginBottom: 16 }}>⚡ {bn ? "মিটার রিডিং" : "Meter Reading"}</h2>
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div><label className="lbl">{bn ? "ইউনিট" : "Unit"}</label>
        <select className="inp" value={uid} onChange={e => setUid(e.target.value)}>
          <option value="">{bn ? "-- ইউনিট বাছুন --" : "-- Select Unit --"}</option>
          {occUnits.map(u => {
            const t = tenants.find(x => x.unitId === u.id);
            const p = properties.find(x => x.id === u.propertyId);
            return <option key={u.id} value={u.id}>{u.unitNo} • {p?.name} — {t?.name||"?"}</option>;
          })}
        </select>
      </div>
      {uid && <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        <div><label className="lbl">{bn ? "আগের রিডিং" : "Previous"}</label>
          <input className="inp" type="number" value={prev} onChange={e => setPrev(e.target.value)} placeholder="0" style={{ fontSize: 18, fontWeight: 700, textAlign: "center" }} /></div>
        <div><label className="lbl">{bn ? "বর্তমান রিডিং" : "Current"}</label>
          <input className="inp" type="number" value={curr} onChange={e => setCurr(e.target.value)} placeholder="0" style={{ fontSize: 18, fontWeight: 700, textAlign: "center" }} /></div>
      </div>}
      {uid && consumed > 0 && <div style={{ padding: 14, borderRadius: 12, background: "rgba(251,191,36,.06)", border: "1px solid rgba(251,191,36,.15)", textAlign: "center" }}>
        <div style={{ fontSize: 11, color: "#64748B" }}>{consumed} {bn ? "ইউনিট" : "units"} × ৳{rate}/{bn ? "ইউনিট" : "unit"}</div>
        <div style={{ fontSize: 24, fontWeight: 800, color: "#FBBF24", marginTop: 4 }}>৳{bn ? FM(bill) : FE(bill)}</div>
      </div>}
    </div>
    <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
      <button className="btn bg" style={{ flex: 1 }} onClick={onClose}>{bn ? "বাতিল" : "Cancel"}</button>
      <button className="btn bp" style={{ flex: 1 }} disabled={busy || !uid || consumed <= 0} onClick={async () => {
        setBusy(true);
        await onSave({ unitId: uid, prevReading: Number(prev), currentReading: Number(curr), unitsConsumed: consumed, rate, billAmount: bill, monthKey, recordedBy: "landlord" });
        setBusy(false); onClose();
      }}>⚡ {busy ? "⏳" : (bn ? "রিডিং সেভ" : "Save Reading")}</button>
    </div>
  </div></div>;
}

// ═══ MOVE-OUT MODAL ═══
function MoveOutModal({ bn, tenant, payments, onMoveOut, onClose }) {
  const [deductions, setDeductions] = useState(0);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const deposit = tenant?.advance || 0;
  const refund = Math.max(deposit - Number(deductions || 0), 0);

  // Calculate dues
  const now = new Date();
  const mk = MK(now.getMonth(), now.getFullYear());
  const curRent = (payments||[]).find(p => p.tenantId === tenant?.id && (!p.type || p.type === "rent") && p.monthKey === mk);
  const hasDue = !curRent && tenant?.rent > 0;

  return <div className="ov" onClick={onClose}><div className="mdl" onClick={e => e.stopPropagation()}><div className="mdl-handle" />
    <h2 style={{ fontSize: 18, fontWeight: 800, color: "#fff", marginBottom: 4 }}>🚪 {bn ? "স্থানান্তর প্রক্রিয়া" : "Move-out Process"}</h2>
    <p style={{ fontSize: 11, color: "#475569", marginBottom: 16 }}>{tenant?.name}</p>

    {/* Settlement Summary */}
    <div style={{ display: "flex", flexDirection: "column", gap: 10, marginBottom: 16 }}>
      <div style={{ padding: 12, borderRadius: 10, background: "rgba(16,185,129,.04)", border: "1px solid rgba(16,185,129,.1)" }}>
        <div style={{ fontSize: 12, color: "#475569" }}>{bn ? "💵 জামানত / অগ্রিম" : "💵 Security Deposit"}</div>
        <div style={{ fontSize: 20, fontWeight: 800, color: "#34D399" }}>৳{deposit.toLocaleString()}</div>
      </div>

      {hasDue && <div style={{ padding: 10, borderRadius: 8, background: "rgba(239,68,68,.06)", border: "1px solid rgba(239,68,68,.1)", fontSize: 11, color: "#FCA5A5" }}>
        ⚠️ {bn ? "এই মাসের ভাড়া বাকি আছে!" : "Current month rent is due!"}
      </div>}

      <div><label className="lbl">{bn ? "কর্তন (ক্ষতিপূরণ/বাকি)" : "Deductions"}</label>
        <input className="inp" type="number" value={deductions} onChange={e => setDeductions(e.target.value)} placeholder="0" /></div>

      <div><label className="lbl">{bn ? "কারণ" : "Reason"}</label>
        <input className="inp" value={reason} onChange={e => setReason(e.target.value)} placeholder={bn ? "কর্তনের কারণ (ঐচ্ছিক)" : "Reason for deductions (optional)"} /></div>

      <div style={{ padding: 14, borderRadius: 12, background: "rgba(59,130,246,.06)", border: "1px solid rgba(59,130,246,.15)", textAlign: "center" }}>
        <div style={{ fontSize: 12, color: "#64748B" }}>{bn ? "ফেরত দিতে হবে" : "Refund Amount"}</div>
        <div style={{ fontSize: 28, fontWeight: 800, color: "#60A5FA" }}>৳{refund.toLocaleString()}</div>
        {Number(deductions) > 0 && <div style={{ fontSize: 12, color: "#475569", marginTop: 2 }}>৳{deposit.toLocaleString()} - ৳{Number(deductions).toLocaleString()} = ৳{refund.toLocaleString()}</div>}
      </div>
    </div>

    <div style={{ display: "flex", gap: 8 }}>
      <button className="btn bg" style={{ flex: 1 }} onClick={onClose}>{bn ? "বাতিল" : "Cancel"}</button>
      <button className="btn bd" style={{ flex: 1 }} disabled={busy} onClick={async () => {
        if (!confirm(bn ? `${tenant.name} কে move-out করবেন? ফেরত: ৳${refund}` : `Move out ${tenant.name}? Refund: ৳${refund}`)) return;
        setBusy(true);
        await onMoveOut(tenant.id, { deductions: Number(deductions), reason, refundAmount: refund, dueRent: hasDue ? tenant.rent : 0 });
        setBusy(false); onClose();
      }}>🚪 {busy ? "⏳" : (bn ? "স্থানান্তর নিশ্চিত" : "Confirm Move-out")}</button>
    </div>
  </div></div>;
}

// ═══ EOF ═══
