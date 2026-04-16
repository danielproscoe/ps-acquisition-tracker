// Push latestNote intel blurbs to DW tracker sites
// These appear as hover tooltips on the dashboard cards
// Run: node scripts/update-latest-notes.mjs

import { initializeApp } from "firebase/app";
import { getDatabase, ref, get, update } from "firebase/database";

const app = initializeApp({
  apiKey: "AIzaSyAjfLspo0mesgOSFR3r0kFfAv_7cnD8yZk",
  databaseURL: "https://ps-pipeline-engine---djr---v1-default-rtdb.firebaseio.com",
  projectId: "ps-pipeline-engine---djr---v1",
});
const db = getDatabase(app);

// keyword → match against site name or address
const notes = [
  {
    match: ["argyle", "faught", "7515"],
    latestNote: "UC — ESA/geotech team cleared last week. Title name change in progress (Danielle Russo). No issues. Unrestricted 10ac in DFW growth corridor, 3.4mi from existing PS. Closing timetable active.",
    latestNoteDate: "Mar 22, 2026",
  },
  {
    match: ["aubrey", "spring hill", "616"],
    latestNote: "UC — Survey received, DD clean, zero issues. Closing June. ETJ = no zoning restrictions. 14ac at $2.7M in Aubrey growth corridor. On autopilot.",
    latestNoteDate: "Mar 22, 2026",
  },
  {
    match: ["bridgewater", "perkins", "31 perkins"],
    latestNote: "LOI at $2.4M ($400K below ask). Sent FU to broker today. Pre-approved for self-storage — entitlement risk eliminated. 4-story, 808 units, 72K NSRF on 1.03ac. Institutional-grade NE deal. Awaiting seller response.",
    latestNoteDate: "Mar 22, 2026",
  },
  {
    match: ["georgetown", "reagan", "32596"],
    latestNote: "DW's top pick — he's driven it. SiteScore 8.72. ONE CALL unlocks it: Georgetown Planning 512-930-3575 (ETJ vs city limits?). If ETJ → no zoning → GREEN. 30\" water + 16\" sewer ON frontage (rare). #1 fastest-growing US city. Sun City = 16K captive retirees downsizing, no indoor CC storage within 2mi. 8,500+ new homes on corridor. Price gap: $2.65M ask vs $1.8M — need to close that delta.",
    latestNoteDate: "Mar 22, 2026",
  },
  {
    match: ["greenville", "traders", "2301"],
    latestNote: "BY RIGHT — verified. Storage Warehouse permitted P per §4-1.7, ecode360. Broker confirmed in writing 3/13. 11.9ac at $109K/ac — very low basis. IH-30 Overlay adds $150-200K facade cost. I-30 corridor, Walmart anchor, 24% pop growth since 2020. No SUP needed — cleaner than prior Greenville site. Ready for DW review.",
    latestNoteDate: "Mar 22, 2026",
  },
];

async function run() {
  // Pull all southwest + east sites
  const swSnap = await get(ref(db, "southwest"));
  const eastSnap = await get(ref(db, "east"));
  const sw = swSnap.exists() ? swSnap.val() : {};
  const east = eastSnap.exists() ? eastSnap.val() : {};

  const allSites = [
    ...Object.entries(sw).map(([id, s]) => ({ id, ...s, _region: "southwest" })),
    ...Object.entries(east).map(([id, s]) => ({ id, ...s, _region: "east" })),
  ];

  const updates = {};
  let matched = 0;

  for (const note of notes) {
    const site = allSites.find((s) => {
      const haystack = `${s.name || ""} ${s.address || ""} ${s.city || ""}`.toLowerCase();
      return note.match.some((kw) => haystack.includes(kw.toLowerCase()));
    });

    if (site) {
      updates[`${site._region}/${site.id}/latestNote`] = note.latestNote;
      updates[`${site._region}/${site.id}/latestNoteDate`] = note.latestNoteDate;
      console.log(`  ✓ ${site.name} (${site._region}/${site.id})`);
      matched++;
    } else {
      console.log(`  ✗ No match for: ${note.match.join(", ")}`);
    }
  }

  if (matched > 0) {
    await update(ref(db), updates);
    console.log(`\nUpdated ${matched}/${notes.length} sites with latestNote blurbs.`);
  } else {
    console.log("\nNo sites matched — check keywords.");
  }

  process.exit(0);
}

run().catch((e) => { console.error(e); process.exit(1); });
