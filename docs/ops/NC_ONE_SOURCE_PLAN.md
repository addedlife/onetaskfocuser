# NerveCenter — one render source

**Status:** Tiers 1 and 2 **shipped** 2026-08-04 (4.114.14, 4.114.15). Tier 3 hold lifted by
the owner the same day ("do it now, all 3 in one pass") and its structural half shipped as
4.114.16 — see §6 for exactly what landed, what did not, and why.
**Owner ask, verbatim:** *"maybe the different card formats should always pull from same
render source — it's just a card resize shouldn't need new structures, check industry
standard."*

This is a handoff. It is written so a fresh session can start at step 1 without
re-deriving anything. Read `docs/ops/MAP.md` first (standing routing), then this.

---

## 1. Why this exists — the incident that produced it

Tickets `mEyXdMpnpv411HyWo8Eg` and `s0wx0jmnqGL5C4ESV4mk`: pinned tasks were not on top
of the NerveCenter task card.

4.114.11 "fixed" it by adding `orderPinnedFirst()` and pointing the stacked list and the
desktop list at it. The owner reopened the ticket: the mobile card was unchanged. The
cause was not a missed line — it was the architecture. **The surface renders its task
list in three separate places, and one of them re-derived the order privately:**

```js
// line ~1994 — the mobile/boxes card's own list
const actionTasks = useMemo(() => {
  const w = t => Number((priorities.find(p => p.id === t.priority) || {}).weight || 0);
  return [...primaryTaskQueue].sort((a, b) => w(b) - w(a));   // ← threw the pins away
}, [primaryTaskQueue, priorities]);
```

The re-sort sat ~400 lines from the render that consumed it and ~1,500 lines from the
fix that it silently undid. Nothing could have caught that by review. 4.114.13 fixed the
sort; **this document is about making the class of bug impossible.**

Second-order damage worth recording: the false "fixed" note on the twin ticket reasoned
*"mobile and tablet cards are the same component, so it's covered."* That is true of the
component and false of the render. The architecture actively misleads the person working
on it.

---

## 2. Current state (measured 2026-08-04, at commit `8575ac46`)

`apps/web/src/08-app-split/components/NerveCenter.jsx` — **4,976 lines.**

Three top-level render branches draw the same five cards (Tasks, Mail, Shailos,
Calendar, Phone):

| branch | lines | approx size | when it renders |
|---|---|---|---|
| mobile / "boxes" card grid | 3184–3791 | 608 | `isMobileDevice \|\| desktopLayout === "boxes"` |
| narrow stacked column | 3792–4116 | 325 | `isStacked` (`availableW < 760`) |
| desktop 5-column | 4117–4973 | 857 | everything else |

≈1,790 lines rendering one screen three times.

**Line numbers will drift.** Locate by the branch conditions above, not by number.

### 2.1 The five cards, per branch

Boxes branch uses module-level `MobileBox` (line ~924); stacked uses module-level
`MobileSection` (line ~826); desktop is inline JSX.

- boxes: Mail 3459 · Phone 3516 · Tasks 3526 · Shailos 3627 · Calendar 3651
- stacked: Tasks 3893 · Calendar 3962 · Mail 4016 · Shailos 4065 · Phone 4091
- desktop: inline, 4117+

### 2.2 The list each branch actually consumes — the whole problem in one table

| card | boxes branch | stacked branch | desktop branch |
|---|---|---|---|
| Tasks | `actionTasks` | `topTasks` (= `primaryTaskQueue.slice`) | `primaryTasks` (= `primaryTaskQueue`) |
| Mail | `actionMail` | `gmailMessages` | varies |
| Shailos | `actionShailos` | `visibleShailos` | `visibleShailos` |
| Calendar | `actionCalendar` | `calendarRows` | `calendarRows` |

Four cards × three branches, and **no two branches agree on which list is the display
list.** The Tasks row is the one that bit; the other three are the same accident waiting.

