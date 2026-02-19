import { useState, useEffect, useRef, useCallback } from "react";
import { auth, googleProvider } from "./firebase";
import {
  signInWithPopup, signInWithEmailAndPassword, createUserWithEmailAndPassword,
  onAuthStateChanged, signOut, updateProfile
} from "firebase/auth";
import * as DB from "./db";

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

  const notify = (m) => { setToast(m); setTimeout(() => setToast(null), 2800); };

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
  };

  const loadTenantData = async (uid) => {
    const t = await DB.getTenant(uid);
    setMyTenant(t);
    if (t?.landlordId) {
      const ll = await DB.getLandlord(t.landlordId);
      setMyLandlord(ll);
    }
    const pay = await DB.getPaymentsByTenant(uid);
    setPayments(pay);
    // load units/properties for display
    const allU = await DB.getAllUnits();
    setUnits(allU);
    const allP = await DB.getAllProperties();
    setProperties(allP);
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

  // ─── EMAIL SIGN IN / REGISTER ───
  const emailAuth = async (email, password, isNew) => {
    try {
      if (isNew) {
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
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
    notify(bn ? "✓ পেমেন্ট রেকর্ড হয়েছে" : "✓ Payment recorded");
  };

  const handleLogout = async () => { await signOut(auth); };

  if (loading) return <SplashScreen />;

  return (
    <div style={{ minHeight: "100vh", background: "#060B16", fontFamily: "'Hind Siliguri',system-ui,sans-serif", color: "#CBD5E1" }}>
      <link href="https://fonts.googleapis.com/css2?family=Hind+Siliguri:wght@300;400;500;600;700&display=swap" rel="stylesheet" />
      <CSS />
      {toast && <div className="toast">{toast}</div>}

      {screen === "welcome" && <WelcomeScreen bn={bn} lang={lang} setLang={setLang} onGoogle={googleSignIn} onEmail={emailAuth} onSetScreen={setScreen} />}

      {screen === "choose-role" && <ChooseRole bn={bn} user={user} onLandlord={() => setScreen("reg-landlord")} onTenant={() => setScreen("reg-tenant")} onAdmin={() => setScreen("admin-pin")} onLogout={handleLogout} />}

      {screen === "admin-pin" && <AdminPinScreen bn={bn} onSubmit={adminLogin} onBack={() => setScreen("choose-role")} />}
      {screen === "reg-landlord" && <RegLandlord bn={bn} user={user} onReg={regLandlord} onBack={() => setScreen("choose-role")} />}
      {screen === "reg-tenant" && <RegTenant bn={bn} user={user} onReg={regTenant} onBack={() => setScreen("choose-role")} />}

      {screen === "admin" && profile?.role === "admin" && (
        <AdminPanel db={{ landlords, tenants, properties, units, payments, logs }}
          bn={bn} lang={lang} setLang={setLang} onLogout={handleLogout}
          selM={selM} setSelM={setSelM} selY={selY} setSelY={setSelY} mk={mk} onRefresh={loadAdminData} />
      )}

      {screen === "landlord" && profile?.role === "landlord" && (
        <LandlordPanel me={myLandlord} tenants={tenants} properties={properties} units={units} payments={payments}
          bn={bn} lang={lang} setLang={setLang} onLogout={handleLogout}
          addProperty={handleAddProperty} assignTenant={handleAssign} unassignTenant={handleUnassign}
          recordPayment={handlePayment} manualAddTenant={manualAddTenant}
          selM={selM} setSelM={setSelM} selY={selY} setSelY={setSelY} mk={mk} onRefresh={() => loadLandlordData(user.uid)} />
      )}

      {screen === "tenant" && profile?.role === "tenant" && (
        <TenantPanel me={myTenant} landlord={myLandlord} units={units} properties={properties} payments={payments}
          bn={bn} lang={lang} setLang={setLang} onLogout={handleLogout}
          recordPayment={handlePayment} selM={selM} selY={selY} mk={mk} />
      )}
    </div>
  );
}

// ═══ CSS ═══
function CSS() {
  return <style>{`
    *{box-sizing:border-box;margin:0;padding:0}
    @keyframes fadeIn{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:translateY(0)}}
    @keyframes slideUp{from{opacity:0;transform:translateY(20px)}to{opacity:1;transform:translateY(0)}}
    @keyframes pulse{0%,100%{transform:scale(1)}50%{transform:scale(1.05)}}
    @keyframes spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}
    .toast{position:fixed;top:14px;left:50%;transform:translateX(-50%);z-index:9999;background:linear-gradient(135deg,#10B981,#059669);color:#fff;padding:12px 28px;border-radius:14px;font-weight:700;font-size:14px;box-shadow:0 8px 30px rgba(16,185,129,.35);animation:slideUp .3s}
    .G{background:rgba(255,255,255,.025);border:1px solid rgba(255,255,255,.05);border-radius:16px}
    .G2{background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.07);border-radius:20px}
    .CH{transition:all .2s;cursor:pointer}.CH:hover{transform:translateY(-2px);border-color:rgba(255,255,255,.12);box-shadow:0 6px 24px rgba(0,0,0,.2)}
    .btn{padding:10px 20px;border-radius:12px;border:none;cursor:pointer;font-family:inherit;font-weight:600;font-size:14px;transition:all .15s;display:inline-flex;align-items:center;gap:8px;justify-content:center}
    .btn:active{transform:scale(.97)}
    .bp{background:linear-gradient(135deg,#10B981,#059669);color:#fff}.bp:hover{box-shadow:0 4px 16px rgba(16,185,129,.3)}
    .bg{background:rgba(255,255,255,.04);color:#94A3B8;border:1px solid rgba(255,255,255,.07)}.bg:hover{background:rgba(255,255,255,.08);color:#fff}
    .bd{background:rgba(239,68,68,.08);color:#EF4444;border:1px solid rgba(239,68,68,.12)}
    .bs{padding:7px 14px;font-size:12px;border-radius:10px}
    .inp{width:100%;padding:12px 16px;border-radius:12px;background:rgba(255,255,255,.035);border:1px solid rgba(255,255,255,.06);color:#E2E8F0;font-family:inherit;font-size:14px;transition:border-color .2s}
    .inp:focus{outline:none;border-color:#10B981;box-shadow:0 0 0 3px rgba(16,185,129,.08)}
    .inp::placeholder{color:rgba(255,255,255,.18)}
    select.inp{appearance:none;padding-right:36px;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' fill='%2364748B' viewBox='0 0 16 16'%3E%3Cpath d='M8 12L2 6h12z'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 14px center}
    select.inp option{background:#1a2235;color:#E2E8F0}
    textarea.inp{resize:vertical;min-height:70px}
    .lbl{font-size:11px;font-weight:700;color:#475569;margin-bottom:5px;display:block}
    .badge{padding:4px 12px;border-radius:20px;font-size:11px;font-weight:700;display:inline-flex;align-items:center;gap:4px}
    .bP{background:rgba(16,185,129,.1);color:#34D399}.bD{background:rgba(245,158,11,.1);color:#F59E0B}.bPa{background:rgba(249,115,22,.1);color:#F97316}
    .bV{background:rgba(59,130,246,.1);color:#60A5FA}.bA{background:rgba(16,185,129,.1);color:#34D399}
    .ov{position:fixed;inset:0;background:rgba(0,0,0,.6);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;z-index:1000;animation:fadeIn .12s;padding:16px}
    .mdl{background:linear-gradient(155deg,#1a2540,#111a2e);border:1px solid rgba(255,255,255,.07);border-radius:22px;padding:28px;width:100%;max-width:500px;max-height:88vh;overflow-y:auto;animation:slideUp .2s}
    .mdl::-webkit-scrollbar{width:3px}.mdl::-webkit-scrollbar-thumb{background:rgba(255,255,255,.06);border-radius:3px}
    .av{width:48px;height:48px;border-radius:14px;background:rgba(255,255,255,.04);display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;overflow:hidden}
    .av img{width:100%;height:100%;object-fit:cover}
    .row{display:flex;align-items:center;justify-content:space-between;padding:14px 16px;border-bottom:1px solid rgba(255,255,255,.025);transition:background .12s}
    .row:hover{background:rgba(255,255,255,.015)}
    .uc{padding:14px;border-radius:14px;text-align:center;cursor:pointer;transition:all .15s;border:1px solid transparent}
    .uc:hover{transform:scale(1.02)}.uv{background:rgba(59,130,246,.03);border-color:rgba(59,130,246,.1)}.uo{background:rgba(16,185,129,.03);border-color:rgba(16,185,129,.1)}
    .invite-box{background:linear-gradient(135deg,rgba(16,185,129,.08),rgba(59,130,246,.06));border:2px dashed rgba(16,185,129,.25);border-radius:16px;padding:20px;text-align:center}
    .code{font-size:32px;font-weight:800;letter-spacing:4px;color:#34D399;font-family:monospace}
    .gbtn{width:100%;padding:14px 20px;border-radius:14px;border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.03);color:#E2E8F0;cursor:pointer;font-family:inherit;font-size:15px;font-weight:600;display:flex;align-items:center;justify-content:center;gap:12px;transition:all .15s}
    .gbtn:hover{background:rgba(255,255,255,.06);border-color:rgba(255,255,255,.15)}
    .gbtn img{width:20px;height:20px}
    @media(max-width:640px){.rg{grid-template-columns:1fr!important}.rg2{grid-template-columns:1fr 1fr!important}}
  `}</style>;
}

function SplashScreen() {
  return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#060B16" }}>
    <div style={{ textAlign: "center" }}>
      <div style={{ fontSize: 56, marginBottom: 12, animation: "pulse 1.5s infinite" }}>📒</div>
      <div style={{ fontSize: 28, fontWeight: 800, background: "linear-gradient(135deg,#34D399,#60A5FA)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>মুন্সী</div>
      <div style={{ fontSize: 10, color: "#475569", marginTop: 8, letterSpacing: 3 }}>SMART RENT MANAGER</div>
      <div style={{ marginTop: 24, width: 20, height: 20, border: "2px solid #10B981", borderTopColor: "transparent", borderRadius: "50%", animation: "spin .8s linear infinite", margin: "24px auto 0" }} />
    </div>
  </div>;
}

// ═══ WELCOME / LOGIN ═══
function WelcomeScreen({ bn, lang, setLang, onGoogle, onEmail, onSetScreen }) {
  const [mode, setMode] = useState("main"); // main, email-login, email-reg
  const [email, setEmail] = useState("");
  const [pass, setPass] = useState("");
  const [busy, setBusy] = useState(false);

  const handleEmail = async (isNew) => {
    if (!email || !pass) return;
    setBusy(true);
    await onEmail(email, pass, isNew);
    setBusy(false);
  };

  return <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 20, background: "radial-gradient(ellipse at 20% 20%,rgba(16,185,129,.05) 0%,transparent 50%),radial-gradient(ellipse at 80% 80%,rgba(59,130,246,.05) 0%,transparent 50%),#060B16" }}>
    <div style={{ width: "100%", maxWidth: 420, animation: "fadeIn .5s" }}>
      <div style={{ textAlign: "center", marginBottom: 36 }}>
        <div style={{ fontSize: 60, marginBottom: 8 }}>📒</div>
        <div style={{ fontSize: 34, fontWeight: 800, background: "linear-gradient(135deg,#34D399,#60A5FA)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>মুন্সী</div>
        <div style={{ fontSize: 13, color: "#64748B", marginTop: 4 }}>{bn ? "আপনার ডিজিটাল হিসাবরক্ষক" : "Your Digital Rent Keeper"}</div>
      </div>

      {mode === "main" && <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {/* Google Sign In */}
        <button className="gbtn" onClick={onGoogle}>
          <svg width="20" height="20" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>
          {bn ? "Google দিয়ে চালিয়ে যান" : "Continue with Google"}
        </button>

        <div style={{ textAlign: "center", margin: "4px 0", color: "#334155", fontSize: 12 }}>— {bn ? "অথবা" : "or"} —</div>

        <button className="btn bg" style={{ width: "100%", padding: 14, borderRadius: 14, fontSize: 14 }} onClick={() => setMode("email-login")}>
          ✉️ {bn ? "ইমেইল দিয়ে লগইন" : "Login with Email"}
        </button>
        <button className="btn bg" style={{ width: "100%", padding: 14, borderRadius: 14, fontSize: 14 }} onClick={() => setMode("email-reg")}>
          📝 {bn ? "নতুন অ্যাকাউন্ট তৈরি" : "Create Account"}
        </button>
      </div>}

      {(mode === "email-login" || mode === "email-reg") && <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <h3 style={{ fontSize: 16, fontWeight: 700, color: "#fff", textAlign: "center" }}>
          {mode === "email-login" ? (bn ? "ইমেইল লগইন" : "Email Login") : (bn ? "নতুন অ্যাকাউন্ট" : "Create Account")}
        </h3>
        <div><label className="lbl">{bn ? "ইমেইল" : "Email"}</label><input className="inp" type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="name@email.com" /></div>
        <div><label className="lbl">{bn ? "পাসওয়ার্ড" : "Password"}</label><input className="inp" type="password" value={pass} onChange={e => setPass(e.target.value)} placeholder={bn ? "কমপক্ষে ৬ অক্ষর" : "Min 6 characters"} onKeyDown={e => e.key === "Enter" && handleEmail(mode === "email-reg")} /></div>
        <button className="btn bp" style={{ width: "100%", padding: 14, fontSize: 15 }} onClick={() => handleEmail(mode === "email-reg")} disabled={busy}>
          {busy ? "⏳" : mode === "email-login" ? (bn ? "লগইন →" : "Login →") : (bn ? "অ্যাকাউন্ট তৈরি →" : "Create →")}
        </button>
        <button className="btn bg bs" onClick={() => setMode("main")} style={{ alignSelf: "center" }}>← {bn ? "পিছনে" : "Back"}</button>
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
  const [f, sF] = useState({ name: user?.displayName || "", phone: "", email: user?.email || "", nid: "", photo: user?.photoURL || "", members: 1 });
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
                {vac === 0 && <div style={{ fontSize: 10, color: "#EF4444", marginTop: 6 }}>{bn ? "কোনো ইউনিট খালি নেই" : "No vacancies"}</div>}
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
                    <div style={{ fontSize: 10, color: "#64748B", marginTop: 2 }}>{u.type === "flat" ? (bn ? "ফ্ল্যাট" : "Flat") : (bn ? "রুম" : "Room")}</div>
                    {u.rent > 0 && <div style={{ fontWeight: 800, color: "#34D399", fontSize: 14, marginTop: 6 }}>৳{bn ? FM(u.rent) : FE(u.rent)}<span style={{ fontSize: 9, color: "#475569" }}>/{bn ? "মাস" : "mo"}</span></div>}
                    {u.bedrooms > 0 && <div style={{ fontSize: 10, color: "#64748B", marginTop: 2 }}>🛏️ {u.bedrooms} 🚿 {u.bathrooms || 0}</div>}
                    {u.conditions && <div style={{ fontSize: 9, color: "#94A3B8", marginTop: 4, padding: "3px 6px", background: "rgba(255,255,255,.02)", borderRadius: 6 }}>📋 {u.conditions.slice(0, 40)}{u.conditions.length > 40 ? "..." : ""}</div>}
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
              <div style={{ fontSize: 10, color: "#475569" }}>/{bn ? "মাস" : "month"}</div>
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
  return <div style={{ position: "sticky", top: 0, zIndex: 100, background: "rgba(6,11,22,.93)", backdropFilter: "blur(16px)", borderBottom: "1px solid rgba(255,255,255,.035)", padding: "10px 16px" }}>
    <div style={{ maxWidth: 1100, margin: "0 auto", display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 22 }}>📒</span>
        <div><div style={{ fontSize: 15, fontWeight: 800, background: "linear-gradient(135deg,#34D399,#60A5FA)", WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent", lineHeight: 1 }}>মুন্সী</div>
          <div style={{ fontSize: 9, color: "#475569", fontWeight: 600, letterSpacing: 1 }}>{icon} {label}</div></div>
      </div>
      <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
        {children}
        {user && <div style={{ fontSize: 11, color: "#64748B", padding: "4px 10px", background: "rgba(255,255,255,.025)", borderRadius: 8 }}>{icon} {user}</div>}
        {onRefresh && <button className="btn bg bs" onClick={onRefresh} title="Refresh">🔄</button>}
        <button className="btn bg bs" onClick={() => setLang(bn ? "en" : "bn")}>{bn ? "EN" : "বাং"}</button>
        <button className="btn bd bs" onClick={onLogout}>{bn ? "বের হন" : "Exit"}</button>
      </div>
    </div>
  </div>;
}

// ═══ ADMIN PANEL ═══
function AdminPanel({ db, bn, lang, setLang, onLogout, selM, setSelM, selY, setSelY, mk, onRefresh }) {
  const [tab, setTab] = useState("overview");
  const [search, setSearch] = useState("");
  const { landlords, tenants, properties, units, payments, logs } = db;
  const mPay = payments.filter(p => p.monthKey === mk);
  const totCol = mPay.reduce((s, p) => s + (Number(p.amount) || 0), 0);

  return <div>
    <Bar bn={bn} lang={lang} setLang={setLang} label="MASTER DASHBOARD" icon="👑" user="Admin" onLogout={onLogout} onRefresh={onRefresh}>
      <select className="inp" style={{ width: "auto", padding: "5px 28px 5px 8px", fontSize: 11 }} value={selM} onChange={e => setSelM(Number(e.target.value))}>
        {(bn ? MBN : MEN).map((m, i) => <option key={i} value={i}>{m}</option>)}
      </select>
    </Bar>
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "16px 16px 40px" }}>
      <div className="rg2" style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 10, marginBottom: 20 }}>
        {[{ i: "🏠", l: bn ? "বাড়িওয়ালা" : "Landlords", v: landlords.length },
          { i: "👤", l: bn ? "ভাড়াটিয়া" : "Tenants", v: tenants.length },
          { i: "🏘️", l: bn ? "বাড়ি" : "Properties", v: properties.length },
          { i: "💰", l: bn ? "আদায়" : "Collected", v: `৳${bn ? FM(totCol) : FE(totCol)}` },
          { i: "🚪", l: bn ? "খালি" : "Vacant", v: `${units.filter(u => u.isVacant).length}/${units.length}` },
        ].map((s, i) => <div key={i} className="G" style={{ padding: 14, animation: `fadeIn .3s ease-out ${i * .04}s both` }}>
          <div style={{ fontSize: 20, marginBottom: 4 }}>{s.i}</div>
          <div style={{ fontSize: 18, fontWeight: 800, color: "#fff" }}>{s.v}</div>
          <div style={{ fontSize: 10, color: "#475569" }}>{s.l}</div>
        </div>)}
      </div>

      <div style={{ display: "flex", gap: 4, marginBottom: 16, overflowX: "auto" }}>
        {[{ k: "overview", l: "📊" }, { k: "landlords", l: "🏠" }, { k: "tenants", l: "👤" }, { k: "payments", l: "💰" }, { k: "logs", l: "📋" }].map(t =>
          <div key={t.k} onClick={() => setTab(t.k)} style={{ padding: "8px 16px", borderRadius: 10, cursor: "pointer", fontSize: 13, fontWeight: 600, background: tab === t.k ? "rgba(16,185,129,.1)" : "transparent", color: tab === t.k ? "#34D399" : "#475569", border: `1px solid ${tab === t.k ? "rgba(16,185,129,.2)" : "transparent"}`, whiteSpace: "nowrap" }}>
            {t.l} {bn ? ({ overview: "সারসংক্ষেপ", landlords: "বাড়িওয়ালা", tenants: "ভাড়াটিয়া", payments: "পেমেন্ট", logs: "লগ" }[t.k]) : t.k}
          </div>)}
      </div>

      {tab === "landlords" && <div className="G" style={{ overflow: "hidden" }}>
        {landlords.map(l => <div key={l.id} className="row" style={{ flexDirection: "column", alignItems: "stretch", gap: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div><div style={{ fontWeight: 700, color: "#fff" }}>{l.name}</div><div style={{ fontSize: 11, color: "#475569" }}>📞 {l.phone} • 📍 {l.location}</div></div>
            <div className="code" style={{ fontSize: 16 }}>{l.inviteCode}</div>
          </div>
        </div>)}
        {landlords.length === 0 && <div style={{ padding: 40, textAlign: "center", color: "#475569" }}>{bn ? "কেউ নেই" : "None"}</div>}
      </div>}

      {tab === "tenants" && <div className="G" style={{ overflow: "hidden" }}>
        {tenants.map(t => {
          const ll = landlords.find(l => l.id === t.landlordId);
          return <div key={t.id} className="row">
            <div><div style={{ fontWeight: 600 }}>{t.name}</div><div style={{ fontSize: 10, color: "#475569" }}>📞 {t.phone} → 🏠 {ll?.name || "?"}</div></div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontWeight: 700, color: "#34D399" }}>৳{bn ? FM(t.rent) : FE(t.rent)}</div>
              <span className={`badge ${t.unitId ? "bA" : "bD"}`} style={{ fontSize: 9 }}>{t.unitId ? "✓" : "⏳"}</span>
            </div>
          </div>;
        })}
        {tenants.length === 0 && <div style={{ padding: 40, textAlign: "center", color: "#475569" }}>{bn ? "কেউ নেই" : "None"}</div>}
      </div>}

      {tab === "payments" && <div className="G" style={{ overflow: "hidden" }}>
        {mPay.map(p => {
          const t = tenants.find(x => x.id === p.tenantId);
          const pm = PAY.find(m => m.k === p.method);
          return <div key={p.id} className="row">
            <div><div style={{ fontWeight: 600, fontSize: 12 }}>{t?.name || "?"}</div><div style={{ fontSize: 10, color: "#475569" }}>{p.paidAt?.split("T")[0]}</div></div>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ padding: "2px 8px", borderRadius: 6, fontSize: 9, fontWeight: 700, background: `${pm?.c || "#666"}12`, color: pm?.c }}>{pm?.i} {pm?.l}</span>
              <span style={{ fontWeight: 800, color: "#fff" }}>৳{bn ? FM(p.amount) : FE(p.amount)}</span>
            </div>
          </div>;
        })}
        {mPay.length === 0 && <div style={{ padding: 40, textAlign: "center", color: "#475569" }}>{bn ? "পেমেন্ট নেই" : "No payments"}</div>}
      </div>}

      {tab === "logs" && <div className="G" style={{ overflow: "hidden" }}>
        {logs.slice(0, 50).map(l => <div key={l.id} className="row">
          <div><div style={{ fontSize: 12, color: "#94A3B8" }}>{l.detail}</div><div style={{ fontSize: 10, color: "#334155" }}>{l.action}</div></div>
          <span style={{ fontSize: 10, color: "#334155", whiteSpace: "nowrap" }}>{l.ts ? new Date(l.ts).toLocaleString() : ""}</span>
        </div>)}
        {logs.length === 0 && <div style={{ padding: 40, textAlign: "center", color: "#475569" }}>{bn ? "কিছু নেই" : "Empty"}</div>}
      </div>}

      {tab === "overview" && <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }} className="rg">
        <div className="G" style={{ padding: 20 }}>
          <h4 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>🏠 {bn ? "বাড়িওয়ালা" : "Landlords"}</h4>
          {landlords.map(l => <div key={l.id} className="row">
            <div style={{ fontWeight: 600, fontSize: 12 }}>{l.name} • {l.phone}</div>
            <div style={{ fontFamily: "monospace", fontSize: 12, color: "#34D399" }}>{l.inviteCode}</div>
          </div>)}
          {!landlords.length && <div style={{ color: "#334155", padding: 16, textAlign: "center" }}>{bn ? "কেউ নেই" : "None"}</div>}
        </div>
        <div className="G" style={{ padding: 20 }}>
          <h4 style={{ fontSize: 14, fontWeight: 700, marginBottom: 12 }}>📋 {bn ? "সাম্প্রতিক" : "Recent"}</h4>
          {logs.slice(0, 8).map(l => <div key={l.id} style={{ padding: "6px 0", borderBottom: "1px solid rgba(255,255,255,.02)", fontSize: 12 }}>
            <div style={{ color: "#94A3B8" }}>{l.detail}</div>
            <div style={{ fontSize: 10, color: "#334155" }}>{l.ts ? new Date(l.ts).toLocaleString() : ""}</div>
          </div>)}
          {!logs.length && <div style={{ color: "#334155", padding: 16, textAlign: "center" }}>{bn ? "কিছু নেই" : "None"}</div>}
        </div>
      </div>}
    </div>
  </div>;
}

