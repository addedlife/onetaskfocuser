// Single source of truth for "who should hold the phone." v1 had this scoring
// algorithm hand-ported three times (JS/C#/Kotlin) with a documented,
// self-acknowledged drift risk. This module imports the ORIGINAL, already
// unit-tested phone-link.js implementation directly (see
// scripts/sync-phone-link.mjs for why it's a vendored copy, not a relative
// reach outside the functions bundle) — there is exactly one implementation
// of the scoring math left; native hosts no longer compute it at all, they
// just report presence and obey whatever this module decides.
const path = require("path");
const url = require("url");

let _phoneLinkPromise = null;
function loadPhoneLink() {
  if (!_phoneLinkPromise) {
    const filePath = path.join(__dirname, "vendor", "phone-link.mjs");
    _phoneLinkPromise = import(url.pathToFileURL(filePath).href);
  }
  return _phoneLinkPromise;
}

// Computes the next leader given the current presence snapshot. Only bumps
// the fencing token when the leader actually changes (including changing to
// "nobody qualifies") — a stable leader keeps its token across repeated
// presence heartbeats, so tokens are cheap to check on every command/state
// write without becoming a source of needless churn.
async function computeLeader({ presence = {}, currentLeader = null, now = Date.now() }) {
  const { chooseAutoHost, BT_CAPABLE_HOSTS } = await loadPhoneLink();
  const hosts = {};
  for (const id of BT_CAPABLE_HOSTS) {
    const entry = presence[id];
    if (entry) {
      hosts[id] = {
        t: Number(entry.t) || 0,
        connected: !!entry.connected,
        quality: Number(entry.quality) || 0,
      };
    }
  }
  const currentHostId = currentLeader?.hostId || "";
  const bestId = chooseAutoHost({ hosts, now, currentHostId });

  if (bestId === currentHostId) {
    return {
      hostId: bestId,
      fencingToken: currentLeader?.fencingToken || 0,
      since: currentLeader?.since || now,
      changed: false,
    };
  }
  return {
    hostId: bestId,
    fencingToken: (Number(currentLeader?.fencingToken) || 0) + 1,
    since: now,
    changed: true,
  };
}

module.exports = { loadPhoneLink, computeLeader };
