// === 00-auth.jsx ===
//
// Clean rebuild (2026-06-17): Google-only sign-in, single canonical origin.
//
// AuthGate listens to Firebase Auth state. It shows the LoginScreen when signed out and
// renders <App user={...} onSignOut={...} /> when signed in.
//
// Identity / data continuity: the app keys all Firestore data on `canonicalUid(user)` =
// the email prefix (see 01-core.js). Google sign-in is the only method, so e.g.
// rabbidanziger@hocsouthbend.org → "rabbidanziger" — the same path it has always used.
//
// Same-origin auth: `authDomain` is pinned to onetaskonly-app.firebaseapp.com in 01-core.js —
// the one origin whose OAuth redirect URI (/__/auth/handler) is registered in Google Cloud, so
// .web.app would fail with redirect_uri_mismatch. index.html bounces web.app visitors to the
// firebaseapp.com origin, and the service worker (sw.js) leaves /__/ paths to the network, so
// Firebase's /__/auth handler is same-origin and reachable — which is what lets
// signInWithRedirect survive iOS Safari ITP.

import React from 'react';
import firebase from 'firebase/compat/app';
import { App } from './08-app-split/index.jsx';
import { DiagnosticsOverlay } from './diagnostics.jsx';
import { ActionBtn, OutlinedButton, Checkbox } from './08-app-split/m3.jsx';
import { NC_FONT_STACK, NC_TYPE } from './08-app-split/ui-tokens.jsx';
import { passkeysSupported, passkeyRegisteredHere, rememberPasskeyRegistered, assertPasskey } from './passkey-client.js';

const _AUTH_STAY_SIGNED_IN_KEY = "ot_auth_stay_signed_in";
const _AUTH_LAST_UID_KEY       = "ot_last_uid";
const _AUTH_FRESH_LOGIN_KEY    = "ot_fresh_login";
// Remember the last working Google account so cold starts can pre-select it (login_hint)
// and the recovery screen can show "Continue as <email>".
const _AUTH_LAST_GOOGLE_EMAIL_KEY = "ot_last_google_email";
// Set just before an auto-recovery sign-out so it can't loop; cleared on a good load.
const _AUTH_RECOVERY_KEY = "ot_access_recovery";

function _readLastGoogleEmail() {
  try { return localStorage.getItem(_AUTH_LAST_GOOGLE_EMAIL_KEY) || ""; } catch (_) { return ""; }
}

function _rememberGoogleEmail(email) {
  const e = String(email || "").trim();
  if (!e) return;
  try { localStorage.setItem(_AUTH_LAST_GOOGLE_EMAIL_KEY, e); } catch (_) {}
}