### 2.3 Every `.sort()` in the file

```
 530, 595, 692   module-level helpers (chief scoring, CalendarTimeline) — fine, leave
1929             calendarRows construction — a real derivation
1985 actionMail      1996 actionTasks     2000 actionShailos    2006 actionCalendar
2125             chief-context weighting — feeds AI, not the display
```

Lines 1985–2006 are the "needs-action" block. It is not wrong to exist — leading with
what is waiting on you is a real feature (ticket `T0aqnE2h`). It is wrong that it is a
*second* ordering authority that only one branch reads.

### 2.4 Verbatim duplication already present

The task composer (textarea + save + cancel) exists character-for-character in the boxes
and stacked branches, differing only in whitespace. The task row with its pin glyph
exists three times (~3597, ~3933, ~4262). Edit one, the other two rot.

---

## 3. The invariant this establishes

> **Layout may fork. Data may not.**
>
> Exactly one place computes what each card displays and in what order. Every branch
> renders that list verbatim. No branch may sort, slice, or re-filter it.

This is the industry-standard split, and worth naming because it is the part that
generalises: *derivation* (what to show) is separated from *presentation* (how it looks),
and presentation is allowed to vary by screen while derivation is not. Where you see it
elsewhere: "container vs presentational components", "headless UI", "one source of truth".

**Honest scope note.** The standard is *not* "one JSX tree at all costs". A wide layout
legitimately sometimes needs different markup from a narrow one — a table that becomes
cards is the textbook case, and this app's 5-column desktop view is a real example. What
is never defensible is three branches each deriving their own data. Tier 1 fixes what is
indefensible; Tiers 2–3 reduce what is merely expensive.

---

## 4. Tier 1 — one data source (approved, do this first)

**Goal:** delete every per-branch derivation. No visual change whatsoever.

**Why first:** it removes the entire bug class for roughly a day of work, and it is the
only tier with no pixel risk. Everything after it is cheaper because of it.

### Steps

1. **Create one display-lists block** in the component body, immediately after
   `primaryTaskQueue` (~line 1876), fenced by exact marker comments — the ratchet in
   step 5 keys off these strings, do not reword them:

   ```js
   // ── NC DISPLAY LISTS: start ────────────────────────────────────────────────
   //  The ONLY place the five cards' contents and order are decided. Every render
   //  branch consumes these verbatim. See docs/ops/NC_ONE_SOURCE_PLAN.md.
   const ncLists = { tasks, mail, shailos, calendar, phone };
   // ── NC DISPLAY LISTS: end ──────────────────────────────────────────────────
   ```

2. **Fold the needs-action ordering into it.** `actionTasks` / `actionMail` /
   `actionShailos` / `actionCalendar` (1985–2006) move inside the block and become the
   canonical lists. Keep the needs-action behaviour; it is a feature. For tasks the
   composed rule is already settled by 4.114.13 and must be preserved exactly:
   **priority weight first, then `orderPinnedFirst` lifts the pinned block on top,
   group-aware** (a group with a pinned subtask travels whole).

3. **Repoint all three branches** at `ncLists.*`. Delete `topTasks`, `primaryTasks`,
   the bare `gmailMessages` / `visibleShailos` / `calendarRows` reads in render, and the
   `taskRest = actionTasks` alias. Keep `primaryTaskQueue` — the chief/AI context and the
   count pills legitimately read the unordered queue; that is a different consumer, and
   the block should expose it under a name that says so (`ncQueues.tasksRaw`).

4. **Caps and slices are presentation, and they stay in the branch** (`slice(0, 50)`,
   "+N more"). A slice does not reorder. If a branch ever needs a *different order*, that
   is a product decision and belongs in the block behind a named flag, never inline.

