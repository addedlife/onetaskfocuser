# Dead-binding inventory — 2026-07-30

Owner ticket `rcjoAhNQnMKglWQxGzGb` (7/29): *"many functions in phone and settings
and developer logs are unworking in the webapp or old stuff thats not needed or
used. suggest cleanup/proper wiring."*

**Deletions need owner approval, so this is a list, not a change.** Twelve entries
were removed in 4.114.5 because they were unambiguous and load-bearing on a
misreading (see the release note). Everything below is still in the tree.

## How this list is produced

`npm run lint` — `no-unused-vars`, now configured to honour this codebase's
existing `_name` convention for a deliberately-unused binding. Before that
change the rule reported 175 findings, ~135 of them intentional, which is why
nobody read its output. It reports 146 now, and every one is a real binding
that nothing reads.

Regenerate any time with `npm run lint`; there is no separate tool to run.

## What the 146 actually are

Three kinds, and they want different treatment:

1. **Dead constants and helpers** — the clearest and safest. The AI-throttle
   block in `NerveCenter.jsx` was the worst case and is already gone: four
   minimum-gap knobs that made the file read as though it enforced a 3-minute
   floor between chief scans, when rate limiting had moved to
   `ai-call-throttle.js` and nothing read them.
2. **Dead props on component signatures** — a prop still declared, threaded
   through two or three components, and read by none. `onOpenFullCalls` was
   this and is gone. `NerveCenter.jsx:1281` has six more on one signature
   (`onRefreshAiConfig`, `setActionsOpen`, `setActionCategoryId`,
   `onOpenChiefPage`, `onOpenHealth`, `actionsOpen`). Each needs a look at the
   caller before removal — a prop passed but unread sometimes means the feature
   was half-wired, not that it was retired, and those are the "unworking
   functions" the ticket is actually about.
3. **Unused callback parameters** — mostly harmless; the `_` prefix is the fix,
   not deletion.

## The list

