// Verifies search-result links actually resolve before they reach the user.
// Search engines occasionally serve stale index entries whose pages have
// since been removed or moved (404/410) — this drops those. Fails open: if
// every link in a non-empty batch comes back unreachable (e.g. an outbound
// network hiccup), the original unfiltered list is returned rather than
// leaving the caller with nothing — search results must never dead-end.

const TIMEOUT_MS = 4000;
const MAX_CONCURRENCY = 6;
const DEAD_STATUSES = new Set([404, 410]);

async function isDead(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    let r = await fetch(url, { method: "HEAD", redirect: "follow", signal: controller.signal });
    // Some servers reject HEAD outright — retry with GET before judging it dead.
    if (r.status === 405 || r.status === 501) {
      r = await fetch(url, { method: "GET", redirect: "follow", signal: controller.signal });
    }
    return DEAD_STATUSES.has(r.status);
  } catch {
    return true;
  } finally {
    clearTimeout(timer);
  }
}

async function inspectLinks(results) {
  if (!results.length) return results;
  const dead = new Array(results.length).fill(false);
  let next = 0;
  async function worker() {
    while (next < results.length) {
      const i = next++;
      dead[i] = await isDead(results[i].link);
    }
  }
  await Promise.all(Array.from({ length: Math.min(MAX_CONCURRENCY, results.length) }, worker));
  const kept = results.filter((_, i) => !dead[i]);
  return kept.length ? kept : results;
}

module.exports = { inspectLinks };
