# BackSeatDriver

A small always-on-top window, one per Claude Code session, for steering a turn that is
already running — without sending a new message and re-paying the context.

```
┌──────────────────────────────────────┐
│ BackSeatDriver steering prompt win… × │
│ Shamash Pro 4 App                    │
│ ┌──────────────────────────────────┐ │
│ │ actually use outlined chips      │ │
│ │ here, not filled                 │ │
│ └──────────────────────────────────┘ │
│ 1 note waiting…            [ Send ]  │
└──────────────────────────────────────┘
```

## The header

The header is the **real side-rail title**, read from the desktop app's own per-session file:

```
%APPDATA%\Claude\claude-code-sessions\<accountId>\<orgId>\local_<uuid>.json
```

Each holds `title` (what the side rail shows), `titleSource`, `lastFocusedAt`, and — the key
field — `cliSessionId`, which maps the app's internal session to the engine `session_id` that
hooks are given. So the window finds its own file by matching `cliSessionId`, with no
guessing. It re-reads the title periodically, so renaming a session moves the header too.

There are a couple of hundred of these files, so the search substring-tests the raw text
before paying for a JSON parse, and goes newest-first — a session's own file is normally the
most recently written.

If no store file exists (a pure CLI session has none), the fallback is the first user message
from the transcript, which is what the title is derived from anyway; `transcript_path` comes
in on the hook payload.

The original header showed `~/.claude/sessions/<pid>.json`'s `name` — a derived slug like
`shamash-pro-4-app-bc`, marked `nameSource: "derived"`. That is the machine's name for the
session, not yours, which is why it read as meaningless.

## When the window is visible

It follows its session, and only its session:

- **Closes** when the session ends (`SessionEnd`), and also when the session's process dies
  without one — the app being killed outright never fires `SessionEnd`, so the window checks
  that its entry in `~/.claude/sessions/` still exists and that its pid is alive.
- **Hides** when you switch to a different session in the app, and returns when you switch
  back. The visible session is whichever store file holds the highest `lastFocusedAt`; only
  the most recently written handful can hold that maximum, so the check parses the top 12 by
  mtime rather than all ~200.
- **Stays visible** when you alt-tab to another application — `lastFocusedAt` tracks which
  *session* was last selected, not whether the app has OS focus. An always-on-top pad that
  vanished the moment you looked at something else would be useless.

## Why this exists