// Use redirect auth on iOS / Android — popups are blocked by iOS Safari.
function _isMobileOrTablet() {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

function _isIOS() {
  if (typeof navigator === "undefined") return false;
  return /iPhone|iPad|iPod/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

// iOS home-screen PWA (added to Home Screen → runs "standalone"): a popup opens
// in a disconnected in-app sheet that can never message the opener back, so
// signInWithPopup hangs forever after the account pick — and no error fires, so
// the popup→redirect fallback below never triggers (owner ticket 7/13). The
// redirect flow IS reliable here because the app is served from the auth domain
// itself (same-origin /__/auth/handler), so standalone iOS goes straight to it.
function _isStandaloneIOS() {
  if (!_isIOS()) return false;
  try {
    if (typeof navigator !== "undefined" && navigator.standalone === true) return true;
    return typeof window !== "undefined" && !!window.matchMedia &&
      window.matchMedia("(display-mode: standalone)").matches;
  } catch (_) { return false; }
}

function _readStaySignedIn() {
  try { return localStorage.getItem(_AUTH_STAY_SIGNED_IN_KEY) !== "0"; } catch (_) { return true; }
}

function _getAuthPersistence(staySignedIn = true) {
  return staySignedIn ? firebase.auth.Auth.Persistence.LOCAL : firebase.auth.Auth.Persistence.SESSION;
}

async function _setAuthPersistence(staySignedIn = true) {
  if (typeof firebase === "undefined" || !firebase.auth || !firebase.auth.Auth?.Persistence) return;
  await firebase.auth().setPersistence(_getAuthPersistence(staySignedIn));
}

// Sign in with Google. Popup-first on every device, redirect as automatic fallback
// (result captured in AuthGate boot()). Returns the user on the popup path, null on
// the redirect path (the page reloads).
//
// Two deliberate choices, from the tablet sign-in-loop incident (2026-07-05):
// 1. ALWAYS show Google's account picker (prompt=select_account). The old login_hint-only
//    flow silently re-selected the last account with no UI at all — when that account was
//    one Firestore denies, the app signed in, got denied, auto-signed-out, and every retry
//    invisibly picked the same broken account again. The picker (with the last account
//    pre-highlighted via login_hint) is the loop-breaker: the owner can choose a different
//    account.
// 2. Popup first even on mobile. signInWithRedirect is the fragile path on modern mobile
//    browsers (storage partitioning, sessionStorage loss across the redirect → the classic
//    auth/missing-initial-state cycle). A popup opened from a user gesture works on Android
//    Chrome and current iOS Safari; where a browser still blocks it we fall back to redirect.
async function _signInWithGoogle(staySignedIn = true) {
  await _setAuthPersistence(staySignedIn);
  try { localStorage.setItem(_AUTH_STAY_SIGNED_IN_KEY, staySignedIn ? "1" : "0"); } catch (_) {}

  const provider = new firebase.auth.GoogleAuthProvider();
  const lastEmail = _readLastGoogleEmail();
  provider.setCustomParameters({
    prompt: "select_account",
    ...(lastEmail ? { login_hint: lastEmail } : {}),
  });

  if (_isStandaloneIOS()) {
    await firebase.auth().signInWithRedirect(provider);
    return null; // page reloads after the redirect; boot() captures the result
  }

  let cred;
  try {
    cred = await firebase.auth().signInWithPopup(provider);
  } catch (e) {
    const code = e?.code || "";
    const popupUnusable =
      code === "auth/popup-blocked" ||
      code === "auth/operation-not-supported-in-this-environment" ||
      code === "auth/web-storage-unsupported";
    if (popupUnusable) {
      await firebase.auth().signInWithRedirect(provider);
      return null; // page reloads after the redirect
    }
    throw e;
  }

  const u = cred.user;
  const emailPrefix = (u.email || "").split("@")[0].toLowerCase();
  if (emailPrefix && (!u.displayName || u.displayName !== emailPrefix)) {
    try { await u.updateProfile({ displayName: emailPrefix }); } catch (_) {}
  }
  try { sessionStorage.setItem(_AUTH_FRESH_LOGIN_KEY, u.uid); } catch (_) {}
  _rememberGoogleEmail(u.email);
  return u;
}

// ── One signing for both gates (owner ticket MsISWD2d) ──────────────────────
// The app asked you to sign in twice: once for the app itself (Firebase Auth's
// Google provider) and again for Gmail and Calendar. Two consent screens for one
// decision — and because they were independent, nothing forced them onto the
// same Google account.
//
// The standard shape for this is a single OAuth 2.0 authorization-code request
// carrying both the OpenID Connect identity scopes and the API scopes. One code
// comes back, the server exchanges it once, and that one exchange yields both
// the identity (turned into a Firebase session) and the durable mail/calendar
// access (a refresh token kept server-side, never in this browser).
//
// This path is ADDITIVE. If anything about it is unavailable — the server half
// isn't configured, the Google script won't load, the popup is blocked, or we're
// in the standalone-iOS case where popups are known to hang — the original
// Firebase Google sign-in below runs instead, unchanged. There is always a door.
const _UNIFIED_SCOPES = [
  'openid',
  'email',
  'profile',
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify',
].join(' ');

let _gisPromise = null;
function _loadGis() {
  if (window.google?.accounts?.oauth2) return Promise.resolve(true);
  if (_gisPromise) return _gisPromise;
  _gisPromise = new Promise((resolve) => {
    const done = () => resolve(!!window.google?.accounts?.oauth2);
    const existing = document.querySelector('script[src*="accounts.google.com/gsi"]');
    if (existing) {
      const t = setInterval(() => { if (window.google?.accounts?.oauth2) { clearInterval(t); done(); } }, 150);
      setTimeout(() => { clearInterval(t); done(); }, 8000);
      return;
    }
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = done;
    s.onerror = () => resolve(false);
    document.head.appendChild(s);
  });
  return _gisPromise;
}

async function _readServerAuthConfig() {
  try {
    const r = await fetch('/api/app-config');
    const d = await r.json();
    const integrations = d?.integrations || {};
    const clientId = String(integrations.googleClientId || d?.googleClientId || '').trim();
    return { clientId, available: !!integrations.googleServerAuthAvailable && !!clientId };
  } catch (_) {
    return { clientId: '', available: false };
  }
}

// Returns the signed-in user, or null when this path isn't usable and the caller
// should fall back. Throws only for a genuine failure worth showing.
async function _signInOnceWithGoogle(staySignedIn = true) {
  if (_isStandaloneIOS()) return null; // popups hang here; redirect flow owns this case
  const { clientId, available } = await _readServerAuthConfig();
  if (!available) return null;
  if (!(await _loadGis())) return null;

  const code = await new Promise((resolve, reject) => {
    let settled = false;
    let client;
    try {
      client = window.google.accounts.oauth2.initCodeClient({
        client_id: clientId,
        scope: _UNIFIED_SCOPES,
        ux_mode: 'popup',
        include_granted_scopes: true,
        // Always show the chooser. Silently reusing whatever account the browser
        // had active is what kept landing this app on the wrong mailbox.
        select_account: true,
        callback: (resp) => {
          if (settled) return;
          settled = true;
          if (resp?.error) {
            if (resp.error === 'popup_closed_by_user' || resp.error === 'access_denied') resolve('');
            else reject(new Error(resp.error_description || resp.error));
            return;
          }
          resolve(String(resp?.code || ''));
        },
      });
    } catch (e) {
      reject(e);
      return;
    }
    try { client.requestCode(); } catch (e) { if (!settled) { settled = true; reject(e); } }
  });
  // Closing the picker is a decision, not a failure — and it must NOT fall
  // through to the legacy flow, or dismissing one Google popup would open a
  // second one. The sentinel says "handled, do nothing".
  if (!code) return "cancelled";

  const r = await fetch('/api/google-workspace', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'XmlHttpRequest' },
    body: JSON.stringify({ action: 'signIn', code }),
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || d.error || !d.customToken) {
    throw new Error(d.error || `Sign-in failed (${r.status})`);
  }

  await _setAuthPersistence(staySignedIn);
  try { localStorage.setItem(_AUTH_STAY_SIGNED_IN_KEY, staySignedIn ? '1' : '0'); } catch (_) {}
  const cred = await firebase.auth().signInWithCustomToken(d.customToken);
  const u = cred.user;
  // Tell the app that mail/calendar are already connected, so it loads them on
  // this very first render instead of showing a "connect Google" prompt for a
  // grant that was part of the same consent.
  try {
    if (d.workspaceConnected) localStorage.setItem('ot_google_connected', '1');
  } catch (_) {}
  const emailPrefix = String(d.account || u.email || '').split('@')[0].toLowerCase();
  if (emailPrefix && (!u.displayName || u.displayName !== emailPrefix)) {
    try { await u.updateProfile({ displayName: emailPrefix }); } catch (_) {}
  }
  try { sessionStorage.setItem(_AUTH_FRESH_LOGIN_KEY, u.uid); } catch (_) {}
  _rememberGoogleEmail(d.account || u.email);
  return u;
}

// Sign in with the device biometric. Returns the user, or null if the person
// dismissed the prompt (not an error — they can still use the Google button).
async function _signInWithPasskey(staySignedIn = true) {
  const d = await assertPasskey();
  if (!d) return null;
  await _setAuthPersistence(staySignedIn);
  try { localStorage.setItem(_AUTH_STAY_SIGNED_IN_KEY, staySignedIn ? "1" : "0"); } catch (_) {}
  const cred = await firebase.auth().signInWithCustomToken(d.customToken);
  rememberPasskeyRegistered(true);
  if (d.email) _rememberGoogleEmail(d.email);
  try { sessionStorage.setItem(_AUTH_FRESH_LOGIN_KEY, cred.user.uid); } catch (_) {}
  return cred.user;
}

// Map a Firebase auth error code to a human, actionable message. Returns "" for the
// benign cancellations we want to swallow silently.
function _googleErrorMessage(e) {
  const code = e?.code || "";
  if (code === "auth/popup-closed-by-user" || code === "auth/cancelled-popup-request") return "";
  if (code === "auth/no-auth-event") return "";
  if (code === "auth/unauthorized-domain")
    return "This domain isn't authorized for Google sign-in. Add it under Firebase → Authentication → Settings → Authorized domains, then try again.";
  if (code === "auth/web-storage-unsupported" || code === "auth/operation-not-supported-in-this-environment")
    return "Your browser is blocking the storage Google sign-in needs (common in private mode or strict tracking prevention). Allow site data for this app, then try again.";
  if (code === "auth/missing-initial-state")
    return "Sign-in lost its place while switching to Google and back (the browser cleared session data mid-redirect). Try again — the picker should appear this time.";
  return `Google sign-in didn't complete${code ? ` [${code}]` : ""}. Please try again.`;
}

// Localhost-only dev bypass — creates a mock user so the preview can render the full app.
//
// The bypass has a real cost: the mock user carries no Firebase auth token, so every
// Firestore read on localhost is denied and the preview renders a fully empty app with a
// "Could not reach Firebase" banner. Worse, because AuthGate short-circuits on
// __OT_DEV, the sign-in screen never appears — so there was no way to sign in for real
// on localhost at all, and no way to see the app with actual data while developing.
//
// `?realauth=1` opts out of the bypass and runs the normal Google sign-in flow against
// the live project. localhost is already an authorized domain in Firebase Auth (the
// OAuth handler lives on onetaskonly-app.firebaseapp.com, also authorized), so this
// needs no console change. The choice is remembered in localStorage so it survives
// reloads and in-app navigation; `?realauth=0` clears it and restores the mock user.
//
// Default behaviour is UNCHANGED: plain localhost still gets the mock user.
const _OT_REAL_AUTH_KEY = "ot_dev_real_auth";
function _wantsRealAuth() {
  if (typeof window === "undefined") return false;
  let stored = false;
  try { stored = localStorage.getItem(_OT_REAL_AUTH_KEY) === "1"; } catch (_) {}
  const param = new URLSearchParams(window.location.search).get("realauth");
  if (param === "1" || param === "0") {
    stored = param === "1";
    try {
      if (stored) localStorage.setItem(_OT_REAL_AUTH_KEY, "1");
      else localStorage.removeItem(_OT_REAL_AUTH_KEY);
    } catch (_) {}
  }
  return stored;
}
const _OT_IS_LOCAL = typeof window !== "undefined"
  && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1");
window.__OT_DEV = _OT_IS_LOCAL && !_wantsRealAuth();
window.__OT_DEV_USER = window.__OT_DEV ? {
  uid: "dev_test_user",
  email: "devtest@onetaskapp.local",
  displayName: "DevTest",
  isAnonymous: false,
  _isDev: true,
  // The Google-Workspace and phone-relay callers bail out before their fetch if the
  // user cannot mint an ID token, so without this the mock never even reaches the
  // intercepted routes. The value is never sent anywhere real — dev-mock answers
  // those routes locally.
  getIdToken: async () => "dev-mock-id-token",
} : null;

// Simulated content clone (see dev-mock.js). The bare dev bypass renders a fully
// EMPTY app, because the mock user holds no Firebase credential and every read is
// denied — useless for judging row density, list overflow, truncation or card
// balance, which is most of what this app's UI tickets are about. So the mock data
// is ON by default whenever the bypass is active; `?mock=0` restores the old empty
// behaviour. Nothing here can affect a deployed build: __OT_DEV is false off
// localhost, so this branch never runs in production.
// Only the FLAG is decided here, next to the other dev flags. main.jsx performs the
// actual install, because it must complete before the first render — App subscribes
// to Store on mount, and a listener registered against the real Store would never be
// swapped afterwards.
window.__OT_MOCK = window.__OT_DEV
  && new URLSearchParams(window.location.search).get("mock") !== "0";

class AppErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error("[AppErrorBoundary]", error, info); }
  render() {
    if (this.state.error) {
      return (
        <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", minHeight:"100vh", padding:24, background:"#EDE5D8", fontFamily:NC_FONT_STACK }}>
          <p style={{ fontSize:NC_TYPE.title, color:"#3D3633", marginBottom:16, textAlign:"center" }}>Something went wrong. Tap to reload.</p>
          <ActionBtn variant="filled" containerColor="#3D3633" labelColor="#EDE5D8" onClick={() => window.location.reload()}>Reload</ActionBtn>
          <pre style={{ marginTop:16, fontSize:NC_TYPE.small, color:"#7E6858", maxWidth:360, overflow:"auto", whiteSpace:"pre-wrap" }}>{String(this.state.error)}</pre>
        </div>
      );
    }
    return this.props.children;
  }
}

