import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Dialog,
  OutlinedTextField,
  Slider,
  LinearProgress,
  List,
  ListItem,
  FilledButton,
  OutlinedButton,
  TextButton,
} from '../m3.jsx';
import { GV_CLEAN } from '../ui-tokens.jsx';

// Bulk SMS sender — shared by both phone surfaces (NerveCenter WebPhone and the
// standalone DeskPhone screen). Paste a list of numbers + one message; it pushes
// each through the surface's own /send transport, paced so the Bluetooth MAP
// bridge (one SMS at a time) isn't overrun. The caller supplies `sendOne`, so
// this component is transport-agnostic — it rides whichever path the host gave
// it (direct = "live", relay = "fallback").
//
// Spacing uses the app design tokens with a literal fallback: the standalone
// DeskPhone document doesn't load App.jsx, so --shp-* isn't injected there. The
// fallback is the token's canonical value, never a stray magic number. Colors
// come from GV_CLEAN literals (safe everywhere); the M3 components self-theme via
// --md-sys-* which both documents define.
const SPC = {
  xs: 'var(--shp-space-xs, 4px)',
  sm: 'var(--shp-space-sm, 8px)',
  md: 'var(--shp-space-md, 12px)',
  lg: 'var(--shp-space-lg, 16px)',
};
const RAD = { sm: 'var(--shp-radius-sm, 8px)', md: 'var(--shp-radius-md, 12px)' };

// Split the pasted blob into clean E.164-ish numbers. Accepts newline / comma /
// semicolon / pipe separators and the usual human formatting (spaces, dashes,
// dots, parens). Returns the deduped list plus counts of what was dropped.
export function parseBulkRecipients(text) {
  const seen = new Set();
  const recipients = [];
  let invalid = 0;
  let dupes = 0;
  const chunks = String(text || '').split(/[\n,;|]+/);
  for (const chunk of chunks) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;
    // Keep digits and a single leading +; strip everything else.
    let number = trimmed.replace(/[^\d+]/g, '');
    number = number.replace(/(?!^)\+/g, '');
    const digits = number.replace(/\D/g, '');
    if (digits.length < 7) { invalid += 1; continue; }
    if (seen.has(number)) { dupes += 1; continue; }
    seen.add(number);
    recipients.push({ number, raw: trimmed });
  }
  return { recipients, invalid, dupes };
}

function smsSegments(body) {
  const len = body.length;
  if (!len) return 0;
  return len <= 160 ? 1 : Math.ceil(len / 153);
}

const STATUS_META = {
  pending: { label: 'Waiting', color: GV_CLEAN.faint },
  sending: { label: 'Sending…', color: GV_CLEAN.accent },
  sent: { label: 'Sent ✓', color: GV_CLEAN.success },
  failed: { label: 'Failed', color: GV_CLEAN.danger },
};

const DELAY_KEY = 'bulk_texter_delay_sec';

