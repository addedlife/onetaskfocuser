import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { runAIJob } from '../../01-core.js';

const GOOGLE_TOKEN_KEY = 'ot_google_token';
const GOOGLE_EXPIRY_KEY = 'ot_google_token_expiry';
const GOOGLE_CONNECTED_KEY = 'ot_google_connected';
const GOOGLE_SCOPE = 'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/gmail.readonly';
const GOOGLE_TOKEN_SAFETY_MS = 2 * 60 * 1000;
const GOOGLE_REAUTH_DELAY_MS = 800;
const GOOGLE_REFRESH_INTERVAL_MS = 15 * 60 * 1000;

function readStoredGoogleToken() {
  try {
    const token = localStorage.getItem(GOOGLE_TOKEN_KEY);
    const expiry = Number(localStorage.getItem(GOOGLE_EXPIRY_KEY) || 0);
    if (token && expiry > Date.now() + GOOGLE_TOKEN_SAFETY_MS) return token;
    localStorage.removeItem(GOOGLE_TOKEN_KEY);
    localStorage.removeItem(GOOGLE_EXPIRY_KEY);
  } catch {}
  return null;
}

function wasGoogleConnected() {
  try { return localStorage.getItem(GOOGLE_CONNECTED_KEY) === '1'; } catch { return false; }
}

function storeGoogleToken(token, expiresInSeconds = 3600) {
  try {
    const usableMs = Math.max(60, Number(expiresInSeconds) - 120) * 1000;
    localStorage.setItem(GOOGLE_TOKEN_KEY, token);
    localStorage.setItem(GOOGLE_EXPIRY_KEY, String(Date.now() + usableMs));
    localStorage.setItem(GOOGLE_CONNECTED_KEY, '1');
  } catch {}
}

function clearStoredGoogleToken({ keepConnected = true } = {}) {
  try {
    localStorage.removeItem(GOOGLE_TOKEN_KEY);
    localStorage.removeItem(GOOGLE_EXPIRY_KEY);
    if (!keepConnected) localStorage.removeItem(GOOGLE_CONNECTED_KEY);
  } catch {}
}

function sortCalEvents(evts) {
  return [...evts].sort((a, b) => {
    const aAllDay = !a.start?.dateTime;
    const bAllDay = !b.start?.dateTime;
    if (aAllDay !== bAllDay) return aAllDay ? 1 : -1;
    const aKey = a.start?.dateTime || a.start?.date || '';
    const bKey = b.start?.dateTime || b.start?.date || '';
    return aKey < bKey ? -1 : aKey > bKey ? 1 : 0;
  });
}

async function fetchCalendarData(token) {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString();
  const eventsUrl = (calId) => `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events?timeMin=${encodeURIComponent(start)}&timeMax=${encodeURIComponent(end)}&singleEvents=true&orderBy=startTime&maxResults=25`;

  let cals = null;
  try {
    console.log('[Google] Fetching calendar list...');
    const listR = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList?showHidden=false&maxResults=50', { headers: { Authorization: `Bearer ${token}` } });
    console.log('[Google] CalendarList status:', listR.status);
    if (listR.status === 401) throw new Error('token_expired');
    if (listR.ok) {
      const listD = await listR.json();
      cals = (listD.items || []).filter(c => c.selected !== false && c.accessRole !== 'none');
      console.log('[Google] Subscribed calendars:', cals.length);
    }
  } catch (e) {
    if (e.message === 'token_expired') throw e;
    console.warn('[Google] calendarList failed, falling back to primary:', e.message);
  }

  if (!cals || cals.length === 0) {
    const r = await fetch(eventsUrl('primary'), { headers: { Authorization: `Bearer ${token}` } });
    if (r.status === 401) throw new Error('token_expired');
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      throw new Error(`Calendar: ${d?.error?.message || 'HTTP ' + r.status}`);
    }
    const d = await r.json();
    return sortCalEvents(d.items || []).slice(0, 20);
  }

  const results = await Promise.allSettled(
    cals.map(cal =>
      fetch(eventsUrl(cal.id), { headers: { Authorization: `Bearer ${token}` } })
        .then(r => { if (r.status === 401) throw new Error('token_expired'); return r.json(); })
        .then(d => (d.items || []))
    )
  );
  for (const r of results) { if (r.reason?.message === 'token_expired') throw new Error('token_expired'); }
  const seen = new Set();
  const all = results
    .flatMap(r => r.status === 'fulfilled' ? r.value : [])
    .filter(evt => { if (seen.has(evt.id)) return false; seen.add(evt.id); return true; });
  console.log('[Google] Total calendar events after merge:', all.length);
  return sortCalEvents(all).slice(0, 20);
}

