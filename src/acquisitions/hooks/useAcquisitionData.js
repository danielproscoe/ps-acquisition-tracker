// ─── useAcquisitionData — Firebase Real-Time Listeners for Acquisitions Module ───
// Mirrors useFirebaseData.js pattern: anonymous auth, onValue, anti-flicker batching.

import { useState, useEffect, useRef, useCallback } from "react";
import { db, auth } from "../../firebase";
import { ref, onValue, set, push, remove, update } from "firebase/database";
import { onAuthStateChanged } from "firebase/auth";
import { ACQUISITION_SCORE_DEFAULTS } from "../scoring/scoringDefaults";

function setIfChanged(setter, newArr) {
  setter((prev) => {
    if (prev.length !== newArr.length) return newArr;
    const prevJson = JSON.stringify(prev);
    const newJson = JSON.stringify(newArr);
    return prevJson === newJson ? prev : newArr;
  });
}

export function useAcquisitionData({ onWeightsChange } = {}) {
  const [authReady, setAuthReady] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [targets, setTargets] = useState([]);
  const [pipeline, setPipeline] = useState([]);
  const [buyerProfiles, setBuyerProfiles] = useState({});
  const [acqWeights, setAcqWeights] = useState(
    ACQUISITION_SCORE_DEFAULTS.map((d) => ({
      key: d.key, label: d.label, icon: d.icon, weight: d.weight, tip: d.tip,
    }))
  );
  const [territories, setTerritories] = useState({});

  const onWeightsChangeRef = useRef(onWeightsChange);
  useEffect(() => { onWeightsChangeRef.current = onWeightsChange; }, [onWeightsChange]);

  // Auth listener — reuse existing anonymous auth from firebase.js
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (user) => {
      if (user) setAuthReady(true);
      // Don't re-sign-in — useFirebaseData already does that
    });
    return () => unsub();
  }, []);

  // Firebase real-time listeners
  useEffect(() => {
    if (!authReady) return;

    const targetsRef = ref(db, "acquisitions/targets");
    const pipelineRef = ref(db, "acquisitions/pipeline");
    const weightsRef = ref(db, "acquisitions/config/acquisition_weights");
    const buyersRef = ref(db, "acquisitions/config/buyer_profiles");
    const terrRef = ref(db, "acquisitions/config/territories");

    const initialLoad = { targets: false, pipeline: false };
    const pending = { targets: [], pipeline: [] };

    const maybeFlush = () => {
      if (initialLoad.targets && initialLoad.pipeline) {
        setIfChanged(setTargets, pending.targets);
        setIfChanged(setPipeline, pending.pipeline);
        setLoaded(true);
      }
    };

    // Targets listener
    const unsubTargets = onValue(targetsRef, (snap) => {
      const val = snap.val();
      const arr = val
        ? Object.entries(val).map(([id, data]) => ({ id, ...data }))
        : [];
      pending.targets = arr;
      initialLoad.targets = true;
      maybeFlush();
    });

    // Pipeline listener (denormalized view)
    const unsubPipeline = onValue(pipelineRef, (snap) => {
      const val = snap.val();
      const arr = val
        ? Object.entries(val).map(([id, data]) => ({ id, ...data }))
        : [];
      pending.pipeline = arr;
      initialLoad.pipeline = true;
      maybeFlush();
    });

    // Weights listener
    const unsubWeights = onValue(weightsRef, (snap) => {
      const val = snap.val();
      if (val?.dimensions) {
        const merged = ACQUISITION_SCORE_DEFAULTS.map((d) => {
          const override = val.dimensions.find((o) => o.key === d.key);
          return { ...d, weight: override ? override.weight : d.weight };
        });
        // Normalize
        const total = merged.reduce((s, d) => s + d.weight, 0);
        if (total > 0 && Math.abs(total - 1.0) > 0.001) {
          merged.forEach((d) => { d.weight = d.weight / total; });
        }
        if (onWeightsChangeRef.current) onWeightsChangeRef.current(merged);
        setAcqWeights(
          merged.map((d) => ({
            key: d.key, label: d.label, icon: d.icon, weight: d.weight, tip: d.tip,
          }))
        );
      }
    });

    // Buyer profiles listener
    const unsubBuyers = onValue(buyersRef, (snap) => {
      const val = snap.val();
      setBuyerProfiles(val || {});
    });

    // Territories listener
    const unsubTerr = onValue(terrRef, (snap) => {
      setTerritories(snap.val() || {});
    });

    return () => {
      unsubTargets();
      unsubPipeline();
      unsubWeights();
      unsubBuyers();
      unsubTerr();
    };
  }, [authReady]);

  // ─── Write Helpers ───

  const addTarget = useCallback(async (facilityData) => {
    const targetRef = push(ref(db, "acquisitions/targets"));
    const id = targetRef.key;
    const now = new Date().toISOString();
    const record = {
      ...facilityData,
      addedDate: now,
      pipeline: { stage: "Identified", addedDate: now },
    };
    await set(targetRef, record);
    // Also write denormalized pipeline entry
    await set(ref(db, `acquisitions/pipeline/${id}`), {
      stage: "Identified",
      name: facilityData.name || facilityData.address || "",
      city: facilityData.city || "",
      state: facilityData.state || "",
      lastUpdated: now,
    });
    return id;
  }, []);

  const updateTarget = useCallback(async (id, updates) => {
    await update(ref(db, `acquisitions/targets/${id}`), updates);
    // Keep pipeline denormalized view in sync
    if (updates.pipeline?.stage || updates.name || updates.city || updates.state) {
      const pipelineUpdate = { lastUpdated: new Date().toISOString() };
      if (updates.pipeline?.stage) pipelineUpdate.stage = updates.pipeline.stage;
      if (updates.name) pipelineUpdate.name = updates.name;
      if (updates.city) pipelineUpdate.city = updates.city;
      if (updates.state) pipelineUpdate.state = updates.state;
      await update(ref(db, `acquisitions/pipeline/${id}`), pipelineUpdate);
    }
  }, []);

  const updateStage = useCallback(async (id, stage, note) => {
    const now = new Date().toISOString();
    const updates = {
      "pipeline/stage": stage,
      "pipeline/lastUpdated": now,
    };
    if (note) {
      // Add to activity log
      const noteRef = push(ref(db, `acquisitions/targets/${id}/pipeline/notes`));
      await set(noteRef, { text: note, date: now, author: "Dan R" });
    }
    await update(ref(db, `acquisitions/targets/${id}`), updates);
    await update(ref(db, `acquisitions/pipeline/${id}`), { stage, lastUpdated: now });
  }, []);

  const removeTarget = useCallback(async (id) => {
    await remove(ref(db, `acquisitions/targets/${id}`));
    await remove(ref(db, `acquisitions/pipeline/${id}`));
  }, []);

  const updateBuyerProfile = useCallback(async (buyerId, profileData) => {
    await set(ref(db, `acquisitions/config/buyer_profiles/${buyerId}`), profileData);
  }, []);

  const assignBuyer = useCallback(async (facilityId, buyerId, priority) => {
    await update(ref(db, `acquisitions/targets/${facilityId}/pipeline`), {
      assignedBuyer: buyerId,
      buyerPriority: priority || "normal",
      assignedDate: new Date().toISOString(),
    });
    await update(ref(db, `acquisitions/pipeline/${facilityId}`), {
      assignedBuyer: buyerId,
      lastUpdated: new Date().toISOString(),
    });
  }, []);

  return {
    authReady,
    loaded,
    targets,
    pipeline,
    buyerProfiles,
    acqWeights,
    territories,
    // Write helpers
    addTarget,
    updateTarget,
    updateStage,
    removeTarget,
    updateBuyerProfile,
    assignBuyer,
  };
}