function AuthGate() {
  const [authState, setAuthState] = React.useState(window.__OT_DEV ? "authed" : "loading");
  const [user, setUser] = React.useState(window.__OT_DEV_USER);
  const [authError, setAuthError] = React.useState("");
  const [recoveryNotice, setRecoveryNotice] = React.useState("");

  // Called by App when a cold-started session is restored but Firestore denies it (a "bad
  // profile" with no access). Rather than stranding the user on a silently-empty app, route
  // straight back to Google sign-in with an explanation. Guarded so it can't loop.
  const handleSessionLostAccess = React.useCallback(() => {
    try { sessionStorage.setItem(_AUTH_RECOVERY_KEY, "1"); } catch (_) {}
    const last = _readLastGoogleEmail();
    setRecoveryNotice(
      last
        ? `This sign-in lost access to your data. Sign in with Google as ${last} to restore your tasks and shailos.`
        : "This sign-in lost access to your data. Sign in with Google to restore your tasks and shailos."
    );
    try { firebase.auth().signOut(); } catch (_) {}
  }, []);

  React.useEffect(() => {
    if (window.__OT_DEV) return;
    if (typeof firebase === "undefined" || !firebase.auth) {
      setAuthState("anon"); return;
    }
    let alive = true;
    let unsub = null;

    async function boot() {
      // On mobile the previous page may have done signInWithRedirect; capture that result
      // before wiring up onAuthStateChanged.
      try {
        const result = await firebase.auth().getRedirectResult();
        if (result?.user && alive) {
          const u = result.user;
          try { sessionStorage.setItem(_AUTH_FRESH_LOGIN_KEY, u.uid); } catch {}
          try { localStorage.setItem(_AUTH_STAY_SIGNED_IN_KEY, "1"); } catch {}
          _rememberGoogleEmail(u.email);
          const emailPrefix = (u.email || "").split("@")[0].toLowerCase();
          if (emailPrefix && (!u.displayName || u.displayName !== emailPrefix)) {
            try { await u.updateProfile({ displayName: emailPrefix }); } catch {}
          }
        }
      } catch (e) {
        const msg = _googleErrorMessage(e);
        if (msg) { console.warn("[Auth] getRedirectResult error:", e.code); setAuthError(msg); }
      }

      if (!alive) return;

      await _setAuthPersistence(_readStaySignedIn())
        .catch(e => console.warn("[Auth] Could not set persistence:", e?.message || e));

      if (!alive) return;

      unsub = firebase.auth().onAuthStateChanged(u => {
        if (u) {
          // Detect a UID switch (different Google account) and bust stale caches.
          try {
            const prev = localStorage.getItem(_AUTH_LAST_UID_KEY);
            if (prev && prev !== u.uid) sessionStorage.setItem(_AUTH_FRESH_LOGIN_KEY, u.uid);
            localStorage.setItem(_AUTH_LAST_UID_KEY, u.uid);
          } catch {}
        }
        setUser(u || null);
        setAuthState(u ? "authed" : "anon");
      });
    }

    boot();
    return () => { alive = false; if (unsub) unsub(); };
  }, []);

  // ?diag=1 overlays the on-device diagnostics readout on top of whatever is rendering.
  let showDiag = false;
  try { showDiag = new URLSearchParams(window.location.search).get("diag") === "1"; } catch (_) {}
  const withDiag = (node) => <>{node}{showDiag && <DiagnosticsOverlay />}</>;

  if (authState === "loading") return withDiag(
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100vh", background:"#EDE5D8" }}>
      <div style={{ width:26, height:26, border:"3px solid #D8CEBC", borderTopColor:"#3D3633", borderRadius:"50%", animation:"ot-spin 0.8s linear infinite" }} />
    </div>
  );

  if (authState === "anon") return withDiag(
    <LoginScreen onLogin={u => { setUser(u); setAuthState("authed"); }} initialError={recoveryNotice || authError} />
  );

  return withDiag(<AppErrorBoundary><App user={user} onSignOut={() => firebase.auth().signOut()} onSessionLostAccess={handleSessionLostAccess} /></AppErrorBoundary>);
}

