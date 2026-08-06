// ── Universal search: turning app data into searchable records, and ranking ──
//
// One normaliser per source. Each returns records shaped:
//   { id, source, title, subtitle, when, surface, anchorId, haystack }
//     surface  — which rail destination shows it ("focus", "nervecenter", …)
//     anchorId — the row's `data-search-id`, so the screen can scroll to it
//     haystack — everything searchable, pre-lowercased once at build time
//
// Nothing here reaches for data; callers pass in what they already hold.

const MAX_HAYSTACK = 600;   // a whole email body would dominate ranking for no gain

/** Message anchors are "conversationKey::messageId" — see messageRecords(). */
export const MESSAGE_ANCHOR_SEP = "::";

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function decodeEntities(value) {
  return clean(value)
    .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, " ");
}

function record({ id, source, title, subtitle = "", when = 0, surface, anchorId, extra = "" }) {
  const head = clean(title);
  if (!head) return null;
  return {
    id: `${source}:${id}`,
    source,
    title: head,
    subtitle: clean(subtitle),
    when: Number(when) || 0,
    surface,
    anchorId: String(anchorId ?? id),
    haystack: `${head} ${subtitle} ${extra}`.slice(0, MAX_HAYSTACK).toLowerCase(),
  };
}

const gmailHeader = (msg, name) => msg?.payload?.headers?.find(h => h.name === name)?.value || "";

// Gmail's From is "Some Name <a@b.com>" — the name is what the owner scans for.
function fromName(raw) {
  const value = clean(raw);
  const named = value.match(/^\s*"?([^"<]+?)"?\s*</);
  return named ? clean(named[1]) : value;
}

function taskTitle(task) {
  // Subtasks keep their own text and the parent's name in parentTask; show the
  // subtask's own words so sibling steps don't all read as the parent.
  if (task?.parentTask && task?.text) return task.text;
  return task?.parentTask || task?.shaila || task?.question || task?.text || "";
}

export function taskRecords(tasks = [], priorities = []) {
  const priName = id => priorities.find(p => p?.id === id)?.name || "";
  return (tasks || []).map(task => record({
    id: task?.id,
    source: "tasks",
    title: taskTitle(task),
    subtitle: [priName(task?.pri), task?.parentTask && task?.text ? `in ${task.parentTask}` : ""]
      .filter(Boolean).join(" · "),
    when: task?.updatedAt || task?.createdAt || 0,
    surface: "focus",
    anchorId: task?.id,
    extra: `${task?.notes || ""} ${task?.who || ""}`,
  })).filter(Boolean);
}

/** Rows as buildNerveShailaRows() produces them: { id, shailaId, parentTask, tasks }. */
export function shailaRecords(rows = []) {
  return (rows || []).map(row => record({
    id: row?.id,
    source: "shailos",
    title: row?.parentTask || row?.shaila || row?.text || "",
    subtitle: row?.sourceShaila?.who || row?.sourceShaila?.asker || "",
    when: row?.createdAt || 0,
    surface: "shailos",
    anchorId: row?.shailaId || row?.id,
    extra: (row?.tasks || []).map(t => t?.text || "").join(" "),
  })).filter(Boolean);
}

export function mailRecords(messages = []) {
  return (messages || []).map(msg => record({
    id: msg?.id,
    source: "mail",
    title: gmailHeader(msg, "Subject") || "(no subject)",
    subtitle: fromName(gmailHeader(msg, "From")),
    when: Number(msg?.internalDate) || 0,
    surface: "nervecenter",
    anchorId: msg?.id,
    extra: `${decodeEntities(msg?.snippet)} ${msg?.aiSummary || ""} ${gmailHeader(msg, "From")}`,
  })).filter(Boolean);
}

export function calendarRecords(events = []) {
  return (events || []).map(evt => {
    const startRaw = evt?.start?.dateTime || evt?.start?.date || "";
    const start = startRaw ? new Date(startRaw) : null;
    const when = start && !isNaN(start.getTime()) ? start.getTime() : 0;
    return record({
      id: evt?.id,
      source: "calendar",
      title: evt?.summary || "(no title)",
      subtitle: when
        ? new Date(when).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
        : "",
      when,
      surface: "nervecenter",
      anchorId: evt?.id,
      extra: `${evt?.location || ""} ${evt?.description || ""}`,
    });
  }).filter(Boolean);
}

/**
 * Phone threads, in the shape buildConversations() produces: each conversation
 * has displayName/number and a messages[] of normalised messages.
 */