5. **Ratchet it** — new `apps/web/scripts/nc-lists-ratchet.mjs`, modelled on
   `scripts/gm3-ratchet.mjs` (read its header comment first; same one-way-valve idea,
   same "count may fall, never rise" contract):
   - Read `NerveCenter.jsx`. Locate the marker-fenced block.
   - Fail if `.sort(` appears anywhere inside the `NerveCenter` component function but
     outside the block. Module-level helpers above the component (530, 595, 692) are
     exempt — they are not display lists.
   - Fail if any `ncLists.*` member is followed by `.sort(`, `.filter(` or `.reverse(`
     anywhere in the file.
   - Wire as `npm run nc:lists`, add to `.github/workflows/deploy.yml` beside the GM3
     step, and to the local gate in `CLAUDE.md` § Release.
   - Target count is **0**, not a baseline — this starts clean, so it never needs the
     ratcheting-down machinery GM3 has.

### Verification

- `npm run build`, `npm run gm3` (currently 761), `npm run nc:lists`.
- Node check of the composed task order, as done for 4.114.13: a pinned "Later" task, a
  pinned group, and an unpinned "Now" row must come out pinned-block-first.
- Preview at three widths — 375px, 900px, 1600px — one screenshot each. All five cards
  present, same content, same order as before the change.
- Spot-check that the needs-action lead is intact: an unread mail still rises, a
  `get_back` shaila still rises, a `now` calendar row still leads.

### Rollback

Single commit, no data migration, no schema. `git revert` is the whole rollback.

---

## 5. Tier 2 — shared leaf components (approved, after Tier 1)

**Goal:** each duplicated piece of markup exists once. Roughly halves the file.

Extract to module level, next to the existing `MobileBox` / `MobileSection` /
`TaskRowActions` — that is the established pattern in this file, and those components are
already hoisted out of the render for a reason (a per-second clock tick was remounting
them mid-gesture; see the comment at ~line 821 before moving anything else).

Order, easiest and least risky first:

1. `TaskComposer` — already byte-identical in two branches. Pure win, no judgement calls.
2. `NcTaskRow` — three copies. Carries the pin glyph, the priority dot, the inline edit
   textarea and `TaskRowActions`. Props: `task`, `pinned`, `dense`, `editing`, handlers.
3. `NcMailRow`, `NcShailaRow`, `NcCalRow` — same treatment, one card per commit.
4. The card shell last, if at all: `MobileBox` and `MobileSection` are genuinely
   different chrome (a grid cell vs a full-width section), and forcing them together is
   Tier 3's job, not this one.

**Constraints that bite here — read `RULES_RATIONALE.md` § "Layout constraints that keep
getting re-broken" before writing any of it.** Specifically: no trailing control under
420px, 56/64px row heights, the 16px `md-item` slot gap, the 1500px column threshold, and
no hero row. A shared row component is exactly where those get flattened by accident.

**Verification per commit:** build + `npm run gm3` (must not rise) + `npm run nc:lists` +
screenshots at 375 / 900 / 1600px for the card touched. One card per commit, one push per
commit — a broken shared row breaks all three layouts at once, so small blast radius
matters more than usual here.

---

## 6. Tier 3 — one tree (partially shipped 2026-08-04, 4.114.16)

The owner lifted the hold and asked for all three tiers in one pass. What that turned into,
honestly reported, because the answer is more interesting than "done":

### What shipped

**One card shell.** `MobileSection` and `MobileBox` are gone, replaced by one `NcCard`.
They were two components drawing the same anatomy — `[icon] [title] [count] [caption]
[actions] [expand]` over a scrolling body — that had drifted into different DOM, two
different action APIs (JSX elements vs `{icon,label,run}` descriptors) and two different
body-scroll rules. `NcCard` renders one structure; `variant="card" | "section"` selects a
metric set (`NC_CARD_METRICS`) and nothing else. Adding a control to a card header is now
one edit, in one place, and it appears in every layout.

