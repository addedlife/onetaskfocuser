// ── Phone hosts — the relay device approval surface ───────────────────────────
//
// This is the human half of the per-device relay credential system that replaced
// the single shared PHONE_RELAY_SECRET (see functions/_relay-devices.cjs for the
// why — three outages, all one root cause).
//
// A new DeskPhone PC or Android host enrolls itself and lands here as "Waiting
// for approval". One click turns it on. Revoke kills exactly that host and leaves
// the others running, which was impossible when every host shared one secret.

import React, { useCallback, useEffect, useState } from 'react';
import firebase from 'firebase/compat/app';
import { NC_TYPE, RADIUS, SP, NC_FONT_STACK } from '../ui-tokens.jsx';
import { ActionBtn } from '../m3.jsx';

const RELAY_BASE = '/api/phone-relay';

function relTime(ms) {
  if (!ms) return 'never';
  const d = Date.now() - ms;
  if (d < 60_000) return 'just now';
  if (d < 3_600_000) return `${Math.round(d / 60_000)} min ago`;
  if (d < 86_400_000) return `${Math.round(d / 3_600_000)} hr ago`;
  return `${Math.round(d / 86_400_000)} d ago`;
}

const STATUS_COPY = {
  approved: { label: 'Approved',            hint: 'This host can send texts and control calls.' },
  pending:  { label: 'Waiting for approval', hint: 'Enrolled but inert until you approve it.' },
  revoked:  { label: 'Revoked',             hint: 'Blocked. Approve again to restore it.' },
};

export default function RelayDevicesPanel({ T, type }) {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [busyId, setBusyId] = useState('');

  const authedFetch = useCallback(async (url, opts = {}) => {
    const user = firebase?.auth?.().currentUser;
    if (!user) throw new Error('Sign in to manage phone hosts.');
    const token = await user.getIdToken();
    const res = await fetch(url, {
      ...opts,
      cache: 'no-store',
      headers: { ...(opts.headers || {}), Authorization: `Bearer ${token}` },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.error || `Relay error (${res.status})`);
    return body;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setErr('');
    try {
      const body = await authedFetch(`${RELAY_BASE}?action=device-list`);
      setDevices(Array.isArray(body?.devices) ? body.devices : []);
    } catch (e) {
      setErr(e.message || 'Could not load phone hosts.');
    } finally {
      setLoading(false);
    }
  }, [authedFetch]);

  useEffect(() => { load(); }, [load]);

  const act = useCallback(async (deviceId, action) => {
    setBusyId(deviceId);
    setErr('');
    try {
      await authedFetch(`${RELAY_BASE}?action=device-${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId }),
      });
      await load();
    } catch (e) {
      setErr(e.message || `Could not ${action} that host.`);
    } finally {
      setBusyId('');
    }
  }, [authedFetch, load]);

  const pending = devices.filter(d => d.status === 'pending');

  return (
    <div style={{ fontFamily: NC_FONT_STACK }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: SP.sm }}>
        <div style={{ fontSize: type?.section || NC_TYPE.body, fontWeight: `var(--nc-fw-semibold, 600)`, color: T.text }}>Phone hosts</div>
        <ActionBtn variant="text" containerColor={T.card} labelColor={T.tSoft}
          height={36} labelSize={NC_TYPE.small} onClick={load}>Refresh</ActionBtn>
      </div>

      <div style={{ fontSize: NC_TYPE.small, color: T.tSoft, marginBottom: SP.sm, lineHeight: 1.45 }}>
        Each computer or tablet that holds your phone's Bluetooth link registers itself here
        with its own credential. Approve one to let it send texts and control calls; revoke one
        to shut just that host out without touching the others.
      </div>

      {pending.length > 0 && (
        <div style={{
          background: T.bgW, border: `1px solid ${T.brdS || T.brd}`, borderRadius: RADIUS.sm,
          padding: SP.sm, marginBottom: SP.sm, fontSize: NC_TYPE.small, color: T.text,
        }}>
          {pending.length === 1
            ? `“${pending[0].label}” is waiting for approval.`
            : `${pending.length} hosts are waiting for approval.`}
        </div>
      )}

      {err && (
        <div style={{ fontSize: NC_TYPE.small, color: T.danger || T.text, marginBottom: SP.sm }}>{err}</div>
      )}

      {loading && <div style={{ fontSize: NC_TYPE.small, color: T.tSoft }}>Loading…</div>}

      {!loading && devices.length === 0 && !err && (
        <div style={{ fontSize: NC_TYPE.small, color: T.tSoft }}>
          No hosts have enrolled yet. Start DeskPhone on a PC (or the Shamash host on the tablet)
          and it will appear here within a few seconds.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: SP.xs }}>
        {devices.map(d => {
          const copy = STATUS_COPY[d.status] || { label: d.status, hint: '' };
          const busy = busyId === d.deviceId;
          return (
            <div key={d.deviceId} style={{
              border: `1px solid ${T.brdS || T.brd}`, borderRadius: RADIUS.sm,
              padding: SP.sm, background: T.card,
            }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: SP.xs, flexWrap: 'wrap' }}>
                <div style={{ fontSize: NC_TYPE.body, fontWeight: `var(--nc-fw-semibold, 600)`, color: T.text }}>{d.label}</div>
                <div style={{ fontSize: NC_TYPE.small, color: d.status === 'approved' ? T.tSoft : (T.danger || T.tSoft) }}>
                  {copy.label}
                </div>
              </div>
              <div style={{ fontSize: NC_TYPE.small, color: T.tSoft, marginTop: 2 }}>
                {copy.hint} Last seen {relTime(d.lastSeenAt)} · {d.platform}
              </div>
              <div style={{ display: 'flex', gap: SP.xs, marginTop: SP.xs, flexWrap: 'wrap' }}>
                {d.status !== 'approved' && (
                  <ActionBtn variant="tonal" containerColor={T.card} labelColor={T.text}
                    height={36} labelSize={NC_TYPE.small} disabled={busy}
                    onClick={() => act(d.deviceId, 'approve')}>Approve</ActionBtn>
                )}
                {d.status === 'approved' && (
                  <ActionBtn variant="text" containerColor={T.card} labelColor={T.tSoft}
                    height={36} labelSize={NC_TYPE.small} disabled={busy}
                    onClick={() => act(d.deviceId, 'revoke')}>Revoke</ActionBtn>
                )}
                <ActionBtn variant="text" containerColor={T.card} labelColor={T.tSoft}
                  height={36} labelSize={NC_TYPE.small} disabled={busy}
                  onClick={() => act(d.deviceId, 'delete')}>Remove</ActionBtn>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
