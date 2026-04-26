// ─── PortfolioFit Badge — second-lens DNA fit indicator ───
// Sits next to the SiteScore badge on every site card.
// Compact pill that expands on hover/click into a percentile breakdown
// showing where the site lands within its PS-DNA density sub-profile.
//
// SiteScore answers "is this a good site on its own merits?"
// PortfolioFit answers "is this a site PS would actually buy?"
import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';

const ATTR_LABELS = {
  population: '3-MI POPULATION',
  income:     'MEDIAN HHI',
  growth:     '5-YR GROWTH',
  households: 'HOUSEHOLDS',
  homeValue:  'HOME VALUE',
  renterPct:  'RENTER %',
  nearestPS:  'PS CLUSTERING',
};

function FitPopover({ anchorRef, fit, onClose }) {
  const [pos, setPos] = useState(null);
  const popRef = useRef(null);
  useEffect(() => {
    if (!anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    setPos({ top: rect.bottom + 8 + window.scrollY, left: rect.left + window.scrollX });
  }, [anchorRef]);
  useEffect(() => {
    if (!popRef.current || !pos) return;
    const r = popRef.current.getBoundingClientRect();
    if (r.right > window.innerWidth - 12) {
      setPos(p => ({ ...p, left: pos.left - (r.right - window.innerWidth + 12) }));
    }
  }, [pos]);

  if (!pos || !fit) return null;
  const c = fit.classColor;

  const rows = Object.entries(fit.percentiles)
    .filter(([, p]) => p != null)
    .map(([k, p]) => {
      const score = fit.attributes[k];
      const barColor = score >= 8 ? '#22C55E' : score >= 6 ? '#3B82F6' : score >= 4 ? '#F59E0B' : '#EF4444';
      return { key: k, label: ATTR_LABELS[k] || k.toUpperCase(), pct: p, score, barColor };
    });

  return createPortal(
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 99998 }} />
      <div ref={popRef} onClick={(e) => e.stopPropagation()} style={{
        position: 'absolute', top: pos.top, left: pos.left,
        width: 320, padding: '14px 16px', borderRadius: 10,
        background: 'linear-gradient(135deg, rgba(10,10,20,0.98), rgba(15,21,56,0.98))',
        border: `1px solid ${c}40`,
        boxShadow: `0 8px 32px rgba(0,0,0,0.6), 0 0 12px ${c}20`,
        zIndex: 99999,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: '#E2E8F0', letterSpacing: '0.06em' }}>
            PORTFOLIO FIT
          </span>
          <span style={{ fontSize: 16, fontWeight: 900, color: c, fontFamily: "'Space Mono', monospace" }}>
            {fit.score.toFixed(2)}/10
          </span>
        </div>
        <div style={{ fontSize: 10, fontWeight: 700, color: c, marginBottom: 10, letterSpacing: '0.04em' }}>
          {fit.classification}
        </div>
        <div style={{
          fontSize: 9, color: '#94A3B8', marginBottom: 10, lineHeight: 1.5,
          padding: '6px 8px', background: 'rgba(148,163,184,0.06)', borderRadius: 6,
        }}>
          Benchmarked against <b style={{ color: '#CBD5E1' }}>{fit.dnaSubProfileSize}</b> PS family
          sites in the <b style={{ color: '#CBD5E1' }}>{fit.density}</b> DNA bucket.
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {rows.map(r => (
            <div key={r.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ flex: '0 0 110px', fontSize: 8, fontWeight: 700, color: '#94A3B8', letterSpacing: '0.06em' }}>
                {r.label}
              </div>
              <div style={{ flex: 1, position: 'relative', height: 8, background: 'rgba(148,163,184,0.12)', borderRadius: 4, overflow: 'hidden' }}>
                {/* P25-P75 sweet-spot band */}
                <div style={{
                  position: 'absolute', top: 0, bottom: 0, left: '25%', width: '50%',
                  background: 'rgba(34,197,94,0.10)', borderLeft: '1px solid rgba(34,197,94,0.3)', borderRight: '1px solid rgba(34,197,94,0.3)',
                }} />
                {/* The site's percentile marker */}
                <div style={{
                  position: 'absolute', top: -1, bottom: -1,
                  left: `calc(${r.pct}% - 2px)`, width: 4,
                  background: r.barColor, borderRadius: 1,
                  boxShadow: `0 0 6px ${r.barColor}80`,
                }} />
              </div>
              <div style={{ flex: '0 0 56px', textAlign: 'right', fontSize: 10, fontWeight: 700, color: r.barColor, fontFamily: "'Space Mono', monospace" }}>
                P{r.pct} · {r.score}/10
              </div>
            </div>
          ))}
        </div>
        <div style={{
          marginTop: 10, paddingTop: 8, borderTop: '1px solid rgba(148,163,184,0.15)',
          fontSize: 8, color: '#64748B', lineHeight: 1.5,
        }}>
          Green band = P25-P75 sweet spot (most typical PS purchase). Marker shows where this site falls.
        </div>
      </div>
    </>,
    document.body
  );
}

export default function PortfolioFitBadge({ fit, size = 'small' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  if (!fit || fit.classification === 'NO DATA' || fit.classification === 'NO DNA') {
    return null;
  }
  const c = fit.classColor;

  if (size === 'small') {
    return (
      <>
        <button
          ref={ref}
          onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
          aria-label={`Portfolio Fit ${fit.score.toFixed(2)} ${fit.classification}`}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '3px 10px', borderRadius: 8,
            background: `${c}14`,
            border: `1px solid ${c}38`,
            fontSize: 11, fontWeight: 700, color: c,
            fontFamily: "'Space Mono', monospace",
            cursor: 'pointer',
            transition: 'all 0.15s ease',
          }}
        >
          <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', color: 'inherit', opacity: 0.85 }}>F</span>
          {fit.score.toFixed(2)}
        </button>
        {open && <FitPopover anchorRef={ref} fit={fit} onClose={() => setOpen(false)} />}
      </>
    );
  }

  return (
    <>
      <div
        ref={ref}
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
        style={{
          display: 'inline-flex', flexDirection: 'column', gap: 4,
          padding: '8px 12px', borderRadius: 10,
          background: `${c}10`,
          border: `1px solid ${c}30`,
          cursor: 'pointer',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 9, fontWeight: 800, color: '#94A3B8', letterSpacing: '0.10em' }}>PORTFOLIO FIT</span>
          <span style={{ fontSize: 16, fontWeight: 900, color: c, fontFamily: "'Space Mono', monospace" }}>
            {fit.score.toFixed(2)}
          </span>
        </div>
        <div style={{ fontSize: 9, fontWeight: 700, color: c, letterSpacing: '0.04em' }}>{fit.classification}</div>
        <div style={{ fontSize: 8, color: '#64748B' }}>{fit.density} DNA · {fit.dnaSubProfileSize} sites</div>
      </div>
      {open && <FitPopover anchorRef={ref} fit={fit} onClose={() => setOpen(false)} />}
    </>
  );
}