The Claude Code **CLI** already supports steering: type while it works and the text is
injected at the next step boundary inside the running turn. The **desktop app** queues
instead — your message waits until the whole turn finishes. That is an open parity gap
([#71726](https://github.com/anthropics/claude-code/issues/71726),
[#30492](https://github.com/anthropics/claude-code/issues/30492)), not a missing capability:
the desktop already spawns the engine in `--input-format stream-json` mode; its
server-served UI just withholds queued messages instead of feeding that channel.

If you would rather not run this at all, the other fix is to use the CLI, where steering
is native.

## Why it works this way

Four more direct routes were checked and rejected:

| Route | Why not |
|---|---|
| Write to the engine's stdin | It is an **anonymous pipe** owned by the Electron main process — no name, no path, no port. Reaching it means handle injection. |
| SendKeys into the desktop composer | Lands the text in the composer, which is *the thing that queues*. No gain. |
| `ccd_session_mgmt.send_message` | Delivers "as a user turn", and refuses to target the current session. |
| The remote-control bridge | A cloud round-trip on a poll, delivered on the same user-turn path. |

They all address a session at **turn** granularity. A hook's `additionalContext` is the
only documented way into a turn already underway — so that is what this uses.

## How it works

1. `SessionStart` → `start.sh` creates `~/.claude/backseat/<session_id>/` and launches
   `window.ps1` for that session, titled with the session's name.
2. You type; **Ctrl+Enter** (or Send) writes one `*.note` file into `inbox/`.
   One file per note, so the drain never truncates a file the window may be writing to.
3. `PostToolUse` → `drain.sh` runs after **every** tool call. If notes exist it consumes
   them and returns them as `additionalContext`, which the engine places next to the tool
   result — inside the running turn.
4. `Stop` → `stop.sh` is the backstop for notes written after the last tool call, while
   Claude is composing its answer. It returns `decision: block`, so the turn continues
   instead of ending.
5. `SessionEnd` → `end.sh` closes the window and archives the trail.

Delivery is at the next **tool boundary**, not on a timer — usually a few seconds during
active work, and free while idle.

### Cost

`drain.sh` runs after every tool call. Idle cost is one process spawn, measured at **~63ms**
on the machine this was built for; the script itself is fork-free on that path (session id
is parsed with shell builtins, not `jq` — which isn't installed here anyway).

### Subagents are skipped

Subagents run tools under the **same** `session_id`. Without an explicit skip, a `Task` or
`Explore` subagent's tool call would consume your steering note into the subagent's context
and the main thread would never see it. `drain.sh` bails when the payload carries `agent_id`.

### It cannot loop

`stop.sh` blocks only when notes exist, and every pass **deletes** the notes it read. Notes
appear only from a deliberate click. No notes, no block.

## Collapsing it

The **−** button rolls the window up to just its title bar; **+** (or a double-click on the
bar) brings it back. It stays docked to the corner it was in, and keeps showing the pending
count — "2 waiting" — since that is the one thing still worth knowing with the input hidden.

It is a collapse, **not** `WindowState = Minimized`, and that is deliberate: this window sets
`ShowInTaskbar="False"`, so a real minimize would send it somewhere with no taskbar button to
restore it — an unrecoverable close wearing a minimize button.

## Getting the window back

Closing it — deliberately or by fat-finger — otherwise leaves no way back except starting a
new session, which loses exactly the context the window exists to protect.

```powershell
powershell -ExecutionPolicy Bypass -File tools/backseat-driver/reopen.ps1
```

Reopens for the session **currently on screen**; `-SessionId <id>` targets a specific one and
`-List` shows every live session and whether it has a window. It refuses to open a second
window for a session that already has one, and rebuilds the state directory if it was cleaned
up, so it works standalone rather than only as an undo. Install also drops a
**BackSeatDriver** shortcut on the Desktop pointing at it — recovery shouldn't depend on
having a terminal open.

This is deliberately **not** automatic. The drain hook could notice a missing window and
respawn it after every tool call, but then closing it on purpose would be impossible.

### Orphans

A window left over from an older build, or one whose state directory was deleted underneath
it, has nothing left to poll and no working close button — it just sits there. Normal cleanup
goes through the pid file in that state directory, which is the one thing an orphan no longer
has.

```powershell
powershell -ExecutionPolicy Bypass -File tools/backseat-driver/sweep.ps1
```

Finds windows by **command line** instead, which still works when the state directory is gone.
Bare, it closes only windows with no live session behind them; `-All` closes every window,
`-WhatIf` lists without changing anything.

## Install

```powershell
powershell -ExecutionPolicy Bypass -File tools/backseat-driver/install.ps1
```

Copies the scripts to `~/.claude/hooks/backseat/` and registers four hooks in the **global**
`~/.claude/settings.json` (backed up first), so it runs in every project. Re-running is safe.
**Hooks load at session start — it takes effect in the next session, not the current one.**

```powershell
powershell -ExecutionPolicy Bypass -File tools/backseat-driver/uninstall.ps1
```

Removes only the entries pointing into `~/.claude/hooks/backseat/`; other hooks are untouched.

## Files

| File | Role |
|---|---|
| `window.ps1` | The WPF window. Plain PowerShell + WPF, so no runtime or build step. |
| `lib.sh` | Session-id parsing, JSON escaping, note collection. |
| `start.sh` · `drain.sh` · `stop.sh` · `end.sh` | The four hooks. |
| `install.ps1` · `uninstall.ps1` | Global install/removal. |

State lives in `~/.claude/backseat/<session_id>/` — `inbox/`, `consumed.md` (audit trail of
everything folded into a turn), `meta.json`, `window.pid`.

## Traps worth remembering

- **`$Input` is a PowerShell automatic variable.** Assigning a control to it works at script
  scope but resolves to the empty pipeline enumerator inside every function and scriptblock.
  The symptom is a null-reference thrown out of `ShowDialog()`, which points nowhere near the
  actual line. The control here is `$InputBox` for that reason.
- **`Start-Process -ArgumentList` does no quoting.** It joins the array with spaces, so any
  path containing them — every path under `Documents\Shamash Pro 4 App` — is split into
  fragments. The script path is quoted explicitly inside the argument list.
- **`DragMove()` eats the click that follows it.** With a custom title bar, a
  `MouseLeftButtonDown` handler that calls `DragMove()` captures the mouse and enters a modal
  drag loop, so the matching `MouseUp` never arrives. Any button inside that drag region — the
  × here — silently does nothing, with no error to point at. The close button marks
  `MouseLeftButtonDown` as `Handled` so the event never reaches the drag handler. A `TextBlock`
  with no `Background` is also hit-test transparent outside its glyphs, so the button is a
  `Border` with `Background="Transparent"` for a real 24×24 target.
- **Hiding a `ShowDialog()` window ends its dialog loop.** `ShowDialog` is modal; when the
  window first hid itself because another session was on screen, `ShowDialog` returned, the
  script ran off the end, and the process exited — no error, no stderr, no exit code, the
  window simply never came back. Any window that hides and re-shows itself must use `Show()`
  plus `[Dispatcher]::Run()`, which decouples visibility from the message loop's lifetime.
- **An unhandled exception in a dispatcher callback kills the process silently.** With
  `$ErrorActionPreference = 'Stop'`, any non-terminating error inside a `DispatcherTimer` tick
  becomes terminating and takes the whole process down with no output. The tick body is wrapped
  in `try/catch` that appends to `window-error.log` in the session's state directory — without
  it, every timer bug looks identical from the outside. Every path that *deliberately* ends a
  window logs to `window-life.log` for the same reason: a window that vanishes with no
  explanation is indistinguishable from one that crashed.
- **PowerShell 5.1 reads `.ps1` files as ANSI unless they carry a UTF-8 BOM.** Without one,
  every em-dash and ellipsis in the source silently becomes mojibake — in comments, and in the
  strings the window actually displays. All scripts here are UTF-8 **with** BOM; tools that
  rewrite them (most editors default to BOM-less UTF-8) will break the glyphs again.
- **PowerShell 5.1 cannot parse a double-quoted string whose `$(...)` subexpression contains
  double quotes.** `"a $(if ($x) { " - $x" })"` is a parse error in 5.1 though it is fine in 7.
  Build the string in two steps.
- **Matching processes by command-line substring matches too much.** `-like '*window.ps1*'`
  also matches any shell whose command line merely *mentions* that text — including one running
  a search for it. That made `reopen` believe a window was already open, and for `sweep`, whose
  entire job is killing what it matches, it is worse than a false positive. Both now require
  the real invocation form, `-File <...>\backseat\window.ps1 -SessionId <id>`, and exclude
  their own process.
