// === diagnostics.jsx ===
// Self-contained troubleshooting overlay, opened with ?diag=1 on any device.
// Reports ground truth FROM THE DEVICE (build version, Firestore sync state, cache
// status, account) so staleness can be measured instead of guessed at remotely.

import React from 'react';
import { Store } from './01-core.js';
import { NC_FONT_STACK, NC_MONO_STACK, NC_TYPE } from './08-app-split/ui-tokens.jsx';

const BUILD_COMMIT = (typeof __BUILD_COMMIT__ !== 'undefined') ? __BUILD_COMMIT__ : 'dev';
const BUILD_TIME = (typeof __BUILD_TIME__ !== 'undefined') ? __BUILD_TIME__ : 'dev';

function rel(ts) {
  if (!ts) return 'never';
  const s = Math.round((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

export function DiagnosticsOverlay() {
  const [, setTick] = React.useState(0);
  const [busy, setBusy] = React.useState('');
  const [probe, setProbe] = React.useState('');
  const [authLines, setAuthLines] = React.useState(null);

  React.useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1500);
    return () => clearInterval(id);
  }, []);

  const d = Store.getDiagnostics();

  let swControlling = false;
  try { swControlling = !!(navigator.serviceWorker && navigator.serviceWorker.controller); } catch (_) {}

  const staleServer = !d.lastServerSyncTs || (Date.now() - d.lastServerSyncTs > 120000);

  const row = (k, v, warn) => (
    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '6px 0', borderBottom: '1px solid #2a2a2a', fontSize: NC_TYPE.body }}>
      <span style={{ color: '#99a' }}>{k}</span>
      <span style={{ color: warn ? '#ff6b6b' : '#cfead0', fontFamily: NC_MONO_STACK, textAlign: 'right', wordBreak: 'break-all' }}>{v}</span>
    </div>
  );

  const btn = (label, fn, bg) => (
    <button onClick={fn} disabled={!!busy}
      style={{ flex: 1, padding: '12px 8px', borderRadius: 8, border: 'none', background: bg || '#2563eb', color: '#fff', fontSize: NC_TYPE.body, fontWeight: 600, cursor: busy ? 'default' : 'pointer', opacity: busy ? 0.6 : 1 }}>
      {label}
    </button>
  );

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 2147483647, background: 'rgba(0,0,0,0.94)', color: '#eee', overflow: 'auto', padding: 18, fontFamily: NC_FONT_STACK, WebkitOverflowScrolling: 'touch' }}>
      <div style={{ maxWidth: 480, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
          <strong style={{ fontSize: NC_TYPE.title }}>Diagnostics</strong>
          <a href="/" style={{ color: '#9cf', fontSize: NC_TYPE.body, textDecoration: 'none' }}>Close ✕</a>
        </div>

        <div style={{ background: '#141414', border: '1px solid #2a2a2a', borderRadius: 10, padding: '6px 14px', marginBottom: 14 }}>
          {row('Build commit', BUILD_COMMIT)}
          {row('Build time (UTC)', BUILD_TIME)}
          {row('Account (uid)', d.uid || '—')}
          {row('Network', d.online === false ? 'OFFLINE' : 'online', d.online === false)}
          {row('Firestore cache', d.hasDb ? 'enabled' : 'NO DB', !d.hasDb)}
          {row('Latest snapshot', d.lastFromCache === null ? 'none yet' : (d.lastFromCache ? 'FROM CACHE' : 'from server'), d.lastFromCache === true)}
          {row('Last server sync', rel(d.lastServerSyncTs), staleServer)}
          {row('Last cache read', rel(d.lastCacheSyncTs))}
          {row('Load status', d.loadStatus || '—', d.loadStatus === 'error')}
          {row('SW controlling page', swControlling ? 'yes' : 'NO', !swControlling)}
        </div>

        {busy && <div style={{ color: '#9cf', fontSize: NC_TYPE.body, marginBottom: 10 }}>{busy}</div>}

        {probe && (
          <div style={{ background: '#141414', border: '1px solid #3a3a3a', borderRadius: 10, padding: '10px 14px', marginBottom: 10, fontSize: NC_TYPE.body, lineHeight: 1.5, color: probe.startsWith('REACHABLE') ? '#cfead0' : '#ffb4b4', fontFamily: NC_MONO_STACK, wordBreak: 'break-word' }}>
            {probe}
          </div>
        )}

        {authLines && (
          <div style={{ background: '#141414', border: '1px solid #3a3a3a', borderRadius: 10, padding: '10px 14px', marginBottom: 10, fontSize: NC_TYPE.meta, lineHeight: 1.6, color: '#cfead0', fontFamily: NC_MONO_STACK, wordBreak: 'break-all' }}>
            {authLines.map((l, i) => (
              <div key={i} style={{ color: l.includes('mismatch') || l.includes('false') ? '#ffb4b4' : '#cfead0' }}>{l}</div>
            ))}
          </div>
        )}

        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          {btn('Test database connection', async () => {
            setBusy('Pinging database…'); setProbe('');
            const r = await Store.probeFirestore();
            setProbe(r.verdict);
            setBusy('');
          }, '#0d9488')}
          {btn('Show login details', async () => {
            setBusy('Reading token…'); setAuthLines(null);
            const r = await Store.authReport();
            setAuthLines(r.lines);
            setBusy('');
          }, '#7c3aed')}
        </div>

        <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          {btn('Force resync', async () => { setBusy('Resyncing…'); await Store.forceResync(); setTimeout(() => setBusy(''), 600); })}
          {btn('Reset Firestore cache', () => { window.location.href = '/?resetCache=1'; }, '#b45309')}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          {btn('Clear all caches + unregister SW + reload (full reset)', async () => {
            setBusy('Clearing service worker and caches…');
            try {
              if ('serviceWorker' in navigator) {
                const regs = await navigator.serviceWorker.getRegistrations();
                await Promise.all(regs.map(r => r.unregister()));
              }
              if (typeof caches !== 'undefined') {
                const keys = await caches.keys();
                await Promise.all(keys.map(k => caches.delete(k)));
              }
            } catch (_) {}
            window.location.replace('/?resetCache=1');
          }, '#b91c1c')}
        </div>

        <p style={{ color: '#7a7a88', fontSize: NC_TYPE.meta, marginTop: 16, lineHeight: 1.55 }}>
          If <b>Build time</b> is older than the latest deploy, this device is running stale
          code — tap the red full-reset button. If <b>Latest snapshot</b> is FROM CACHE and
          <b> Last server sync</b> is old or “never”, the device isn’t reaching Firestore —
          tap “Force resync”, and if that doesn’t help, “Reset Firestore cache”.
        </p>
      </div>
    </div>
  );
}
