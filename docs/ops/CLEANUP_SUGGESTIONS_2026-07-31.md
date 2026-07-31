# Cleanup suggestions — 31 July 2026

Written during the buglog session that shipped 4.114.7 and 4.114.8. Three tickets came
off the live Bug Log; two were fixed and pushed, one was a review. What follows is what
the work turned up that is *not* fixed — the things worth deciding on rather than
quietly leaving.

Nothing here is urgent. Nothing here is a regression. It is the list of places where the
code is carrying weight it no longer needs to carry.

---

## 1. The calendar's "Show N earlier" row is the last reveal standing

**Where:** `apps/web/src/08-app-split/components/NerveCenter.jsx`, the `MoreRow`
component and its two remaining uses (`cal-past`, `desk-cal-past`).

Ticket 3waTrsYloL01D6nFLhfW said "get rid of all show mores", and 4.114.7 did — every
row cap and every "+N more" reveal on every card is gone, and the cards scroll instead.
One reveal was deliberately left: the calendar's "Show 3 earlier", which hides events
that have already happened today.

The reasoning: that is a *time filter*, not an overflow cap. Nothing is hidden because it
did not fit; it is hidden because it is over. Uncapping it would push this afternoon's
events down the card behind this morning's.

**The decision to make:** if you read "all show mores" literally, this one goes too and
the calendar card simply opens scrolled to now (the timeline view already auto-scrolls
that way, so the machinery exists). Say the word and it is a ten-minute change. Left in
place for now because removing it makes the card measurably worse to use, and that is a
judgement I would rather you make than I do.

## 2. Two hard row caps survive in the stacked layout

**Where:** `NerveCenter.jsx` — `actionMail.slice(0, 40)` and `actionShailos.slice(0, 40)`
in the stacked (phone-width) accordion sections.

These are not "show mores" — there is no reveal control and never was one; they are a
render budget that stops a 400-message inbox from building 400 DOM rows inside an
accordion on a phone. They stayed.

**The decision to make:** 40 is an arbitrary number nobody chose deliberately. If a
stacked card should genuinely be endless, the right fix is not to raise the number but to
virtualise the list (render only what is on screen). That is a real piece of work, worth
doing only if you actually scroll those cards past 40 on the phone.

## 3. `NerveCenter.jsx` is carrying ~55 dead bindings

`npx eslint` on that one file reports 122 warnings, of which around 55 are
`no-unused-vars` — variables computed on every render and then never read. A sample:
`chiefSummaryText`, `nerveSummaryStrip`, `globalSnapshotParts`, `specialCalendarRows`,
`taskSuggestionScanKey`, `boxRows`, `upcomingCal`, `fmtTimeM`, and a family of `trunc` /
`joinTop` / `rowMinH` / `bodyF` / `metaF` / `lineH` formatting helpers.

This session removed six of them as a side effect of the uncap work (123 → 122 warnings).
The rest are the residue of features that were rebuilt in place — the new code landed,
the old computations were never deleted.

**Suggested:** one focused pass that deletes them, in a commit that touches nothing else,
so the diff is trivially reviewable. It costs a little render time on every NerveCenter
tick and, more importantly, it makes the file lie about what it uses — which is exactly
what makes a 5,000-line file frightening to edit. A follow-up to the 4.114.5
dead-bindings pass, which cleared 12 elsewhere.

## 4. Outbound picture texts: the review you asked for (ticket MFKFN1o7qr7PR5SfrroC)

> "do a full review industry azstandard if theres a way to send a picture mms from the pc
> or tablet through the host to phone to recipient."

**Short answer: yes, it works today — but only when the browser can reach a host
directly, not through the cloud relay.**

The chain that works:

1. `10-deskphone-web.jsx` — you attach a file, it becomes base64 and posts to
   `/send-with-attachments` with `{to, body, cid, attachments[]}`.
2. The host implements that route on **both** platforms — Windows in
   `Services/ControlApiService.cs` (→ `SendWithAttachments` → MAP), Android in
   `HostService.kt` (→ decode → `MessageAttachment` → the same MAP send path).
3. The phone sends it as a real MMS to the recipient, and the host's sent-folder
   confirmation flips the optimistic echo bubble from "sending" to sent.

The chain that does **not** work: the cloud relay. `phone-command-availability.js`
explicitly refuses `/send-with-attachments` whenever `viaCloud` is true, with the message
"Picture texts need the DeskPhone window open on this PC — the cloud relay carries text
only. The words alone will send from here."

That refusal is correct rather than lazy. Queued commands live in a Realtime Database node
(`phone-relay/commands`) that is read and rewritten *as a whole* by a transaction on every
drain. Dropping a multi-megabyte base64 image into that node would make every drain — one
every few seconds, all day — read and rewrite the image. It would work, and it would be
expensive and slow in a way that degrades everything else on the relay.

**The industry-standard shape, if you want it closed:** do outbound exactly the way
inbound already does it. Inbound picture texts do not travel through the relay blob
either — the host uploads a resized preview to `phone-media/{mediaId}` and the message
carries only the small id (this is the mechanism 4.114.8 taught DeskPhone Web to read).
Outbound would mirror it: the browser uploads the image to storage, queues a command
carrying only the reference, and the host fetches and sends. The queue stays small, the
image travels once, and it is the same pattern in both directions.

That is a storage-path change, which under the standing rules needs a heads-up from you
before anyone starts. **It is not started.** Estimate: a day, most of it in the two hosts
and the storage rules rather than the web app.

## 5. The relay's two generations sit side by side

`apps/web/functions/phone-relay.js` and `apps/web/functions/phone-relay-v2/` are both
live. v2 has proper schema validation (zod, with real size ceilings); v1 hand-parses. The
`push-media` route exists in both.

**Suggested:** not a cleanup to do today, but worth knowing that any change to the media
path currently has to be made twice, and that the two can silently disagree. When the
outbound work in §4 happens, that is the moment to retire v1 rather than triple the
surface.

---

## What shipped in this session

| Version | Ticket | What changed |
|---|---|---|
| 4.114.7 | 3waTrsYloL01D6nFLhfW | Every NerveCenter card renders its whole list and scrolls. `fitSlice`, `useFitRows`, `CardMoreChip` and the show-all state are deleted. |
| 4.114.8 | 8RbMKKO9PTQX7ZRfkwmF | DeskPhone Web now fetches picture-text images from `phone-media/{mediaId}` on the cloud relay path, via a new shared `utils/phone-media.js` both phone surfaces use. |
| — | MFKFN1o7qr7PR5SfrroC | Reviewed, no code change — see §4. |

Gates on both: `npm run build` green, `npm run gm3` 762/762 unchanged, `npm run test:phone`
75/75.
