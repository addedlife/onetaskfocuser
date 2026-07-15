// Verifies search-result links actually resolve before they reach the user.
// Search engines occasionally serve stale index entries whose pages have
// since been removed or moved (404/410) — this drops those. Fails open: if
// every link in a non-empty batch comes back unreachable (e.g. an outbound
// network hiccup), the original unfiltered list is returned rather than
// leaving the caller with nothing — search results must never dead-end.

const TIMEOUT_MS = 4000;
const MAX_CONCURRENCY = 6;
const DEAD_STATUSES = new Set([404, 410]);

async function checkOne(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let r = await fetch(url, { method: "HEAD", redirect: "follow", signal: controller.signal });
    // Some servers reject HEAD outright — retry with GET before judging it dead.
    if (r.status === 405 || r.status === 501) {
      r = await fetch(url, { method: "GET", redirect: "follow", signal: controller.signal });
    }
    return { dead: DEAD_STATUSES.has(r.status), resolvedUrl: r.url || url };
  } catch {
    return { dead: true, resolvedUrl: url };
  } finally {
    clearTimeout(timer);
  }
}

async function runInspection(results, { rewriteLink }) {
  if (!results.length) return results;
  const checks = new Array(results.length);
  let next = 0;
  async function worker() {
    while (next < results.length) {
      const i = next++;
      checks[i] = await checkOne(results[i].link);
    }
  }
  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENCY, results.length) }, worker));
  const kept = results
    .map((r, i) => (checks[i].dead ? null : (rewriteLink ? { ...r, link: checks[i].resolvedUrl } : r)))
    .filter(Boolean);
  return kept.length ? kept : results;
}

// Drops dead links, keeps the original URL as-is.
async function inspectLinks(results) {
  return runInspection(results, { rewriteLink: false });
}

// Drops dead links AND rewrites the link to its final resolved destination —
// for sources like Gemini grounding chunks, whose URIs are Google redirect
// wrappers (vertexaisearch.cloud.google.com/...) that can expire after a
// few days, so the durable real URL should be stored instead of the wrapper.
async function resolveAndInspectLinks(results) {
  return runInspection(results, { rewriteLink: true });
}

module.exports = { inspectLinks, resolveAndInspectLinks };
