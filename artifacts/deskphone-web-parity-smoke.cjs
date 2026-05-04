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

const messages = Array.from({ length: 72 }, (_, i) => ({
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
  isMms: false,
  attachments: [],
}));

messages.push({
  id: "mms-photo",
  handle: "mms-photo",
  from: "+15551234567",
  to: "",
  number: "+15551234567",
  body: "",
  preview: "",
  timestamp: new Date(Date.UTC(2026, 4, 3, 14, 0)).toISOString(),
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
];

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
    send({ hfp: "Connected", map: "Connected", fullHistoryStatus: "Full history ready", build: "b242  2026-05-04 10:00" });
  } else if (requestPath === "/messages") {
    send(messages);
  } else if (requestPath === "/calls") {
    send(calls);
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
    source: `localStorage.setItem('deskphone_web_host_url','http://127.0.0.1:${hostPort}'); localStorage.setItem('deskphone_web_bridge_url','http://127.0.0.1:${hostPort}');`,
  });

  const loaded = waitEvent("Page.loadEventFired");
  await call("Page.navigate", { url: previewUrl });
  await loaded;
  await waitFor("!!document.querySelector('.dp-message-scroll') && document.querySelectorAll('.dp-message-item').length > 50");
  await waitFor("document.querySelector('.dp-mms-image')?.complete && document.querySelector('.dp-mms-image')?.naturalWidth > 0");

  const desktop = await evalValue(`(async () => {
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
    const scrollBox = document.querySelector('.dp-message-scroll');
    const scrollable = scrollBox.scrollHeight > scrollBox.clientHeight + 30;
    scrollBox.scrollTop = 0;
    document.querySelector('.dp-scroll-bottom').click();
    await new Promise((resolve) => setTimeout(resolve, 600));
    const maxTop = scrollBox.scrollHeight - scrollBox.clientHeight;
    const placeholderShown = Array.from(document.querySelectorAll('.dp-muted-body')).some((el) => el.textContent.includes('MMS message'));
    const image = document.querySelector('.dp-mms-image');
    image.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 50));
    const opened = !!document.querySelector('.dp-image-viewer');
    document.querySelector('.dp-image-viewer-tools button[aria-label="Rotate right"]').click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    const transform = document.querySelector('.dp-image-viewer-stage img')?.style.transform || '';
    document.querySelector('.dp-image-viewer-close').click();
    await new Promise((resolve) => setTimeout(resolve, 50));
    return {
      rail,
      messageList,
      callHistory,
      webVersionText,
      hostBuildText,
      scrollable,
      scrolledToBottom: scrollBox.scrollTop >= maxTop - 8,
      imageLoaded: image.naturalWidth > 0,
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
    if (!result.desktop.scrollable || !result.desktop.scrolledToBottom) failures.push("message history did not scroll to latest");
    if (!result.desktop.imageLoaded || result.desktop.placeholderShown) failures.push("MMS image did not replace placeholder");
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
