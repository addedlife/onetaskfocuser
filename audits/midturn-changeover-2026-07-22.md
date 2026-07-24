# Mid-turn steering changeover — forensic investigation

**Date of investigation:** 2026-07-23 / 2026-07-24
**Subject:** when and where Claude Code began delivering user messages *into* a running turn
**Method:** primary-source forensics on this machine — 74 local session transcripts
(2026-06-28 → 2026-07-24), the live engine process table, on-disk message envelopes, and the
public CLI/Desktop changelogs. External sources are labelled as such.

---

## 1. Summary of findings

The Claude Code **desktop app** changed behaviour on **2026-07-22**: messages typed while a turn
is running are now delivered *inside* that turn instead of being held until it ends.

The change tracks the **engine binary** (`claude-code` **2.1.215 → 2.1.217**), **not** the
desktop shell, and it is **undocumented** — absent from the CLI changelog through 2.1.218 and
from the Desktop release notes through v1.24012.0.

The mechanism the model actually sees is a `<system-reminder>` appended to the **end of a
tool-call result**, instructing it to address the message and continue rather than stop.

---

## 2. The streaming channel was never the bottleneck

Verbatim from this machine's live process table, the desktop app spawns the bundled engine as:

```
…\Claude\claude-code\2.1.217\claude.exe --output-format stream-json --verbose
  --input-format stream-json --effort xhigh --model claude-opus-4-8 --permission-prompt-tool stdio
```

Host: Claude Desktop **1.24012.1.0** (arm64, Electron 42.7.0).

`--input-format stream-json` is the receive side of a two-way pipe — the app can hand the engine
a new user message on stdin at any moment, mid-turn included. So the question was never
*"is there a channel?"* but *"on receiving a mid-run message, does the engine inject it into the
live turn or hold it?"*

Corroborating this externally: CLI **2.1.208** carries *"Fixed stream-json **input** killing the
session on blank CRLF or whitespace-only lines from Windows-style SDK hosts."* The input channel
was live and being actively bug-fixed **weeks before** the behaviour changed. The channel is old;
only the **delivery semantics** flipped.

---

## 3. Two distinct on-disk envelopes (non-obvious result)

**(a) `queued_command` attachment** — the desktop's envelope for "feed something to the running
session." Verbatim example:

```json
{"type":"queued_command","prompt":"look at the prev session…","commandMode":"prompt",
 "origin":{"kind":"human"},"timestamp":"2026-07-23T00:40:42Z"}
```

The same envelope **also carries automated `<task-notification>` payloads** (background-task
completions). So `queued_command` is a general injection channel, and `origin:{kind:"human"}` is
the only discriminator between a real human steer and a machine notification. **This envelope is
old** — present since at least 2026-06-28.

**(b) The native `<system-reminder>`** — engine-generated, shown to the model:

> "The user sent a new message while you were working: … *This is how Claude Code surfaces
> messages the user sends mid-turn — within the running turn, often alongside the next tool
> result, rather than as a separate conversation turn.*"

Envelope (a) means *"the app captured what you typed."* Reminder (b) means *"the engine folded it
into the live turn."* **The changeover is the arrival of (b).**

---

## 4. The dataset

Human steers (`origin:{kind:"human"}`) vs. native mid-turn reminders, against engine version:

| Window | Engine | Human steers recorded | Native mid-turn reminders |
|---|---|---|---|
| 6/28 – 7/02 | 2.1.187 → .197 | 1–12 per session | **0** |
| 7/10 – 7/17 | 2.1.202 → .209 | up to 16 (7/12), 18 (7/15) | **0** |
| 7/19 – 7/21 | 2.1.215 | up to 16 (7/21) | **0** |
| **7/22 – 7/23** | **2.1.217** | 46 (build session), 4 | **15, then 8** |

**72 sessions on engines 2.1.187–2.1.215 produced zero native reminders despite heavy mid-run
typing.** The reminder appears **only** in the two 2.1.217 sessions. Escape-interrupts
(`[Request interrupted by user]`) are frequent in the earlier sessions — the destructive
alternative, used because the non-destructive path wasn't delivering.

Desktop shell was already the **1.24012** family on both 7/21 (no reminders) and 7/22
(reminders) — so the shell did not cause it.

---

## 5. Within-session natural experiment (the clincher)

