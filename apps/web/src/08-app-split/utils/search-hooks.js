// ── Universal search: the two hooks screens use ─────────────────────────────
//
// A screen that OWNS data publishes it:      useSearchSource("tasks", records);
// A screen that can be JUMPED TO honours it: useSearchReveal("focus");
//
// Both are deliberately tiny. Adding a source to universal search should never
// mean threading props through App.jsx.

import React from 'react';
import {
  publishSearchSource, subscribeSearchReveal, clearSearchReveal,
  SEARCH_FLASH_CLASS, SEARCH_FLASH_MS,
} from './search-registry.js';

/**
 * Publish this screen's records for as long as it is mounted. `records` should
 * be memoised by the caller (useMemo) — this hook republishes whenever the
 * identity changes, and an unmemoised array would republish every render.
 */
export function useSearchSource(sourceId, records) {
  React.useEffect(() => {
    publishSearchSource(sourceId, records || []);
    return () => publishSearchSource(sourceId, []);
  }, [sourceId, records]);
}

/**
 * Scroll to the picked row and flash it. The screen only has to put
 * `data-search-id={id}` on its rows — matching the anchorId the record carried.
 *
 * Retries for a moment: the row may be inside a list that has not painted yet,
 * or below a virtualised cut-off that the screen expands on its own.
 */
export function useSearchReveal(surface, { enabled = true, container = null } = {}) {
  React.useEffect(() => {
    if (!enabled || typeof window === "undefined") return undefined;
    let cancelled = false;
    let timers = [];

    const unsub = subscribeSearchReveal((target) => {
      if (cancelled || target.surface !== surface) return;
      let attempts = 0;
      const tryReveal = () => {
        if (cancelled) return;
        const root = container?.current || document;
        const escaped = String(target.anchorId).replace(/["\\]/g, "\\$&");
        const node = root.querySelector?.(`[data-search-id="${escaped}"]`);
        if (!node) {
          // ~1.5s of retries, then give up quietly — the surface still switched,
          // which is most of the value, and a missing row is not worth an error.
          if (attempts++ < 10) timers.push(setTimeout(tryReveal, 150));
          return;
        }
        clearSearchReveal();
        node.scrollIntoView({ block: "center", behavior: "smooth" });
        node.classList.add(SEARCH_FLASH_CLASS);
        timers.push(setTimeout(() => node.classList.remove(SEARCH_FLASH_CLASS), SEARCH_FLASH_MS));
      };
      tryReveal();
    });

    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
      timers = [];
      unsub();
    };
  }, [surface, enabled, container]);
}
