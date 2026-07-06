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
window.__OT_DEV = (typeof window !== "undefined" && (window.location.hostname === "localhost" || window.location.hostname === "127.0.0.1"));
window.__OT_DEV_USER = window.__OT_DEV ? {
  uid: "dev_test_user",
  email: "devtest@onetaskapp.local",
  displayName: "DevTest",
  isAnonymous: false,
  _isDev: true,
} : null;

class AppErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { error: null }; }
  static getDerivedStateFromError(error) { return { error }; }
  componentDidCatch(error, info) { console.error("[AppErrorBoundary]", error, info); }
  render() {
    if (this.state.error) {
      return (
        <div style={{ display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", minHeight:"100vh", padding:24, background:"#EDE5D8", fontFamily:"system-ui" }}>
          <p style={{ fontSize:16, color:"#3D3633", marginBottom:16, textAlign:"center" }}>Something went wrong. Tap to reload.</p>
          <button onClick={() => window.location.reload()} style={{ padding:"10px 24px", borderRadius:8, border:"none", background:"#3D3633", color:"#EDE5D8", fontSize:15, cursor:"pointer" }}>Reload</button>
          <pre style={{ marginTop:16, fontSize:11, color:"#7E6858", maxWidth:360, overflow:"auto", whiteSpace:"pre-wrap" }}>{String(this.state.error)}</pre>
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

  const S = {
    bg:"#EDE5D8", card:"#F5EFE5", text:"#3D3633",
    tSoft:"#6E5848", tFaint:"#7E6858", brd:"#D8CEBC",
  };

  async function handleGoogleSignIn() {
    setLoading(true); setErr("");
    try {
      const u = await _signInWithGoogle(staySignedIn);
      if (u) onLogin(u); // popup path; redirect path reloads the page
    } catch (e) {
      const msg = _googleErrorMessage(e);
      if (msg) setErr(msg);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", minHeight:"100vh", background:S.bg, fontFamily:"system-ui", padding:20 }}>
      <div style={{ width:"100%", maxWidth:360, background:S.card, borderRadius:22, padding:"40px 28px 32px", boxShadow:"0 8px 40px rgba(0,0,0,0.10)", animation:"ot-fade 0.3s" }}>

        {/* Logo */}
        <div style={{ textAlign:"center", marginBottom:28 }}>
          <div style={{ fontSize:36, lineHeight:1, marginBottom:10 }}>◎</div>
          <h1 style={{ fontSize:22, fontWeight:700, color:S.text, fontFamily:"Georgia,serif", margin:0, letterSpacing:0.5 }}>Shamash Pro 4</h1>
          <p style={{ fontSize:12, color:S.tFaint, marginTop:5, fontFamily:"system-ui" }}>Sign in to continue</p>
        </div>

        <label style={{ display:"flex", alignItems:"center", gap:9, margin:"0 0 18px", color:S.tSoft, fontSize:12, lineHeight:1.35, cursor:"pointer", userSelect:"none" }}>
          <input
            type="checkbox"
            checked={staySignedIn}
            onChange={e => setStaySignedIn(e.target.checked)}
            style={{ width:16, height:16, margin:0, accentColor:S.text, cursor:"pointer", flex:"0 0 auto" }}
          />
          <span>Stay signed in on this device</span>
        </label>

        {err && (
          <p style={{ fontSize:12, color:"#C94040", marginBottom:14, lineHeight:1.5, fontFamily:"system-ui" }}>{err}</p>
        )}

        {/* Google Sign-In */}
        <button onClick={handleGoogleSignIn} disabled={loading} style={{
          width:"100%", padding:"13px 14px", borderRadius:12, border:`1.5px solid ${S.brd}`,
          background:S.bg, color:S.text, fontSize:14, fontWeight:700,
          cursor: loading ? "default" : "pointer", fontFamily:"system-ui",
          display:"flex", alignItems:"center", justifyContent:"center", gap:10,
          opacity: loading ? 0.6 : 1,
        }}>
          {/* Google "G" logo */}
          <svg width="18" height="18" viewBox="0 0 48 48">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
          </svg>
          {loading ? "Signing in…" : "Continue with Google"}
        </button>
      </div>
    </div>
  );
}

export { AuthGate };
