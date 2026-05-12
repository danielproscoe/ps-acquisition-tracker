// ═══════════════════════════════════════════════════════════════════════════
// Pipeline Verification Audit Log — Phase B Firebase Wire
//
// Phase A (Move 3 ship 2026-05-11, commit 218b49a) wrote every verification
// cycle to window.localStorage under the key
// "storvex.pipelineVerifyAuditLog.v1". That kept the ledger per-browser —
// DW's screenshots on his laptop never appeared on Dan's session, MT's
// verifications never showed up for Reza, and the longitudinal moat lived
// in isolated pockets.
//
// Phase B (this module) mirrors every entry to Firebase Realtime DB at
// /pipelineVerifyAudit/{cycleId} so DW + MT + Reza + Dan share ONE ledger
// across all browsers and sessions. Firebase push-keys are time-prefixed
// and chronologically sortable — perfect for an append-only audit ledger.
// localStorage stays as a synchronous, offline-tolerant fallback.
//
// Behavior contract:
//   - appendAuditEntry(entry) — always writes to localStorage first
//     (sync, never fails). Then attempts Firebase push. If Firebase fails
//     (no auth, rules block, offline), the local entry survives and the
//     returned result flags localOnly:true so callers can surface the
//     state if desired.
//   - subscribeAuditLog(handler) — streams the live merged view:
//     Firebase entries (authoritative cross-browser) + any local entries
//     not yet propagated to Firebase (dedup by timestamp). Sorted oldest
//     to newest. Returns an unsubscribe function.
//   - readLocalAuditLog() — synchronous local-only read for fallback UI
//     before the Firebase listener has settled.
//
// Patent posture (extends the pipelineVerificationOracle.js system claim):
//   The append-only audit ledger is a longitudinal moat asset; mirroring
//   to a multi-tenant primary store with offline-first fallback is the
//   substrate that makes the cross-user shared-track-record claim
//   operative.
// ═══════════════════════════════════════════════════════════════════════════

import { db, auth } from "../firebase";
import { ref, push, onValue, query, limitToLast } from "firebase/database";

export const LEGACY_LOCAL_KEY = "storvex.pipelineVerifyAuditLog.v1";
export const FIREBASE_PATH = "pipelineVerifyAudit";
export const MAX_LOCAL_ENTRIES = 100;
export const MAX_REMOTE_ENTRIES = 500;

// ─── Local helpers (pure, testable) ──────────────────────────────────────

function safeLocalGet() {
  if (typeof window === "undefined" || !window.localStorage) return [];
  try {
    const raw = window.localStorage.getItem(LEGACY_LOCAL_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function safeLocalSet(arr) {
  if (typeof window === "undefined" || !window.localStorage) return;
  try {
    const next = capLocalEntries(arr);
    window.localStorage.setItem(LEGACY_LOCAL_KEY, JSON.stringify(next));
  } catch {
    // best-effort — localStorage quota or private-mode failures are non-fatal
  }
}

export function capLocalEntries(arr, max = MAX_LOCAL_ENTRIES) {
  if (!Array.isArray(arr)) return [];
  if (arr.length <= max) return arr;
  return arr.slice(-max);
}

// Pure merge — exposed so tests can verify dedup + sort without Firebase
// or DOM. The handler in subscribeAuditLog feeds this with each onValue tick.
export function mergeAuditEntries(remoteEntries, localEntries) {
  const remote = Array.isArray(remoteEntries) ? remoteEntries : [];
  const local = Array.isArray(localEntries) ? localEntries : [];

  const remoteByTimestamp = new Set(
    remote.map((r) => r && r.timestamp).filter(Boolean)
  );

  const remoteTagged = remote.map((e) => ({ ...e, _source: "firebase" }));
  const localOnly = local
    .filter((e) => e && e.timestamp && !remoteByTimestamp.has(e.timestamp))
    .map((e) => ({ ...e, _source: "local" }));

  return [...remoteTagged, ...localOnly].sort((a, b) =>
    String(a.timestamp || "").localeCompare(String(b.timestamp || ""))
  );
}

// ─── Public API ──────────────────────────────────────────────────────────

export function readLocalAuditLog() {
  return safeLocalGet();
}

export async function appendAuditEntry(entry) {
  // 1. localStorage mirror first — synchronous, always succeeds for valid
  //    JSON-serializable entries. Guarantees the UI sees its own writes
  //    even if Firebase is unreachable.
  const prior = safeLocalGet();
  safeLocalSet([...prior, entry]);

  // 2. Firebase push — best effort. push() generates a time-prefixed,
  //    chronologically-sortable key that becomes the cycleId.
  if (!auth || !auth.currentUser) {
    return { localOnly: true, reason: "no-auth", cycleId: null };
  }
  try {
    const dbRef = ref(db, FIREBASE_PATH);
    const result = await push(dbRef, entry);
    return { localOnly: false, cycleId: result.key, reason: null };
  } catch (err) {
    return {
      localOnly: true,
      reason: err && err.message ? err.message : String(err),
      cycleId: null,
    };
  }
}

export function subscribeAuditLog(handler) {
  if (typeof handler !== "function") return () => {};

  // Bootstrap with local entries immediately so the UI is not blank
  // while Firebase resolves.
  try {
    handler(mergeAuditEntries([], safeLocalGet()));
  } catch {
    /* ignore */
  }

  let unsubFn = () => {};
  try {
    const dbRef = ref(db, FIREBASE_PATH);
    const q = query(dbRef, limitToLast(MAX_REMOTE_ENTRIES));
    unsubFn = onValue(
      q,
      (snap) => {
        const val = snap.val();
        const remote = val
          ? Object.entries(val).map(([cycleId, e]) => ({
              ...e,
              _cycleId: cycleId,
            }))
          : [];
        handler(mergeAuditEntries(remote, safeLocalGet()));
      },
      (err) => {
        // Firebase rejected — fall back to local-only view so UI is still useful.
        console.warn("pipelineAuditLog: Firebase subscription failed, falling back to local:", err);
        handler(mergeAuditEntries([], safeLocalGet()));
      }
    );
  } catch (err) {
    console.warn("pipelineAuditLog: subscribeAuditLog setup failed:", err);
  }

  return unsubFn;
}
