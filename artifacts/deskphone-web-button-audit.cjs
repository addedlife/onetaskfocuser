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

if (!chromePath) throw new Error("Chrome not found");

const messages = Array.from({ length: 24 }, (_, i) => ({
  id: `m${i}`,
  handle: `m${i}`,
  from: i % 2 ? "+15551234567" : "Me",
  to: i % 2 ? "" : "+15551234567",
  number: "+15551234567",
  body: `Button audit message ${i}`,
  preview: `Button audit message ${i}`,
  timestamp: new Date(Date.UTC(2026, 4, 7, 12, i)).toISOString(),
  isSent: i % 2 === 0,
  isRead: i % 3 !== 0,
  isPinned: i === 5,
  pinActionLabel: i === 5 ? "Unpin" : "Pin",
  isMms: false,
  attachments: [],
}));

const calls = [
  { id: "call-1", number: "+15551234567", direction: "Incoming", directionLabel: "Incoming", timestamp: new Date().toISOString(), durationDisplay: "2 min" },
  { id: "call-2", number: "+15557654321", direction: "Outgoing", directionLabel: "Outgoing", timestamp: new Date().toISOString(), durationDisplay: "1 min" },
];

const contacts = [
  { id: "contact-1", displayName: "A Test Contact", primaryPhone: "+15551234567", phoneNumbers: ["+15551234567"] },
  { id: "contact-2", displayName: "B Backup Contact", primaryPhone: "+15557654321", phoneNumbers: ["+15557654321"] },
];

const commandRequests = [];
const handoffRequests = [];

function readBody(req) {
  return new Promise((resolve) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => resolve(body));
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "*");
  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  const url = new URL(req.url, `http://127.0.0.1:${hostPort}`);
  const send = (payload) => {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(payload));
  };

  if (req.method === "POST") {
    commandRequests.push({ path: req.url, body: await readBody(req) });
  }

  if (url.pathname === "/status") {
    send({
      hfp: "Connected",
      map: "Connected",
      build: "b261  05/07/26 4:55 am",
      showReconnectPrompt: false,
      showBuildUpdatePrompt: false,
      showBuildUpdateIndicator: false,
      knownDevices: [{ address: "AABB", name: "Phone", isDefault: true }],
      scannedDevices: [{ address: "CCDD", name: "Other Phone" }],
      isScanning: false,
      hasUndoMessageDelete: true,
      hasUndoCallHistoryDelete: true,
    });
  } else if (url.pathname === "/messages") {
    send(messages);
  } else if (url.pathname === "/calls") {
    send(calls);
  } else if (url.pathname === "/contacts") {
    send(contacts);
  } else if (url.pathname === "/handoff") {
    handoffRequests.push(Object.fromEntries(url.searchParams.entries()));
    send({ ok: true });
  } else if (url.pathname === "/command-log") {
    send(commandRequests);
  } else if (url.pathname === "/handoff-log") {
    send(handoffRequests);
  } else {
    send({ ok: true });
  }
});

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitHttp(url, timeout = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await sleep(150);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

function openSocket(url) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(url);
    ws.addEventListener("open", () => resolve(ws), { once: true });
    ws.addEventListener("error", reject, { once: true });
  });
}

