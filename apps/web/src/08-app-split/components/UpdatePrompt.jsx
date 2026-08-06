// ── "A new version is live — update?" ────────────────────────────────────────
//
// Mounted app-wide (App.jsx), deliberately OUTSIDE the `!shellHidden` guard that
// hides the rail: a stale tab on a chromeless surface is exactly the one that
// most needs telling, and this must never depend on the rail being visible.
//
// Consent, not a hijack. The service worker already force-navigates its clients
// when a genuinely new worker activates — the rescue for installed PWAs that
// resume old code forever — but that yanks the page out from under whatever the
// owner was in the middle of. This asks first, and "Later" means later: the same
// version is never announced twice (update-watcher.js tracks that), so dismissing
// it does not start a nagging cycle.

import React from 'react';
import { ActionBtn, Dialog } from '../m3.jsx';
import { ICON, NC_FONT_STACK, NC_TYPE, SP } from '../ui-tokens.jsx';
import { UPDATE_AVAILABLE_EVENT, applyUpdate, watchForUpdates } from '../../update-watcher.js';
import { APP_VERSION } from '../../version.js';

export function UpdatePrompt({ T }) {
  const C = T || {};
  const [pending, setPending] = React.useState(null);   // the newer version string
  const [applying, setApplying] = React.useState(false);

  React.useEffect(() => {
    const onAvailable = e => setPending(e.detail?.version || null);
    window.addEventListener(UPDATE_AVAILABLE_EVENT, onAvailable);
    const stop = watchForUpdates();
    return () => { window.removeEventListener(UPDATE_AVAILABLE_EVENT, onAvailable); stop(); };
  }, []);

  // Mounted unconditionally with `open` driven from state, rather than rendered
  // only once there is something to announce. md-dialog runs its open transition
  // off the false→true transition of that property; handing it a dialog that is
  // already `open` on its very first render skips the sequence and leaves the
  // surface stuck mid-animation, 50px above where it belongs and clipped by the
  // top of the screen. Every other dialog in the app is wired this way
  // (DevEditMode's `open={!!draft}`); this one now matches.
  return (
    <Dialog
      open={!!pending}
      onClosed={() => { if (!applying) setPending(null); }}
      style={{
        '--md-dialog-container-color': C.bg,
        maxWidth: 'min(460px, 94vw)', minWidth: 'min(460px, 94vw)',
      }}>
      <div slot="headline" style={{
        display: 'flex', alignItems: 'center', gap: SP.sm,
        fontFamily: NC_FONT_STACK, fontSize: NC_TYPE.title,
        fontWeight: `var(--nc-fw-semibold, 600)`, color: C.text,
      }}>
        <span className="material-symbols-rounded" style={{ color: C.accent, fontSize: ICON.md }}>system_update_alt</span>
        <span style={{ flex: 1 }}>A new version is ready</span>
      </div>
      <div slot="content" style={{
        fontFamily: NC_FONT_STACK, fontSize: NC_TYPE.body, color: C.muted, lineHeight: 1.55,
      }}>
        Shamash <strong style={{ color: C.text }}>v{pending || ''}</strong> is live. You're running v{APP_VERSION}.
        Updating reloads the app — anything you've typed but not saved will be lost.
      </div>
      <div slot="actions">
        <ActionBtn variant="text" labelColor={C.muted} disabled={applying}
          onClick={() => setPending(null)}>Later</ActionBtn>
        <ActionBtn variant="filled" disabled={applying}
          onClick={() => { setApplying(true); applyUpdate(); }}>
          {applying ? 'Updating…' : 'Update now'}
        </ActionBtn>
      </div>
    </Dialog>
  );
}

export default UpdatePrompt;