// ── Login screen (Google-only) ───────────────────────────────────────────────
function LoginScreen({ onLogin, initialError = "" }) {
  const [err, setErr]           = React.useState(initialError);
  const [loading, setLoading]   = React.useState(false);
  const [staySignedIn, setStaySignedIn] = React.useState(_readStaySignedIn);
  // Only offered when this browser has actually registered a passkey — an unlock
  // button that opens a prompt with nothing behind it is worse than no button.
  const [bioReady, setBioReady] = React.useState(() => passkeysSupported() && passkeyRegisteredHere());
  const [bioBusy, setBioBusy]   = React.useState(false);

  async function handleBiometricSignIn() {
    setBioBusy(true); setErr("");
    try {
      const u = await _signInWithPasskey(staySignedIn);
      if (u) onLogin(u);
    } catch (e) {
      // A passkey that no longer verifies must never become a dead end: say so
      // plainly and leave the Google button as the way through.
      setErr(`${e?.message || "Biometric sign-in failed."} You can still continue with Google.`);
      setBioReady(false);
    } finally {
      setBioBusy(false);
    }
  }

  const S = {
    bg:"#EDE5D8", card:"#F5EFE5", text:"#3D3633",
    tSoft:"#6E5848", tFaint:"#7E6858", brd:"#D8CEBC",
  };

  async function handleGoogleSignIn() {
    setLoading(true); setErr("");
    try {
      // One consent covering the app AND mail/calendar. Returns null when this
      // path isn't usable here, in which case the original two-step flow runs.
      let u = null;
      try {
        u = await _signInOnceWithGoogle(staySignedIn);
        if (u === "cancelled") return;
        if (u) { onLogin(u); return; }
      } catch (e) {
        console.warn('[Auth] unified sign-in failed, falling back:', e?.message || e);
      }
      u = await _signInWithGoogle(staySignedIn);
      if (u) onLogin(u); // popup path; redirect path reloads the page
    } catch (e) {
      const msg = _googleErrorMessage(e);
      if (msg) setErr(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", minHeight:"100vh", background:S.bg, fontFamily:NC_FONT_STACK, padding:20 }}>
      <div style={{ width:"100%", maxWidth:360, background:S.card, borderRadius:22, padding:"40px 28px 32px", boxShadow:"0 8px 40px rgba(0,0,0,0.10)", animation:"ot-fade 0.3s" }}>

        {/* Logo */}
        <div style={{ textAlign:"center", marginBottom:28 }}>
          <div style={{ fontSize:36, lineHeight:1, marginBottom:10 }}>◎</div>
          <h1 style={{ fontSize:22, fontWeight:`var(--nc-fw-strong, 700)`, color:S.text, fontFamily:NC_FONT_STACK, margin:0, letterSpacing:0.5 }}>Shamash Pro 4</h1>
          <p style={{ fontSize:NC_TYPE.meta, color:S.tFaint, marginTop:5, fontFamily:NC_FONT_STACK }}>Sign in to continue</p>
        </div>

        <label style={{ display:"flex", alignItems:"center", gap:9, margin:"0 0 18px", color:S.tSoft, fontSize:NC_TYPE.meta, lineHeight:1.35, cursor:"pointer", userSelect:"none" }}>
          <Checkbox
            checked={staySignedIn}
            onChange={e => setStaySignedIn(e.target.checked)}
            style={{ '--md-checkbox-selected-container-color':S.text, '--md-checkbox-selected-hover-container-color':S.text, '--md-checkbox-selected-focus-container-color':S.text, '--md-checkbox-selected-pressed-container-color':S.text, flex:"0 0 auto" }}
          />
          <span>Stay signed in on this device</span>
        </label>

        {err && (
          <p style={{ fontSize:NC_TYPE.meta, color:"#C94040", marginBottom:14, lineHeight:1.5, fontFamily:NC_FONT_STACK }}>{err}</p>
        )}

        {bioReady && (
          <div style={{ marginBottom:14 }}>
            <ActionBtn
              variant="filled"
              icon="fingerprint"
              onClick={handleBiometricSignIn}
              disabled={bioBusy || loading}
              containerColor={S.text}
              labelColor={S.card}
              height={46}
              style={{ width:"100%", opacity: bioBusy ? 0.6 : 1 }}
            >
              {bioBusy ? "Waiting for your device…" : "Unlock with Face ID or fingerprint"}
            </ActionBtn>
            <div style={{ textAlign:"center", fontSize:NC_TYPE.small, color:S.tFaint, margin:"10px 0 2px", fontFamily:NC_FONT_STACK }}>or</div>
          </div>
        )}

        {/* Google Sign-In */}
        <OutlinedButton onClick={handleGoogleSignIn} disabled={loading} style={{
          width:"100%",
          '--md-outlined-button-container-height':'46px',
          '--md-outlined-button-container-shape':'12px',
          '--md-outlined-button-outline-color':S.brd,
          '--md-outlined-button-outline-width':'1.5px',
          '--md-outlined-button-label-text-color':S.text,
          '--md-outlined-button-label-text-size':'14px',
          '--md-outlined-button-label-text-weight':'700',
          opacity: loading ? 0.6 : 1,
        }}>
          {/* Google "G" logo */}
          <svg slot="icon" width="18" height="18" viewBox="0 0 48 48">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
          </svg>
          <span>{loading ? "Signing in…" : "Continue with Google"}</span>
        </OutlinedButton>
      </div>
    </div>
  );
}

export { AuthGate };
