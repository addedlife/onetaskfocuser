const childProcess = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");

const previewUrl = "http://127.0.0.1:4183/?view=deskphone";
const hostPort = 8876;
const cdpPort = 9226;

const chromePath = [
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
].find((candidate) => fs.existsSync(candidate));

if (!chromePath) {
  throw new Error("Google Chrome was not found for the smoke test.");
}

const imageDataUrl =
  "data:image/svg+xml;base64," +
  Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="320"><rect width="480" height="320" fill="#1A73E8"/><circle cx="170" cy="150" r="86" fill="#CEEAD6"/><rect x="285" y="86" width="130" height="170" rx="18" fill="#FCE8E6"/></svg>'
  ).toString("base64");

const messages = Array.from({ length: 180 }, (_, i) => ({
  id: `m${i}`,
  handle: `m${i}`,
  from: i % 3 === 0 ? "Me" : "+15551234567",
  to: i % 3 === 0 ? "+15551234567" : "",
  number: "+15551234567",
  body: `History line ${i + 1}`,
  preview: `History line ${i + 1}`,
  timestamp: new Date(Date.UTC(2026, 4, 3, 12, i)).toISOString(),
  isSent: i % 3 === 0,
  isRead: i % 4 !== 0,
  isPinned: i === 20,
  pinActionLabel: i === 20 ? "Unpin" : "Pin",
  isMms: false,
  attachments: [],
}));

messages.push({
  id: "pending-confirming",
  handle: "",
  from: "Me",
  to: "+15551234567",
  number: "+15551234567",
  body: "Awaiting phone confirmation",
  preview: "Awaiting phone confirmation",
  timestamp: new Date(Date.UTC(2026, 4, 3, 15, 45)).toISOString(),
  isSent: true,
  isRead: true,
  sendStatus: "Confirming",
  sendStatusLabel: "Confirming",
  outgoingStatusLabel: "Confirming on phone",
  isMms: false,
  attachments: [],
});

messages.push({
  id: "mms-photo",
  handle: "mms-photo",
  from: "+15551234567",
  to: "",
  number: "+15551234567",
  body: "",
  preview: "",
  timestamp: new Date(Date.UTC(2026, 4, 3, 16, 0)).toISOString(),
  isSent: false,
  isRead: true,
  isMms: true,
  attachments: [
    {
      fileName: "test-photo.svg",
      contentType: "image/svg+xml",
      isImage: true,
      isContactCard: false,
      size: 1200,
      dataUrl: imageDataUrl,
    },
  ],
});

const calls = [
  {
    id: "call-1",
    number: "+15551234567",
    direction: "Incoming",
    directionLabel: "Incoming",
    timestamp: new Date(Date.UTC(2026, 4, 3, 15, 0)).toISOString(),
    durationDisplay: "2 min",
  },
  {
    id: "call-2",
    number: "+15551234567",
    direction: "Missed",
    directionLabel: "Missed",
    timestamp: new Date(Date.UTC(2026, 4, 3, 16, 15)).toISOString(),
    durationDisplay: "",
    isMissed: true,
  },
  {
    id: "call-3",
    number: "+15551234567",
    direction: "Outgoing",
    directionLabel: "Outgoing",
    timestamp: new Date(Date.UTC(2026, 4, 3, 17, 30)).toISOString(),
    durationDisplay: "48 sec",
  },
  {
    id: "call-4",
    number: "+15557654321",
    direction: "Outgoing",
    directionLabel: "Outgoing",
    timestamp: new Date(Date.UTC(2026, 4, 3, 18, 0)).toISOString(),
    durationDisplay: "1 min",
  },
];
const contacts = [
  {
    id: "contact-1",
    displayName: "A Test Contact",
    primaryPhone: "+15551234567",
    phoneNumbers: ["+15551234567"],
  },
  {
    id: "contact-2",
    displayName: "B Backup Contact",
    primaryPhone: "+15557654321",
    phoneNumbers: ["+15557654321"],
  },
];

let hasUndoMessageDelete = false;
const handoffRequests = [];
const commandRequests = [];

