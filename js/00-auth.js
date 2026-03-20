// === 00-auth.js ===
// AuthGate: Listens to Firebase Auth state.
// Shows LoginScreen when signed out; renders <App user={...} onSignOut={...} /> when signed in.
//
// Username/password auth: email stored internally as `username@onetaskapp.local`
// Google auth: email prefix used as canonical UID, so same account regardless of domain.

const _AUTH_DOMAIN = "onetaskapp.local";
function _toEmail(username) {
  return `${username.toLowerCase().trim()}@${_AUTH_DOMAIN}`;
}

function AuthGate() {
  const [authState, setAuthState] = React.useState("loading"); // "loading"|"authed"|"anon"
  const [user, setUser] = React.useState(null);

  React.useEffect(() => {
    if (typeof firebase === "undefined" || !firebase.auth) {
      setAuthState("anon"); return;
    }
    const unsub = firebase.auth().onAuthStateChanged(u => {
      setUser(u || null);
      setAuthState(u ? "authed" : "anon");
    });
    return unsub;
  }, []);

  if (authState === "loading") return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", height:"100vh", background:"#EDE5D8" }}>
      <div style={{ width:26, height:26, border:"3px solid #D8CEBC", borderTopColor:"#3D3633", borderRadius:"50%", animation:"ot-spin 0.8s linear infinite" }} />
    </div>
  );

  if (authState === "anon") return (
    <LoginScreen onLogin={u => { setUser(u); setAuthState("authed"); }} />
  );

  return <App user={user} onSignOut={() => firebase.auth().signOut()} />;
}