async function fetchGmailData(token) {
  console.log('[Google] Fetching Gmail...');
  const q = encodeURIComponent('(category:primary) OR (category:promotions is:important) OR (category:updates is:important)');
  const listR = await fetch(
    `https://www.googleapis.com/gmail/v1/users/me/messages?maxResults=20&q=${q}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  console.log('[Google] Gmail list status:', listR.status);
  if (listR.status === 401) throw new Error('token_expired');
  if (!listR.ok) {
    const d = await listR.json().catch(() => ({}));
    throw new Error(`Gmail: ${d?.error?.message || 'HTTP ' + listR.status}`);
  }
  const list = await listR.json();
  console.log('[Google] Gmail message count:', list.messages?.length ?? 0);
  if (!list.messages?.length) return [];
  const msgs = await Promise.all(
    list.messages.slice(0, 20).map(m =>
      fetch(`https://www.googleapis.com/gmail/v1/users/me/messages/${m.id}?format=metadata&metadataHeaders=Subject&metadataHeaders=From&metadataHeaders=Date`,
        { headers: { Authorization: `Bearer ${token}` } }).then(r => r.json())
    )
  );

  try {
    const emails = msgs.map((m) => {
      const subj = m?.payload?.headers?.find(h => h.name === 'Subject')?.value || '';
      const snip = (m.snippet || '').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim().slice(0, 180);
      return { subject: subj, body: snip };
    });
    const job = await runAIJob("dashboard.email_summaries.v1", { emails }, {});
    const summaries = Array.isArray(job?.output) ? job.output : null;
    if (summaries) {
      return msgs.map((m, i) => ({ ...m, aiSummary: typeof summaries[i] === 'string' ? summaries[i].replace(/^"|"$/g, '') : '' }));
    }
  } catch (e) {
    console.warn('[Google] AI email summary failed:', e.message);
  }
  return msgs;
}