export default function BulkTexter({
  open,
  onClose,
  sendOne,             // async ({ to, body }) => boolean
  usingRelay = false,  // true when the active transport is the cloud relay (fallback)
  online = true,       // is the phone host reachable / live connection (same as surface indicator)
  onBatchDone,         // optional: called once after a batch so the surface can refresh
}) {
  const [numbersText, setNumbersText] = useState('');
  const [message, setMessage] = useState('');
  const [delaySec, setDelaySec] = useState(() => {
    try { const v = parseFloat(localStorage.getItem(DELAY_KEY)); return Number.isFinite(v) ? v : 0.8; }
    catch { return 0.8; }
  });
  const [phase, setPhase] = useState('compose');      // compose | confirm | sending | done
  const [statuses, setStatuses] = useState({});       // number -> pending|sending|sent|failed
  const [stopping, setStopping] = useState(false);
  const [stoppedEarly, setStoppedEarly] = useState(false);
  const stopRef = useRef(false);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  const { recipients, invalid, dupes } = useMemo(() => parseBulkRecipients(numbersText), [numbersText]);
  const segments = smsSegments(message.trim());

  // Reopening from a finished/idle state starts a clean compose (but never yanks a
  // batch that's still in flight).
  useEffect(() => {
    if (open && phaseRef.current !== 'sending') {
      setPhase('compose');
      setStatuses({});
      setStopping(false);
      setStoppedEarly(false);
    }
  }, [open]);

  useEffect(() => {
    try { localStorage.setItem(DELAY_KEY, String(delaySec)); } catch {}
  }, [delaySec]);

  const counts = useMemo(() => {
    let sent = 0; let failed = 0; let done = 0;
    for (const value of Object.values(statuses)) {
      if (value === 'sent') { sent += 1; done += 1; }
      else if (value === 'failed') { failed += 1; done += 1; }
    }
    return { sent, failed, done };
  }, [statuses]);

  const runBatch = useCallback(async (list) => {
    if (!list.length) return;
    const body = message.trim();
    const delayMs = Math.max(0, Math.round(delaySec * 1000));
    stopRef.current = false;
    setStopping(false);
    setStoppedEarly(false);
    setStatuses(() => {
      const init = {};
      list.forEach((r) => { init[r.number] = 'pending'; });
      return init;
    });
    setPhase('sending');
    for (let i = 0; i < list.length; i += 1) {
      if (stopRef.current) { setStoppedEarly(true); break; }
      const r = list[i];
      setStatuses((s) => ({ ...s, [r.number]: 'sending' }));
      let ok = false;
      try { ok = await sendOne({ to: r.number, body }); } catch { ok = false; }
      setStatuses((s) => ({ ...s, [r.number]: ok ? 'sent' : 'failed' }));
      if (i < list.length - 1 && !stopRef.current && delayMs > 0) {
        await new Promise((res) => setTimeout(res, delayMs));
      }
    }
    try { onBatchDone?.(); } catch {}
    setStopping(false);
    setPhase('done');
  }, [message, delaySec, sendOne, onBatchDone]);

  const failedRecipients = useMemo(
    () => recipients.filter((r) => statuses[r.number] === 'failed'),
    [recipients, statuses],
  );

  const requestStop = useCallback(() => {
    stopRef.current = true;
    setStopping(true);
  }, []);

  const handleDialogClosed = useCallback(() => {
    // ESC / scrim / programmatic close all land here. Never abandon a live batch
    // silently — flag it to stop, then let the parent hide us.
    if (phaseRef.current === 'sending') stopRef.current = true;
    onClose?.();
  }, [onClose]);

  const canSend = recipients.length > 0 && message.trim().length > 0 && !!online;
  const transportNote = usingRelay
    ? 'Fallback route (cloud relay) — sends are paced one at a time as your PC drains them.'
    : 'Live route (direct to your PC) — sends as fast as the Bluetooth bridge allows.';

  const fieldStyle = { width: '100%', marginBottom: SPC.md };
  const noteStyle = { fontSize: 12, color: GV_CLEAN.muted, fontFamily: 'inherit', margin: `0 0 ${SPC.md}` };

  return createPortal(
    <Dialog open={open} onClosed={handleDialogClosed} aria-label="Bulk text">
      <div slot="headline" style={{ fontFamily: 'inherit' }}>Bulk text</div>

      <div slot="content" style={{ width: 'min(540px, 84vw)', fontFamily: 'inherit', color: GV_CLEAN.text }}>
        <p style={{ ...noteStyle, color: usingRelay ? GV_CLEAN.warning : GV_CLEAN.muted }}>{transportNote}</p>
        {!online && (
          <p style={{ ...noteStyle, color: GV_CLEAN.danger }}>
            No live phone connection for texts (MAP not connected). Sends will fail.
          </p>
        )}

        {(phase === 'compose' || phase === 'confirm') && (
          <>
            <OutlinedTextField
              label="Phone numbers"
              type="textarea"
              rows={4}
              value={numbersText}
              disabled={phase === 'confirm'}
              onInput={(e) => setNumbersText(e.target.value)}
              placeholder="Paste numbers — one per line, or comma-separated"
              style={fieldStyle}
            />
            <p style={noteStyle}>
              <strong style={{ color: GV_CLEAN.text }}>{recipients.length}</strong> recipient{recipients.length === 1 ? '' : 's'}
              {dupes > 0 ? ` · ${dupes} duplicate${dupes === 1 ? '' : 's'} removed` : ''}
              {invalid > 0 ? ` · ${invalid} skipped` : ''}
            </p>

            <OutlinedTextField
              label="Message"
              type="textarea"
              rows={4}
              value={message}
              disabled={phase === 'confirm'}
              onInput={(e) => setMessage(e.target.value)}
              placeholder="Type the text everyone gets"
              style={fieldStyle}
            />
            <p style={noteStyle}>
              {message.trim().length} chars · ~{segments} SMS each
              {recipients.length > 0 ? ` · ${recipients.length} text${recipients.length === 1 ? '' : 's'} total` : ''}
            </p>

            <div style={{ display: 'flex', alignItems: 'center', gap: SPC.md }}>
              <span style={{ fontSize: 12, color: GV_CLEAN.muted, fontFamily: 'inherit', whiteSpace: 'nowrap' }}>
                Gap between texts: <strong style={{ color: GV_CLEAN.text }}>{delaySec.toFixed(1)}s</strong>
              </span>
              <Slider
                min={0}
                max={5}
                step={0.1}
                value={delaySec}
                labeled
                disabled={phase === 'confirm'}
                onInput={(e) => setDelaySec(Number(e.target.value))}
                style={{ flex: 1 }}
              />
            </div>
            <p style={{ ...noteStyle, marginBottom: 0 }}>
              Lower = faster. If your phone starts dropping texts, raise it.
            </p>

            {phase === 'confirm' && (
              <div style={{ marginTop: SPC.lg, padding: SPC.md, borderRadius: RAD.md, background: GV_CLEAN.bgSoft }}>
                <p style={{ margin: 0, fontFamily: 'inherit', color: GV_CLEAN.text }}>
                  Send this message to <strong>{recipients.length}</strong> number{recipients.length === 1 ? '' : 's'}?
                </p>
                <p style={{ margin: `${SPC.xs} 0 0`, fontSize: 12, color: GV_CLEAN.muted, fontFamily: 'inherit' }}>
                  These are real texts sent from your phone. They can’t be unsent.
                </p>
              </div>
            )}
          </>
        )}

        {(phase === 'sending' || phase === 'done') && (
          <>
            <div style={{ marginBottom: SPC.sm }}>
              <LinearProgress
                value={recipients.length ? counts.done / recipients.length : 0}
                style={{ width: '100%' }}
              />
            </div>
            <p style={{ ...noteStyle, marginBottom: SPC.sm }}>
              {phase === 'done'
                ? `${stoppedEarly ? 'Stopped — ' : 'Done — '}${counts.sent} sent · ${counts.failed} failed`
                : `Sending ${counts.done}/${recipients.length} · ${counts.sent} sent · ${counts.failed} failed`}
            </p>
            <List style={{ maxHeight: 220, overflowY: 'auto', borderRadius: RAD.sm, background: GV_CLEAN.bgSoft }}>
              {recipients.map((r) => {
                const meta = STATUS_META[statuses[r.number] || 'pending'];
                return (
                  <ListItem key={r.number}>
                    <div slot="headline" style={{ fontFamily: 'inherit' }}>{r.number}</div>
                    <div slot="end" style={{ fontSize: 12, fontWeight: 600, color: meta.color, fontFamily: 'inherit' }}>
                      {meta.label}
                    </div>
                  </ListItem>
                );
              })}
            </List>
          </>
        )}
      </div>

      <div slot="actions" style={{ display: 'flex', gap: SPC.sm, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        {phase === 'compose' && (
          <>
            <TextButton onClick={() => onClose?.()}><span>Close</span></TextButton>
            <FilledButton disabled={!canSend} onClick={() => setPhase('confirm')}>
              <span>Send {recipients.length || ''}</span>
            </FilledButton>
          </>
        )}
        {phase === 'confirm' && (
          <>
            <OutlinedButton onClick={() => setPhase('compose')}><span>Back</span></OutlinedButton>
            <FilledButton onClick={() => runBatch(recipients)}><span>Send now</span></FilledButton>
          </>
        )}
        {phase === 'sending' && (
          <FilledButton disabled={stopping} onClick={requestStop}>
            <span>{stopping ? 'Stopping…' : 'Stop'}</span>
          </FilledButton>
        )}
        {phase === 'done' && (
          <>
            <TextButton onClick={() => onClose?.()}><span>Close</span></TextButton>
            {failedRecipients.length > 0 && (
              <OutlinedButton onClick={() => runBatch(failedRecipients)}>
                <span>Retry failed ({failedRecipients.length})</span>
              </OutlinedButton>
            )}
            <FilledButton onClick={() => { setPhase('compose'); setStatuses({}); }}>
              <span>New batch</span>
            </FilledButton>
          </>
        )}
      </div>
    </Dialog>,
    document.body
  );
}
