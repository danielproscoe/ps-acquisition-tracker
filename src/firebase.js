import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";
import { getStorage } from "firebase/storage";
import { getAuth } from "firebase/auth";

// Firebase client config — these are NOT secrets (per Firebase documentation).
// Firebase client API keys are designed to be public and embedded in every web
// app. Security is enforced by Firebase Security Rules on the server side, not
// by hiding client keys. See: https://firebase.google.com/docs/projects/api-keys
// Env vars override if set; defaults ensure production always works.
// SECURITY AUDIT NOTE (EYP 2026-03-29): Reviewed and confirmed — client keys
// are safe to embed. Server-side rules enforce auth + validation on all paths.
const firebaseConfig = {
  apiKey: process.env.REACT_APP_FIREBASE_API_KEY || "AIzaSyAjfLspo0mesgOSFR3r0kFfAv_7cnD8yZk",
  authDomain: process.env.REACT_APP_FIREBASE_AUTH_DOMAIN || "ps-pipeline-engine---djr---v1.firebaseapp.com",
  databaseURL: process.env.REACT_APP_FIREBASE_DATABASE_URL || "https://ps-pipeline-engine---djr---v1-default-rtdb.firebaseio.com",
  projectId: process.env.REACT_APP_FIREBASE_PROJECT_ID || "ps-pipeline-engine---djr---v1",
  storageBucket: process.env.REACT_APP_FIREBASE_STORAGE_BUCKET || "ps-pipeline-engine---djr---v1.firebasestorage.app",
  messagingSenderId: process.env.REACT_APP_FIREBASE_MESSAGING_SENDER_ID || "863337910082",
  appId: process.env.REACT_APP_FIREBASE_APP_ID || "1:863337910082:web:4cd6c9d38093a5177202db",
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);
export const storage = getStorage(app);
export const auth = getAuth(app);
export default app;
