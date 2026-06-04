import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

const port = Number(process.env.RAVE_RELAY_PORT || 5212);
const targetUrl = process.env.RAVE_RELAY_URL || `http://127.0.0.1:${port}/`;
const challengeDate = "2026-05-31";
const chromePath =
  process.env.CHROME_PATH ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const userDataDir = await mkdtemp(join(tmpdir(), "rave-relay-chrome-"));
let chrome;
let server;

try {
  if (!process.env.RAVE_RELAY_URL) {
    server = spawn("python3", ["-m", "http.server", String(port), "--bind", "127.0.0.1"], {
      stdio: ["ignore", "ignore", "pipe"]
    });
    await waitForServer(targetUrl);
  }

  const browserWs = await launchChrome();
  const cdp = await connectCdp(browserWs);
  const desktop = await runViewportCheck(cdp, {
    name: "desktop",
    width: 1280,
    height: 860,
    mobile: false
  });
  const mobile = await runViewportCheck(cdp, {
    name: "mobile",
    width: 390,
    height: 844,
    mobile: true
  });
  await cdp.close();

  if (!desktop.ok || !mobile.ok) {
    throw new Error(JSON.stringify({ desktop, mobile }, null, 2));
  }

  console.log(
    `browser ok: desktop feedback="${desktop.feedback}", mobile overflow=${mobile.overflow}, screenshots=${desktop.screenshot},${mobile.screenshot}`
  );
} finally {
  if (chrome && !chrome.killed) chrome.kill("SIGTERM");
  if (server && !server.killed) server.kill("SIGTERM");
  await rm(userDataDir, { recursive: true, force: true });
}

async function waitForServer(url) {
  const deadline = Date.now() + 10000;
  let lastError;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw lastError || new Error(`Timed out waiting for ${url}`);
}

async function launchChrome() {
  const args = [
    "--headless=new",
    "--disable-gpu",
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-background-networking",
    "--remote-debugging-port=0",
    `--user-data-dir=${userDataDir}`,
    "about:blank"
  ];

  chrome = spawn(chromePath, args, { stdio: ["ignore", "ignore", "pipe"] });
  chrome.on("exit", (code) => {
    if (code !== 0 && code !== null) {
      console.error(`Chrome exited with code ${code}`);
    }
  });

  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for Chrome DevTools")), 10000);
    chrome.stderr.on("data", (chunk) => {
      const match = String(chunk).match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[1]);
      }
    });
    chrome.on("error", reject);
  });
}

function connectCdp(wsUrl) {
  const socket = new WebSocket(wsUrl);
  let nextId = 1;
  const pending = new Map();
  const waiters = [];

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id && pending.has(message.id)) {
      const { resolve, reject } = pending.get(message.id);
      pending.delete(message.id);
      if (message.error) {
        reject(new Error(message.error.message));
      } else {
        resolve(message.result || {});
      }
      return;
    }

    for (const waiter of [...waiters]) {
      const sameMethod = waiter.method === message.method;
      const sameSession = !waiter.sessionId || waiter.sessionId === message.sessionId;
      if (sameMethod && sameSession) {
        clearTimeout(waiter.timeout);
        waiters.splice(waiters.indexOf(waiter), 1);
        waiter.resolve(message.params || {});
      }
    }
  });

  const open = new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  return open.then(() => ({
    send(method, params = {}, sessionId) {
      const id = nextId++;
      const payload = sessionId ? { id, method, params, sessionId } : { id, method, params };
      socket.send(JSON.stringify(payload));
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
    },
    waitFor(method, sessionId, timeoutMs = 10000) {
      return new Promise((resolve, reject) => {
        const waiter = {
          method,
          sessionId,
          resolve,
          timeout: setTimeout(() => {
            waiters.splice(waiters.indexOf(waiter), 1);
            reject(new Error(`Timed out waiting for ${method}`));
          }, timeoutMs)
        };
        waiters.push(waiter);
      });
    },
    close() {
      socket.close();
    }
  }));
}

