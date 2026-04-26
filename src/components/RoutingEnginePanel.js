// ─── Routing Engine Panel — expandable site card section ───
// Renders the full ranked buyer list with hot-capital tiers, pitch hooks,
// contact previews, and one-click outreach launchers.
//
// Embedded inline in DW (southwest) and MT (east) tracker site cards
// AND in the Review Queue card. Collapsed by default — Dan toggles open.

import React, { useState, useMemo } from 'react';

const TIER_PRIORITY = {
  'TIER_1_HOT_CAPITAL': 1,
  'TIER_2_ACTIVE': 2,
  'TIER_3_MEDIUM': 3,
  'TIER_4_SELECTIVE': 4,
  'TIER_5_HYPER_LOCAL': 5,
};

function gmailComposeUrl(operator, site, mode = 'rec') {
  const contacts = operator.contacts || {};
  const primary = contacts.primary || {};
  const to = primary.email || '';
  const ccArr = (contacts.cc || []).filter(Boolean);
  const cc = ccArr.length ? `&cc=${encodeURIComponent(ccArr.join(','))}` : '';

  const addr = site.address || site.name || 'site';
  const acreage = site.acreage ? `${site.acreage} ac` : '';
  const subject = mode === 'rec'
    ? `${site.name || addr} — site recommendation${acreage ? ` (${acreage})` : ''}`
    : `${site.name || addr} — quick inquiry`;

  return `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}${cc}&su=${encodeURIComponent(subject)}`;
}