Session `8cf190c4` (7/22) updated its engine **mid-session**, 2.1.215 → 2.1.217, at line ~228 of
1140:

- **Lines 1–227 (on 2.1.215):** owner steering actively in progress *via the BackSeatDriver
  workaround* (its wrapper at lines 57–114) — **zero** native reminders.
- **Lines 726–1140 (on 2.1.217):** fifteen native "while you were working" reminders.

Same conversation, same window, same desktop shell. The only variable that moved at the boundary
was the engine binary, and native mid-turn delivery switched on with it.

---

## 6. Dark launch, not a pending announcement

The pattern is textbook **decoupling deploy from release**: ship the code inert, flip it on later,
iterate behind the flag (trunk-based development + feature toggles + staged rollout).

- The plumbing (`stream-json` input) shipped early and was hardened in public (2.1.208).
- The semantics flipped at 2.1.217.
- The changelog silence is *consistent* with a flag mid-rollout — you don't document a toggle
  that isn't on for everyone yet; the entry normally lands at general availability.
- #71726 staying open and unanswered fits the same reading: not "fixed" until GA.

**Testable prediction:** if the gate is a server-side flag rather than the binary, two machines on
*identical* engine versions can behave differently.

**Criticism that stands:** dark-launching a feature is unremarkable, but this was a silent change
to **how the model receives user input** — a semantic contract change with no signal to anyone
building on top. Case in point: BackSeatDriver was built the same night the native path lit up.

---

## 7. Confidence ledger

- **Proven (primary, this machine):** the streaming spawn flags; `queued_command` with the
  human/task `origin` discriminator since 6/28; native reminders exclusively under 2.1.217 from
  7/22; the within-session flip experiment.
- **Strong inference:** the behaviour shipped in engine **2.1.216/217** — desktop shell constant
  across the boundary, correlation exact, reproduced within one session.
- **External corroboration — corrected, not blind-independent.** The owner had already posted the
  mechanism to #71726 themselves on **2026-07-22T22:47:20Z**
  ([comment 5052392191](https://github.com/anthropics/claude-code/issues/71726#issuecomment-5052392191)),
  ahead of this investigation, quoting BackSeatDriver's own prompt alongside the native fix's
  near-identical wording. `chk-mk`'s "confirming this is fixed" the next day
  ([comment, 2026-07-23T01:23:18Z](https://github.com/anthropics/claude-code/issues/71726))
  therefore came **after** seeing that post, not blind. It still has real evidentiary value — they
  reproduced the mechanism against their own install (desktop 1.24012.1) in their own words, and
  independently flagged the missing changelog entry — but it is corroboration-after-disclosure,
  not the independent replication earlier drafts of this report implied.
- **Caveat:** CLI changelog 2.1.210–2.1.218 says nothing about steering. Cannot *fully* exclude a
  coincident server-side rollout that merely landed with the 2.1.217 bundle; nothing on disk
  favours that over the simpler engine-version explanation.

---

## 8. Consequences

- **BackSeatDriver (`tools/backseat-driver/`) is now duplicate machinery.** Native delivery covers
  the same need. Keep it only as insurance against a flag rollback. Memory
  `project_backseatdriver.md` has been updated to record this.
- **Watcher:** daily cloud routine `trig_01KpBB8KMo8RSZURCkxWpjU9` (09:00 America/Indianapolis)
  watches the CLI changelog and Desktop release notes for official acknowledgement only. For
  **#71726 specifically**, broadened 2026-07-24 to alert on **any new comment at all** (baseline:
  10 comments, latest `5072555390`), fetched via the GitHub REST API
  (`api.github.com/repos/anthropics/claude-code/issues/71726/comments`) rather than scraping the
  HTML page, which does not render comments. #30492 and the changelogs stay on the
  official-acknowledgement-only bar.

## 9. Update log

- **2026-07-24, post-investigation:** engine bumped to **2.1.219** (2.1.218 never got a local
  bundle) — headline is Claude Opus 5; full bullet list checked, nothing steering-related.
  Desktop jumped **1.24012.1 → 1.24012.9**, eight patch releases with **zero** published
  changelog entries for any of them (newest published entry remains v1.24012.0, 2026-07-21).
  Issue #71726 gained one new comment: the owner's own draft from §above, posted live. No
  maintainer reply yet; issue still open, still labeled `duplicate` + `area:desktop`.
