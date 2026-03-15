#!/usr/bin/env node
/**
 * backup-firebase.mjs -- PS Acquisition Tracker Database Backup
 * 
 * Exports all Firebase Realtime Database paths to a timestamped JSON file.
 * Run: node backup-firebase.mjs
 * Output: backup-YYYY-MM-DDTHH-MM-SS.json in current directory
 * 
 * Addresses audit finding DATA-01: No Database Backup Strategy
 */

import { initializeApp } from 'firebase/app';
import { getDatabase, ref, get } from 'firebase/database';
import { writeFileSync } from 'fs';

const firebaseConfig = {
  apiKey: "AIzaSyAjfLspo0mesgOSFR3r0kFfAv_7cnD8yZk",
  authDomain: "ps-pipeline-engine---djr---v1.firebaseapp.com",
  databaseURL: "https://ps-pipeline-engine---djr---v1-default-rtdb.firebaseio.com",
  projectId: "ps-pipeline-engine---djr---v1",
  storageBucket: "ps-pipeline-engine---djr---v1.firebasestorage.app",
  messagingSenderId: "863337910082",
  appId: "1:863337910082:web:4cd6c9d38093a5177202db"
};

const PATHS = ['submissions', 'southwest', 'east'];

async function backup() {
  console.log('[backup] Starting Firebase backup...');
  const app = initializeApp(firebaseConfig);
  const db = getDatabase(app);

  const result = {
    _meta: {
      timestamp: new Date().toISOString(),
      paths: PATHS,
      version: '1.0.0'
    }
  };

  let totalSites = 0;

  for (const path of PATHS) {
    console.log(`[backup] Reading /${path}...`);
    const snapshot = await get(ref(db, path));
    if (snapshot.exists()) {
      const data = snapshot.val();
      const count = typeof data === 'object' ? Object.keys(data).length : 0;
      result[path] = data;
      totalSites += count;
      console.log(`[backup]   /${path}: ${count} records`);
    } else {
      result[path] = null;
      console.log(`[backup]   /${path}: empty`);
    }
  }

  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const filename = `backup-${ts}.json`;
  writeFileSync(filename, JSON.stringify(result, null, 2));

  console.log(`[backup] Done. ${totalSites} total records saved to ${filename}`);
  process.exit(0);
}

backup().catch(err => {
  console.error('[backup] FATAL:', err.message);
  process.exit(1);
});