## src/08-app-split/components/NerveCenter.jsx  (55)
- 885: 'chipBg' is assigned a value but never used. Allowed unused vars must match /^_/u
- 886: 'tint' is assigned a value but never used. Allowed unused vars must match /^_/u
- 969: 'tint' is assigned a value but never used. Allowed unused vars must match /^_/u
- 970: 'chipBg' is assigned a value but never used. Allowed unused vars must match /^_/u
- 1276: 'sections' is assigned a value but never used. Allowed unused vars must match /^_/u
- 1276: 'onRefreshAiConfig' is defined but never used. Allowed unused args must match /^_/u
- 1276: 'actionsOpen' is assigned a value but never used. Allowed unused vars must match /^_/u
- 1276: 'setActionsOpen' is defined but never used. Allowed unused args must match /^_/u
- 1276: 'actionCategoryId' is assigned a value but never used. Allowed unused vars must match /^_/u
- 1276: 'setActionCategoryId' is defined but never used. Allowed unused args must match /^_/u
- 1276: 'onOpenChiefPage' is defined but never used. Allowed unused args must match /^_/u
- 1276: 'onOpenHealth' is defined but never used. Allowed unused args must match /^_/u
- 1288: 'startHealthResize' is assigned a value but never used. Allowed unused vars must match /^_/u
- 1323: 'taskMoreButtonRef' is assigned a value but never used. Allowed unused vars must match /^_/u
- 1430: 'toggleCalCardView' is assigned a value but never used. Allowed unused vars must match /^_/u
- 1940: 'ncTasksPanel' is assigned a value but never used. Allowed unused vars must match /^_/u
- 2054: 'specialCalendarRows' is assigned a value but never used. Allowed unused vars must match /^_/u
- 2058: 'calendarNowInsertIndex' is assigned a value but never used. Allowed unused vars must match /^_/u
- 2199: 'chiefFallback' is assigned a value but never used. Allowed unused vars must match /^_/u
- 2227: 'ageHours' is defined but never used. Allowed unused args must match /^_/u
- 2227: 'text' is defined but never used. Allowed unused args must match /^_/u
- 2228: 'text' is defined but never used. Allowed unused args must match /^_/u
- 2229: 'summary' is defined but never used. Allowed unused args must match /^_/u
- 2230: 'now' is defined but never used. Allowed unused args must match /^_/u
- 2230: 'past' is defined but never used. Allowed unused args must match /^_/u
- 2238: 'time' is defined but never used. Allowed unused args must match /^_/u
- 2239: 'time' is defined but never used. Allowed unused args must match /^_/u
- 2248: 'taskSuggestionScanKey' is assigned a value but never used. Allowed unused vars must match /^_/u
- 2785: 'startChiefChatResize' is assigned a value but never used. Allowed unused vars must match /^_/u
- 2841: 'chiefSummaryText' is assigned a value but never used. Allowed unused vars must match /^_/u
- 2866: 'globalSnapshotParts' is assigned a value but never used. Allowed unused vars must match /^_/u
- 2920: 'nerveSummaryStrip' is assigned a value but never used. Allowed unused vars must match /^_/u
- 3346: 'boxRows' is assigned a value but never used. Allowed unused vars must match /^_/u
- 3424: 'fmtTimeM' is assigned a value but never used. Allowed unused vars must match /^_/u
- 3430: 'upcomingCal' is assigned a value but never used. Allowed unused vars must match /^_/u
- 3438: 'rowMinH' is assigned a value but never used. Allowed unused vars must match /^_/u
- 3439: 'bodyF' is assigned a value but never used. Allowed unused vars must match /^_/u
- 3440: 'metaF' is assigned a value but never used. Allowed unused vars must match /^_/u
- 3441: 'lineH' is assigned a value but never used. Allowed unused vars must match /^_/u
- 3454: 'trunc' is assigned a value but never used. Allowed unused vars must match /^_/u
- 3455: 'joinTop' is assigned a value but never used. Allowed unused vars must match /^_/u
- 3651: 'ti' is defined but never used. Allowed unused args must match /^_/u
- 3727: 'si' is defined but never used. Allowed unused args must match /^_/u
- 3913: 'hd' is assigned a value but never used. Allowed unused vars must match /^_/u
- 3914: 'fmtStepsM' is assigned a value but never used. Allowed unused vars must match /^_/u
- 3915: 'fmtSleepM' is assigned a value but never used. Allowed unused vars must match /^_/u
- 4013: 'ti' is defined but never used. Allowed unused args must match /^_/u
- 4176: 'si' is defined but never used. Allowed unused args must match /^_/u
- 4341: 'ti' is defined but never used. Allowed unused args must match /^_/u
- 4408: 'idx' is defined but never used. Allowed unused args must match /^_/u
- 4481: 'fmtEvtTime' is assigned a value but never used. Allowed unused vars must match /^_/u
- 4487: 'isNow' is assigned a value but never used. Allowed unused vars must match /^_/u
- 4535: 'hasCurrentCalendarEvent' is assigned a value but never used. Allowed unused vars must match /^_/u
- 4536: 'calendarNowLine' is assigned a value but never used. Allowed unused vars must match /^_/u
- 4724: 'secFrac' is assigned a value but never used. Allowed unused vars must match /^_/u