export function useGoogleWorkspace(clientId) {
  const effectiveGoogleClientId = useMemo(() => (clientId || '').trim(), [clientId]);
  const [googleToken, setGoogleToken] = useState(readStoredGoogleToken);
  const [googleWasConnected, setGoogleWasConnected] = useState(wasGoogleConnected);
  const [calendarRefreshKey, setCalendarRefreshKey] = useState(0);
  const [calendarEvents, setCalendarEvents] = useState(null);
  const [gmailMessages, setGmailMessages] = useState(null);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleError, setGoogleError] = useState(null);
  const gTokenClientRef = useRef(null);
  const silentRefreshInFlightRef = useRef(false);

  const requestGoogleToken = useCallback((options = {}) => {
    const prompt = options.prompt;
    if (!gTokenClientRef.current) return false;
    if (prompt === '') silentRefreshInFlightRef.current = true;
    gTokenClientRef.current.requestAccessToken(prompt === undefined ? undefined : { prompt });
    return true;
  }, []);

  useEffect(() => {
    const client = effectiveGoogleClientId;
    if (!client) { gTokenClientRef.current = null; return; }
    function initClient() {
      if (!window.google?.accounts?.oauth2) { console.warn('[Google] GIS loaded but oauth2 not ready'); return; }
      console.log('[Google] initTokenClient');
      gTokenClientRef.current = window.google.accounts.oauth2.initTokenClient({
        client_id: client,
        scope: GOOGLE_SCOPE,
        callback: (resp) => {
          silentRefreshInFlightRef.current = false;
          console.log('[Google] OAuth callback error:', resp.error || 'none', '| has token:', !!resp.access_token);
          if (resp.error) {
            if (resp.error === 'popup_closed_by_user') return;
            if (resp.error === 'access_denied') {
              setGoogleError('Access denied - please approve Calendar and Gmail access in the Google popup.');
              return;
            }
            setGoogleError(resp.error_description || resp.error);
            return;
          }
          console.log('[Google] Token received, length:', resp.access_token?.length);
          setGoogleToken(resp.access_token);
          storeGoogleToken(resp.access_token, resp.expires_in);
          setGoogleWasConnected(true);
          setGoogleError(null);
        },
      });
      console.log('[Google] Token client ready:', !!gTokenClientRef.current);
      if (wasGoogleConnected() && !readStoredGoogleToken()) {
        setTimeout(() => { requestGoogleToken({ prompt: '' }); }, 600);
      }
    }
    if (window.google?.accounts?.oauth2) { initClient(); return; }
    if (document.querySelector('script[src*="accounts.google.com/gsi"]')) {
      const t = setInterval(() => { if (window.google?.accounts?.oauth2) { clearInterval(t); initClient(); } }, 200);
      return () => clearInterval(t);
    }
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = () => { console.log('[Google] GIS script loaded'); initClient(); };
    s.onerror = () => { console.error('[Google] GIS script failed to load'); setGoogleError('Could not load Google sign-in script.'); };
    document.head.appendChild(s);
    console.log('[Google] Loading GIS script...');
  }, [effectiveGoogleClientId, requestGoogleToken]);

  useEffect(() => {
    if (googleToken) return;
    if (!wasGoogleConnected() || silentRefreshInFlightRef.current) return;
    const t = setTimeout(() => { requestGoogleToken({ prompt: '' }); }, GOOGLE_REAUTH_DELAY_MS);
    return () => clearTimeout(t);
  }, [googleToken, requestGoogleToken]);

  useEffect(() => {
    if (!googleToken || !wasGoogleConnected()) return;
    let expiry = 0;
    try { expiry = Number(localStorage.getItem(GOOGLE_EXPIRY_KEY) || 0); } catch {}
    const delay = Math.max(30 * 1000, expiry - Date.now() - GOOGLE_TOKEN_SAFETY_MS);
    const t = setTimeout(() => { requestGoogleToken({ prompt: '' }); }, delay);
    return () => clearTimeout(t);
  }, [googleToken, requestGoogleToken]);

  useEffect(() => {
    if (!googleToken) return;
    let cancelled = false;
    const load = () => {
      if (cancelled) return;
      console.log('[Google] Starting load, token length:', googleToken?.length);
      setGoogleLoading(true);
      Promise.allSettled([fetchCalendarData(googleToken), fetchGmailData(googleToken)])
        .then(([calR, mailR]) => {
          console.log('[Google] Results: cal=', calR.status, 'mail=', mailR.status);
          if (cancelled) { console.log('[Google] cancelled - skipping state update'); return; }
          const errs = [];
          if (calR.status === 'fulfilled') {
            setCalendarEvents(calR.value);
          } else if (calR.reason?.message === 'token_expired') {
            clearStoredGoogleToken({ keepConnected: true });
            setGoogleToken(null);
            requestGoogleToken({ prompt: '' });
            return;
          } else {
            console.error('[Google] cal error:', calR.reason?.message);
            errs.push(calR.reason?.message || 'Calendar error');
            setCalendarEvents(prev => prev ?? []);
          }
          if (mailR.status === 'fulfilled') {
            setGmailMessages(mailR.value);
          } else if (mailR.reason?.message === 'token_expired') {
            clearStoredGoogleToken({ keepConnected: true });
            setGoogleToken(null);
            requestGoogleToken({ prompt: '' });
            return;
          } else {
            console.error('[Google] mail error:', mailR.reason?.message);
            errs.push(mailR.reason?.message || 'Gmail error');
            setGmailMessages(prev => prev ?? []);
          }
          if (errs.length) setGoogleError(errs.join(' · '));
        })
        .finally(() => { if (!cancelled) setGoogleLoading(false); });
    };
    load();
    const t = setInterval(load, GOOGLE_REFRESH_INTERVAL_MS);
    return () => { cancelled = true; clearInterval(t); };
  }, [googleToken, calendarRefreshKey, requestGoogleToken]);

  const connectGoogle = useCallback(() => {
    if (!effectiveGoogleClientId) {
      setGoogleError('Google connector needs a Google OAuth Client ID in Settings > Google.');
      return;
    }
    if (!gTokenClientRef.current) {
      console.warn('[Google] connectGoogle: token client not ready');
      setGoogleError('Google sign-in not ready - wait a moment and try again.');
      return;
    }
    console.log('[Google] Requesting access token...');
    setGoogleError(null);
    requestGoogleToken();
  }, [effectiveGoogleClientId, requestGoogleToken]);

  const disconnectGoogle = useCallback(() => {
    setGoogleToken(null);
    setCalendarEvents(null);
    setGmailMessages(null);
    setGoogleError(null);
    setGoogleWasConnected(false);
    clearStoredGoogleToken({ keepConnected: false });
  }, []);

  const refreshCalendar = useCallback(() => setCalendarRefreshKey(k => k + 1), []);

  return {
    calendarEvents,
    connectGoogle,
    disconnectGoogle,
    effectiveGoogleClientId,
    gmailMessages,
    googleError,
    googleLoading,
    googleToken,
    googleWasConnected,
    refreshCalendar,
  };
}