async function runViewportCheck(cdp, viewport) {
  const { targetId } = await cdp.send("Target.createTarget", { url: "about:blank" });
  const { sessionId } = await cdp.send("Target.attachToTarget", { targetId, flatten: true });
  await cdp.send("Page.enable", {}, sessionId);
  await cdp.send("Runtime.enable", {}, sessionId);
  await cdp.send(
    "Emulation.setDeviceMetricsOverride",
    {
      width: viewport.width,
      height: viewport.height,
      deviceScaleFactor: viewport.mobile ? 2 : 1,
      mobile: viewport.mobile
    },
    sessionId
  );

  const viewportUrl = new URL(targetUrl);
  viewportUrl.searchParams.set("date", challengeDate);
  const loaded = cdp.waitFor("Page.loadEventFired", sessionId);
  await cdp.send("Page.navigate", { url: viewportUrl.href }, sessionId);
  await loaded;

  const details = await evaluate(
    cdp,
    sessionId,
    `new Promise((resolve) => {
      const startButton = document.querySelector('#start-button');
      const challengeButton = document.querySelector('#challenge-button');
      try {
        Object.defineProperty(navigator, 'clipboard', {
          configurable: true,
          value: {
            writeText: async (value) => {
              window.__raveRelayCopiedText = value;
            }
          }
        });
      } catch (error) {}
      challengeButton.click();
      setTimeout(() => {
        const challengeFeedback = document.querySelector('#feedback').textContent.trim();
        startButton.click();
        setTimeout(() => {
          const activeLane = document.querySelector('.lane.is-active');
          const laneIndex = activeLane ? activeLane.dataset.lane : '0';
          document.querySelector('[data-lane-button="' + laneIndex + '"]').click();
          setTimeout(() => {
            const startRect = startButton.getBoundingClientRect();
            resolve({
              title: document.title,
              dayText: document.querySelector('#day-pill').textContent.trim(),
              laneCount: document.querySelectorAll('.lane').length,
              challengeButtonText: challengeButton.textContent.trim(),
              challengeFeedback,
              challengeCopiedText: window.__raveRelayCopiedText || '',
              feedback: document.querySelector('#feedback').textContent.trim(),
              roundLabel: document.querySelector('#round-label').textContent.trim(),
              scoreText: document.querySelector('#score').textContent.trim(),
              copyDisabled: document.querySelector('#copy-button').disabled,
              resultHidden: document.querySelector('#result-panel').hidden,
              overflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
              startVisible: startRect.top >= 0 && startRect.bottom <= window.innerHeight
            });
          }, 120);
        }, 520);
      }, 100);
    })`
  );

  const screenshotResult = await cdp.send(
    "Page.captureScreenshot",
    { format: "png", captureBeyondViewport: false },
    sessionId
  );
  const requestedScreenshot =
    viewport.name === "desktop" ? process.env.SAVE_SCREENSHOT : process.env.SAVE_MOBILE_SCREENSHOT;
  const screenshot = requestedScreenshot || join(tmpdir(), `rave-relay-${viewport.name}.png`);
  const screenshotBuffer = Buffer.from(screenshotResult.data, "base64");
  if (requestedScreenshot) {
    await mkdir(dirname(requestedScreenshot), { recursive: true });
  }
  await writeFile(screenshot, screenshotBuffer);

  const ok =
    details.title === "Rave Relay" &&
    details.dayText === challengeDate &&
    details.laneCount === 4 &&
    details.challengeButtonText === "Copy challenge" &&
    details.challengeFeedback === "challenge copied" &&
    details.challengeCopiedText.includes(`date=${challengeDate}`) &&
    ["Pulse 1 / 18", "Pulse 2 / 18"].includes(details.roundLabel) &&
    details.feedback.length > 0 &&
    details.copyDisabled &&
    details.resultHidden &&
    details.overflow <= 1 &&
    (viewport.mobile ? true : details.startVisible);

  await cdp.send("Target.closeTarget", { targetId });
  return { ...details, ok, screenshot };
}

async function evaluate(cdp, sessionId, expression) {
  const response = await cdp.send(
    "Runtime.evaluate",
    {
      expression,
      awaitPromise: true,
      returnByValue: true
    },
    sessionId
  );
  if (response.exceptionDetails) {
    throw new Error(response.exceptionDetails.text || "Runtime evaluation failed");
  }
  return response.result.value;
}
