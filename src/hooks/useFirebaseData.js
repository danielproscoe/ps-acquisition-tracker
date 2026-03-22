// src/hooks/useFirebaseData.js
// Firebase auth, real-time listeners, and write helpers extracted from App.js

import { useState, useEffect } from "react";
import { db, auth } from "../firebase";
import { signInAnonymously, onAuthStateChanged } from "firebase/auth";
import { ref, onValue, set, push, remove, update } from "firebase/database";
import { SITE_SCORE_DEFAULTS, normalizeSiteScoreWeights } from "../utils";

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

  // ─── FIREBASE REAL-TIME LISTENERS (wait for auth) ───
  useEffect(() => {
    if (!authReady) return;
    const subsRef = ref(db, "submissions");
    const eastRef = ref(db, "east");
    const swRef = ref(db, "southwest");
    const iqRef = ref(db, "config/siteiq_weights");

    const unsubIQ = onValue(iqRef, (snap) => {
      const val = snap.val();
      if (val?.dimensions) {
        const merged = SITE_SCORE_DEFAULTS.map(d => {
          const override = val.dimensions.find(o => o.key === d.key);
          return { ...d, weight: override ? override.weight : d.weight };
        });
        const normalized = normalizeSiteScoreWeights(merged);
        // Notify App.js to update its module-scope SITE_SCORE_CONFIG
        if (onWeightsChange) onWeightsChange(normalized);
        setIqWeights(merged.map(d => ({ key: d.key, label: d.label, icon: d.icon, weight: d.weight, tip: d.tip })));
        setConfigVersion(v => v + 1);
      }
    });

    const unsubSubs = onValue(subsRef, (snap) => {
      const val = snap.val();
      const arr = val ? Object.entries(val).map(([id, d]) => ({ ...d, id })) : [];
      setSubs(arr);
    });
    const unsubEast = onValue(eastRef, (snap) => {
      const val = snap.val();
      const arr = val ? Object.entries(val).map(([id, d]) => ({ ...d, id })) : [];
      setEast(arr);
      setLoaded(true);
    });
    const unsubSw = onValue(swRef, (snap) => {
      const val = snap.val();
      const arr = val ? Object.entries(val).map(([id, d]) => ({ ...d, id })) : [];
      setSw(arr);
    });

    return () => {
      unsubSubs();
      unsubEast();
      unsubSw();
      unsubIQ();
    };
  }, [authReady, onWeightsChange]);

  // ─── FIREBASE WRITE HELPERS (with path validation) ───
  const fbSet = (path, value) => {
    if (typeof path !== "string" || !path) { console.error("fbSet: invalid path", path); return Promise.resolve(); }
    return set(ref(db, path), value);
  };
  const fbUpdate = (path, value) => {
    if (typeof path !== "string" || !path) { console.error("fbUpdate: invalid path", path); return Promise.resolve(); }
    return update(ref(db, path), value);
  };
  const fbPush = (path, value) => {
    if (typeof path !== "string" || !path) { console.error("fbPush: invalid path", path); return Promise.resolve(); }
    return push(ref(db, path), value);
  };
  const fbRemove = (path) => {
    if (typeof path !== "string" || !path) { console.error("fbRemove: invalid path", path); return Promise.resolve(); }
    return remove(ref(db, path));
  };

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