async function runAudit() {
  await new Promise((resolve) => server.listen(hostPort, "127.0.0.1", resolve));
  await waitHttp(previewUrl);

  const profile = path.join(os.tmpdir(), "codex-deskphone-button-audit");
  const chrome = childProcess.spawn(
    chromePath,
    ["--headless=new", "--disable-gpu", `--remote-debugging-port=${cdpPort}`, `--user-data-dir=${profile}`, "about:blank"],
    { stdio: "ignore" }
  );

  try {
    await waitHttp(`http://127.0.0.1:${cdpPort}/json/version`);
    let response = await fetch(`http://127.0.0.1:${cdpPort}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" });
    if (!response.ok) response = await fetch(`http://127.0.0.1:${cdpPort}/json/new?${encodeURIComponent("about:blank")}`);
    const target = await response.json();
    const ws = await openSocket(target.webSocketDebuggerUrl);
    let nextId = 1;
    const pending = new Map();
    const waiters = new Map();

    ws.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (message.id && pending.has(message.id)) {
        const request = pending.get(message.id);
        pending.delete(message.id);
        message.error ? request.reject(new Error(message.error.message)) : request.resolve(message.result || {});
        return;
      }
      const list = waiters.get(message.method);
      if (list?.length) list.shift()(message.params || {});
    });

    const call = (method, params = {}) => new Promise((resolve, reject) => {
      const id = nextId++;
      pending.set(id, { resolve, reject });
      ws.send(JSON.stringify({ id, method, params }));
    });
    const waitEvent = (method, timeout = 10000) => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${method}`)), timeout);
      const list = waiters.get(method) || [];
      list.push((params) => {
        clearTimeout(timer);
        resolve(params);
      });
      waiters.set(method, list);
    });
    const evalValue = async (expression) => {
      const result = await call("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Runtime evaluation failed");
      return result.result?.value;
    };

    await call("Page.enable");
    await call("Runtime.enable");
    await call("Page.addScriptToEvaluateOnNewDocument", {
      source: `
        localStorage.setItem('deskphone_web_host_url','http://127.0.0.1:${hostPort}');
        localStorage.setItem('deskphone_web_bridge_url','http://127.0.0.1:${hostPort}');
        localStorage.setItem('deskphone_web_rail_collapsed','false');
        localStorage.setItem('deskphone_web_rail_autocollapse','false');
      `,
    });
    const loaded = waitEvent("Page.loadEventFired");
    await call("Page.navigate", { url: previewUrl });
    await loaded;

    const result = await evalValue(`(async () => {
      window.confirm = () => true;
      const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
      const wait = async (selector, timeout = 5000) => {
        const started = Date.now();
        while (Date.now() - started < timeout) {
          const element = document.querySelector(selector);
          if (element) return element;
          await sleep(50);
        }
        throw new Error('missing ' + selector);
      };
      const textHas = (text) => Array.from(document.querySelectorAll('button,h2,p')).some((element) => (element.textContent || '').includes(text));
      const clickSource = async (source, root = document) => {
        const element =
          root.querySelector('button[data-native-source="' + source + '"], input[data-native-source="' + source + '"]') ||
          root.querySelector('[data-native-source="' + source + '"]');
        if (!element) throw new Error('missing source ' + source);
        element.click();
        await sleep(140);
        return true;
      };
      const inputSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      await wait('.dp-message-scroll');

      const initialNoNativeText = !textHas('Show native app') && !textHas('Developer Tools shell');
      const conversationMenu = await wait('.dp-conversation-menu');
      conversationMenu.open = true;
      for (const source of ['MainWindow.xaml:1299','MainWindow.xaml:1302','MainWindow.xaml:1306','MainWindow.xaml:1309','MainWindow.xaml:1312']) await clickSource(source, conversationMenu);
      conversationMenu.open = false;

      const sideCallPane = document.querySelector('.dp-thread-calls:not(.is-full-calls)');
      const unifiedCallsPaneVisible = !!sideCallPane && sideCallPane.querySelectorAll('.dp-thread-call-row').length >= ${calls.length};
      const oldFullCallsButtonRemoved = !document.querySelector('[aria-label="Open full call history"]');
      const callTextButtons = Array.from(document.querySelectorAll('[data-native-source="MainWindow.xaml:2826"]'));
      (callTextButtons[1] || callTextButtons[0]).click();
      await sleep(140);
      const callPaneTextOpenedComposer = !!document.querySelector('.dp-new-compose-shell');
      document.querySelector('.dp-new-compose-shell [data-native-source="MainWindow.xaml:3036"]')?.click();
      await sleep(100);
      await clickSource('MainWindow.xaml:2831');
      await clickSource('MainWindow.xaml:2836');
      await clickSource('MainWindow.xaml:2841');
      await clickSource('MainWindow.xaml:2592');

      await clickSource('MainWindow.xaml:562');
      await wait('.dp-contacts-shell');
      document.querySelector('.dp-contacts-shell [data-native-source="MainWindow.xaml:3888"]').click();
      await sleep(120);
      const contactTextOpenedComposer = !!document.querySelector('.dp-new-compose-shell');
      document.querySelector('.dp-new-compose-shell [data-native-source="MainWindow.xaml:3036"]')?.click();
      await sleep(100);
      await clickSource('MainWindow.xaml:562');
      await wait('.dp-contacts-shell');
      await clickSource('MainWindow.xaml:3895');
      await clickSource('MainWindow.xaml:3919');
      const editFocused = document.activeElement?.getAttribute('data-automation-id') === 'ContactEditorName';
      await clickSource('MainWindow.xaml:3953');
      await clickSource('MainWindow.xaml:3766');
      const newContactTitle = document.querySelector('.dp-contact-detail h3')?.textContent.trim();
      const newContactDeleteDisabled = document.querySelector('.dp-contacts-shell [data-native-source="MainWindow.xaml:3953"]')?.disabled === true;
      const name = document.querySelector('[data-automation-id="ContactEditorName"]');
      const phone = document.querySelector('[data-automation-id="ContactEditorPhone"]');
      inputSetter.call(name, 'Browser Button Audit');
      name.dispatchEvent(new Event('input', { bubbles:true }));
      inputSetter.call(phone, '+15550001111');
      phone.dispatchEvent(new Event('input', { bubbles:true }));
      await clickSource('MainWindow.xaml:3959');

      await clickSource('MainWindow.xaml:586');
      await wait('.dp-settings-shell');
      const settingsNoNativeText = !textHas('Show native app');
      await clickSource('MainWindow.xaml:4052');
      await clickSource('MainWindow.xaml:4083');
      await clickSource('MainWindow.xaml:4088');
      await clickSource('MainWindow.xaml:4102');
      await clickSource('MainWindow.xaml:4135');
      await clickSource('MainWindow.xaml:4150');
      await clickSource('MainWindow.xaml:4000');
      await clickSource('MainWindow.xaml:4235');
      await clickSource('MainWindow.xaml:4288');
      document.querySelector('[data-native-source="MainWindow.xaml:4258"] input')?.click();
      await sleep(90);
      document.querySelector('[data-native-source="MainWindow.xaml:4294"] input')?.click();
      await sleep(90);
      document.querySelector('[data-native-source="MainWindow.xaml:4309"] input')?.click();
      await sleep(90);
      await clickSource('MainWindow.xaml:4005');
      await clickSource('MainWindow.xaml:4381');
      await clickSource('MainWindow.xaml:4385');
      await clickSource('MainWindow.xaml:4390');
      await clickSource('MainWindow.xaml:4395');
      await clickSource('MainWindow.xaml:4412');
      await clickSource('MainWindow.xaml:4010');
      await clickSource('MainWindow.xaml:4480');
      await clickSource('MainWindow.xaml:4476');

      await clickSource('MainWindow.xaml:603');
      await wait('.dp-tab-placeholder');
      const developerCleanTitle = document.querySelector('.dp-tab-placeholder h2')?.textContent.trim() === 'Developer Tools' && !textHas('Developer Tools shell');
      await clickSource('MainWindow.xaml:620');
      await clickSource('LogWindow.xaml:45');
      await clickSource('MainWindow.xaml:4346');
      await clickSource('MainWindow.xaml:4639');

      const commands = await fetch('http://127.0.0.1:${hostPort}/command-log').then((response) => response.json());
      const handoffs = await fetch('http://127.0.0.1:${hostPort}/handoff-log').then((response) => response.json());
      return {
        initialNoNativeText,
        unifiedCallsPaneVisible,
        oldFullCallsButtonRemoved,
        callPaneTextOpenedComposer,
        contactTextOpenedComposer,
        editFocused,
        newContactTitle,
        newContactDeleteDisabled,
        settingsNoNativeText,
        developerCleanTitle,
        handoffCount: handoffs.length,
        commandPaths: commands.map((command) => command.path),
      };
    })()`);

    const requiredEndpoints = [
      "/mark-conversation-read",
      "/mark-conversation-unread",
      "/toggle-conversation-pin",
      "/toggle-conversation-mute",
      "/toggle-conversation-block",
      "/dial",
      "/toggle-call-block",
      "/delete-call-entry",
      "/delete-all-call-history",
      "/save-contact",
      "/delete-contact",
      "/scan-devices",
      "/connect-saved-device",
      "/set-default-saved-device",
      "/forget-saved-device",
      "/connect-scanned-device",
      "/reset-ui-scale",
      "/refresh-theme-sync",
      "/set-theme-sync",
      "/set-history-paused",
      "/set-dark-mode",
      "/import-starter-vcf",
      "/import-pending-contacts",
      "/skip-pending-contacts",
      "/open-contact-sync-folder",
      "/export-messages-backup",
      "/open-sound-settings",
      "/audio-refresh",
      "/open-live-log",
      "/clear-log",
      "/run-ui-auditor",
    ];

    const checks = {
      initialNoNativeText: "native text removed",
      unifiedCallsPaneVisible: "unified call pane visible",
      oldFullCallsButtonRemoved: "old full call-history button removed",
      callPaneTextOpenedComposer: "call pane text opens composer",
      contactTextOpenedComposer: "contact text opens composer",
      editFocused: "edit focuses editor",
      newContactDeleteDisabled: "new contact delete disabled",
      settingsNoNativeText: "settings native button removed",
      developerCleanTitle: "developer title clean",
    };
    const failures = [];
    for (const [key, label] of Object.entries(checks)) {
      if (!result[key]) failures.push(label);
    }
    if (result.newContactTitle !== "New contact") failures.push("New Contact did not stay in new-contact mode");
    if (result.handoffCount !== 0) failures.push("handoff requests were still made");
    for (const endpoint of requiredEndpoints) {
      if (!result.commandPaths.some((requestPath) => requestPath.includes(endpoint))) failures.push(`${endpoint} not called`);
    }

    console.log(JSON.stringify({ ok: failures.length === 0, failures, result }, null, 2));
    await call("Browser.close").catch(() => {});
    ws.close();
    if (failures.length) process.exitCode = 1;
  } finally {
    chrome.kill();
    server.close();
  }
}

runAudit().catch((error) => {
  console.error(error.stack || error.message);
  server.close();
  process.exitCode = 1;
});