// ── Login / Sign-up screen ──────────────────────────────────────────────────
function LoginScreen({ onLogin }) {
  const [mode, setMode]         = React.useState("login"); // "login"|"signup"
  const [username, setUsername] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [err, setErr]           = React.useState("");
  const [loading, setLoading]   = React.useState(false);
  const [showPw, setShowPw]     = React.useState(false);

  const S = {
    bg:"#EDE5D8", card:"#F5EFE5", text:"#3D3633",
    tSoft:"#6E5848", tFaint:"#7E6858", brd:"#D8CEBC", input:"#E4DACB",
    divider:"#D0C4B0"
  };

  async function handleSubmit(e) {
    e.preventDefault();
    const u = username.trim();
    if (!u)           { setErr("Username is required."); return; }
    if (u.length < 2) { setErr("Username must be at least 2 characters."); return; }
    if (!password)    { setErr("Password is required."); return; }
    setLoading(true); setErr("");

    const email = _toEmail(u);
    const auth  = firebase.auth();
    try {
      let cred;
      if (mode === "login") {
        cred = await auth.signInWithEmailAndPassword(email, password);
      } else {
        if (password.length < 6) { setErr("Password must be at least 6 characters."); setLoading(false); return; }
        cred = await auth.createUserWithEmailAndPassword(email, password);
        await cred.user.updateProfile({ displayName: u });
      }
      onLogin(cred.user);
    } catch(e) {
      const map = {
        "auth/user-not-found":      "No account with that username.",
        "auth/wrong-password":      "Incorrect password.",
        "auth/invalid-credential":  "Incorrect username or password.",
        "auth/email-already-in-use":"That username is already taken.",
        "auth/weak-password":       "Password must be at least 6 characters.",
        "auth/too-many-requests":   "Too many attempts. Try again in a few minutes.",
      };
      setErr(map[e.code] || e.message);
    } finally { setLoading(false); }
  }

  async function handleGoogleSignIn() {
    setLoading(true); setErr("");
    try {
      const provider = new firebase.auth.GoogleAuthProvider();
      const cred = await firebase.auth().signInWithPopup(provider);
      // Ensure displayName is set to the email prefix for canonical UID matching
      const u = cred.user;
      const emailPrefix = (u.email || "").split("@")[0].toLowerCase();
      if (emailPrefix && (!u.displayName || u.displayName !== emailPrefix)) {
        try { await u.updateProfile({ displayName: emailPrefix }); } catch(_) {}
      }
      onLogin(cred.user);
    } catch(e) {
      if (e.code !== "auth/popup-closed-by-user") {
        if (e.code === "auth/unauthorized-domain") {
          setErr("Domain not authorized — add onetaskfocuser.netlify.app to Firebase → Auth → Settings → Authorized domains.");
        } else {
          setErr((e.code ? `[${e.code}] ` : "") + e.message);
        }
      }
    } finally { setLoading(false); }
  }

  function switchMode() { setMode(m => m === "login" ? "signup" : "login"); setErr(""); }

  return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center", minHeight:"100vh", background:S.bg, fontFamily:"system-ui", padding:20 }}>
      <div style={{ width:"100%", maxWidth:360, background:S.card, borderRadius:22, padding:"36px 28px 28px", boxShadow:"0 8px 40px rgba(0,0,0,0.10)", animation:"ot-fade 0.3s" }}>

        {/* Logo */}
        <div style={{ textAlign:"center", marginBottom:28 }}>
          <div style={{ fontSize:36, lineHeight:1, marginBottom:10 }}>◎</div>
          <h1 style={{ fontSize:22, fontWeight:700, color:S.text, fontFamily:"Georgia,serif", margin:0, letterSpacing:0.5 }}>OneTask</h1>
          <p style={{ fontSize:12, color:S.tFaint, marginTop:5, fontFamily:"system-ui" }}>
            {mode === "login" ? "Sign in to continue" : "Create your account"}
          </p>
        </div>

        <form onSubmit={handleSubmit}>
          {/* Username */}
          <div style={{ marginBottom:14 }}>
            <label style={{ fontSize:10, fontWeight:700, color:S.tSoft, display:"block", marginBottom:5, letterSpacing:1, textTransform:"uppercase" }}>Username</label>
            <input
              value={username} onChange={e => { setUsername(e.target.value); setErr(""); }}
              autoCapitalize="none" autoCorrect="off" spellCheck="false" autoComplete="username"
              style={{ width:"100%", padding:"11px 14px", borderRadius:10, border:`1.5px solid ${S.brd}`, background:S.input, color:S.text, fontSize:14, outline:"none", fontFamily:"system-ui", boxSizing:"border-box" }}
            />
          </div>

          {/* Password */}
          <div style={{ marginBottom:20 }}>
            <label style={{ fontSize:10, fontWeight:700, color:S.tSoft, display:"block", marginBottom:5, letterSpacing:1, textTransform:"uppercase" }}>Password</label>
            <div style={{ position:"relative" }}>
              <input
                type={showPw ? "text" : "password"}
                value={password} onChange={e => { setPassword(e.target.value); setErr(""); }}
                autoComplete={mode === "login" ? "current-password" : "new-password"}
                style={{ width:"100%", padding:"11px 40px 11px 14px", borderRadius:10, border:`1.5px solid ${S.brd}`, background:S.input, color:S.text, fontSize:14, outline:"none", fontFamily:"system-ui", boxSizing:"border-box" }}
              />
              <button type="button" onClick={() => setShowPw(v => !v)}
                style={{ position:"absolute", right:10, top:"50%", transform:"translateY(-50%)", background:"none", border:"none", cursor:"pointer", fontSize:14, color:S.tFaint, lineHeight:1, padding:4 }}>
                {showPw ? "🙈" : "👁"}
              </button>
            </div>
          </div>

          {err && (
            <p style={{ fontSize:12, color:"#C94040", marginBottom:14, lineHeight:1.5, fontFamily:"system-ui" }}>{err}</p>
          )}

          <button type="submit" disabled={loading} style={{
            width:"100%", padding:"13px", borderRadius:12, border:"none",
            background: loading ? S.brd : S.text,
            color: loading ? S.tFaint : S.bg,
            fontSize:14, fontWeight:700, cursor: loading ? "default" : "pointer",
            fontFamily:"system-ui", transition:"opacity 0.15s", opacity: loading ? 0.7 : 1,
          }}>
            {loading
              ? (mode === "login" ? "Signing in…" : "Creating account…")
              : (mode === "login" ? "Sign in" : "Create account")}
          </button>
        </form>

        {/* Divider */}
        <div style={{ display:"flex", alignItems:"center", gap:10, margin:"18px 0" }}>
          <div style={{ flex:1, height:1, background:S.divider }}/>
          <span style={{ fontSize:11, color:S.tFaint }}>or</span>
          <div style={{ flex:1, height:1, background:S.divider }}/>
        </div>

        {/* Google Sign-In */}
        <button onClick={handleGoogleSignIn} disabled={loading} style={{
          width:"100%", padding:"11px 14px", borderRadius:12, border:`1.5px solid ${S.brd}`,
          background:S.bg, color:S.text, fontSize:13, fontWeight:600,
          cursor: loading ? "default" : "pointer", fontFamily:"system-ui",
          display:"flex", alignItems:"center", justifyContent:"center", gap:10,
          opacity: loading ? 0.6 : 1,
        }}>
          {/* Google "G" logo */}
          <svg width="16" height="16" viewBox="0 0 48 48">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.18 1.48-4.97 2.31-8.16 2.31-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
          </svg>
          Continue with Google
        </button>

        <div style={{ textAlign:"center", marginTop:16 }}>
          <button onClick={switchMode} style={{ background:"none", border:"none", cursor:"pointer", fontSize:12, color:S.tSoft, fontFamily:"system-ui", textDecoration:"underline", textUnderlineOffset:2 }}>
            {mode === "login" ? "No account? Create one →" : "Already have an account? Sign in →"}
          </button>
        </div>
      </div>
    </div>
  );
}