**One layout value.** `ncLayout` (`"grid" | "stack" | "columns"`) is computed once, next to
`isStacked`, and the three render branches key off it. The two conditions are no longer
re-spelled 500 lines apart. This also settles §8's open question: `isMobileDevice` and
`desktopLayout === "boxes"` share a branch **deliberately** — "boxes" exists precisely so a
desktop can opt into the device layout — and the named value is what makes that legible.

### What did NOT ship, and the finding behind it

**Container queries were evaluated and rejected for this screen.** The plan's sketch assumed
layout differences could move into `@container` rules. They cannot, and the reason is worth
writing down because it will come up again:

> Every remaining width-driven difference in NerveCenter changes **what renders**, not how
> it looks — whether a row carries a trailing action menu at all, whether Done/Delete move
> into the row's edit state (ticket `yk3jFYeI`), whether the header's actions fold behind one
> overflow button. CSS can only restyle elements that are already in the DOM, so expressing
> these as container queries would mean rendering both sets of controls and hiding one. That
> duplicates every action's aria-label and touch target — worse for screen readers and worse
> for the thumb, to win a stylistic point.

Container queries are the right tool where the difference genuinely is cosmetic, and this
codebase already uses them there (`10-deskphone-web.jsx`). Here the fork that remains is by
**role**, not by width, and a prop is the honest way to say so.

**The card bodies are still forked.** `NcCard` unified the *shells*. Inside them, the grid
branch and the stacked branch still write their own body markup for Mail, Shailos, Calendar
and Phone (the task rows are shared — Tier 2). That is the remaining ~700 lines and the real
Tier 3 tail.

**The desktop 5-column tree stays forked**, as this plan predicted it might. It is a
genuinely different information architecture — resizable panes, the live timeline, the email
reader pane — not a wider version of the same card.

### What is left

1. Share the four remaining card bodies between the grid and stacked branches, one card per
   commit, the way the task row was done. Highest value: Mail and Calendar, which carry the
   most duplicated markup.
2. Confirm the tablet portrait/landscape layouts on a real device (tickets
   `tbtjtb55bwkBM38cIxfw`, `pRxHFdM14jRsCgjzQy8G` are still device-unverified). Do this
   before touching the bodies, not after — that was the original reason for the hold and it
   has not been discharged, only overtaken.
3. Only then decide whether the desktop column tree is worth merging at all. The honest
   default is no.

## 7. Release protocol for this work

Standing rules, repeated because this work is many small pushes:

- Bump `apps/web/src/version.js` every release. `fix:`/`style:` → patch+1.
- Gate: `npm run build` **and** `npm run gm3`, plus `npm run nc:lists` once it exists.
- Push at every logical package point, not once at the end.
- **A push is not a release until the run is green** — after every push,
  `gh run watch $(gh run list --limit 1 --json databaseId -q '.[0].databaseId') --exit-status`.
  A red run holds every commit behind it; fix it in the same turn. This rule exists
  because 4.114.11 and 4.114.12 sat undeployed for two days while three sessions
  reported them shipped (`RULES_RATIONALE.md` § "Why pushed is not shipped").
- Ticket notes go on `users/rabbidanziger/bugs/{id}`; `notes` is replaced, not appended,
  so re-send existing notes. Rebuild the `meta/openTickets` mirror before ending.

## 8. Assumptions a future session may overturn

- That the needs-action ordering should survive at all. It is assumed to be a keeper
  (ticket `T0aqnE2h` deleted the hero row *in favour of* order carrying importance). If
  the owner would rather the cards show the queue's own order untouched, Tier 1 gets
  simpler, not harder — one list, no weighting.
- That the desktop 5-column layout keeps a structural fork. Assumed yes through Tier 2;
  Tier 3 decides properly.
- ~~That `isMobileDevice` and `desktopLayout === "boxes"` should keep sharing one branch.~~
  **Settled 2026-08-04:** deliberate. "boxes" is the desktop opt-in to the device layout;
  `ncLayout` now names it.
