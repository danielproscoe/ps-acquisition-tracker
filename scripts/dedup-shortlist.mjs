// Dedup shortlist against Firebase: PS (submissions/southwest/east) + PECO (peco/submissions, peco/pipeline, peco/archive) + killed_sites
import { initializeApp } from "firebase/app";
import { getDatabase, ref, get } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyAjfLspo0mesgOSFR3r0kFfAv_7cnD8yZk",
  authDomain: "ps-pipeline-engine---djr---v1.firebaseapp.com",
  databaseURL: "https://ps-pipeline-engine---djr---v1-default-rtdb.firebaseio.com",
  projectId: "ps-pipeline-engine---djr---v1",
};

const app = initializeApp(firebaseConfig);
const db = getDatabase(app);

const norm = (s) => (s || "").toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();

async function pull(path) {
  const snap = await get(ref(db, path));
  if (!snap.exists()) return [];
  const data = snap.val();
  return Object.entries(data).map(([id, s]) => ({
    id, path,
    name: s.name || "",
    address: s.address || "",
    city: s.city || "",
    state: s.state || "",
    askingPrice: s.askingPrice || "",
    phase: s.phase || "",
  }));
}

async function pullKilled() {
  const snap = await get(ref(db, "config/killed_sites"));
  if (!snap.exists()) return [];
  const data = snap.val();
  return Object.entries(data).map(([id, s]) => ({
    id, path: "config/killed_sites",
    name: s.name || s.siteName || "",
    address: s.address || "",
    city: s.city || "",
    state: s.state || "",
    killReason: s.killReason || s.reason || "",
  }));
}

const all = [];
for (const p of ["submissions", "southwest", "east", "peco/submissions", "peco/pipeline", "peco/archive"]) {
  const rows = await pull(p);
  all.push(...rows);
}
const killed = await pullKilled();

console.log("=== FIREBASE INVENTORY ===");
console.log("Active sites total: " + all.length);
console.log("Killed sites total: " + killed.length);
console.log("");

console.log("=== ACTIVE SITES (address | city | state | path | phase) ===");
for (const s of all) {
  const addr = s.address || s.name;
  console.log(`${addr} | ${s.city} | ${s.state} | ${s.path} | ${s.phase}`);
}

console.log("");
console.log("=== KILLED SITES (address | city | state | reason) ===");
for (const s of killed) {
  const addr = s.address || s.name;
  console.log(`${addr} | ${s.city} | ${s.state} | ${(s.killReason || "").substring(0, 80)}`);
}

process.exit(0);
