/**
 * AI gateway (client side). Every AI call goes through the serverless proxy at /api/ai-proxy so API
 * keys never touch the browser. The proxy is JOB-BASED: the client sends `{ job, input }` (or a raw
 * text prompt) and the prompt templates + provider routing live server-side (Phase 11). Faithful to
 * Pro 4's 01-core.js gateway; default provider is Claude (owner preference), with prompt caching on.
 *
 * Job-specific functions that format tasks/conversations (optimize, conversation-extract) land with
 * their features; the self-contained jobs are here now.
 */

import type { AiProvider } from '@/lib/types';

export const AI_PROXY_ENDPOINT = '/api/ai-proxy';
const AI_PROXY_TIMEOUT_MS = 30_000;
const DEFAULT_PROVIDER: AiProvider = 'claude';
const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

export interface AiOpts {
  provider?: AiProvider;
  model?: string;
  task?: string;
  mode?: string;
  geminiCredential?: string;
}

interface AiResponse {
  text?: string;
  output?: unknown;
  error?: unknown;
  [key: string]: unknown;
}

/**
 * The auth layer injects a token getter so this module has no hard Firebase dependency. When unset (dev
 * mock user), requests go without a token and the gateway answers 401 → we degrade to null, same as a timeout.
 */
let idTokenProvider: (() => Promise<string | null>) | null = null;
export function setIdTokenProvider(fn: () => Promise<string | null>): void {
  idTokenProvider = fn;
}

async function callAIProxy(
  payload: Record<string, unknown>,
  timeoutMs = AI_PROXY_TIMEOUT_MS,
): Promise<AiResponse | null> {
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    try {
      const tok = idTokenProvider ? await idTokenProvider() : null;
      if (tok) headers['Authorization'] = `Bearer ${tok}`;
    } catch {
      /* token fetch failed → gateway will 401 → handled below */
    }
    const r = await fetch(AI_PROXY_ENDPOINT, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: ctrl?.signal,
    });
    const d = (await r.json().catch(() => ({}))) as AiResponse;
    if (!r.ok || d.error) {
      console.warn('[AI] gateway error:', d.error || r.statusText);
      return null;
    }
    return d;
  } catch (e) {
    const aborted = e instanceof DOMException && e.name === 'AbortError';
    console.warn('[AI] gateway call failed:', aborted ? `timed out after ${timeoutMs}ms` : e);
    return null;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function normalize(opts?: AiOpts): AiOpts {
  return { provider: DEFAULT_PROVIDER, model: DEFAULT_MODEL, ...(opts ?? {}) };
}

/** Named-job dispatcher (Pro 4 `runAIJob`). Returns the full response (`.output`/`.text`) or null. */
export async function runAIJob(
  job: string,
  input: Record<string, unknown> = {},
  opts?: AiOpts,
  options: { mode?: string; genConfig?: Record<string, unknown> } = {},
): Promise<AiResponse | null> {
  const o = normalize(opts);
  return callAIProxy({
    job,
    input,
    mode: options.mode ?? o.mode,
    provider: o.provider,
    model: o.model,
    geminiCredential: o.geminiCredential,
    genConfig: options.genConfig,
  });
}

/** Raw text dispatcher (Pro 4 `callAI`). Returns the text or null. */
export async function callAI(
  prompt: string,
  opts?: AiOpts,
  genConfig: Record<string, unknown> = {},
): Promise<string | null> {
  const o = normalize(opts);
  const d = await callAIProxy({
    kind: 'text',
    task: o.task ?? 'general',
    provider: o.provider,
    model: o.model,
    geminiCredential: o.geminiCredential,
    prompt,
    genConfig,
  });
  return d?.text ?? null;
}

const stripQuotes = (s: string): string => s.replace(/^["'`]+|["'`]+$/g, '').trim();

/** AI first-step suggestion (job `task.first_step.v1`) — one crisp action sentence. */
export async function suggestFirstStep(taskText: string, opts?: AiOpts): Promise<string | null> {
  const job = await runAIJob('task.first_step.v1', { taskText }, opts);
  const text = typeof job?.text === 'string' ? job.text : '';
  return text ? stripQuotes(text) : null;
}

/** Short summary of a shaila answer (job `shaila.answer_summary.v1`). */
export async function aiSummarizeAnswer(answerText: string, opts?: AiOpts): Promise<string> {
  const job = await runAIJob('shaila.answer_summary.v1', { answerText }, opts, {
    genConfig: { temperature: 0.1, maxOutputTokens: 24 },
  });
  return typeof job?.text === 'string' ? stripQuotes(job.text) : '';
}

const DEFAULT_CALENDAR_TIME_ZONE = 'America/New_York';

function dateTimeHasExplicitZone(value: unknown): boolean {
  return /(?:z|[+-]\d{2}:?\d{2})$/i.test(String(value ?? '').trim());
}

/** Add the app's calendar defaults (timezone + reminders) to an AI-parsed event body (Pro 4). */
export function withCalendarEventDefaults(
  eventBody: Record<string, unknown>,
  defaultTimeZone = DEFAULT_CALENDAR_TIME_ZONE,
): Record<string, unknown> {
  const event = { ...(eventBody ?? {}) };
  delete event.defaultTimeZone;
  delete event.timeZone;
  const applyZone = (part: unknown): unknown => {
    if (!part || typeof part !== 'object') return part;
    const next = { ...(part as Record<string, unknown>) };
    if (next.dateTime && !next.timeZone && !dateTimeHasExplicitZone(next.dateTime)) {
      next.timeZone = defaultTimeZone;
    }
    return next;
  };
  return {
    ...event,
    start: applyZone(event.start),
    end: applyZone(event.end),
    reminders: event.reminders ?? { useDefault: false, overrides: [] },
  };
}

/** Parse a natural-language event into a Google Calendar event body (job `schedule.parse_event.v1`). */
export async function aiParseCalendarEvent(
  description: string,
  opts?: AiOpts,
  options: { defaultTimeZone?: string; today?: string } = {},
): Promise<Record<string, unknown>> {
  const defaultTimeZone = options.defaultTimeZone ?? DEFAULT_CALENDAR_TIME_ZONE;
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const job = await runAIJob(
    'schedule.parse_event.v1',
    { today, description, defaultTimeZone },
    opts,
    { genConfig: { maxOutputTokens: 700 } },
  );
  if (!job?.output || typeof job.output !== 'object') {
    throw new Error('Could not parse event — try rephrasing.');
  }
  return withCalendarEventDefaults(job.output as Record<string, unknown>, defaultTimeZone);
}