// ═══ LANDLORD PANEL ═══
function LandlordPanel({ me, tenants, properties, units, payments, bn, lang, setLang, onLogout, addProperty, assignTenant, unassignTenant, recordPayment, manualAddTenant, selM, setSelM, selY, setSelY, mk, onRefresh }) {
  const [modal, setModal] = useState(null);
  const [selProp, setSelProp] = useState(null);
  const [selFloor, setSelFloor] = useState(null);
  const [edit, setEdit] = useState(null);

  const mPay = payments.filter(p => p.monthKey === mk && tenants.some(t => t.id === p.tenantId));
  const collected = mPay.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  const paidSet = new Set(mPay.filter(p => p.status === "paid").map(p => p.tenantId));
  const dueT = tenants.filter(t => !paidSet.has(t.id) && t.unitId);
  const unassigned = tenants.filter(t => !t.unitId);

  const prop = selProp ? properties.find(p => p.id === selProp) : null;
  const pUnits = selProp ? units.filter(u => u.propertyId === selProp) : [];
  const floors = prop ? [...new Set(pUnits.map(u => u.floor))].sort((a, b) => a - b) : [];
  const fUnits = selFloor ? pUnits.filter(u => u.floor === selFloor) : [];

  return <div>
    <Bar bn={bn} lang={lang} setLang={setLang} label={bn ? "বাড়িওয়ালা" : "LANDLORD"} icon="🏠" user={me?.name} onLogout={onLogout} onRefresh={onRefresh}>
      <select className="inp" style={{ width: "auto", padding: "5px 28px 5px 8px", fontSize: 11 }} value={selM} onChange={e => setSelM(Number(e.target.value))}>
        {(bn ? MBN : MEN).map((m, i) => <option key={i} value={i}>{m}</option>)}
      </select>
    </Bar>
    <div style={{ maxWidth: 1100, margin: "0 auto", padding: "16px 16px 40px" }}>

      {me && <div className="invite-box" style={{ marginBottom: 20, animation: "fadeIn .4s" }}>
        <div style={{ fontSize: 12, color: "#34D399", fontWeight: 700, marginBottom: 8 }}>🔗 {bn ? "আপনার ইনভাইট কোড — ভাড়াটিয়াদের এটি দিন" : "Share this with tenants"}</div>
        <div className="code">{me.inviteCode}</div>
      </div>}

      <div className="rg2" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 10, marginBottom: 18 }}>
        {[{ i: "🏘️", l: bn ? "বাড়ি" : "Properties", v: properties.length },
          { i: "💰", l: bn ? "আদায়" : "Collected", v: `৳${bn ? FM(collected) : FE(collected)}` },
          { i: "⚠️", l: bn ? "বাকি" : "Due", v: dueT.length },
          { i: "👤", l: bn ? "অপেক্ষায়" : "Unassigned", v: unassigned.length },
        ].map((s, i) => <div key={i} className="G" style={{ padding: 14 }}>
          <div style={{ fontSize: 20, marginBottom: 4 }}>{s.i}</div>
          <div style={{ fontSize: 16, fontWeight: 800, color: "#fff" }}>{s.v}</div>
          <div style={{ fontSize: 10, color: "#475569" }}>{s.l}</div>
        </div>)}
      </div>

      {selProp && <div style={{ marginBottom: 12, display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#475569" }}>
        <span style={{ cursor: "pointer", color: "#34D399" }} onClick={() => { setSelProp(null); setSelFloor(null); }}>🏘️ {bn ? "সব" : "All"}</span>
        <span style={{ opacity: .3 }}>›</span>
        <span style={{ cursor: selFloor ? "pointer" : "default", color: selFloor ? "#34D399" : "#E2E8F0" }} onClick={() => setSelFloor(null)}>{prop?.name}</span>
        {selFloor && <><span style={{ opacity: .3 }}>›</span><span style={{ color: "#E2E8F0" }}>{bn ? `${selFloor} তলা` : `Floor ${selFloor}`}</span></>}
      </div>}

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
              <div style={{ display: "flex", gap: 6 }}><span className="badge bA">{pu.length - pv} occ.</span><span className="badge bV">{pv} {bn ? "খালি" : "vacant"}</span></div>
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
                <div><div style={{ fontWeight: 600, fontSize: 12 }}>{t.name}</div><div style={{ fontSize: 10, color: "#475569" }}>{u?.unitNo}</div></div>
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
              <div><div style={{ fontWeight: 700, fontSize: 13 }}>{bn ? `${f} তলা` : `Floor ${f}`}</div><div style={{ fontSize: 10, color: "#475569" }}>{fu.length} units • {fo} occ.</div></div>
            </div>
          </div>
        </div>;
      })}

      {selFloor && <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(fUnits.length, 4)}, 1fr)`, gap: 8 }}>
        {fUnits.map(u => {
          const t = tenants.find(x => x.unitId === u.id);
          const pay = mPay.find(p => p.tenantId === t?.id);
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
    </div>

    {modal === "addProp" && <AddPropModal bn={bn} onSave={async (p) => { await addProperty(p); setModal(null); }} onClose={() => setModal(null)} />}
    {modal === "assign" && edit && <AssignModal bn={bn} unitId={edit.unitId} tenants={unassigned}
      onSave={async (tid, rent, adv, date, notes) => { await assignTenant(tid, edit.unitId, rent, adv, date, notes); setModal(null); }} onClose={() => setModal(null)} />}
    {modal === "pay" && edit && <PayModal bn={bn} tenant={edit} mk={mk}
      onSave={async (p) => { await recordPayment(p); setModal(null); }} onClose={() => setModal(null)} />}
    {modal === "detail" && edit && <div className="ov" onClick={() => setModal(null)}>
      <div className="mdl" onClick={e => e.stopPropagation()}>
        <h3 style={{ fontSize: 17, fontWeight: 800, color: "#fff", marginBottom: 8 }}>{edit.name}</h3>
        <div style={{ fontSize: 12, color: "#475569", marginBottom: 12 }}>📞 {edit.phone} {edit.nid ? `• NID: ${edit.nid}` : ""}</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
          {[{ l: bn ? "ভাড়া" : "Rent", v: `৳${edit.rent}` }, { l: bn ? "সদস্য" : "Members", v: edit.members || "—" }]
            .map((it, i) => <div key={i} style={{ background: "rgba(255,255,255,.02)", borderRadius: 10, padding: "8px 12px" }}>
              <div style={{ fontSize: 10, color: "#475569" }}>{it.l}</div><div style={{ fontSize: 13, fontWeight: 600 }}>{it.v}</div>
            </div>)}
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn bp" style={{ flex: 1 }} onClick={() => setModal("pay")}>💰 {bn ? "আদায়" : "Collect"}</button>
          <button className="btn bd" style={{ flex: 1 }} onClick={() => { if (confirm(bn ? "নিশ্চিত?" : "Sure?")) { unassignTenant(edit.id); setModal(null); } }}>🗑️ {bn ? "সরান" : "Remove"}</button>
        </div>
      </div>
    </div>}
    {modal === "manualTenant" && <ManualAddTenantModal bn={bn} units={units.filter(u => u.isVacant)} properties={properties}
      onSave={async (info, unitId, rent) => { await manualAddTenant(info, unitId, rent); setModal(null); }} onClose={() => setModal(null)} />}
  </div>;
}
function TenantPanel({ me, landlord, units, properties, payments, bn, lang, setLang, onLogout, recordPayment, selM, selY, mk }) {
  const [modal, setModal] = useState(null);
  const unit = me?.unitId ? units.find(u => u.id === me.unitId) : null;
  const prop = unit ? properties.find(p => p.id === unit.propertyId) : null;
  const curPay = payments.find(p => p.monthKey === mk);

  return <div>
    <Bar bn={bn} lang={lang} setLang={setLang} label={bn ? "ভাড়াটিয়া" : "TENANT"} icon="👤" user={me?.name} onLogout={onLogout} />
    <div style={{ maxWidth: 700, margin: "0 auto", padding: "16px 16px 40px" }}>
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
        <div className="G2" style={{ padding: 22, marginBottom: 16, position: "relative", overflow: "hidden" }}>
          <div style={{ position: "absolute", top: 0, left: 0, right: 0, height: 3, background: `linear-gradient(90deg,${prop?.color || "#10B981"},transparent)` }} />
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 10 }}>
            <div><div style={{ fontSize: 10, fontWeight: 700, color: "#475569" }}>{bn ? "আমার ইউনিট" : "MY UNIT"}</div>
              <h2 style={{ fontSize: 22, fontWeight: 800, color: "#fff" }}>{unit?.unitNo} • {bn ? `${unit?.floor} তলা` : `Floor ${unit?.floor}`}</h2>
              <div style={{ fontSize: 12, color: "#475569" }}>📍 {prop?.name} — {prop?.address}</div></div>
            <div style={{ textAlign: "right" }}><div style={{ fontSize: 10, color: "#475569" }}>{bn ? "মাসিক ভাড়া" : "Rent"}</div>
              <div style={{ fontSize: 24, fontWeight: 800, color: "#34D399" }}>৳{bn ? FM(me.rent) : FE(me.rent)}</div></div>
          </div>
        </div>

        <div className="G" style={{ padding: 20, marginBottom: 16 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700 }}>💰 {(bn ? MBN : MEN)[selM]}</h3>
            {(!curPay || curPay.status !== "paid") && <button className="btn bp bs" onClick={() => setModal("pay")}>💰 {bn ? "ভাড়া দিন" : "Pay"}</button>}
          </div>
          {curPay ? <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className={`badge ${curPay.status === "paid" ? "bP" : "bPa"}`} style={{ fontSize: 13, padding: "6px 16px" }}>
              {curPay.status === "paid" ? "✓" : "◐"} {curPay.status === "paid" ? (bn ? "পরিশোধিত" : "Paid") : (bn ? "আংশিক" : "Partial")}
            </span>
            <span style={{ fontSize: 18, fontWeight: 800, color: "#fff" }}>৳{bn ? FM(curPay.amount) : FE(curPay.amount)}</span>
          </div> : <div style={{ padding: 14, background: "rgba(245,158,11,.04)", borderRadius: 10, border: "1px solid rgba(245,158,11,.08)", display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{ fontSize: 24 }}>⚠️</span>
            <div><div style={{ fontWeight: 700, color: "#F59E0B" }}>{bn ? "ভাড়া বাকি" : "Due"}</div><div style={{ fontSize: 12, color: "#475569" }}>৳{bn ? FM(me.rent) : FE(me.rent)}</div></div>
          </div>}
        </div>

        {landlord && <div className="G" style={{ padding: 16, marginBottom: 16 }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: "#475569", marginBottom: 8 }}>🏠 {bn ? "বাড়িওয়ালা" : "Landlord"}</div>
          <div style={{ fontWeight: 700, color: "#fff" }}>{landlord.name} • 📞 {landlord.phone}</div>
        </div>}

        <div className="G" style={{ padding: 16 }}>
          <h4 style={{ fontSize: 13, fontWeight: 700, marginBottom: 10 }}>📋 {bn ? "ইতিহাস" : "History"}</h4>
          {payments.length === 0 ? <div style={{ padding: 20, textAlign: "center", color: "#334155" }}>{bn ? "কিছু নেই" : "None"}</div> :
            payments.sort((a, b) => (b.paidAt || "").localeCompare(a.paidAt || "")).slice(0, 12).map(p => <div key={p.id} className="row">
              <div><div style={{ fontSize: 11, fontWeight: 600 }}>{p.monthKey}</div><div style={{ fontSize: 9, color: "#334155" }}>{p.paidAt?.split("T")[0]}</div></div>
              <div style={{ fontWeight: 800, color: "#34D399" }}>৳{bn ? FM(p.amount) : FE(p.amount)}</div>
            </div>)}
        </div>
      </div>}
    </div>
    {modal === "pay" && me && <PayModal bn={bn} tenant={me} mk={mk}
      onSave={p => { recordPayment(p); setModal(null); }} onClose={() => setModal(null)} />}
  </div>;
}

// ═══ MODALS ═══
function AddPropModal({ bn, onSave, onClose }) {
  const [f, sF] = useState({ name: "", address: "", location: "", floors: 5, unitsPerFloor: 4, unitType: "flat", color: "#10B981", defaultRent: "", defaultConditions: "", defaultBedrooms: "", defaultBathrooms: "" });
  const [busy, setBusy] = useState(false);
  const set = (k, v) => sF(o => ({ ...o, [k]: v }));
  const cols = ["#10B981", "#6366F1", "#F97316", "#EAB308", "#06B6D4", "#EC4899", "#3B82F6"];
  const handleSave = async () => {
    if (!f.name || !f.address || busy) return;
    setBusy(true);
    try { await onSave(f); } catch(e) { console.error(e); } finally { setBusy(false); }
  };
  return <div className="ov" onClick={onClose}><div className="mdl" onClick={e => e.stopPropagation()}>
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
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            <div><label className="lbl">🛏️</label><input className="inp" type="number" value={f.defaultBedrooms} onChange={e => set("defaultBedrooms", e.target.value)} placeholder="0" /></div>
            <div><label className="lbl">🚿</label><input className="inp" type="number" value={f.defaultBathrooms} onChange={e => set("defaultBathrooms", e.target.value)} placeholder="0" /></div>
          </div>
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
  const [f, sF] = useState({ name: "", phone: "", email: "", nid: "", members: 1, advance: "", moveInDate: new Date().toISOString().split("T")[0], notes: "" });
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

  return <div className="ov" onClick={onClose}><div className="mdl" onClick={e => e.stopPropagation()}>
    <h2 style={{ fontSize: 18, fontWeight: 800, color: "#fff", marginBottom: 16 }}>👤➕ {bn ? "ম্যানুয়ালি ভাড়াটিয়া যোগ" : "Add Tenant Manually"}</h2>
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <div><label className="lbl">{bn ? "নাম" : "Name"} *</label><input className="inp" value={f.name} onChange={e => set("name", e.target.value)} /></div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div><label className="lbl">{bn ? "ফোন" : "Phone"}</label><input className="inp" value={f.phone} onChange={e => set("phone", e.target.value)} placeholder="01XXXXXXXXX" /></div>
        <div><label className="lbl">NID</label><input className="inp" value={f.nid} onChange={e => set("nid", e.target.value)} /></div>
      </div>

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
  return <div className="ov" onClick={onClose}><div className="mdl" onClick={e => e.stopPropagation()}>
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

function PayModal({ bn, tenant, mk, onSave, onClose }) {
  const [amt, setAmt] = useState(tenant.rent || "");
  const [method, setMethod] = useState("bkash");
  const [status, setStatus] = useState("paid");
  const [note, setNote] = useState("");
  return <div className="ov" onClick={onClose}><div className="mdl" onClick={e => e.stopPropagation()}>
    <h2 style={{ fontSize: 18, fontWeight: 800, color: "#fff", marginBottom: 4 }}>💰 {bn ? "ভাড়া" : "Pay"}</h2>
    <div style={{ fontSize: 12, color: "#475569", marginBottom: 16 }}>{tenant.name}</div>
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div><label className="lbl">{bn ? "পরিমাণ ৳" : "Amount ৳"}</label><input className="inp" type="number" value={amt} onChange={e => setAmt(e.target.value)} style={{ fontSize: 18, fontWeight: 800, textAlign: "center" }} /></div>
      <div><label className="lbl">{bn ? "মাধ্যম" : "Method"}</label>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          {PAY.map(m => <div key={m.k} onClick={() => setMethod(m.k)} style={{ padding: "10px 8px", borderRadius: 10, cursor: "pointer", textAlign: "center", background: method === m.k ? `${m.c}15` : "rgba(255,255,255,.015)", border: `1.5px solid ${method === m.k ? `${m.c}40` : "rgba(255,255,255,.04)"}` }}>
            <div style={{ fontSize: 16 }}>{m.i}</div>
            <div style={{ fontSize: 10, fontWeight: 700, color: method === m.k ? m.c : "#475569", marginTop: 2 }}>{m.l}</div>
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
      <button className="btn bp" style={{ flex: 1 }} onClick={() => { if (amt) onSave({ tenantId: tenant.id, monthKey: mk, amount: Number(amt), method, status, note }); }}>💰 {bn ? "পরিশোধ" : "Pay"}</button>
    </div>
  </div></div>;
}
