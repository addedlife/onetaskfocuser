# ANALYSIS 20 — Focus app (Focus / Queue / Insights tabs)

> Phase-0 source audit. Derived from **current Pro 4 source**, not memory:
> `08-app-split/App.jsx` (render blocks cited by line), `06-shelf.jsx`, `04-components.jsx`, `05-modals.jsx`.
> **Acceptance test = faithfulness.** The Pro 5 rebuild of each item below must reproduce the *behavior*;
> structure/typing/tokens may be upgraded, features may not be silently changed.
>
> **Status of this audit:** Focus tab = fully read (App.jsx 3820–4069). Queue tab = shelf + subtask groups
> read (`06-shelf.jsx`), main render located (App.jsx 4095–4380) — **still to read in full**. Insights tab
> (App.jsx 4380+) — **still to read**. Component deep-dives (badges, ZenMode, BrainDump, OverwhelmBanner,
> PostItStack, modals) — **still to read** in `04-components.jsx` (1827 ln) / `05-modals.jsx` (378 ln).
>
> **⚠ The current Pro 5 Focus surfaces (`FocusSurface`, `QueueTab`, `InsightsTab`) are SUPERFICIAL** — built
> before this audit. Each "Parity gap" section lists what they are missing vs. the real source.

---

## A. FOCUS tab — the one-task card (App.jsx 3820–4069)

Container: centered "spine", `width: min(88vw, 500px)`, `tab==="focus"` hides page overflow.

### A1. Above-card row (3826–3855)
- Large clock — `clockTime.toLocaleTimeString` `{hour:'numeric',minute:'2-digit'}`, 28px, weight 300, letter-spacing 3, muted.
- `{todayCompCount} today` with a "done" glyph (only when > 0).
- Right cluster: **legacy-complete** clock button (only if `AS.legacyCompleteUI`), **Zen** button (`setZen(true)`), **Done** button (`compTask(curT.id)`). Icons tinted the card colour.
- No-task variant: clock + a faint disabled check.

### A2. The card (3858–3920)
- Colour = `gP(pris, curT.priority).color`; **Shaila tier forces `#C8A84C` gold**. Ink = `textOnColor(cardColor)` plus a family of derived alphas (`_fc50/_fc40/_fcBg/...`) chosen by `_lum(cardColor) > 0.35` (light vs dark card).
- `borderRadius: 28`, big soft shadow `0 12px 50px ${cardColor}35`. On complete: `justComp` → scale .94 + opacity .3. **Ripple** overlay (`showRip`), **completion-flash** overlay (`compFlash`, 0.6s, big check).
- Priority **label** (uppercase). **"Mrs. W"** sub-label if `curT.mrsW`.
- **Inline edit**: `editId === curT.id` → text input + Save (`saveEd`); else click text → `startEd(curT)`.
- Body text via **`AutoFitText`** (auto-sizes between `min(48, vw*0.08)` and 16px to fit `maxHeight clamp(70px,18vh,200px)`).
- Sub-lines: `parentTask` → "Step {stepIndex} of {totalSteps} of {parentTask}"; `blockedNote` → "Blocked: …" italic; age → "since yesterday" / "{d} days waiting" (only ≥1 day, from `getTaskAgeHours`).
- Empty state: success check circle + ("All clear." if `compT.length` else "Add your first task.").

### A3. Quick actions under the card (3902–3912)
- **Park til tomorrow** (`parkTask`).
- **"🔍 What's in the way?"** → `setShowBlockReflect(true)` — **only when `getTaskAgeHours(curT) >= 72`**.
- (Just-Start timer block 3899–3900 — **DROPPED by owner**, do not build.)

### A4. Priority circles (3922–3987)
- Outside-click handler dismisses the selected priority + clears the draft.
- **Built-in row**: `p.isShaila || id ∈ {BEFORE_SHAVUOS_PRIORITY_ID, now, today, eventually}`. Big circles `clamp(70→90px)`, selected grows to `clamp(82→104px)` + soft border + stronger glow. **Mic/voice button** appears on hover (or when selected) above each circle → `setSelPri(p.id); setShowVoice(true)`. Shaila circle is gold and labelled "Shaila".
- **Custom row**: the rest, sorted by `weight` desc, smaller circles `clamp(32→44px)`, also with mic buttons.
- Click circle → toggle `selPri`.

### A5. Add-task input (3970–3986) — shown when `selPri` set
- Auto-growing **textarea** (max 120px), placeholder = `"Who + what shaila?"` for shaila tier else rotating `ph`. Enter (no shift) submits `addTask`; Escape cancels.
- **Energy toggle** button cycling `null → high(⚡) → low(🌊) → null` (`entryEnergy`).
- **Add** = priority-coloured `FilledIconButton`.
- **"✦ Shatter into crystals"** (when draft length > 3) → `setShowBD({id:'__new__', text, priority:selPri})` (AI shatter modal — gated on AI backend).

### A6. Queue shortcut (3990–3994)
- A single `md-list-item` "Queue · {effectiveCount}" → `switchTab('queue')`.