export function messageRecords(conversations = []) {
  const out = [];
  for (const thread of conversations || []) {
    const number = thread?.number || "";
    const who = thread?.displayName || thread?.formattedPhone || number;
    for (const msg of thread?.messages || []) {
      const body = clean(msg?.body || msg?.preview);
      if (!body) continue;
      out.push(record({
        id: msg?.id,
        source: "messages",
        title: body,
        subtitle: `${msg?.isSent ? "You → " : ""}${who}`,
        when: Number(msg?.timestampMs) || 0,
        surface: "deskphone",
        // The thread has to be OPENED before the message exists in the DOM, so
        // the anchor carries both halves: which conversation, then which row.
        anchorId: `${thread?.key || ""}${MESSAGE_ANCHOR_SEP}${msg?.id}`,
        extra: `${number} ${who}`,
      }));
    }
  }
  return out.filter(Boolean);
}

// TaskRiver and the Bug Log are deliberately NOT sources. TaskRiver renders the
// same tasks under a different lens, so indexing it would double every task hit;
// the Bug Log is a modal with no addressable row to jump to, so a result there
// could switch surface but never land on the ticket. Both become one-line
// additions here the day they have a row worth jumping to.

// ── Matching and ranking ────────────────────────────────────────────────────
//
// Substring first — it is what the owner means nine times in ten — with a
// subsequence fallback so "shvz" still finds "Shabbos vort". Deliberately not
// a fuzzy library: the whole corpus is a few thousand short strings, a scan
// costs well under a millisecond, and there is no index to keep in sync.

const RECENT_MS = 7 * 24 * 60 * 60 * 1000;

function subsequenceScore(haystack, needle) {
  let hi = 0, hits = 0, streak = 0, best = 0;
  for (let ni = 0; ni < needle.length; ni++) {
    const found = haystack.indexOf(needle[ni], hi);
    if (found === -1) return 0;
    streak = found === hi ? streak + 1 : 1;
    best = Math.max(best, streak);
    hi = found + 1;
    hits++;
  }
  return hits === needle.length ? 8 + best : 0;
}

function scoreOne(rec, needle, { allowSubsequence = false } = {}) {
  const title = rec.title.toLowerCase();
  const at = title.indexOf(needle);
  let score = 0;
  if (at === 0) score = 100;                                   // title starts with it
  else if (at > 0) score = title[at - 1] === " " ? 80 : 60;     // word start beats mid-word
  else if (rec.haystack.includes(needle)) score = 40;           // body/sender/notes hit
  // Subsequence is a LAST resort, on the title only. Run against the full
  // haystack it matched almost everything — "dra" hit "Pick up the dry
  // cleaning" — so it is reached only when nothing matched literally.
  else if (allowSubsequence && needle.length >= 3) score = subsequenceScore(title, needle);
  if (!score) return 0;
  // Recency nudge only — it breaks ties, it never outranks a better text match.
  if (rec.when && Date.now() - rec.when < RECENT_MS) score += 6;
  if (rec.title.length < 60) score += 2;                        // short, scannable titles first
  return score;
}

/**
 * Rank records against a query.
 * @returns [{ source, label, results: [...] }] grouped, groups in source order.
 */
export function rankSearchResults(query, records, { perSource = 8, sources = null } = {}) {
  const needle = clean(query).toLowerCase();
  if (needle.length < 2) return [];
  const pool = (sources && sources.length)
    ? records.filter(rec => sources.includes(rec.source))
    : records;

  const collect = (allowSubsequence) => {
    const found = new Map();
    for (const rec of pool) {
      const score = scoreOne(rec, needle, { allowSubsequence });
      if (!score) continue;
      if (!found.has(rec.source)) found.set(rec.source, []);
      found.get(rec.source).push({ ...rec, score });
    }
    return found;
  };

  // Literal matches first; only a completely empty result set falls back to the
  // looser typo-tolerant pass, so a good query is never diluted by fuzz.
  let groups = collect(false);
  if (groups.size === 0) groups = collect(true);
  const out = [];
  for (const [source, hits] of groups) {
    hits.sort((a, b) => b.score - a.score || b.when - a.when);
    out.push({ source, results: hits.slice(0, perSource), total: hits.length });
  }
  return out;
}

/** Flat, in display order — what keyboard navigation walks. */
export function flattenSearchGroups(groups) {
  return groups.flatMap(group => group.results);
}
