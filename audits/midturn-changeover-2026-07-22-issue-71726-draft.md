# POSTED — comment on anthropics/claude-code#71726

**Status: LIVE.** Posted by the owner (@addedlife) on 2026-07-24T17:18:29Z, comment id
`5072555390`: https://github.com/anthropics/claude-code/issues/71726#issuecomment-5072555390

Text below is preserved as the record of what was submitted (unedited from the draft). No
maintainer reply as of the last check.

For context, the owner had already posted an earlier comment on this same issue —
2026-07-22T22:47:20Z, id `5052392191`:
https://github.com/anthropics/claude-code/issues/71726#issuecomment-5052392191 — describing the
BackSeatDriver mechanism and the native fix's near-identical wording, predating this
investigation. See §9 of `midturn-changeover-2026-07-22.md` for how that affects the
independence of the third-party corroboration in that report.

---

Adding a data point that narrows the attribution: **this tracks the bundled engine version, not
the desktop build.**

The confirmation above cites desktop `1.24012.1`, which is the version an end user can see — but
on my machine desktop `1.24012.x` was running both *before* and *after* the behaviour appeared.
The variable that actually moved was the engine: **`claude-code` 2.1.215 → 2.1.217**.

**1. The channel long predates the change.** The desktop app already spawns the engine with
`--output-format stream-json --verbose --input-format stream-json`. And `2.1.208` contains:

> "Fixed stream-json **input** killing the session on blank CRLF or whitespace-only lines from
> Windows-style SDK hosts."

So the input channel was live and being bug-fixed weeks earlier. What changed at 2.1.217 isn't the
existence of a channel — it's whether the engine folds arriving input into the **running** turn.

**2. Version correlation across a run of sessions.** Counting, across local session transcripts,
messages typed during a running turn versus occurrences of the mid-turn `<system-reminder>`:

| Engine | Messages typed mid-run | Mid-turn reminders |
|---|---|---|
| 2.1.187 – 2.1.215 (72 sessions) | frequent (up to 18 in one session) | **0** |
| 2.1.217 | — | **present, repeatedly** |

Zero occurrences across every session on 2.1.215 and earlier, despite plenty of mid-run typing
(and plenty of `Esc` interrupts as the workaround). It appears immediately once 2.1.217 is in
play.

**3. A within-session control.** One session had the engine update *mid-conversation*,
2.1.215 → 2.1.217. Same window, same desktop build, same conversation:

- before the engine flip — messages typed mid-run, **no** mid-turn reminders;
- after the flip — mid-turn reminders throughout.

That isolates the engine as the locus about as cleanly as an end user can.

**Why it may matter for triage:** if the gate is the engine bundle (or a server-side flag rolled
out alongside it) rather than the desktop build, then **two users on identical desktop versions can
legitimately see different behaviour** — which would make this look flaky or irreproducible in bug
reports. Worth pinning down before this is called fixed.

Agreed on keeping it open until there's official confirmation. There's still no changelog entry in
either the CLI notes (nothing through 2.1.218) or the Desktop release notes, and the mechanism —
a `<system-reminder>` appended to the end of a tool-call result, instructing the model to address
the message and continue — is a change to how user input reaches the model. That seems worth
documenting explicitly, since anyone building tooling around turn boundaries is affected by it.