### A7. Hamburger menu (3999–4062) — floating top-left, sectioned
- **Current Task**: Good enough (`goodEnoughTask`), Mark blocked (`setBlockedModal`), Change priority (`setChgPri`), Park rest (if `parentTask`, `parkRestOfGroup`), Delete (`delTask`).
- **Navigate**: Queue, Insights, Settings (opens settings to "queue" tab).
- **Focus**: Enter zen, Auto-zen toggle (`zenEnabled`), Just Start timer *(DROPPED)*, Body double *(DROPPED)*.
- **Add & Organize**: AI Prioritize (`tasksOptimize`, spinner while `optLoading`), Brain dump, Bulk add, Shatter task.
- **Data**: Backup (`doFullBackup`, spinner), Restore (`doLoadBackup`), Shaila log (`setShowShailaManager`).

### A8. PostItStack (4064–4068)
- Bottom-right, focus tab only, when `compT.length > 0`. Shows completed tasks; `onUncomp`, `onClone`. (Read full component in `04-components.jsx`.)

### A9. Parity gap — current Pro 5 `FocusSurface`
Has: card colour + label + age + energy + parentTask, Done, Park, ONE row of circles, inline add box with energy chips.
**Missing:** Shaila-gold card, contrast-ink family, Mrs.W, **inline edit**, **AutoFitText**, clock+today header, **Zen**, blockedNote, **"What's in the way?" (≥72h)**, **mic/voice on circles**, **built-in vs custom circle rows**, **energy ·/⚡/🌊 toggle**, **"Shatter into crystals"**, **Queue shortcut**, the **entire hamburger menu**, **PostItStack**, ripple + completion-flash. *(Just-Start & Body-Double intentionally dropped.)*

---

## B. QUEUE tab — (App.jsx 4095–4380; `06-shelf.jsx`)

Derived state (App.jsx ~1589–1627): energy-filtered + snooze-filtered queue; opt-in **OverwhelmBanner**
(`overwhelmThreshold`, default 7; focus mode shows top 3); `queueTFiltered` collapses subtask groups to a
single position marker rendered as **`SubtaskGroup`**; `shailaNumberMap` (shailaId → stable 1-based number).

### B1. SubtaskGroup ("crystals") — `06-shelf.jsx` 123–271 *(read)*
Collapsible single row = ONE queue item. Left priority bar, split icon, parent text, progress bar (`doneSteps/total`).
Expanded: each step has **drag-reorder** (HTML5 drag), a complete button (Alt+click = legacy complete), **inline edit**
(click text), `#stepIndex`, a **`ShailaMiniPill`** on `isGetBackStep` steps (status researching/have_answer/got_back +
answer snippet), change-priority dot, delete. "N crystals completed". **Add step** inline. Footer: "↑ Next crystal to
top" (`onMoveTop`), "✓ All done" (Alt = legacy).

### B2. Trophy Shelf — `ShelfView` `06-shelf.jsx` 21–119 *(read)*
"Trophy Shelf / Every task conquered". A **stacked post-it pile** (`stackH = min(n*4+30,120)`, up to 16 notes, priority
colours, slight rotations) → click to **fan out** a full-screen modal of every completed task as full-size post-its
(Georgia serif, completedAt date, **clone / return-to-queue / delete** per note). Plus a "This list (N)" panel of the
current list's completed tasks with the same three actions. Empty: "Complete tasks to build your stack".

### B3. Queue rows + badges — **TO READ** (App.jsx 4095–4380)
Each active row uses badges from `04-components.jsx`: **AgeBadge, EnergyBadge, ContextBadges, MrsWBadge, BlockedBadge**
(+ row drag-reorder, complete, change-priority, delete, edit). Quick-add + search live here. **Read before building.**

### B4. Parity gap — current Pro 5 `QueueTab`
Has: smart-sorted list, search, quick-add (tier chips), opt-in overwhelm, inline Park/Done, a plain "Done today" list.
**Missing:** **SubtaskGroups/crystals**, the **Trophy Shelf** (post-it pile + fan-out + clone/delete/uncomplete),
**all badges**, drag-reorder, change-priority, edit, the real overwhelm banner, shaila mini-pills, context tags.

---

## C. INSIGHTS tab — **TO READ** (App.jsx 4380+)

Plan calls for: completion charts (day / week / all + weekday / speed / trend), AI insight, AI chat, daily tip.
Current Pro 5 `InsightsTab` has only: 3 stat tiles + a 7-day bar chart + a static daily tip (AI deferred).
**Read the source block before rebuilding** to capture the exact chart set + computations.

---

## D. Supporting components to audit (before their surfaces ship)
`04-components.jsx` (1827 ln): `AutoFitText`, `Ripple`, `Confetti`, `AgeBadge`, `EnergyBadge`, `ContextBadges`,
`MrsWBadge`, `BlockedBadge`, `ZenMode`, `BrainDump`, `OverwhelmBanner`, `PostItStack`, `ShailaManager`,
`ShailaMiniPill`, `BlockReflectModal`, `PriEditor`, `TabBtn`. *(BodyDoubleTimer, JustStartTimer — dropped.)*
`05-modals.jsx` (378 ln): `BulkAdd`, `TaskBD` (Shatter), `BlockedModal`, `ContextTagPicker`, `ListManager`.

---

## E. New store actions the faithful Focus app needs (not yet in `state/data.ts`)
`editTask(id, text)`, `deleteTask(id)`, `cloneTask(t)`, `uncompleteTask(id)`, `changePriority(id, pri)`,
`goodEnoughTask(id)`, `setBlocked(id, note)`, `reorderTasks(order)`, subtask: `addSubtask(parent, text)`,
`reorderSubtasks(parent, order)`, `parkRestOfGroup(t)`. (Plus the AI-gated `tasksOptimize`, `shatter`.)
