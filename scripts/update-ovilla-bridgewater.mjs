import { initializeApp } from "firebase/app";
import { getDatabase, ref, update } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyAjfLspo0mesgOSFR3r0kFfAv_7cnD8yZk",
  authDomain: "ps-pipeline-engine---djr---v1.firebaseapp.com",
  databaseURL: "https://ps-pipeline-engine---djr---v1-default-rtdb.firebaseio.com",
  projectId: "ps-pipeline-engine---djr---v1",
  storageBucket: "ps-pipeline-engine---djr---v1.firebasestorage.app",
  messagingSenderId: "863337910082",
  appId: "1:863337910082:web:4cd6c9d38093a5177202db",
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

const now = new Date().toISOString();

const updates = {
  // === OVILLA TX — FM 664 ===
  // First site plan denied at REIC. Countered at $2M with 300' frontage (alternate site plan).
  "southwest/mmpi84dhhom1/askingPrice": "$2,000,000",
  "southwest/mmpi84dhhom1/latestNote": "First site plan denied at REIC. Countered seller at $2M with alternate site plan — 300' frontage. Updated LOI sent to Ty Underwood (SLJ Company). Alternate plan expected to be stronger layout.",
  "southwest/mmpi84dhhom1/latestNoteDate": "Mar 26, 2026",
  "southwest/mmpi84dhhom1/reicOutcome": "rejected",
  "southwest/mmpi84dhhom1/reicNotes": "First site plan denied. Alternate site plan with 300' frontage submitted at $2M — resubmission pending.",
  "southwest/mmpi84dhhom1/reicDate": now,

  // === BRIDGEWATER MA — 31 Perkins St ===
  // DW killed it. Seller countered $3M vs our $2.4M. DW says do not respond, will never happen.
  "southwest/mmpi84dhsjuf/phase": "Dead",
  "southwest/mmpi84dhsjuf/latestNote": "DEAD per DW. Seller countered $3M vs our $2.4M offer. DW: 'Never go silent do not respond — this will never happen.' No further contact.",
  "southwest/mmpi84dhsjuf/latestNoteDate": "Mar 26, 2026",
  "southwest/mmpi84dhsjuf/reicOutcome": "rejected",
  "southwest/mmpi84dhsjuf/reicNotes": "DW killed deal — seller at $3M, too far from $2.4M. Do not respond.",
  "southwest/mmpi84dhsjuf/reicDate": now,
};

try {
  await update(ref(db), updates);
  console.log("Updated 2 sites:");
  console.log("  Ovilla TX — REIC denial logged, counter at $2M, alternate site plan");
  console.log("  Bridgewater MA — Phase set to Dead per DW");
  process.exit(0);
} catch (err) {
  console.error("Firebase update failed:", err.message);
  process.exit(1);
}
