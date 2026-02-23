import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider } from "firebase/auth";
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
