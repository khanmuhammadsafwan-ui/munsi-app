import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, RecaptchaVerifier, signInWithPhoneNumber } from "firebase/auth";
import { getFirestore } from "firebase/firestore";

const firebaseConfig = {
  apiKey: "AIzaSyBx8Kefs7oB_rALsbCXjKxU4HKlnOptk0Q",
  authDomain: "munsi-app-15293.firebaseapp.com",
  projectId: "munsi-app-15293",
  storageBucket: "munsi-app-15293.firebasestorage.app",
  messagingSenderId: "314363482572",
  appId: "1:314363482572:web:ba4461750d2426c6334d69"
};

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);
export const googleProvider = new GoogleAuthProvider();

// ═══ PHONE AUTH HELPERS ═══
let recaptchaVerifier = null;

export function setupRecaptcha(buttonId) {
  if (recaptchaVerifier) {
    try { recaptchaVerifier.clear(); } catch(e) {}
    recaptchaVerifier = null;
  }
  recaptchaVerifier = new RecaptchaVerifier(auth, buttonId, {
    size: "invisible",
    callback: () => {},
    "expired-callback": () => { recaptchaVerifier = null; }
  });
  return recaptchaVerifier;
}

export async function sendPhoneOTP(phoneNumber) {
  const formatted = phoneNumber.replace(/[^0-9]/g, "");
  const intl = formatted.startsWith("88") ? `+${formatted}` : `+88${formatted}`;
  if (!recaptchaVerifier) throw new Error("Recaptcha not initialized");
  return await signInWithPhoneNumber(auth, intl, recaptchaVerifier);
}