## src/08-app-split/App.jsx  (35)
- 2: 'PALETTE' is defined but never used. Allowed unused vars must match /^_/u
- 2: 'aiParseConversation' is defined but never used. Allowed unused vars must match /^_/u
- 5: 'ContextBadges' is defined but never used. Allowed unused vars must match /^_/u
- 5: 'OverwhelmBanner' is defined but never used. Allowed unused vars must match /^_/u
- 6: 'ContextTagPicker' is defined but never used. Allowed unused vars must match /^_/u
- 8: 'savePendingRecording' is defined but never used. Allowed unused vars must match /^_/u
- 14: 'DeskPhoneSuitePanel' is defined but never used. Allowed unused vars must match /^_/u
- 26: 'isShailaPriority' is defined but never used. Allowed unused vars must match /^_/u
- 28: 'List' is defined but never used. Allowed unused vars must match /^_/u
- 28: 'ListItem' is defined but never used. Allowed unused vars must match /^_/u
- 222: 'justOpt' is assigned a value but never used. Allowed unused elements of array destructuring patterns must match /^_/u
- 226: 'showLM' is assigned a value but never used. Allowed unused elements of array destructuring patterns must match /^_/u
- 233: 'navExp' is assigned a value but never used. Allowed unused elements of array destructuring patterns must match /^_/u
- 245: 'ctxPicker' is assigned a value but never used. Allowed unused elements of array destructuring patterns must match /^_/u
- 245: 'setCtxPicker' is assigned a value but never used. Allowed unused elements of array destructuring patterns must match /^_/u
- 251: 'energyModal' is assigned a value but never used. Allowed unused elements of array destructuring patterns must match /^_/u
- 251: 'setEnergyModal' is assigned a value but never used. Allowed unused elements of array destructuring patterns must match /^_/u
- 259: 'showOverwhelm' is assigned a value but never used. Allowed unused elements of array destructuring patterns must match /^_/u
- 259: 'setShowOverwhelm' is assigned a value but never used. Allowed unused elements of array destructuring patterns must match /^_/u
- 283: 'googleAuthMode' is assigned a value but never used. Allowed unused elements of array destructuring patterns must match /^_/u
- 320: 'isPrioritizing' is assigned a value but never used. Allowed unused elements of array destructuring patterns must match /^_/u
- 381: 'inputTmr' is assigned a value but never used. Allowed unused vars must match /^_/u
- 385: 'autoOptTmr' is assigned a value but never used. Allowed unused vars must match /^_/u
- 2258: 'expandNav' is assigned a value but never used. Allowed unused vars must match /^_/u
- 2474: 'shailaCount' is assigned a value but never used. Allowed unused vars must match /^_/u
- 2690: 'delGroup' is defined but never used. Allowed unused vars must match /^_/u
- 2769: 'manOpt' is defined but never used. Allowed unused vars must match /^_/u
- 2814: 'addList' is defined but never used. Allowed unused vars must match /^_/u
- 2815: 'renList' is defined but never used. Allowed unused vars must match /^_/u
- 2829: 'switchList' is defined but never used. Allowed unused vars must match /^_/u
- 2830: 'addPri' is defined but never used. Allowed unused vars must match /^_/u
- 2838: 'remPri' is defined but never used. Allowed unused vars must match /^_/u
- 3349: 'saveHealthConfigToFirebase' is defined but never used. Allowed unused vars must match /^_/u
- 4639: 'idx' is defined but never used. Allowed unused args must match /^_/u
- 4680: 'idx' is defined but never used. Allowed unused args must match /^_/u

## src/04-components.jsx  (14)
- 5: 'uid' is defined but never used. Allowed unused vars must match /^_/u
- 5: 'db' is defined but never used. Allowed unused vars must match /^_/u
- 5: 'Store' is defined but never used. Allowed unused vars must match /^_/u
- 8: 'TonalButton' is defined but never used. Allowed unused vars must match /^_/u
- 95: 'T' is defined but never used. Allowed unused args must match /^_/u
- 110: 'T' is defined but never used. Allowed unused args must match /^_/u
- 130: 'T' is defined but never used. Allowed unused args must match /^_/u
- 144: 'T' is defined but never used. Allowed unused args must match /^_/u
- 153: 'T' is defined but never used. Allowed unused args must match /^_/u
- 782: 'pris' is defined but never used. Allowed unused args must match /^_/u
- 829: 'T' is defined but never used. Allowed unused args must match /^_/u
- 884: 'colHeight' is assigned a value but never used. Allowed unused vars must match /^_/u
- 887: 'totalScroll' is assigned a value but never used. Allowed unused vars must match /^_/u
- 1395: 'submitNewShaila' is defined but never used. Allowed unused vars must match /^_/u

