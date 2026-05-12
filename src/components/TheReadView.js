// TheReadView.js — The Read: centralized institutional intake surface.
//
// One tab, two intake modes:
//   1. Address Lookup → market overview via QuickLookupPanel
//                       (ESRI + Places + PS Family + Oracles)
//   2. OM Drop → OM-anchored underwrite via AssetAnalyzerView
//                (works for both land and existing-stabilized OMs;
//                 the underlying Analyzer detects + routes)
//
// This wrapper does NOT mutate either component — it composes them as
// sibling intake surfaces. Both flows continue to function exactly as
// they did when each was its own tab. The only thing that changes is
// the user-facing nav: one "⚡ The Read" tab instead of two.
//
// Deep-link routing (?asset=greenville etc) auto-selects OM mode so
// the demo loaders inside AssetAnalyzerView fire as expected.

import React, { useState, useEffect } from 'react';
import QuickLookupPanel from '../QuickLookupPanel';
import AssetAnalyzerView from './AssetAnalyzerView';
import PipelineScreenshotIntakePanel from './PipelineScreenshotIntakePanel';

const NAVY = '#1E2761';
const GOLD = '#C9A84C';
const ICE = '#D6E4F7';
const STEEL = '#2C3E6B';

export default function TheReadView({ autoEnrichESRI, fbSet, fbPush, notify, navigateTo, setTab }) {
  // Default to address mode. Deep-link routing (?asset=...) overrides to OM.
  const [mode, setMode] = useState('address');

  // If the URL carries an ?asset= preset, jump straight into OM mode so
  // the Analyzer's demo loader can fire.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const asset = (params.get('asset') || '').toLowerCase().trim();
    const VALID_PRESETS = ['greenville', 'tallahassee', 'red-rock'];
    if (asset && VALID_PRESETS.includes(asset)) {
      setMode('om');
    }
  }, []);

  return (
    <div>
      {/* Intake mode toggle — sits above either intake surface */}
      <div style={{
        background: `linear-gradient(135deg, rgba(30,39,97,0.95), rgba(15,21,56,0.92))`,
        border: `1px solid rgba(201,168,76,0.25)`,
        borderRadius: 14,
        padding: '14px 18px',
        marginBottom: 14,
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        flexWrap: 'wrap',
      }}>
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 200 }}>
          <div style={{
            fontSize: 9,
            color: GOLD,
            letterSpacing: '0.18em',
            fontWeight: 900,
            textTransform: 'uppercase',
            marginBottom: 4,
          }}>
            The Read · Institutional Intake
          </div>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.6)', letterSpacing: '0.05em' }}>
            Address → market overview. OM → underwrite. Same audit trail.
          </div>
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: 6, background: 'rgba(0,0,0,0.35)', padding: 4, borderRadius: 8 }}>
          <button
            onClick={() => setMode('address')}
            style={{
              padding: '8px 18px',
              borderRadius: 6,
              border: 'none',
              cursor: 'pointer',
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: '0.08em',
              fontFamily: "'Inter', system-ui, sans-serif",
              transition: 'all 0.2s',
              background: mode === 'address'
                ? `linear-gradient(135deg, ${GOLD}, #B89540)`
                : 'transparent',
              color: mode === 'address' ? NAVY : 'rgba(255,255,255,0.7)',
              boxShadow: mode === 'address' ? '0 4px 16px rgba(201,168,76,0.35)' : 'none',
            }}
          >
            🏠 Address Lookup
          </button>
          <button
            onClick={() => setMode('om')}
            style={{
              padding: '8px 18px',
              borderRadius: 6,
              border: 'none',
              cursor: 'pointer',
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: '0.08em',
              fontFamily: "'Inter', system-ui, sans-serif",
              transition: 'all 0.2s',
              background: mode === 'om'
                ? `linear-gradient(135deg, ${GOLD}, #B89540)`
                : 'transparent',
              color: mode === 'om' ? NAVY : 'rgba(255,255,255,0.7)',
              boxShadow: mode === 'om' ? '0 4px 16px rgba(201,168,76,0.35)' : 'none',
            }}
          >
            📄 Drop OM (Land or Storage)
          </button>
          <button
            onClick={() => setMode('verify')}
            style={{
              padding: '8px 18px',
              borderRadius: 6,
              border: 'none',
              cursor: 'pointer',
              fontSize: 11,
              fontWeight: 800,
              letterSpacing: '0.08em',
              fontFamily: "'Inter', system-ui, sans-serif",
              transition: 'all 0.2s',
              background: mode === 'verify'
                ? `linear-gradient(135deg, ${GOLD}, #B89540)`
                : 'transparent',
              color: mode === 'verify' ? NAVY : 'rgba(255,255,255,0.7)',
              boxShadow: mode === 'verify' ? '0 4px 16px rgba(201,168,76,0.35)' : 'none',
            }}
          >
            🔍 Verify Screenshot
          </button>
        </div>
      </div>

      {/* Render the appropriate intake surface */}
      {mode === 'address' && (
        <QuickLookupPanel
          autoEnrichESRI={autoEnrichESRI}
          fbSet={fbSet}
          fbPush={fbPush}
          notify={notify}
          navigateTo={navigateTo}
          setTab={setTab}
        />
      )}
      {mode === 'om' && (
        <AssetAnalyzerView
          fbSet={fbSet}
          fbPush={fbPush}
          notify={notify}
        />
      )}
      {mode === 'verify' && <PipelineScreenshotIntakePanel />}
    </div>
  );
}