const server = http.createServer((req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const requestPath = new URL(req.url, `http://127.0.0.1:${hostPort}`).pathname;
  const send = (payload) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload));
  };

  if (requestPath === "/status") {
    send({
      hfp: "Connected",
      map: "Connected",
      callState: "Active",
      isCallActive: true,
      isMuted: false,
      showReconnectPrompt: true,
      showBuildUpdatePrompt: false,
      showBuildUpdateIndicator: true,
      pendingBuildVersion: "b999",
      pendingBuildTitle: "New Build Available: b999",
      pendingBuildBody: "Switch to the staged smoke-test build.",
      fullHistoryStatus: "Full history ready",
      build: "b242  2026-05-04 10:00",
      syncThemeWithShamash: false,
      pauseHistoryActivity: false,
      isDarkModeEnabled: false,
      themeSyncLabel: "Theme sync off",
      themeSyncRefreshStatus: "",
      hasUndoMessageDelete,
      undoMessageDeleteText: hasUndoMessageDelete ? "Message deleted from +1 (555) 123-4567" : "",
      hasUndoCallHistoryDelete: true,
      undoCallHistoryDeleteText: "Call deleted: Incoming +1 (555) 123-4567",
      bluetoothStatus: "2 device(s) found",
      isScanning: false,
      isConnecting: false,
      selectedDeviceAddress: "AABBCCDDEEFF",
      knownDevices: [
        { address: "AABBCCDDEEFF", name: "FIG-NEWTON", isDefault: true, lastSeen: "2026-05-06T12:00:00Z" },
      ],
      scannedDevices: [
        { address: "112233445566", name: "Backup Phone", isPaired: true },
      ],
    });
  } else if (requestPath === "/messages") {
    send(messages);
  } else if (requestPath === "/calls") {
    send(calls);
  } else if (requestPath === "/contacts") {
    send(contacts);
  } else if (requestPath === "/handoff") {
    const searchParams = new URL(req.url, `http://127.0.0.1:${hostPort}`).searchParams;
    handoffRequests.push({
      target: searchParams.get("target") || "",
      value: searchParams.get("value") || "",
    });
    send({ ok: true });
  } else if (requestPath === "/handoff-log") {
    send(handoffRequests);
  } else if (requestPath === "/command-log") {
    send(commandRequests);
  } else if (requestPath === "/delete-message") {
    hasUndoMessageDelete = true;
    commandRequests.push({ path: req.url });
    send({ ok: true });
  } else if (requestPath === "/undo-message-delete") {
    hasUndoMessageDelete = false;
    commandRequests.push({ path: req.url });
    send({ ok: true });
  } else if (["/dial", "/send", "/audio-refresh", "/open-bluetooth-settings", "/open-sound-settings", "/open-builds-folder", "/open-event-log", "/open-contact-sync-folder", "/export-messages-backup", "/reset-ui-scale", "/refresh-theme-sync", "/import-starter-vcf", "/import-pending-contacts", "/skip-pending-contacts", "/set-theme-sync", "/set-history-paused", "/set-dark-mode", "/open-live-log", "/clear-log", "/run-ui-auditor", "/toggle-mute", "/accept-build-update", "/snooze-build-update", "/show-build-update-prompt", "/toggle-message-pin", "/scan-devices", "/connect-saved-device", "/set-default-saved-device", "/forget-saved-device", "/connect-scanned-device", "/save-contact", "/delete-contact", "/undo-call-history-delete"].includes(requestPath)) {
    commandRequests.push({ path: req.url });
    send({ ok: true });
  } else {
    send({ ok: true });
  }
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function openSocket(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.addEventListener("open", () => resolve(ws), { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
}

async function waitForChrome() {
  const started = Date.now();
  while (Date.now() - started < 10000) {
    try {
      const response = await fetch(`http://127.0.0.1:${cdpPort}/json/version`);
      if (response.ok) return;
    } catch {}
    await sleep(150);
  }
  throw new Error("Chrome remote debugging did not start.");
}

async function newTarget(url) {
  let response = await fetch(`http://127.0.0.1:${cdpPort}/json/new?${encodeURIComponent(url)}`, {
    method: "PUT",
  });
  if (!response.ok) {
    response = await fetch(`http://127.0.0.1:${cdpPort}/json/new?${encodeURIComponent(url)}`);
  }
  if (!response.ok) throw new Error(`Could not create browser target: ${response.status}`);
  return response.json();
}

async function runCdp() {
  const target = await newTarget("about:blank");
  const ws = await openSocket(target.webSocketDebuggerUrl);
  let nextId = 1;
  const pending = new Map();
  const waiters = new Map();

  ws.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const request = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) request.reject(new Error(message.error.message));
      else request.resolve(message.result || {});
      return;
    }
    const list = waiters.get(message.method);
    if (list?.length) list.shift()(message.params || {});
  });

  const call = (method, params = {}) =>
    new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });

  const waitEvent = (method, timeout = 10000) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${method}`)), timeout);
      const list = waiters.get(method) || [];
      list.push((params) => {
        clearTimeout(timer);
        resolve(params);
      });
      waiters.set(method, list);
    });

  const evalValue = async (expression) => {
    const result = await call("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || "Runtime evaluation failed");
    }
    return result.result?.value;
  };

  const waitFor = async (expression, timeout = 12000) => {
    const started = Date.now();
    while (Date.now() - started < timeout) {
      if (await evalValue(expression)) return true;
      await sleep(100);
    }
    throw new Error(`Timed out waiting for ${expression}`);
  };

  await call("Page.enable");
  await call("Runtime.enable");
  await call("Emulation.setDeviceMetricsOverride", {
    width: 1400,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  });
  await call("Page.addScriptToEvaluateOnNewDocument", {
    source: `
      localStorage.setItem('deskphone_web_host_url','http://127.0.0.1:${hostPort}');
      localStorage.setItem('deskphone_web_bridge_url','http://127.0.0.1:${hostPort}');
      localStorage.setItem('deskphone_web_rail_autocollapse','false');
      localStorage.setItem('deskphone_web_rail_collapsed','false');
      localStorage.removeItem('deskphone_web_rail_width');
      localStorage.removeItem('deskphone_web_message_list_width');
      localStorage.removeItem('deskphone_web_call_history_width');
    `,
  });

  const loaded = waitEvent("Page.loadEventFired");
  await call("Page.navigate", { url: previewUrl });
  await loaded;
  await waitFor("!!document.querySelector('.dp-message-scroll') && document.querySelectorAll('.dp-message-item').length > 50");
  await waitFor("document.querySelector('.dp-mms-image')?.complete && document.querySelector('.dp-mms-image')?.naturalWidth > 0");

  const desktop = await evalValue(`(async () => {
    const waitForSelector = async (selector, timeout = 4000) => {
      const started = Date.now();
      while (Date.now() - started < timeout) {
        const found = document.querySelector(selector);
        if (found) return found;
        await new Promise((resolve) => setTimeout(resolve, 50));
      }
      return null;
    };
    const widthOf = (selector) => Math.round(document.querySelector(selector).getBoundingClientRect().width);
    const drag = (splitterSelector, targetSelector, dx) => {
      const splitter = document.querySelector(splitterSelector);
      const rect = splitter.getBoundingClientRect();
      const before = widthOf(targetSelector);
      splitter.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 4, clientX: rect.left + 3, clientY: rect.top + 20 }));
      window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 4, clientX: rect.left + 3 + dx, clientY: rect.top + 20 }));
      window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 4, clientX: rect.left + 3 + dx, clientY: rect.top + 20 }));
      return new Promise((resolve) => setTimeout(() => resolve({ before, after: widthOf(targetSelector) }), 50));
    };
    const rail = await drag('.dp-splitter', '.dp-rail', 58);
    const messageList = await drag('.dp-message-splitter', '.dp-conversation-pane', 64);
    const callHistory = await drag('.dp-thread-inner-splitter', '.dp-thread-calls', -72);
    const webVersionText = document.querySelector('.dp-app-build')?.textContent.trim() || '';
    const hostBuildText = document.querySelector('.dp-app-time')?.textContent.trim() || '';
    const chooseDeviceButton = document.querySelector('.dp-reconnect-prompt [data-native-source="MainWindow.xaml:812"]');
    chooseDeviceButton?.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const chooseDeviceOpenedSettings = !!document.querySelector('.dp-settings-shell');
    document.querySelector('button[data-native-source="MainWindow.xaml:508"]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    document.querySelector('[data-native-source="MainWindow.xaml:904"]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const buildPromptShown = !!document.querySelector('.dp-build-overlay [data-native-source="MainWindow.xaml:882"]');
    document.querySelector('.dp-build-overlay [data-native-source="MainWindow.xaml:887"]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    document.querySelector('[data-native-source="MainWindow.xaml:904"]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    document.querySelector('.dp-build-overlay [data-native-source="MainWindow.xaml:882"]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    document.querySelector('[data-native-source="MainWindow.xaml:973"]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    document.querySelector('button[data-native-source="MainWindow.xaml:455"]').click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const topNewMessageComposerOpened = !!document.querySelector('.dp-new-compose-shell[data-native-source="MainWindow.xaml:2999"]');
    document.querySelector('.dp-new-compose-shell [data-native-source="MainWindow.xaml:3036"]')?.click();
    const topNewMessageCancelReturned = !!(await waitForSelector('[data-automation-id="ThreadSearchBox"]'));
    const inputSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    const textareaSetter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    let threadSearchInput = await waitForSelector('[data-automation-id="ThreadSearchBox"]');
    if (!threadSearchInput) throw new Error('Thread search input missing after top New Message cancel');
    const incomingBubble = Array.from(document.querySelectorAll('.dp-message-bubble.is-incoming')).find((bubble) => bubble.querySelector('.dp-message-body'));
    const incomingForwardBody = incomingBubble?.querySelector('.dp-message-body')?.textContent.trim() || '';
    incomingBubble?.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    document.querySelector('button[data-native-source="MainWindow.xaml:2040"]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const forwardDraftBody = document.querySelector('[data-automation-id="NewMessageBody"]')?.value || '';
    const forwardDraftReady = !!incomingForwardBody && forwardDraftBody === incomingForwardBody;
    document.querySelector('.dp-new-compose-shell [data-native-source="MainWindow.xaml:3036"]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    threadSearchInput = await waitForSelector('[data-automation-id="ThreadSearchBox"]');
    const pinnedStripVisible = !!document.querySelector('.dp-pinned-message-strip[data-native-source="MainWindow.xaml:2670"]');
    document.querySelector('.dp-pinned-message-strip button[data-native-source="MainWindow.xaml:2670"]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 150));
    const pinnedJumpFound = document.querySelector('[data-message-id="m20"]')?.getBoundingClientRect().top < window.innerHeight;
    const pinnedMessage = document.querySelector('[data-message-id="m20"] .dp-message-bubble');
    pinnedMessage?.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    document.querySelector('[data-message-id="m20"] button[data-native-source="MainWindow.xaml:2052"]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const deleteMessage = document.querySelector('[data-message-id="m20"] button[data-native-source="MainWindow.xaml:2048"]');
    deleteMessage?.click();
    await new Promise((resolve) => setTimeout(resolve, 150));
    const messageDeleteUndoVisible = !!document.querySelector('.dp-undo-delete-bar button[data-native-source="MainWindow.xaml:2340"]');
    document.querySelector('.dp-undo-delete-bar button[data-native-source="MainWindow.xaml:2340"]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    inputSetter.call(threadSearchInput, 'History line 17');
    threadSearchInput.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 150));
    const threadSearchButtonSources = ["MainWindow.xaml:1693", "MainWindow.xaml:1697"].every((source) => !!document.querySelector('button[data-native-source="' + source + '"]'));
    const firstSearchCurrent = document.querySelector('[data-thread-search-current="true"] .dp-message-body')?.textContent.trim() || '';
    document.querySelector('button[data-native-source="MainWindow.xaml:1697"]').click();
    await new Promise((resolve) => setTimeout(resolve, 150));
    const nextSearchCurrent = document.querySelector('[data-thread-search-current="true"] .dp-message-body')?.textContent.trim() || '';
    document.querySelector('button[data-native-source="MainWindow.xaml:1693"]').click();
    await new Promise((resolve) => setTimeout(resolve, 150));
    const previousSearchCurrent = document.querySelector('[data-thread-search-current="true"] .dp-message-body')?.textContent.trim() || '';
    const threadSearchNavigation = threadSearchButtonSources && firstSearchCurrent && nextSearchCurrent && nextSearchCurrent !== firstSearchCurrent && previousSearchCurrent === firstSearchCurrent;
    const conversationMenu = document.querySelector('.dp-conversation-menu');
    conversationMenu.open = true;
    const conversationMenuSources = ["MainWindow.xaml:1299", "MainWindow.xaml:1302", "MainWindow.xaml:1306", "MainWindow.xaml:1309", "MainWindow.xaml:1312"];
    const conversationMenuActions = conversationMenuSources.every((source) => !!document.querySelector('.dp-conversation-menu button[data-native-source="' + source + '"]'));
    for (const source of conversationMenuSources) {
      document.querySelector('.dp-conversation-menu button[data-native-source="' + source + '"]').click();
      await new Promise((resolve) => setTimeout(resolve, 60));
    }
    conversationMenu.open = false;
    const scrollBox = document.querySelector('.dp-message-scroll');
    const scrollable = scrollBox.scrollHeight > scrollBox.clientHeight + 30;
    scrollBox.scrollTop = 0;
    document.querySelector('.dp-scroll-bottom').click();
    await new Promise((resolve) => setTimeout(resolve, 600));
    const maxTop = scrollBox.scrollHeight - scrollBox.clientHeight;
    const scrolledToBottom = scrollBox.scrollTop >= maxTop - 8;
    const placeholderShown = Array.from(document.querySelectorAll('.dp-muted-body')).some((el) => el.textContent.includes('MMS message'));
    const callRowsAll = document.querySelectorAll('.dp-thread-call-row').length;
    document.querySelector('[data-automation-id="CallHistoryFilterMissed"]').click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const callRowsMissed = document.querySelectorAll('.dp-thread-call-row').length;
    const missedLabel = document.querySelector('.dp-thread-call-row strong')?.textContent.trim() || '';
    document.querySelector('[data-automation-id="CallHistoryFilterOut"]').click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const callRowsOut = document.querySelectorAll('.dp-thread-call-row').length;
    const outLabel = document.querySelector('.dp-thread-call-row strong')?.textContent.trim() || '';
    document.querySelector('[data-automation-id="CallHistoryFilterAll"]').click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    document.querySelector('[data-native-source="MainWindow.xaml:2826"]').click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const replyFocusedFromCallRow = document.activeElement?.getAttribute('data-automation-id') === 'ReplyComposeBox';
    document.querySelector('[data-native-source="MainWindow.xaml:2831"]').click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    document.querySelector('[data-native-source="MainWindow.xaml:2592"]').click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    document.querySelector('[data-native-source="MainWindow.xaml:2836"]').click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    document.querySelector('[data-native-source="MainWindow.xaml:2841"]').click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const threadCallUndoVisible = !!document.querySelector('.dp-call-undo-bar[data-native-source="MainWindow.xaml:2627"] button');
    document.querySelector('.dp-call-undo-bar[data-native-source="MainWindow.xaml:2627"] button')?.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    document.querySelector('[data-native-source="MainWindow.xaml:2573"]').click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const dialerOpened = !!document.querySelector('.dp-thread-dialer');
    const dialerInput = document.querySelector('[data-automation-id="ThreadDialerNumber"]');
    if (!dialerInput) throw new Error('Thread dialer input missing after opening keypad');
    const dialerKeypadSources = Array.from(document.querySelectorAll('.dp-thread-dialer-keys button')).map((button) => button.getAttribute('data-native-source'));
    document.querySelector('[data-native-source="MainWindow.xaml:2952"]').click();
    document.querySelector('[data-native-source="MainWindow.xaml:2961"]').click();
    document.querySelector('[data-native-source="MainWindow.xaml:2963"]').click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const dialerAfterKeypad = document.querySelector('[data-automation-id="ThreadDialerNumber"]').value;
    inputSetter.call(dialerInput, '5559');
    dialerInput.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('[data-native-source="MainWindow.xaml:2893"]').click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const dialerAfterBackspace = document.querySelector('[data-automation-id="ThreadDialerNumber"]').value;
    document.querySelector('[data-native-source="MainWindow.xaml:2931"]').click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    document.querySelector('[data-native-source="MainWindow.xaml:2992"]').click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    document.querySelector('[data-native-source="MainWindow.xaml:2966"]').click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    document.querySelector('button[data-native-source="MainWindow.xaml:2871"]').click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const dialerClosed = !document.querySelector('.dp-thread-dialer');
    document.querySelector('[data-native-source="MainWindow.xaml:1078"]').click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const headerNewMessageComposerOpened = !!document.querySelector('.dp-new-compose-shell[data-native-source="MainWindow.xaml:2999"]');
    document.querySelector('.dp-new-compose-shell .dp-compose-contact-list button[data-native-source="MainWindow.xaml:3069"]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const pickedComposeContact = document.querySelector('[data-automation-id="NewMessageTo"]')?.value || '';
    const newMessageBody = document.querySelector('[data-automation-id="NewMessageBody"]');
    if (!newMessageBody) throw new Error('New Message body missing after header New Message open');
    textareaSetter.call(newMessageBody, 'Browser full compose smoke');
    newMessageBody.dispatchEvent(new Event('input', { bubbles: true }));
    newMessageBody.dispatchEvent(new Event('change', { bubbles: true }));
    let newMessageSendButton = document.querySelector('.dp-new-compose-shell [data-native-source="MainWindow.xaml:3136"]');
    for (let i = 0; i < 20 && newMessageSendButton?.disabled; i++) {
      await new Promise((resolve) => setTimeout(resolve, 50));
      newMessageSendButton = document.querySelector('.dp-new-compose-shell [data-native-source="MainWindow.xaml:3136"]');
    }
    newMessageSendButton?.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    document.querySelector('.dp-new-compose-shell [data-native-source="MainWindow.xaml:3036"]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    document.querySelector('[data-native-source="MainWindow.xaml:1750"]').click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    document.querySelector('[data-native-source="MainWindow.xaml:1755"]').click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    document.querySelector('[data-native-source="MainWindow.xaml:1742"]').click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    document.querySelector('[data-native-source="MainWindow.xaml:1746"]').click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    document.querySelector('button[data-native-source="MainWindow.xaml:1738"]').click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    document.querySelector('[data-native-source="MainWindow.xaml:1760"]').click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    document.querySelector('[data-native-source="MainWindow.xaml:1766"]').click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const image = document.querySelector('.dp-mms-image');
    const pendingStatusText = document.querySelector('.dp-message-status.is-confirming')?.textContent.trim() || '';
    const imageBubble = image.closest('.dp-message-bubble');
    const imageAttachmentRows = imageBubble.querySelectorAll('.dp-attachment-row').length;
    const imageAttachmentStack = imageBubble.querySelector('.dp-attachment-stack');
    const imageMeta = imageBubble.querySelector('.dp-message-meta');
    const messageCount = document.querySelectorAll('.dp-message-item').length;
    const imageWhitespaceRemoved =
      getComputedStyle(imageAttachmentStack).marginTop === '0px' &&
      getComputedStyle(imageMeta).display === 'none' &&
      getComputedStyle(imageBubble).backgroundColor === 'rgba(0, 0, 0, 0)';
    image.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    const opened = !!document.querySelector('.dp-image-viewer');
    document.querySelector('.dp-image-viewer-tools button[aria-label="Rotate right"]').click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const transform = document.querySelector('.dp-image-viewer-stage img')?.style.transform || '';
    document.querySelector('.dp-image-viewer-close').click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    document.querySelector('[data-native-source="MainWindow.xaml:586"]').click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const settingsSectionSources = ["MainWindow.xaml:4000", "MainWindow.xaml:4005", "MainWindow.xaml:4010"];
    const settingsSectionButtons = settingsSectionSources.every((source) => !!document.querySelector('.dp-settings-sections button[data-native-source="' + source + '"]'));
    const deviceControlButtons = ["MainWindow.xaml:4052", "MainWindow.xaml:4083", "MainWindow.xaml:4088", "MainWindow.xaml:4102", "MainWindow.xaml:4135", "MainWindow.xaml:4150"].every((source) => !!document.querySelector('.dp-settings-shell button[data-native-source="' + source + '"]'));
    const settingsToolSourcesBySection = [
      { section: null, sources: ["MainWindow.xaml:4140", "MainWindow.xaml:4627", "MainWindow.xaml:4633", "MainWindow.xaml:4052", "MainWindow.xaml:4083", "MainWindow.xaml:4088", "MainWindow.xaml:4102", "MainWindow.xaml:4135", "MainWindow.xaml:4150"] },
      { section: "MainWindow.xaml:4000", sources: ["MainWindow.xaml:4235", "MainWindow.xaml:4288"] },
      { section: "MainWindow.xaml:4005", sources: ["MainWindow.xaml:4381", "MainWindow.xaml:4385", "MainWindow.xaml:4390", "MainWindow.xaml:4395", "MainWindow.xaml:4412"] },
      { section: "MainWindow.xaml:4010", sources: ["MainWindow.xaml:4480", "MainWindow.xaml:4476"] },
    ];
    let settingsToolButtons = true;
    for (const group of settingsToolSourcesBySection) {
      if (group.section) {
        document.querySelector('.dp-settings-sections button[data-native-source="' + group.section + '"]').click();
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      for (const source of group.sources) {
        const button = document.querySelector('.dp-settings-shell button[data-native-source="' + source + '"]');
        settingsToolButtons = settingsToolButtons && !!button;
        button?.click();
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    const settingsToggleSources = ["MainWindow.xaml:4258", "MainWindow.xaml:4294", "MainWindow.xaml:4309"];
    document.querySelector('.dp-settings-sections button[data-native-source="MainWindow.xaml:4000"]').click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const settingsToggleButtons = settingsToggleSources.every((source) => !!document.querySelector('.dp-settings-toggle[data-native-source="' + source + '"] input'));
    for (const source of settingsToggleSources) {
      document.querySelector('.dp-settings-toggle[data-native-source="' + source + '"] input')?.click();
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    for (const source of settingsSectionSources) {
      document.querySelector('.dp-settings-sections button[data-native-source="' + source + '"]').click();
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    document.querySelector('button[data-native-source="MainWindow.xaml:562"]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const contactsSurface = !!document.querySelector('.dp-contacts-shell[data-native-source="MainWindow.xaml:3368"]');
    const contactActionSources = ["MainWindow.xaml:3766", "MainWindow.xaml:3888", "MainWindow.xaml:3895", "MainWindow.xaml:3919", "MainWindow.xaml:3948", "MainWindow.xaml:3953", "MainWindow.xaml:3959"];
    const contactActionButtons = contactActionSources.every((source) => !!document.querySelector('.dp-contacts-shell [data-native-source="' + source + '"]'));
    document.querySelector('.dp-contacts-shell [data-native-source="MainWindow.xaml:3888"]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    document.querySelector('.dp-contacts-shell [data-native-source="MainWindow.xaml:3895"]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    document.querySelector('.dp-contacts-shell [data-native-source="MainWindow.xaml:3919"]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    document.querySelector('.dp-contacts-shell [data-native-source="MainWindow.xaml:3953"]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    document.querySelector('.dp-contacts-shell [data-native-source="MainWindow.xaml:3766"]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    document.querySelector('.dp-contacts-shell [data-native-source="MainWindow.xaml:3948"]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const contactNameInput = document.querySelector('[data-automation-id="ContactEditorName"]');
    const contactPhoneInput = document.querySelector('[data-automation-id="ContactEditorPhone"]');
    inputSetter.call(contactNameInput, 'Browser Contact');
    contactNameInput.dispatchEvent(new Event('input', { bubbles: true }));
    inputSetter.call(contactPhoneInput, '+15550001111');
    contactPhoneInput.dispatchEvent(new Event('input', { bubbles: true }));
    document.querySelector('.dp-contacts-shell [data-native-source="MainWindow.xaml:3959"]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    document.querySelector('button[data-native-source="MainWindow.xaml:544"]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const fullCallsSurface = !!document.querySelector('.dp-calls-shell .dp-thread-calls.is-full-calls');
    const fullCallsRowsAll = document.querySelectorAll('.dp-calls-shell .dp-thread-call-row').length;
    document.querySelector('.dp-calls-shell [data-automation-id="CallHistoryFilterOut"]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const fullCallsRowsOut = document.querySelectorAll('.dp-calls-shell .dp-thread-call-row').length;
    const fullCallsActionSources = ["MainWindow.xaml:3513", "MainWindow.xaml:3518", "MainWindow.xaml:3522", "MainWindow.xaml:3527"]
      .every((source) => !!document.querySelector('.dp-calls-shell [data-native-source="' + source + '"]'));
    document.querySelector('.dp-calls-shell [data-native-source="MainWindow.xaml:3513"]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    document.querySelector('.dp-calls-shell [data-native-source="MainWindow.xaml:3518"]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    document.querySelector('.dp-calls-shell [data-native-source="MainWindow.xaml:3522"]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    document.querySelector('.dp-calls-shell [data-native-source="MainWindow.xaml:3527"]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    document.querySelector('.dp-calls-shell [data-native-source="MainWindow.xaml:3259"]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const fullCallsRecentsHidden = !document.querySelector('.dp-calls-shell .dp-thread-call-row') && !!document.querySelector('.dp-calls-hidden-pane');
    document.querySelector('.dp-calls-hidden-pane [data-native-source="MainWindow.xaml:3204"]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const fullCallsRecentsRestored = document.querySelectorAll('.dp-calls-shell .dp-thread-call-row').length === fullCallsRowsOut;
    const fullCallUndoVisible = !!document.querySelector('.dp-call-undo-bar[data-native-source="MainWindow.xaml:3378"] button');
    document.querySelector('.dp-call-undo-bar[data-native-source="MainWindow.xaml:3378"] button')?.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    document.querySelector('.dp-calls-shell [data-native-source="MainWindow.xaml:3576"]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const fullCallsDialerClosed = !document.querySelector('.dp-calls-shell .dp-thread-dialer');
    document.querySelector('button[data-native-source="MainWindow.xaml:525"]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const fullCallsDialerFromMakeCall = !!document.querySelector('.dp-calls-shell .dp-thread-dialer');
    document.querySelector('button[data-native-source="MainWindow.xaml:603"]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const developerToolSources = ["MainWindow.xaml:620", "LogWindow.xaml:45", "MainWindow.xaml:4346", "MainWindow.xaml:4639"];
    const developerToolButtons = developerToolSources.every((source) => !!document.querySelector('.dp-tab-placeholder button[data-native-source="' + source + '"]'));
    for (const source of developerToolSources) {
      document.querySelector('.dp-tab-placeholder button[data-native-source="' + source + '"]')?.click();
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    document.querySelector('[data-automation-id="DeskPhoneRailAutoCollapseToggle"]')?.click();
    await new Promise((resolve) => setTimeout(resolve, 10650));
    const railAutoCollapsedAfterIdle = document.querySelector('.dp-shell')?.classList.contains('is-collapsed') || false;
    const handoffRequests = await fetch('http://127.0.0.1:${hostPort}/handoff-log').then((response) => response.json());
    const commandRequests = await fetch('http://127.0.0.1:${hostPort}/command-log').then((response) => response.json());
    return {
      rail,
      messageList,
      callHistory,
      webVersionText,
      hostBuildText,
      chooseDeviceOpenedSettings,
      buildPromptShown,
      forwardDraftReady,
      pinnedStripVisible,
      pinnedJumpFound,
      messageDeleteUndoVisible,
      handoffRequests,
      commandRequests,
      threadSearchNavigation,
      conversationMenuActions,
      topNewMessageComposerOpened,
      topNewMessageCancelReturned,
      headerNewMessageComposerOpened,
      pickedComposeContact,
      scrollable,
      scrolledToBottom,
      callRowsAll,
      callRowsMissed,
      missedLabel,
      callRowsOut,
      outLabel,
      replyFocusedFromCallRow,
      threadCallUndoVisible,
      dialerOpened,
      dialerKeypadSources,
      dialerAfterKeypad,
      dialerAfterBackspace,
      dialerClosed,
      settingsSectionButtons,
      settingsToolButtons,
      deviceControlButtons,
      settingsToggleButtons,
      contactsSurface,
      contactActionButtons,
      fullCallUndoVisible,
      fullCallsSurface,
      fullCallsRowsAll,
      fullCallsRowsOut,
      fullCallsActionSources,
      fullCallsRecentsHidden,
      fullCallsRecentsRestored,
      fullCallsDialerClosed,
      fullCallsDialerFromMakeCall,
      developerToolButtons,
      railAutoCollapsedAfterIdle,
      imageLoaded: image.naturalWidth > 0,
      pendingStatusText,
      imageBubbleIsMediaOnly: imageBubble.classList.contains('is-media-only'),
      imageAttachmentRows,
      imageWhitespaceRemoved,
      messageCount,
      placeholderShown,
      viewerOpened: opened,
      viewerRotated: transform.includes('90deg'),
      viewerClosed: !document.querySelector('.dp-image-viewer'),
      noHorizontalOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2
    };
  })()`);

  await call("Emulation.setDeviceMetricsOverride", {
    width: 390,
    height: 820,
    deviceScaleFactor: 1,
    mobile: true,
  });
  await sleep(250);

  const mobile = await evalValue(`(() => ({
    shellWidth: Math.round(document.querySelector('.dp-shell').getBoundingClientRect().width),
    noHorizontalOverflow: document.documentElement.scrollWidth <= document.documentElement.clientWidth + 2,
    splittersHidden: Array.from(document.querySelectorAll('.dp-splitter,.dp-message-splitter,.dp-thread-inner-splitter')).every((el) => getComputedStyle(el).display === 'none')
  }))()`);

  await call("Browser.close").catch(() => {});
  ws.close();
  return { desktop, mobile };
}

async function main() {
  const profile = path.join(os.tmpdir(), "codex-chrome-deskphone-smoke-profile");
  const chrome = childProcess.spawn(
    chromePath,
    [
      "--headless=new",
      "--disable-gpu",
      `--remote-debugging-port=${cdpPort}`,
      `--user-data-dir=${profile}`,
      "about:blank",
    ],
    { stdio: "ignore" }
  );

  await waitForChrome();
  await new Promise((resolve) => server.listen(hostPort, "127.0.0.1", resolve));

  try {
    const result = await runCdp();
    const failures = [];
    if (!(result.desktop.rail.after > result.desktop.rail.before)) failures.push("rail splitter did not expand");
    if (!(result.desktop.messageList.after > result.desktop.messageList.before)) failures.push("message splitter did not expand");
    if (!(result.desktop.callHistory.after > result.desktop.callHistory.before)) failures.push("call-history splitter did not expand");
    if (result.desktop.webVersionText !== "DeskPhone Web Version 001" || result.desktop.hostBuildText !== "Windows Host: b242") failures.push("web version or Windows host label is wrong");
    if (!result.desktop.chooseDeviceOpenedSettings) failures.push("Choose device did not open browser settings");
    if (!result.desktop.buildPromptShown) failures.push("build update indicator did not open the build prompt");
    for (const endpoint of ["/show-build-update-prompt", "/snooze-build-update", "/accept-build-update", "/toggle-mute"]) {
      if (!result.desktop.commandRequests.some((request) => request.path.includes(endpoint))) failures.push(`${endpoint} was not called`);
    }
    if (!result.desktop.topNewMessageComposerOpened || !result.desktop.topNewMessageCancelReturned) failures.push("top New Message composer open/cancel failed");
    if (!result.desktop.headerNewMessageComposerOpened || !result.desktop.pickedComposeContact.includes("5551234567")) failures.push("header New Message composer contact pick failed");
    if (!result.desktop.forwardDraftReady) failures.push("message forward did not open a prefilled New Message draft");
    if (!result.desktop.pinnedStripVisible || !result.desktop.pinnedJumpFound) failures.push("pinned message strip did not render or jump to the pinned message");
    if (!result.desktop.commandRequests.some((request) => request.path.includes("/toggle-message-pin") && request.path.includes("m20"))) failures.push("message pin action did not call /toggle-message-pin with the message id");
    if (!result.desktop.messageDeleteUndoVisible) failures.push("message delete did not show the undo bar");
    if (!result.desktop.commandRequests.some((request) => request.path.includes("/delete-message") && request.path.includes("m20"))) failures.push("message delete action did not call /delete-message with the message id");
    if (!result.desktop.commandRequests.some((request) => request.path.includes("/undo-message-delete"))) failures.push("message undo action did not call /undo-message-delete");
    if (!result.desktop.threadSearchNavigation) failures.push("thread search previous/next navigation failed");
    if (!result.desktop.conversationMenuActions) failures.push("conversation row action menu sources are incomplete");
    if (!result.desktop.handoffRequests.some((request) => request.target === "new-message")) failures.push("new-message handoff did not target desktop compose");
    for (const target of ["mark-read", "mark-unread", "toggle-pin", "toggle-mute", "toggle-block"]) {
      if (!result.desktop.handoffRequests.some((request) => request.target === target && request.value.includes("15551234567"))) failures.push(`${target} handoff did not carry the conversation number`);
    }
    if (!result.desktop.handoffRequests.some((request) => request.target === "new-contact" && request.value.includes("15551234567"))) failures.push("add-contact handoff did not carry the conversation number");
    if (!result.desktop.handoffRequests.some((request) => request.target === "edit-contact" && request.value.includes("15551234567"))) failures.push("edit-contact handoff did not carry the conversation number");
    if (!result.desktop.scrollable || !result.desktop.scrolledToBottom) failures.push("message history did not scroll to latest");
    if (result.desktop.callRowsAll !== 3 || result.desktop.callRowsMissed !== 1 || result.desktop.missedLabel !== "Missed") failures.push("missed-call filter did not isolate missed calls");
    if (result.desktop.callRowsOut !== 1 || result.desktop.outLabel !== "Outgoing") failures.push("outgoing-call filter did not isolate outgoing calls");
    if (!result.desktop.replyFocusedFromCallRow) failures.push("message-this-number call-row action did not focus the reply box");
    if (!result.desktop.threadCallUndoVisible) failures.push("thread call-history undo bar was not visible");
    if (!result.desktop.commandRequests.some((request) => request.path.includes("/dial") && (request.path.includes("15551234567") || request.path.includes("5551234567")))) failures.push("call-this-number call-row action did not dial through the host");
    if (!result.desktop.handoffRequests.some((request) => request.target === "delete-all-calls")) failures.push("delete-all-calls handoff was not recorded");
    if (!result.desktop.handoffRequests.some((request) => request.target === "toggle-block" && request.value.includes("15551234567"))) failures.push("call-record block handoff did not carry the number");
    if (!result.desktop.handoffRequests.some((request) => request.target === "delete-call-entry" && request.value.includes("15551234567"))) failures.push("delete-call-entry handoff did not carry the number");
    if (result.desktop.dialerKeypadSources.length !== 12 || !result.desktop.dialerKeypadSources.includes("MainWindow.xaml:2952") || !result.desktop.dialerKeypadSources.includes("MainWindow.xaml:2963")) failures.push("thread-side dialer keypad native sources are incomplete");
    if (result.desktop.dialerAfterKeypad !== "1*#") failures.push("thread-side dialer keypad buttons did not append digits");
    if (!result.desktop.dialerOpened || result.desktop.dialerAfterBackspace !== "555" || !result.desktop.dialerClosed) failures.push("thread-side dialer show/backspace/hide behavior failed");
    if (!result.desktop.handoffRequests.some((request) => request.target === "new-message" && request.value.includes("555"))) failures.push("thread-side dialer text action did not hand off the typed number");
    if (!result.desktop.commandRequests.some((request) => request.path.includes("/dial") && request.path.includes("555"))) failures.push("thread-side dialer call did not use the host dial endpoint");
    if (!result.desktop.commandRequests.some((request) => request.path.includes("/dial") && request.path.includes("*86"))) failures.push("voicemail dialer action did not dial *86");
    if (!result.desktop.settingsSectionButtons) failures.push("settings section buttons are incomplete");
    if (!result.desktop.settingsToolButtons) failures.push("settings host tool buttons are incomplete");
    if (!result.desktop.deviceControlButtons) failures.push("settings device control buttons are incomplete");
    if (!result.desktop.settingsToggleButtons) failures.push("settings toggle controls are incomplete");
    for (const endpoint of ["/open-bluetooth-settings", "/open-sound-settings", "/audio-refresh", "/open-builds-folder", "/open-event-log", "/reset-ui-scale", "/refresh-theme-sync", "/import-starter-vcf", "/import-pending-contacts", "/skip-pending-contacts", "/set-theme-sync", "/set-history-paused", "/set-dark-mode", "/open-contact-sync-folder", "/export-messages-backup", "/scan-devices", "/connect-saved-device", "/set-default-saved-device", "/forget-saved-device", "/connect-scanned-device"]) {
      if (!result.desktop.commandRequests.some((request) => request.path.includes(endpoint))) failures.push(`${endpoint} was not called`);
    }
    if (!result.desktop.contactsSurface || !result.desktop.contactActionButtons) failures.push("contacts browser surface/action buttons are incomplete");
    for (const endpoint of ["/save-contact", "/delete-contact", "/undo-call-history-delete"]) {
      if (!result.desktop.commandRequests.some((request) => request.path.includes(endpoint))) failures.push(`${endpoint} was not called`);
    }
    if (!result.desktop.handoffRequests.some((request) => request.target === "new-message" && request.value.includes("5551234567"))) failures.push("contact Text action did not hand off selected phone number");
    if (!result.desktop.commandRequests.some((request) => request.path.includes("/dial") && request.path.includes("5551234567"))) failures.push("contact Call action did not dial selected phone number");
    if (!result.desktop.handoffRequests.some((request) => request.target === "edit-contact" && request.value.includes("5551234567"))) failures.push("contact Edit Details action did not hand off selected phone number");
    if (!result.desktop.handoffRequests.some((request) => request.target === "new-contact")) failures.push("contact New Contact action did not open native contact handoff");
    if (!result.desktop.fullCallsSurface) failures.push("full Calls browser surface did not open");
    if (result.desktop.fullCallsRowsAll !== 4 || result.desktop.fullCallsRowsOut !== 2) failures.push("full Calls surface did not show/filter all call history");
    if (!result.desktop.fullCallsActionSources) failures.push("full Calls row action sources are incomplete");
    if (!result.desktop.fullCallsRecentsHidden || !result.desktop.fullCallsRecentsRestored) failures.push("full Calls hide/show recents failed");
    if (!result.desktop.fullCallUndoVisible) failures.push("full Calls undo bar was not visible");
    if (!result.desktop.fullCallsDialerClosed || !result.desktop.fullCallsDialerFromMakeCall) failures.push("Make Call did not reopen the full Calls dialer");
    if (!result.desktop.commandRequests.some((request) => request.path.includes("/send") && request.path.includes("5551234567") && request.path.includes("Browser%20full%20compose%20smoke"))) failures.push("full New Message composer did not send through /send");
    if (!result.desktop.handoffRequests.some((request) => request.target === "new-message" && request.value.includes("5557654321"))) failures.push("full Calls message action did not hand off the selected call number");
    if (!result.desktop.commandRequests.some((request) => request.path.includes("/dial") && request.path.includes("5557654321"))) failures.push("full Calls call action did not dial the selected call number");
    if (!result.desktop.handoffRequests.some((request) => request.target === "toggle-block" && request.value.includes("5557654321"))) failures.push("full Calls block action did not carry the selected call number");
    if (!result.desktop.handoffRequests.some((request) => request.target === "delete-call-entry" && request.value.includes("5557654321"))) failures.push("full Calls delete action did not carry the selected call number");
    if (!result.desktop.developerToolButtons) failures.push("developer host tool buttons are incomplete");
    if (!result.desktop.railAutoCollapsedAfterIdle) failures.push("DeskPhone rail auto-collapse did not close after idle while enabled");
    for (const endpoint of ["/open-live-log", "/clear-log", "/run-ui-auditor"]) {
      if (!result.desktop.commandRequests.some((request) => request.path.includes(endpoint))) failures.push(`${endpoint} was not called`);
    }
    if (result.desktop.messageCount < 150) failures.push("message history was capped too shallow for DeskPhone Web");
    if (!result.desktop.imageLoaded || result.desktop.placeholderShown) failures.push("MMS image did not replace placeholder");
    if (!result.desktop.pendingStatusText.includes("Confirming on phone")) failures.push("outgoing pending message status was not visible");
    if (!result.desktop.imageBubbleIsMediaOnly || result.desktop.imageAttachmentRows !== 0) failures.push("MMS image still renders as a bordered attachment card instead of the message item");
    if (!result.desktop.imageWhitespaceRemoved) failures.push("MMS image-only bubble still has extra message whitespace/chrome");
    if (!result.desktop.viewerOpened || !result.desktop.viewerRotated || !result.desktop.viewerClosed) failures.push("image viewer open/rotate/close failed");
    if (!result.desktop.noHorizontalOverflow || !result.mobile.noHorizontalOverflow || !result.mobile.splittersHidden) failures.push("responsive layout overflow or mobile splitters visible");

    console.log(JSON.stringify({ ok: failures.length === 0, failures, result }, null, 2));
    process.exitCode = failures.length ? 1 : 0;
  } finally {
    server.close();
    chrome.kill();
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
  server.close();
});
