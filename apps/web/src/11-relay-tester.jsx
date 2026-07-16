// === 11-relay-tester.jsx ===
//
// Standalone GM3 tester for the phone-relay v2 rebuild (reached via
// ?standalone=relaytester — see main.jsx). Talks ONLY to phoneRelayV2; the
// live phoneRelay function, phone-relay/* data, and every native host are
// completely untouched by anything on this page.
//
// Purpose: prove the new presence -> leader-election -> command loop works
// end to end (sub-second handoff on disconnect, fencing-token rejection of
// stale commands) using apps/web/scripts/relay-tester-mock-host.mjs — with
// ZERO Bluetooth hardware — before a single native host is touched, and again
// once real hosts exist.
//
// Every element here is a real @material/web component (see CLAUDE.md's M3
// rule) via the shared wrapper layer in 08-app-split/m3.jsx — no hand-coded
// lookalikes.
import React from 'react';
import firebase from 'firebase/compat/app';
import 'firebase/compat/auth';
import {
  FilledButton, OutlinedButton, TextField, List, ListItem, Divider,
  ChipSet, AssistChip, LinearProgress, Badge, ActionBtn,
} from './08-app-split/m3.jsx';
import { GV_CLEAN, NC_FONT_STACK, NC_GLOBAL_CSS, RADIUS, SP, ELEV, TRANSITION, themeVarsCss } from './08-app-split/ui-tokens.jsx';
import { HOST_LABEL, BT_CAPABLE_HOSTS } from './08-app-split/phone-link.js';

const FIREBASE_CONFIG = {
  apiKey: "AIzaSyB5UiDE9s0xjWeYa4OQ1LLJ63EwPVoSLrA",
  authDomain: "onetaskonly-app.firebaseapp.com",
  projectId: "onetaskonly-app",
  storageBucket: "onetaskonly-app.firebasestorage.app",
  messagingSenderId: "1017463520129",
  appId: "1:1017463520129:web:b4d8ca01864dfb2a35c680",
};

const ENDPOINT = '/api/phone-relay-v2';
const POLL_MS = 2000;

// Client-side mirror of the server-side allowlist (functions/phone-relay-v2/
// schemas.js) — purely a UX nicety for instant feedback in the composer; the
// server is the actual enforcement boundary and re-checks this independently.
const KNOWN_COMMANDS = [
  '/dial', '/answer', '/hangup', '/toggle-mute', '/send', '/refresh', '/connect',
  '/mark-conversation-read', '/mark-conversation-unread',
  '/delete-message', '/toggle-message-pin', '/save-contact', '/delete-contact',
];

function ageLabel(ms) {
  if (!(ms >= 0)) return '—';
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  return `${Math.round(s / 3600)}h ago`;
}

function useAuthUser() {
  const [user, setUser] = React.useState(null);
  const [ready, setReady] = React.useState(false);
  React.useEffect(() => {
    if (!firebase.apps.length) firebase.initializeApp(FIREBASE_CONFIG);
    const unsub = firebase.auth().onAuthStateChanged((u) => { setUser(u || null); setReady(true); });
    return () => unsub();
  }, []);
  return { user, ready };
}

async function callRelay(action, { method = 'GET', body, idToken } = {}) {
  const started = performance.now();
  const url = `${ENDPOINT}?action=${action}`;
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const ms = Math.round(performance.now() - started);
  let json = null;
  try { json = await res.json(); } catch { /* non-JSON response */ }
  return { ok: res.ok, status: res.status, json, ms };
}

function Card({ children, style }) {
  const C = GV_CLEAN;
  return (
    <div style={{
      background: C.bgSoft, border: `1px solid ${C.divider}`, borderRadius: RADIUS.md,
      padding: SP.lg, boxShadow: ELEV[1], transition: TRANSITION, ...style,
    }}>
      {children}
    </div>
  );
}

