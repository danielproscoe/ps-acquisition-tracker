// ─── BuyerFit Badge — third-lens routing fit indicator ───
// Sits next to PortfolioFit on every site card.
// Compact pill that expands on hover/click into a top-7 ranked buyer list.
//
// SiteScore  → "is this a good site on its own merits?"
// PortfolioFit → "does this match what PS specifically buys?"
// BuyerFit   → "if PS passes, who else should buy this?"

import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';

function BuyerListPopover({ anchorRef, fit, onClose, onPickOperator }) {
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

  return createPortal(
    <>
      <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 99998 }} />
      <div ref={popRef} onClick={(e) => e.stopPropagation()} style={{
        position: 'absolute', top: pos.top, left: pos.left,
        width: 380, padding: '14px 16px', borderRadius: 10,
        background: 'linear-gradient(135deg, rgba(10,10,20,0.98), rgba(15,21,56,0.98))',
        border: `1px solid ${c}40`,
        boxShadow: `0 8px 32px rgba(0,0,0,0.6), 0 0 12px ${c}20`,
        zIndex: 99999,
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
          <span style={{ fontSize: 11, fontWeight: 800, color: '#E2E8F0', letterSpacing: '0.06em' }}>
            BUYER ROUTING ENGINE
          </span>
          <span style={{ fontSize: 16, fontWeight: 900, color: c, fontFamily: "'Space Mono', monospace" }}>
            {fit.topBuyerScore.toFixed(2)}/10
          </span>
        </div>
        <div style={{ fontSize: 10, fontWeight: 700, color: c, marginBottom: 10, letterSpacing: '0.04em' }}>
          {fit.classification} · {fit.dealType || '—'}
        </div>

        <div style={{
          fontSize: 9, color: '#94A3B8', marginBottom: 10, lineHeight: 1.5,
          padding: '6px 8px', background: 'rgba(148,163,184,0.06)', borderRadius: 6,
        }}>
          <b style={{ color: '#CBD5E1' }}>{fit.survivors}</b> of <b style={{ color: '#CBD5E1' }}>{fit.matrixSize}</b> operators survived hard-gates.
          {fit.hardGateFails && fit.hardGateFails.length > 0 ? (
            <> {fit.hardGateFails.length} filtered.</>
          ) : null}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 320, overflowY: 'auto' }}>
          {(fit.ranked || []).map((c, i) => (
            <div
              key={c.operator}
              onClick={() => onPickOperator && onPickOperator(c)}
              style={{
                display: 'flex', alignItems: 'center', gap: 8,
                padding: '8px 10px', borderRadius: 6,
                background: i === 0 ? 'rgba(34,197,94,0.07)' : 'rgba(148,163,184,0.04)',
                border: `1px solid ${i === 0 ? 'rgba(34,197,94,0.25)' : 'rgba(148,163,184,0.10)'}`,
                cursor: onPickOperator ? 'pointer' : 'default',
                transition: 'all 0.12s ease',
              }}
            >
              <div style={{
                flex: '0 0 22px', height: 22, borderRadius: 4,
                background: c.tierColor, color: '#0A0A14',
                fontSize: 11, fontWeight: 900, fontFamily: "'Space Mono', monospace",
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>{i + 1}</div>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: '#E2E8F0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.operator}
                </div>
                <div style={{ fontSize: 8, color: '#94A3B8', letterSpacing: '0.04em', marginTop: 1 }}>
                  {c.tierLabel}
                  {c.hotCapitalRank && c.hotCapitalRank <= 50 ? ` · #${c.hotCapitalRank} hot capital` : ''}
                  {c.pressure ? ` · ${String(c.pressure).split(' (')[0].split(' —')[0]}` : ''}
                </div>
              </div>
              <div style={{ flex: '0 0 48px', textAlign: 'right', fontSize: 12, fontWeight: 800, color: c.tierColor, fontFamily: "'Space Mono', monospace" }}>
                {c.score.toFixed(1)}
              </div>
            </div>
          ))}
        </div>

        <div style={{
          marginTop: 10, paddingTop: 8, borderTop: '1px solid rgba(148,163,184,0.15)',
          fontSize: 8, color: '#64748B', lineHeight: 1.5,
        }}>
          Top 7 of {fit.survivors} surviving operators · Tier badges show hot-capital ranking · Click a row to expand the Routing Engine panel.
        </div>
      </div>
    </>,
    document.body
  );
}

export default function BuyerFitBadge({ fit, size = 'small', onPickOperator }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  if (!fit || !fit.topBuyer || fit.classification === 'NO MATRIX') {
    return null;
  }
  const c = fit.classColor;

  if (size === 'small') {
    return (
      <>
        <button
          ref={ref}
          onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
          aria-label={`Top buyer ${fit.topBuyer} ${fit.topBuyerScore.toFixed(2)}`}
          title={`Top: ${fit.topBuyer} · ${fit.classification}`}
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
          <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', color: 'inherit', opacity: 0.85 }}>B</span>
          {fit.topBuyerScore.toFixed(2)}
        </button>
        {open && <BuyerListPopover anchorRef={ref} fit={fit} onClose={() => setOpen(false)} onPickOperator={onPickOperator} />}
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
          <span style={{ fontSize: 9, fontWeight: 800, color: '#94A3B8', letterSpacing: '0.10em' }}>BUYER FIT</span>
          <span style={{ fontSize: 16, fontWeight: 900, color: c, fontFamily: "'Space Mono', monospace" }}>
            {fit.topBuyerScore.toFixed(2)}
          </span>
        </div>
        <div style={{ fontSize: 9, fontWeight: 700, color: c, letterSpacing: '0.04em' }}>{fit.classification}</div>
        <div style={{ fontSize: 8, color: '#64748B', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 200 }}>
          → {fit.topBuyer}
        </div>
      </div>
      {open && <BuyerListPopover anchorRef={ref} fit={fit} onClose={() => setOpen(false)} onPickOperator={onPickOperator} />}
    </>
  );
}