export default function RoutingEnginePanel({ site, fit, onCreateRecForOperator }) {
  const [open, setOpen] = useState(false);
  const [expandedRow, setExpandedRow] = useState(null);

  const ranked = useMemo(() => fit?.ranked || [], [fit]);
  const matrixSize = fit?.matrixSize || 0;
  const survivors = fit?.survivors || 0;
  const failsByReason = useMemo(() => {
    const acc = {};
    (fit?.hardGateFails || []).forEach(f => {
      const key = (f.reason || 'unknown').split(':')[0].trim();
      acc[key] = (acc[key] || 0) + 1;
    });
    return Object.entries(acc).sort((a, b) => b[1] - a[1]).slice(0, 6);
  }, [fit]);

  if (!fit || !fit.topBuyer) {
    return null;
  }

  const c = fit.classColor;

  return (
    <div style={{
      marginTop: 12,
      borderRadius: 10,
      border: `1px solid ${c}28`,
      background: `linear-gradient(180deg, ${c}06, transparent)`,
      overflow: 'hidden',
    }}>
      <div
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
        style={{
          padding: '10px 14px',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          cursor: 'pointer', userSelect: 'none',
          background: open ? `${c}10` : 'transparent',
          transition: 'background 0.15s ease',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span style={{ fontSize: 10, fontWeight: 900, color: c, letterSpacing: '0.10em' }}>
            ROUTING ENGINE
          </span>
          <span style={{
            fontSize: 9, fontWeight: 700, color: '#94A3B8',
            padding: '2px 6px', borderRadius: 4,
            background: 'rgba(148,163,184,0.08)',
          }}>
            {survivors}/{matrixSize} survive · top: <span style={{ color: c, fontWeight: 800 }}>{fit.topBuyer}</span> {fit.topBuyerScore.toFixed(1)}
          </span>
        </div>
        <span style={{ fontSize: 11, color: c, fontWeight: 700 }}>
          {open ? '▼ HIDE' : '▶ EXPAND'}
        </span>
      </div>

      {open && (
        <div style={{ padding: '4px 14px 14px' }}>
          {/* Top-7 ranked list */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {ranked.map((cand, i) => {
              const tColor = cand.tierColor;
              const isExpanded = expandedRow === cand.operator;
              return (
                <div
                  key={cand.operator}
                  style={{
                    borderRadius: 8,
                    border: `1px solid ${i === 0 ? 'rgba(34,197,94,0.35)' : 'rgba(148,163,184,0.18)'}`,
                    background: i === 0 ? 'rgba(34,197,94,0.05)' : 'rgba(15,21,56,0.45)',
                    overflow: 'hidden',
                  }}
                >
                  <div
                    onClick={() => setExpandedRow(isExpanded ? null : cand.operator)}
                    style={{
                      padding: '10px 12px',
                      display: 'flex', alignItems: 'center', gap: 10,
                      cursor: 'pointer',
                    }}
                  >
                    <div style={{
                      flex: '0 0 24px', height: 24, borderRadius: 4,
                      background: tColor, color: '#0A0A14',
                      fontSize: 11, fontWeight: 900, fontFamily: "'Space Mono', monospace",
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>{i + 1}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 12, fontWeight: 800, color: '#E2E8F0', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {cand.operator}
                      </div>
                      <div style={{ fontSize: 9, color: '#94A3B8', letterSpacing: '0.04em', marginTop: 2 }}>
                        <span style={{ color: tColor, fontWeight: 700 }}>{cand.tierLabel}</span>
                        {cand.hotCapitalRank && cand.hotCapitalRank <= 50 ? ` · #${cand.hotCapitalRank} hot capital` : ''}
                        {cand.pressure ? ` · ${String(cand.pressure).split(' (')[0].split(' —')[0]}` : ''}
                        {cand.decisionSpeed ? ` · ${cand.decisionSpeed}d` : ''}
                      </div>
                    </div>
                    <div style={{ flex: '0 0 48px', textAlign: 'right', fontSize: 14, fontWeight: 900, color: tColor, fontFamily: "'Space Mono', monospace" }}>
                      {cand.score.toFixed(1)}
                    </div>
                    <span style={{ fontSize: 9, color: '#94A3B8', marginLeft: 4 }}>
                      {isExpanded ? '▼' : '▶'}
                    </span>
                  </div>

                  {isExpanded && (
                    <div style={{ padding: '8px 14px 12px', borderTop: '1px solid rgba(148,163,184,0.12)' }}>
                      {cand.pitchHook && (
                        <div style={{
                          fontSize: 10, color: '#CBD5E1', lineHeight: 1.55,
                          padding: '8px 10px', borderRadius: 6,
                          background: 'rgba(201,168,76,0.06)',
                          border: '1px solid rgba(201,168,76,0.20)',
                          marginBottom: 8,
                        }}>
                          <b style={{ color: '#C9A84C', fontSize: 9, letterSpacing: '0.08em' }}>PITCH HOOK</b><br/>
                          <span style={{ fontStyle: 'italic' }}>{cand.pitchHook}</span>
                        </div>
                      )}

                      {cand.operationalFlag && (
                        <div style={{
                          fontSize: 9, color: '#FCA5A5', lineHeight: 1.5,
                          padding: '6px 8px', borderRadius: 6,
                          background: 'rgba(239,68,68,0.08)',
                          border: '1px solid rgba(239,68,68,0.22)',
                          marginBottom: 8,
                        }}>
                          <b>⚠ OPERATIONAL FLAG</b> {cand.operationalFlag}
                        </div>
                      )}

                      {cand.contacts && cand.contacts.primary && (
                        <div style={{ fontSize: 10, color: '#94A3B8', lineHeight: 1.6, marginBottom: 8 }}>
                          <b style={{ color: '#94A3B8', fontSize: 9, letterSpacing: '0.08em' }}>PRIMARY CONTACT</b><br/>
                          <span style={{ color: '#E2E8F0' }}>{cand.contacts.primary.name}</span>
                          {cand.contacts.primary.title ? <span> · {cand.contacts.primary.title}</span> : null}
                          {cand.contacts.primary.email ? (
                            <><br/><span style={{ color: '#3B82F6' }}>{cand.contacts.primary.email}</span></>
                          ) : null}
                          {cand.contacts.primary.phone ? <><br/>{cand.contacts.primary.phone}</> : null}
                        </div>
                      )}

                      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                        <a
                          href={gmailComposeUrl(cand, site, 'rec')}
                          target="_blank"
                          rel="noopener noreferrer"
                          onClick={(e) => e.stopPropagation()}
                          style={{
                            padding: '6px 12px', borderRadius: 6,
                            background: tColor, color: '#0A0A14',
                            fontSize: 10, fontWeight: 800, letterSpacing: '0.06em',
                            textDecoration: 'none', textTransform: 'uppercase',
                          }}
                        >
                          ✉ Compose Outreach
                        </a>
                        {onCreateRecForOperator && (
                          <button
                            onClick={(e) => { e.stopPropagation(); onCreateRecForOperator(cand, site); }}
                            style={{
                              padding: '6px 12px', borderRadius: 6,
                              background: 'transparent', color: tColor,
                              border: `1px solid ${tColor}`,
                              fontSize: 10, fontWeight: 800, letterSpacing: '0.06em',
                              textTransform: 'uppercase', cursor: 'pointer',
                            }}
                          >
                            📋 REC for {cand.operator.split(' ')[0]}
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Hard-gate summary footer */}
          {failsByReason.length > 0 && (
            <div style={{
              marginTop: 10, paddingTop: 10,
              borderTop: '1px solid rgba(148,163,184,0.12)',
              display: 'flex', flexWrap: 'wrap', gap: 6,
            }}>
              <span style={{ fontSize: 8, color: '#64748B', letterSpacing: '0.08em', fontWeight: 700, marginRight: 4 }}>
                FILTERED:
              </span>
              {failsByReason.map(([reason, n]) => (
                <span key={reason} style={{
                  fontSize: 9, color: '#94A3B8', padding: '2px 8px', borderRadius: 10,
                  background: 'rgba(148,163,184,0.08)', border: '1px solid rgba(148,163,184,0.15)',
                }}>
                  {reason} <b style={{ color: '#CBD5E1' }}>×{n}</b>
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
