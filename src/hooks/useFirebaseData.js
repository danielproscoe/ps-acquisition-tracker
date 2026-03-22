// src/hooks/useFirebaseData.js
// Firebase auth, real-time listeners, and write helpers extracted from App.js

import { useState, useEffect, useRef, useCallback } from "react";
import { db, auth } from "../firebase";
import { signInAnonymously, onAuthStateChanged } from "firebase/auth";
import { ref, onValue, set, push, remove, update } from "firebase/database";
import { SITE_SCORE_DEFAULTS, normalizeSiteScoreWeights } from "../utils";

// Deep-compare two arrays of site objects by serializing to JSON.
// Prevents unnecessary re-renders when Firebase pushes identical data.
function setIfChanged(setter, newArr) {
  setter(prev => {
    if (prev.length !== newArr.length) return newArr;
    // Fast path: compare serialized JSON
    const prevJson = JSON.stringify(prev);
    const newJson = JSON.stringify(newArr);
    return prevJson === newJson ? prev : newArr;
  });
}

// SITE_SCORE_CONFIG is module-scope in App.js and mutated here via the listener.
// The hook receives a setter callback so App.js can keep SITE_SCORE_CONFIG in sync.
export function useFirebaseData({ onWeightsChange }) {
  const [authReady, setAuthReady] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [subs, setSubs] = useState([]);
  const [east, setEast] = useState([]);
  const [sw, setSw] = useState([]);
  const [configVersion, setConfigVersion] = useState(0);
  const [iqWeights, setIqWeights] = useState(
    SITE_SCORE_DEFAULTS.map(d => ({ key: d.key, label: d.label, icon: d.icon, weight: d.weight, tip: d.tip }))
  );

  // ─── FIREBASE AUTH — anonymous sign-in ───
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user) {
        setAuthReady(true);
      } else {
        signInAnonymously(auth).catch((err) => {
          console.error("Anonymous auth failed:", err);
          setAuthReady(true);
        });
      }
    });
    return () => unsub();
  }, []);

  // Stable ref for the weights callback — avoids tearing down Firebase listeners
  // every time AppInner re-renders (which was the primary cause of flicker).
  const onWeightsChangeRef = useRef(onWeightsChange);
  useEffect(() => { onWeightsChangeRef.current = onWeightsChange; }, [onWeightsChange]);

  // ─── FIREBASE REAL-TIME LISTENERS (wait for auth) ───
  // Track which data sources have delivered their first snapshot so we can
  // hold off rendering until ALL data is ready (prevents 3-frame flicker).
  const initialLoadRef = useRef({ subs: false, east: false, sw: false });

  useEffect(() => {
    if (!authReady) return;
    initialLoadRef.current = { subs: false, east: false, sw: false };

    const subsRef = ref(db, "submissions");
    const eastRef = ref(db, "east");
    const swRef = ref(db, "southwest");
    const iqRef = ref(db, "config/siteiq_weights");

    // Pending initial data — buffer updates until all 3 data listeners fire.
    const pendingRef = { subs: [], east: [], sw: [] };

    const maybeFlush = () => {
      const il = initialLoadRef.current;
      if (il.subs && il.east && il.sw) {
        // All 3 have reported — flush in a single synchronous block (React 18 batches these)
        setIfChanged(setSubs, pendingRef.subs);
        setIfChanged(setEast, pendingRef.east);
        setIfChanged(setSw, pendingRef.sw);
        setLoaded(true);
      }
    };

    const unsubIQ = onValue(iqRef, (snap) => {
      const val = snap.val();
      if (val?.dimensions) {
        const merged = SITE_SCORE_DEFAULTS.map(d => {
          const override = val.dimensions.find(o => o.key === d.key);
          return { ...d, weight: override ? override.weight : d.weight };
        });
        const normalized = normalizeSiteScoreWeights(merged);
        if (onWeightsChangeRef.current) onWeightsChangeRef.current(normalized);
        setIqWeights(merged.map(d => ({ key: d.key, label: d.label, icon: d.icon, weight: d.weight, tip: d.tip })));
        setConfigVersion(v => v + 1);
      }
    });

    const unsubSubs = onValue(subsRef, (snap) => {
      const val = snap.val();
      const arr = val ? Object.entries(val).map(([id, d]) => ({ ...d, id })) : [];
      if (!initialLoadRef.current.subs) {
        initialLoadRef.current.subs = true;
        pendingRef.subs = arr;
        maybeFlush();
      } else {
        setIfChanged(setSubs, arr);
      }
    });
    const unsubEast = onValue(eastRef, (snap) => {
      const val = snap.val();
      const arr = val ? Object.entries(val).map(([id, d]) => ({ ...d, id })) : [];
      if (!initialLoadRef.current.east) {
        initialLoadRef.current.east = true;
        pendingRef.east = arr;
        maybeFlush();
      } else {
        setIfChanged(setEast, arr);
      }
    });
    const unsubSw = onValue(swRef, (snap) => {
      const val = snap.val();
      const arr = val ? Object.entries(val).map(([id, d]) => ({ ...d, id })) : [];
      if (!initialLoadRef.current.sw) {
        initialLoadRef.current.sw = true;
        pendingRef.sw = arr;
        maybeFlush();
      } else {
        setIfChanged(setSw, arr);
      }
    });

    return () => {
      unsubSubs();
      unsubEast();
      unsubSw();
      unsubIQ();
    };
  }, [authReady]); // onWeightsChange stabilized via ref — no longer a dependency

  // ─── FIREBASE WRITE HELPERS (with path validation, stable references) ───
  const fbSet = useCallback((path, value) => {
    if (typeof path !== "string" || !path) { console.error("fbSet: invalid path", path); return Promise.resolve(); }
    return set(ref(db, path), value);
  }, []);
  const fbUpdate = useCallback((path, value) => {
    if (typeof path !== "string" || !path) { console.error("fbUpdate: invalid path", path); return Promise.resolve(); }
    return update(ref(db, path), value);
  }, []);
  const fbPush = useCallback((path, value) => {
    if (typeof path !== "string" || !path) { console.error("fbPush: invalid path", path); return Promise.resolve(); }
    return push(ref(db, path), value);
  }, []);
  const fbRemove = useCallback((path) => {
    if (typeof path !== "string" || !path) { console.error("fbRemove: invalid path", path); return Promise.resolve(); }
    return remove(ref(db, path));
  }, []);

  return {
    authReady,
    loaded,
    subs, setSubs,
    east, setEast,
    sw, setSw,
    configVersion, setConfigVersion,
    iqWeights, setIqWeights,
    fbSet, fbUpdate, fbPush, fbRemove,
  };
}
