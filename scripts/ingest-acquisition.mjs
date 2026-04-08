#!/usr/bin/env node
// ─── ingest-acquisition.mjs — Push acquisition targets to Firebase ───
//
// Usage: node scripts/ingest-acquisition.mjs
//
// This script is called by Claude after extracting Crexi Intelligence data.
// It takes a JSON facility record from stdin and:
// 1. Validates required fields
// 2. Pushes to Firebase acquisitions/targets/{id}
// 3. Pushes denormalized pipeline entry
// 4. Returns the Firebase ID for dashboard reference
//
// Claude's workflow:
// 1. Navigate to Crexi Intelligence in Chrome
// 2. Extract facility data using crexiParser field map
// 3. Enrich with MSA data, estimate NOI
// 4. Call this script to push to Firebase
// 5. Verify on dashboard via Acquisitions tab

import { initializeApp } from "firebase/app";
import { getDatabase, ref, push, set, update } from "firebase/database";

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

// Read facility JSON from command line argument or stdin
async function main() {
  let facilityJson;

  if (process.argv[2]) {
    // JSON passed as command line argument
    facilityJson = process.argv[2];
  } else {
    // Read from stdin
    const chunks = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk);
    }
    facilityJson = Buffer.concat(chunks).toString("utf-8");
  }

  if (!facilityJson) {
    console.error("ERROR: No facility data provided. Pass JSON as argument or pipe to stdin.");
    process.exit(1);
  }

  let facility;
  try {
    facility = JSON.parse(facilityJson);
  } catch (e) {
    console.error("ERROR: Invalid JSON:", e.message);
    process.exit(1);
  }

  // Validate required fields
  const required = ["address", "city", "state"];
  const missing = required.filter((f) => !facility[f]);
  if (missing.length > 0) {
    console.error("ERROR: Missing required fields:", missing.join(", "));
    process.exit(1);
  }

  // Generate name if not provided
  if (!facility.name) {
    facility.name = `${facility.city} ${facility.state} — ${facility.address}`;
  }

  // Ensure pipeline state
  if (!facility.pipeline) {
    facility.pipeline = {
      stage: "Identified",
      addedDate: new Date().toISOString(),
      source: facility.listingSource || "Crexi Intelligence",
    };
  }

  // Push to Firebase
  try {
    const targetRef = push(ref(db, "acquisitions/targets"));
    const id = targetRef.key;

    await set(targetRef, {
      ...facility,
      _firebaseId: id,
      _ingestedAt: new Date().toISOString(),
    });

    // Denormalized pipeline entry
    await set(ref(db, `acquisitions/pipeline/${id}`), {
      stage: facility.pipeline.stage,
      name: facility.name,
      city: facility.city,
      state: facility.state,
      askingPrice: facility.underwriting?.askingPrice || facility.askingPrice || "",
      lastUpdated: new Date().toISOString(),
    });

    console.log(`SUCCESS: Facility ingested as ${id}`);
    console.log(`  Name: ${facility.name}`);
    console.log(`  Stage: ${facility.pipeline.stage}`);
    console.log(`  Loan Maturity: ${facility.crexi?.loanMaturityDate || "not provided"}`);
    console.log(`  Owner: ${facility.ownerEntity || "not provided"}`);
    console.log(`  Dashboard: https://storvex.vercel.app (Acquisitions tab)`);

    process.exit(0);
  } catch (e) {
    console.error("ERROR: Firebase write failed:", e.message);
    process.exit(1);
  }
}

main();