function SignInScreen() {
  const C = GV_CLEAN;
  const [busy, setBusy] = React.useState(false);
  const [err, setErr] = React.useState('');
  async function signIn() {
    setBusy(true); setErr('');
    try {
      await firebase.auth().signInWithPopup(new firebase.auth.GoogleAuthProvider());
    } catch (e) {
      setErr(e?.message || 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  }
  return (
    <div style={{
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
      minHeight: '100vh', background: C.bg, fontFamily: NC_FONT_STACK, gap: SP.md, padding: SP.lg,
    }}>
      <h1 style={{ color: C.text, fontSize: 20, margin: 0 }}>Phone Relay v2 — Tester</h1>
      <p style={{ color: C.muted, fontSize: 13, maxWidth: 360, textAlign: 'center', margin: 0 }}>
        Owner sign-in required — this page reads/writes only phone-relay-v2 test data.
      </p>
      {err && <p style={{ color: C.danger || '#C94040', fontSize: 12 }}>{err}</p>}
      <FilledButton onClick={signIn} disabled={busy}>
        <span>{busy ? 'Signing in…' : 'Continue with Google'}</span>
      </FilledButton>
    </div>
  );
}

function PresenceRow({ hostId, entry, isLeader, now }) {
  const C = GV_CLEAN;
  const age = entry ? now - Number(entry.t || 0) : Infinity;
  const live = entry && age < 60000;
  const tone = isLeader ? (C.success || '#2E7D32') : live ? C.text : C.muted;
  return (
    <ListItem style={{ '--md-list-item-label-text-color': tone }}>
      <div slot="headline">{HOST_LABEL[hostId] || hostId}{isLeader ? '  •  LEADER' : ''}</div>
      <div slot="supporting-text">
        {entry
          ? `${entry.connected ? 'connected' : 'disconnected'} · quality ${entry.quality ?? 0} · heartbeat ${ageLabel(age)}`
          : 'no presence — host offline or never started'}
      </div>
    </ListItem>
  );
}

export function RelayTesterPage() {
  const { user, ready } = useAuthUser();
  const [diag, setDiag] = React.useState(null);
  const [diagErr, setDiagErr] = React.useState('');
  const [log, setLog] = React.useState([]); // raw request/response trace
  const [now, setNow] = React.useState(Date.now());
  const [cmdPath, setCmdPath] = React.useState('/refresh');
  const [handoffs, setHandoffs] = React.useState([]);
  const prevLeaderHostRef = React.useRef(undefined);
  const idTokenRef = React.useRef(null);

  React.useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const pushLog = React.useCallback((entry) => {
    setLog((prev) => [{ at: Date.now(), ...entry }, ...prev].slice(0, 50));
  }, []);

  const poll = React.useCallback(async () => {
    if (!user) return;
    try {
      const idToken = await user.getIdToken();
      idTokenRef.current = idToken;
      const { ok, status, json, ms } = await callRelay('diagnostics', { idToken });
      pushLog({ action: 'diagnostics', status, ms, ok });
      if (!ok) { setDiagErr(json?.error || `HTTP ${status}`); return; }
      setDiagErr('');
      setDiag(json);
      const nextHostId = json?.leader?.hostId || '';
      if (prevLeaderHostRef.current !== undefined && prevLeaderHostRef.current !== nextHostId) {
        setHandoffs((prev) => [{
          at: Date.now(),
          from: prevLeaderHostRef.current || '(none)',
          to: nextHostId || '(none)',
          fencingToken: json?.leader?.fencingToken,
        }, ...prev].slice(0, 20));
      }
      prevLeaderHostRef.current = nextHostId;
    } catch (e) {
      setDiagErr(e?.message || String(e));
    }
  }, [user, pushLog]);

  React.useEffect(() => {
    if (!user) return;
    poll();
    const t = setInterval(poll, POLL_MS);
    return () => clearInterval(t);
  }, [user, poll]);

  async function sendCommand() {
    if (!user) return;
    const idToken = idTokenRef.current || await user.getIdToken();
    const { ok, status, json, ms } = await callRelay('command', {
      method: 'POST', idToken, body: { path: cmdPath },
    });
    pushLog({ action: `command ${cmdPath}`, status, ms, ok, detail: json });
  }

  if (!ready) return null;
  if (!user) return <SignInScreen />;

  const C = GV_CLEAN;
  const leader = diag?.leader || null;
  const presence = diag?.presence || {};
  const pending = diag?.pendingCommands || [];

  return (
    <div className="nc-suite-root" style={{
      minHeight: '100vh', background: C.bg, fontFamily: NC_FONT_STACK, color: C.text,
      padding: SP.xl, display: 'flex', flexDirection: 'column', gap: SP.lg, maxWidth: 900, margin: '0 auto',
    }}>
      {/* M3 bridge tokens (font/color) — required before any @material/web component
          renders correctly; without these it ships with Times New Roman + M3-default
          purple (see CLAUDE.md's M3 component rule). App.jsx injects these globally for
          the main app tree, but this page renders standalone and bypasses that tree. */}
      <style>{NC_GLOBAL_CSS}</style>
      <style>{themeVarsCss({})}</style>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div>
          <h1 style={{ fontSize: 20, margin: 0 }}>Phone Relay v2 — Standalone Tester</h1>
          <p style={{ fontSize: 12, color: C.muted, margin: '4px 0 0' }}>
            Signed in as {user.email} · polling every {POLL_MS / 1000}s · touches only phone-relay-v2/* data
          </p>
        </div>
        <OutlinedButton onClick={() => firebase.auth().signOut()}><span>Sign out</span></OutlinedButton>
      </div>

      {diagErr && (
        <Card style={{ borderColor: C.danger || '#C94040' }}>
          <span style={{ color: C.danger || '#C94040', fontSize: 13 }}>diagnostics error: {diagErr}</span>
        </Card>
      )}

      <Card>
        <h2 style={{ fontSize: 14, margin: '0 0 8px' }}>Leader (fencing-token arbitration)</h2>
        {leader ? (
          <ChipSet>
            <AssistChip label={`host: ${HOST_LABEL[leader.hostId] || leader.hostId || '(none)'}`} />
            <AssistChip label={`fencing token: ${leader.fencingToken}`} />
            <AssistChip label={`held since: ${ageLabel(now - Number(leader.since || 0))}`} />
          </ChipSet>
        ) : <span style={{ color: C.muted, fontSize: 13 }}>No leader elected yet — start a mock host.</span>}
      </Card>

      <Card>
        <h2 style={{ fontSize: 14, margin: '0 0 8px' }}>Host presence</h2>
        <List>
          {BT_CAPABLE_HOSTS.map((hostId) => (
            <PresenceRow key={hostId} hostId={hostId} entry={presence[hostId]} isLeader={leader?.hostId === hostId} now={now} />
          ))}
        </List>
      </Card>

      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: SP.sm, marginBottom: 8 }}>
          <h2 style={{ fontSize: 14, margin: 0 }}>Send command</h2>
          {pending.length > 0 && <Badge>{String(pending.length)}</Badge>}
        </div>
        <div style={{ display: 'flex', gap: SP.sm, alignItems: 'center' }}>
          <TextField
            label="command path"
            value={cmdPath}
            onInput={(e) => setCmdPath(e.target.value)}
            style={{ flex: 1 }}
          />
          <FilledButton onClick={sendCommand}><span>Send</span></FilledButton>
        </div>
        <ChipSet style={{ marginTop: 8 }}>
          {KNOWN_COMMANDS.map((c) => (
            <AssistChip key={c} label={c} onClick={() => setCmdPath(c)} />
          ))}
        </ChipSet>
      </Card>

      <Card>
        <h2 style={{ fontSize: 14, margin: '0 0 8px' }}>Handoff trace</h2>
        {handoffs.length === 0
          ? <span style={{ color: C.muted, fontSize: 13 }}>No handoffs observed yet.</span>
          : (
            <List>
              {handoffs.map((h, i) => (
                <ListItem key={i}>
                  <div slot="headline">{h.from} → {h.to} (token {h.fencingToken})</div>
                  <div slot="supporting-text">{ageLabel(now - h.at)}</div>
                </ListItem>
              ))}
            </List>
          )}
      </Card>

      <Card>
        <h2 style={{ fontSize: 14, margin: '0 0 8px' }}>Raw request/response log</h2>
        <div style={{ maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
          {log.map((entry, i) => (
            <div key={i} style={{ fontSize: 11, fontFamily: 'ui-monospace, monospace', color: entry.ok ? C.muted : (C.danger || '#C94040') }}>
              {ageLabel(now - entry.at)} · {entry.action} · HTTP {entry.status} · {entry.ms}ms
              {entry.detail ? ` · ${JSON.stringify(entry.detail)}` : ''}
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <h2 style={{ fontSize: 14, margin: '0 0 8px' }}>How to drive this without hardware</h2>
        <p style={{ fontSize: 12, color: C.muted, lineHeight: 1.6, margin: 0 }}>
          In two terminals: <code>node scripts/relay-tester-mock-host.mjs --host=windows --secret=…</code> and{' '}
          <code>--host=android --secret=…</code>. Ctrl+C one to see a graceful handoff; <code>kill -9</code> its
          process (or close the terminal) to see the unclean-disconnect path — presence clears itself within
          seconds either way because onDisconnect() is armed server-side, not by client cleanup code.
        </p>
      </Card>
      <ActionBtn variant="text" onClick={poll}>Refresh now</ActionBtn>
      <LinearProgress indeterminate={false} value={1} style={{ opacity: 0 }} />
    </div>
  );
}