## src/10-deskphone-web.jsx  (11)
- 653: 'channelLabel' is defined but never used. Allowed unused vars must match /^_/u
- 742: 'quickConnectSummary' is defined but never used. Allowed unused vars must match /^_/u
- 751: 'localPhoneHostName' is defined but never used. Allowed unused vars must match /^_/u
- 751: 'status' is defined but never used. Allowed unused args must match /^_/u
- 1027: 'enrichMessageWithContact' is defined but never used. Allowed unused vars must match /^_/u
- 1192: 'groupCallsByNumber' is defined but never used. Allowed unused vars must match /^_/u
- 1239: 'SourceTag' is defined but never used. Allowed unused vars must match /^_/u
- 1823: 'selectedConversation' is defined but never used. Allowed unused args must match /^_/u
- 3294: 'syncThemeWithShamash' is assigned a value but never used. Allowed unused vars must match /^_/u
- 3296: 'isDarkModeEnabled' is assigned a value but never used. Allowed unused vars must match /^_/u
- 6445: 'relayStale' is assigned a value but never used. Allowed unused vars must match /^_/u

## src/03-voice.jsx  (6)
- 3: 'useState' is defined but never used. Allowed unused vars must match /^_/u
- 3: 'useEffect' is defined but never used. Allowed unused vars must match /^_/u
- 3: 'useRef' is defined but never used. Allowed unused vars must match /^_/u
- 3: 'useCallback' is defined but never used. Allowed unused vars must match /^_/u
- 19: 'webText' is assigned a value but never used. Allowed unused elements of array destructuring patterns must match /^_/u
- 182: 'webSpeechFallback' is defined but never used. Allowed unused args must match /^_/u

## src/01-core.js  (4)
- 1078: 'lists' is assigned a value but never used. Allowed unused vars must match /^_/u
- 1192: 'listId' is assigned a value but never used. Allowed unused vars must match /^_/u
- 1329: 'listId' is defined but never used. Allowed unused args must match /^_/u
- 1862: 'callGeminiProxy' is defined but never used. Allowed unused vars must match /^_/u

## src/08-app-split/components/HealthPage.jsx  (4)
- 1: 'useCallback' is defined but never used. Allowed unused vars must match /^_/u
- 1: 'useEffect' is defined but never used. Allowed unused vars must match /^_/u
- 2: 'ICON' is defined but never used. Allowed unused vars must match /^_/u
- 395: 'T' is defined but never used. Allowed unused args must match /^_/u

## src/08-app-split/components/ConvCapture.jsx  (3)
- 1: 'useMemo' is defined but never used. Allowed unused vars must match /^_/u
- 2: 'fmtMs' is defined but never used. Allowed unused vars must match /^_/u
- 4: 'suiteIcon' is defined but never used. Allowed unused vars must match /^_/u

## src/07-settings.jsx  (2)
- 3: 'useEffect' is defined but never used. Allowed unused vars must match /^_/u
- 4: 'DEF_PRI' is defined but never used. Allowed unused vars must match /^_/u

## src/08-app-split/components/NerveCenterPhoneSurface.jsx  (2)
- 247: 'isMobile' is assigned a value but never used. Allowed unused vars must match /^_/u
- 252: 'touchActions' is assigned a value but never used. Allowed unused vars must match /^_/u

## src/09-transcription-pen.js  (2)
- 207: 'blob' is defined but never used. Allowed unused args must match /^_/u
- 221: 'blob' is assigned a value but never used. Allowed unused vars must match /^_/u

## src/dev-mock.js  (2)
- 43: 'soon' is assigned a value but never used. Allowed unused vars must match /^_/u
- 412: 'lists' is assigned a value but never used. Allowed unused vars must match /^_/u

## src/08-app-split/components/ShailosTracker.jsx  (1)
- 102: 'blob' is defined but never used. Allowed unused args must match /^_/u

## src/08-app-split/components/SuitePanels.jsx  (1)
- 57: 'post' is assigned a value but never used. Allowed unused vars must match /^_/u

## src/08-app-split/components/TaskRiverPanel.jsx  (1)
- 133: 'onOpenPhone' is defined but never used. Allowed unused args must match /^_/u

## src/08-app-split/utils/shailosQueue.js  (1)
- 5: 'priorities' is assigned a value but never used. Allowed unused vars must match /^_/u

## src/09-next/system/kit.jsx  (1)
- 2: 'ELEV' is defined but never used. Allowed unused vars must match /^_/u

## src/11-relay-tester.jsx  (1)
- 21: 'Divider' is defined but never used. Allowed unused vars must match /^_/u