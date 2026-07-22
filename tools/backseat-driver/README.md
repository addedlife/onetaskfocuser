# BackSeatDriver

A small always-on-top window, one per Claude Code session, for steering a turn that is
already running — without sending a new message and re-paying the context.

```
┌──────────────────────────────────────┐
│ shamash-pro-4-app-0c              ×  │
│ Shamash Pro 4 App · 8cf190c4         │
│ ┌──────────────────────────────────┐ │
│ │ actually use outlined chips      │ │
│ │ here, not filled                 │ │
│ └──────────────────────────────────┘ │
│ 1 note waiting…            [ Send ]  │
└──────────────────────────────────────┘
```

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

### It cannot loop

`stop.sh` blocks only when notes exist, and every pass **deletes** the notes it read. Notes
appear only from a deliberate click. No notes, no block.

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

## Two traps worth remembering

- **`$Input` is a PowerShell automatic variable.** Assigning a control to it works at script
  scope but resolves to the empty pipeline enumerator inside every function and scriptblock.
  The symptom is a null-reference thrown out of `ShowDialog()`, which points nowhere near the
  actual line. The control here is `$InputBox` for that reason.
- **`Start-Process -ArgumentList` does no quoting.** It joins the array with spaces, so any
  path containing them — every path under `Documents\Shamash Pro 4 App` — is split into
  fragments. The script path is quoted explicitly inside the argument list.
