// ─── useOperatorMatrix — hydrates operator-matrix.json once at mount ───
// Mirrors usePortfolioDNA pattern. Returns { matrix, loading, error }.
//
// Used by App.js to power the BuyerFit badge + Routing Engine panel.
// Falls back gracefully if missing — UI hides badge/panel.

import { useEffect, useState } from 'react';

let _cachedMatrix = null;

export function useOperatorMatrix() {
  const [matrix, setMatrix] = useState(_cachedMatrix);
  const [loading, setLoading] = useState(!_cachedMatrix);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (_cachedMatrix) return;
    let cancelled = false;
    fetch('/operator-matrix.json', { cache: 'force-cache' })
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
      })
      .then(json => {
        if (cancelled) return;
        _cachedMatrix = json;
        setMatrix(json);
        setLoading(false);
      })
      .catch(e => {
        if (cancelled) return;
        console.warn('Operator matrix not loaded:', e.message);
        setError(e.message);
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  return { matrix, loading, error };
}
