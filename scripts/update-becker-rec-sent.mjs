// Patch latestNote + latestNoteDate + activityLog after REC email sent to DW 4/29/26
import { initializeApp } from "firebase/app";
import { getDatabase, ref, get, update } from "firebase/database";

const app = initializeApp({
  apiKey: "AIzaSyAjfLspo0mesgOSFR3r0kFfAv_7cnD8yZk",
  databaseURL: "https://ps-pipeline-engine---djr---v1-default-rtdb.firebaseio.com",
  projectId: "ps-pipeline-engine---djr---v1",
});
const db = getDatabase(app);

const path = "submissions/hockley_tx_19250_becker";

const newNote = "REC + survey emailed to DW 4/29/26 from DJR Outlook (Wendy Cline off-market 4/24 listing at $1.2M). REC package generated SiteScore 8.70/10 — capped YELLOW pending title commitment on eastern easement (Dan visual: back-corner placement, building plate fits western/center). Real CC street rents pulled live: PS #29250 $1.40/SF, iStorage Cypress $1.00/SF, CubeSmart 290 $0.98/SF — modeled $1.20/SF stabilized. ESRI re-verified live: 19,168 3-mi pop / $101K HHI / 3.76% CAGR. Awaiting DW reaction before routing to southwest tracker.";

const newDate = "Apr 29, 2026";

const newActivity = {
  date: "Apr 29, 2026",
  action: "REC email sent to DW",
  details: "Recommendation email + REC Package PDF + survey forwarded to dwollent@publicstorage.com from DJR Outlook. Email body: pin drop, HAR listing, Storvex deep-link, 6 property bullets, market gap with real Hwy 290 CC rent comps, live ESRI 2025 demos. Storvex branded signature. Site sits in submissions queue pending DW reaction.",
};

const snap = await get(ref(db, path));
const cur = snap.val();
if (!cur) {
  console.error(`ERROR: site not found at ${path}`);
  process.exit(1);
}

const log = Array.isArray(cur.activityLog) ? cur.activityLog : [];
log.push(newActivity);

await update(ref(db, path), {
  latestNote: newNote,
  latestNoteDate: newDate,
  activityLog: log,
  recEmailSentDate: "Apr 29, 2026",
  recEmailSentTo: "dwollent@publicstorage.com",
});

console.log(`SUCCESS: patched ${path}`);
console.log(`  latestNote (${newNote.length} chars)`);
console.log(`  latestNoteDate: ${newDate}`);
console.log(`  activityLog: ${log.length} entries`);
process.exit(0);
