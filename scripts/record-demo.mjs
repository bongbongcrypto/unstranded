#!/usr/bin/env node
// Record the demo's screen segments, hands off.
//
//   node scripts/record-demo.mjs --list              what the segments are
//   node scripts/record-demo.mjs --segment b         record one
//   node scripts/record-demo.mjs --all               record every segment
//   node scripts/record-demo.mjs --segment b --dry   choreography only, no capture
//
// The browser is driven over the DevTools protocol rather than by moving the
// mouse, so recording does not take the machine hostage: the window sits on a
// spare monitor drawing itself while whoever owns the desk keeps working.
//
// Timings come from docs/demo-script.json, so a segment is exactly as long as
// the narration written over it and the two can never drift.
//
// The app being filmed needs a signed-in session. That lives in .shoot-profile,
// which a person signs into once (scripts/open-shoot-profile.mjs). The recorder
// closes that window and relaunches the same profile fullscreen on the shoot
// monitor, so the login carries over and nothing is typed on camera.
//
// Nothing here writes to a chain. Every run this films already happened; the
// recorder is only driving a browser across pages that record what it did.
// Both go through KeeperHub's own execute endpoint with the same session, which
// is the same path a human clicking Run would take.
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluate, launch } from "./lib/cdp.mjs";
import { SEGMENT_SLOTS, checkSlots, seconds } from "./lib/segments.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "docs", "recording");
const PROFILE = join(ROOT, ".shoot-profile");
const STATE_FILE = join(OUT, "run-state.json");

const WIDTH = 1920;
const HEIGHT = 1080;

const ON_DEMAND_ID = "bycmjcabf8ypy0u8e16bm";
const WATCHER_ID = "ffz6dntmq9ftu7e2wr15d";
const ON_DEMAND = "https://app.keeperhub.com/workflows/" + ON_DEMAND_ID;
const WATCHER = "https://app.keeperhub.com/workflows/" + WATCHER_ID;
const RELEASE_TX =
  "https://sepolia.etherscan.io/tx/0xd47911d516b533e4c0899101cada489a33ebe2f09187df14c2eba249b5f8bf62";
const REPO = "https://github.com/bongbongcrypto/unstranded";
const local = (name) => "file:///" + join(OUT, name).replace(/\\/g, "/");

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Which screen to film on, from --monitor. Null means pick a spare one. */
let monitorArg = null;
/** Cut the take short, for proving the rig without sitting through a segment. */
let secondsArg = null;

/** State that segment c needs from segment b, kept on disk so they can be separate runs. */
function loadState() {
  try {
    return JSON.parse(readFileSync(STATE_FILE, "utf8"));
  } catch {
    return {};
  }
}
function saveState(patch) {
  const next = { ...loadState(), ...patch };
  mkdirSync(OUT, { recursive: true });
  writeFileSync(STATE_FILE, JSON.stringify(next, null, 2));
  return next;
}

/**
 * Every monitor attached, so the shoot can be sent to one nobody is using.
 */
function monitors() {
  const out = execFileSync("powershell.exe", [
    "-NoProfile",
    "-Command",
    "Add-Type -AssemblyName System.Windows.Forms; " +
      "[System.Windows.Forms.Screen]::AllScreens | ForEach-Object { " +
      "'{0},{1},{2},{3},{4}' -f $_.Bounds.X,$_.Bounds.Y,$_.Bounds.Width,$_.Bounds.Height,$_.Primary }",
  ]).toString();
  return out
    .trim()
    .split(/\r?\n/)
    .map((line, i) => {
      const [x, y, w, h, primary] = line.split(",");
      return { index: i, x: Number(x), y: Number(y), width: Number(w), height: Number(h), primary: primary === "True" };
    })
    .sort((a, b) => a.x - b.x);
}

/** The screen to shoot on: a named one, else the largest that is not primary. */
function pickMonitor(wanted) {
  const all = monitors();
  if (wanted !== null) {
    const found = all[Number(wanted)];
    if (!found) throw new Error(`no monitor ${wanted}; there are ${all.length} (0 to ${all.length - 1})`);
    return found;
  }
  const spare = all.filter((m) => !m.primary && m.width >= WIDTH && m.height >= HEIGHT);
  const rank = (m) => (m.x < 0 || m.y < 0 ? 1 : 0);
  return (
    spare.sort((a, b) => rank(a) - rank(b) || b.width * b.height - a.width * a.height)[0] ??
    all.find((m) => m.primary)
  );
}

/** ffmpeg or ffprobe, by name. */
function findFfmpeg(name = "ffmpeg") {
  const winget = join(
    process.env.LOCALAPPDATA ?? "",
    "Microsoft/WinGet/Packages/Gyan.FFmpeg_Microsoft.Winget.Source_8wekyb3d8bbwe",
  );
  try {
    for (const dir of readdirSync(winget)) {
      const exe = join(winget, dir, "bin", `${name}.exe`);
      if (existsSync(exe)) return exe;
    }
  } catch {
    /* fall through to PATH */
  }
  return name;
}


/**
 * Close the sign-in window so the recorder can open the same profile itself.
 *
 * Chrome refuses a second instance on a profile directory; it hands the URL to
 * the running one and exits, and the recorder would then wait forever for a
 * debugging port that never opens.
 */
function closeProfileChrome() {
  try {
    execFileSync("powershell.exe", [
      "-NoProfile",
      "-Command",
      "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'chrome.exe' -and $_.CommandLine -like '*.shoot-profile*' } | " +
        "ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
    ]);
  } catch {
    /* nothing was open */
  }
}

// ---------------------------------------------------------------- page tools
//
// Injected into the page rather than shipped in it. A spotlight ring and an
// eased scroll are things a recording wants and a product does not.
const HELPERS = `
(() => {
  if (window.__shoot) return "already";
  const style = document.createElement("style");
  style.textContent =
    ".__spot{position:absolute;pointer-events:none;z-index:2147483647;border-radius:12px;" +
    "box-shadow:0 0 0 3px #7fd1ff,0 0 24px 6px rgba(127,209,255,.55);transition:all .45s cubic-bezier(.4,0,.2,1);" +
    "opacity:0}" +
    ".__spot.on{opacity:1}";
  document.head.append(style);
  const ring = document.createElement("div");
  ring.className = "__spot";
  document.body.append(ring);

  const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

  const ringEl = (el, pad) => {
    const r = el.getBoundingClientRect();
    const z = parseFloat(getComputedStyle(document.documentElement).zoom) || 1;
    ring.style.left = ((r.left + scrollX) / z - pad) + "px";
    ring.style.top = ((r.top + scrollY) / z - pad) + "px";
    ring.style.width = (r.width / z + pad * 2) + "px";
    ring.style.height = (r.height / z + pad * 2) + "px";
    ring.classList.add("on");
    return el.textContent.trim().slice(0, 60);
  };

  // First element whose own text contains the string. Text nodes only, so a
  // container that merely wraps the match does not win over the line itself.
  const findText = (text, within) => {
    const root = within ? document.querySelector(within) : document.body;
    if (!root) return null;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) {
      if (n.textContent.includes(text)) {
        const el = n.parentElement;
        // offsetParent is null inside any fixed-position container, which is
        // where the app keeps its side panel; a box with a size is the test.
        if (el && el.getClientRects().length > 0) return el;
      }
    }
    return null;
  };

  window.__shoot = {
    // The side panel is not removed when it is hidden; it is slid off the right
    // edge of the page, and it stays that way across navigations. So every shot
    // that cares says which way it wants it rather than assuming.
    panelOpen() {
      const tab = document.querySelector('[role="tab"]');
      return !!tab && tab.getBoundingClientRect().x < innerWidth;
    },
    setPanel(open) {
      if (this.panelOpen() === open) return "panel already " + (open ? "open" : "hidden");
      // Open: a chevron-right on the panel's left edge. Hidden: a chevron-left
      // pinned to the page's right edge, which sits under a fixed overlay that
      // swallows real clicks, so this one is clicked as an element.
      const want = open ? "svg.lucide-chevron-left" : "svg.lucide-chevron-right";
      const btn = [...document.querySelectorAll("button")].find((b) => {
        const r = b.getBoundingClientRect();
        return b.querySelector(want) && r.width <= 32 && r.x > innerWidth * 0.6 && r.y < 150;
      });
      if (!btn) throw new Error("no chevron to " + (open ? "open" : "hide") + " the panel");
      btn.click();
      return "panel " + (open ? "opened" : "hidden");
    },
    scrollTo(y, ms = 900) {
      return new Promise((done) => {
        const from = window.scrollY;
        const to = Math.max(0, Math.min(y, document.documentElement.scrollHeight - innerHeight));
        const t0 = performance.now();
        const step = (now) => {
          const p = Math.min(1, (now - t0) / ms);
          window.scrollTo(0, from + (to - from) * ease(p));
          if (p < 1) requestAnimationFrame(step); else done(to);
        };
        requestAnimationFrame(step);
      });
    },
    scrollToEl(sel, ms) {
      const el = document.querySelector(sel);
      if (!el) throw new Error("no element for " + sel);
      const r = el.getBoundingClientRect();
      return this.scrollTo(window.scrollY + r.top - (innerHeight - r.height) / 2, ms);
    },
    async scrollToText(text, within, ms = 900) {
      const el = findText(text, within);
      if (!el) throw new Error("no text " + text);
      const r = el.getBoundingClientRect();
      await this.scrollTo(window.scrollY + r.top - (innerHeight - r.height) / 2, ms);
      return el.textContent.trim().slice(0, 40);
    },
    spot(sel, pad = 8) {
      const el = document.querySelector(sel);
      if (!el) throw new Error("no element for " + sel);
      return ringEl(el, pad);
    },
    spotText(text, within, pad = 8) {
      const el = findText(text, within);
      if (!el) throw new Error("no text " + text);
      return ringEl(el, pad);
    },
    clickText(text, within) {
      const el = findText(text, within);
      if (!el) throw new Error("no text " + text);
      (el.closest("button,a,[role=button]") || el).click();
      return "clicked " + text;
    },
    unspot() { ring.classList.remove("on"); },
    // The run list in the Runs tab: one entry per row, newest first, with the
    // chevron's centre so it can be clicked as real input, and whether the row
    // is open (the chevron points down) and has loaded its step count.
    runs() {
      const panel = document.querySelector('[role="tabpanel"][data-state="active"]');
      if (!panel) return [];
      return [...panel.querySelectorAll("button")]
        .filter((b) => b.querySelector('svg[class*="lucide-chevron"]'))
        .map((b) => {
          const row = b.parentElement;
          const r = b.getBoundingClientRect();
          return {
            title: (row.innerText.match(/Run #[0-9]+/) || [""])[0],
            open: !!b.querySelector("svg.lucide-chevron-down"),
            loaded: /steps/.test(row.innerText),
            x: Math.round(r.x + r.width / 2),
            y: Math.round(r.y + r.height / 2),
          };
        })
        .filter((row) => row.title);
    },
    // The app's own API, with the page's own session. This is the same request
    // the Run button makes.
    async execute(workflowId, input) {
      const r = await fetch("/api/workflows/" + workflowId + "/execute", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ input }),
      });
      return r.status + " " + (await r.text()).slice(0, 120);
    },
    async executions(workflowId) {
      const r = await fetch("/api/workflows/" + workflowId + "/executions");
      return r.json();
    },
    async json(path) {
      const r = await fetch(path);
      return r.status === 200 ? r.json() : { status: r.status };
    },
  };
  return "ready";
})()
`;

// A real click, delivered as input rather than as a synthetic DOM event. The
// app's tabs and run rows listen for pointer events, and element.click() on
// them does nothing. (The panel chevrons are the other way round; see setPanel.)
async function clickXY(s, x, y) {
  for (const type of ["mouseMoved", "mousePressed", "mouseReleased"]) {
    await s.send("Input.dispatchMouseEvent", { type, x, y, button: "left", clickCount: 1 });
  }
  return `click ${x},${y}`;
}

// The active tab's content. The other two tabs keep empty, hidden panels in
// the DOM, and the first of those is what a bare [role=tabpanel] finds.
const PANEL = '[role="tabpanel"][data-state="active"]';

// Layout facts about the workflow page at 1920x1080, read off screenshots. If
// the app moves its furniture these are the numbers to update.
const UI = {
  fitView: [1312, 975], // React Flow's fit-view control, with the panel hidden
  runsTab: [1632, 124],
  refresh: [1420, 184],
};

/** Hide the panel and fit every node into the canvas. */
async function canvasWide(s) {
  const panel = await evaluate(s, `window.__shoot.setPanel(false)`);
  await sleep(700);
  await clickXY(s, ...UI.fitView);
  await sleep(600);
  return `wide (${panel})`;
}

/** Fresh page, panel showing, Runs tab open. */
async function runsView(s, go, url) {
  await go(url);
  const panel = await evaluate(s, `window.__shoot.setPanel(true)`);
  await sleep(700);
  await clickXY(s, ...UI.runsTab);
  await sleep(1200);
  return `runs (${panel})`;
}

const runList = (s) => evaluate(s, `window.__shoot.runs()`);

const executionIds = async (s, workflowId) =>
  evaluate(s, `window.__shoot.executions(${JSON.stringify(workflowId)}).then((a) => a.map((r) => r.id))`);

/**
 * Refresh the run list until it holds an execution that was not there when
 * the run was fired, or until the deadline. The list lags the execute call by
 * a second or two, and a click aimed at "the new run" before it is there
 * lands on the previous one.
 */
async function waitForNewRun(s, workflowId, knownIds, { timeout = 15000 } = {}) {
  const known = new Set(knownIds ?? []);
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    await clickXY(s, ...UI.refresh);
    await sleep(900);
    const ids = await executionIds(s, workflowId);
    const top = (await runList(s))[0];
    if (ids.some((id) => !known.has(id)) && top) return `${top.title} is new`;
  }
  return "no new run appeared";
}

/**
 * Open or close the i-th run row, newest first, and check that it happened.
 * A refresh that lands after the click re-renders the list closed again, so
 * the click is repeated until the row agrees.
 */
async function setRun(s, i, open) {
  for (let tries = 0; tries < 4; tries++) {
    const row = (await runList(s))[i];
    if (!row) throw new Error(`no run row ${i}`);
    if (row.open === open) return `${row.title} ${open ? "open" : "closed"}`;
    await clickXY(s, row.x, row.y);
    await sleep(900);
  }
  throw new Error(`run row ${i} would not ${open ? "open" : "close"}`);
}


/** Wait for the newest execution started after `since` to finish; return it. */
async function waitForExecution(s, workflowId, since, timeoutMs = 180000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const list = await evaluate(s, `window.__shoot.executions(${JSON.stringify(workflowId)})`);
    const mine = (Array.isArray(list) ? list : []).filter((e) => new Date(e.startedAt).getTime() >= since - 5000);
    const newest = mine.sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt))[0];
    if (newest && ["success", "error", "failed"].includes(newest.status)) return newest;
    await sleep(3000);
  }
  throw new Error("the execution did not finish in time");
}

// ----------------------------------------------------------------- segments
//
// `at` is milliseconds from the start of the segment, which is also the moment
// capture begins, so a step lands under the sentence it belongs to.
const CHOREOGRAPHY = [
  {
    // 0:00 three transactions, and the one nobody comes back for
    id: "a",
    url: local("three-steps.html"),
    setup: async () => {
      execFileSync(process.execPath, [join(ROOT, "scripts", "make-pages.mjs")], { stdio: "inherit" });
      return "pages rebuilt from the chain";
    },
    steps: [
      { at: 1200, do: async (s) => evaluate(s, `window.__shoot.spotText("Start the withdrawal", null, 10)`) },
      { at: 4000, do: async (s) => evaluate(s, `window.__shoot.spotText("Prove it", null, 10)`) },
      // 0:09.1 "people do the first two and never come back"
      { at: 9200, do: async (s) => evaluate(s, `window.__shoot.spotText("Finalize it", null, 12)`) },
      // 0:12.6 the count
      { at: 12400, do: async (s) => evaluate(s, `window.__shoot.unspot()`) },
      { at: 12600, do: async (s, go) => go(local("survey.html")) },
      // 0:20.3 what is in the fifteen
      { at: 20300, do: async (s) => evaluate(s, `window.__shoot.spotText("68,080 USDT", null, 12)`) },
      // 0:26.9 and how long it has been there
      { at: 26700, do: async (s) => evaluate(s, `window.__shoot.unspot()`) },
      { at: 26900, do: async (s) => evaluate(s, `window.__shoot.spotText("75 days ago", null, 10)`) },
    ],
  },
  {
    // 0:32.5 the function that lets a stranger help, and cannot let them take
    id: "b",
    url: local("external-proof.html"),
    steps: [
      { at: 900, do: async (s) => evaluate(s, `window.__shoot.spotText("finalizeWithdrawalTransactionExternalProof", null, 10)`) },
      // 0:38.3 the two rows that matter: any address, and nothing to change
      { at: 5800, do: async (s) => evaluate(s, `window.__shoot.unspot()`) },
      { at: 6000, do: async (s) => evaluate(s, `window.__shoot.spotText("fixed inside the proven withdrawal", null, 10)`) },
      // 0:47 fifteen of fifteen
      { at: 14300, do: async (s) => evaluate(s, `window.__shoot.unspot()`) },
      { at: 14500, do: async (s, go) => go(local("simulate.html")) },
      { at: 16000, do: async (s) => evaluate(s, `window.__shoot.spotText("would succeed", null, 12)`) },
    ],
  },
  {
    // 0:55.6 the workflow itself
    id: "c",
    url: ON_DEMAND,
    zoom: 1.1,
    steps: [
      { at: 2000, do: async (s) => canvasWide(s) },
      // 0:59.2 the five reads, named as the narration names them
      { at: 4200, do: async (s) => evaluate(s, `window.__shoot.spot('.react-flow__node[data-id="step-1"]', 10)`) },
      { at: 6200, do: async (s) => evaluate(s, `window.__shoot.spot('.react-flow__node[data-id="step-4"]', 10)`) },
      { at: 8200, do: async (s) => evaluate(s, `window.__shoot.spot('.react-flow__node[data-id="step-5"]', 10)`) },
      { at: 10200, do: async (s) => evaluate(s, `window.__shoot.spot('.react-flow__node[data-id="step-6"]', 10)`) },
      // 1:09.7 two gates, then one write
      { at: 14100, do: async (s) => evaluate(s, `window.__shoot.spot('.react-flow__node[data-id="step-3"]', 10)`) },
      { at: 15200, do: async (s) => evaluate(s, `window.__shoot.spot('.react-flow__node[data-id="step-7"]', 10)`) },
      { at: 16200, do: async (s) => evaluate(s, `window.__shoot.spot('.react-flow__node[data-id="step-8"]', 12)`) },
    ],
  },
  {
    // 1:12.7 the release, and the balance that moved
    id: "d",
    url: local("run-release.html"),
    steps: [
      { at: 1000, do: async (s) => evaluate(s, `window.__shoot.spotText("Release To Owner", null, 10)`) },
      // 1:17.4 the transaction on Etherscan
      { at: 4500, do: async (s) => evaluate(s, `window.__shoot.unspot()`) },
      { at: 4700, do: async (s, go) => go(RELEASE_TX) },
      // 1:25.5 what it cost the owner
      { at: 12600, do: async (s, go) => go(local("balances.html")) },
      { at: 14000, do: async (s) => evaluate(s, `window.__shoot.spotText("0.9640", null, 12)`) },
    ],
  },
  {
    // 1:32.4 both refusals
    id: "e",
    url: local("run-unproven.html"),
    steps: [
      { at: 1000, do: async (s) => evaluate(s, `window.__shoot.spotText("Proof Count", null, 10)`) },
      // 1:38.6 the second refusal, on a game that has not resolved
      { at: 6000, do: async (s) => evaluate(s, `window.__shoot.unspot()`) },
      { at: 6200, do: async (s, go) => go(local("run-unresolved.html")) },
      { at: 7600, do: async (s) => evaluate(s, `window.__shoot.spotText("Game Resolved", null, 10)`) },
      // 1:45.8 what the first version did instead
      { at: 13200, do: async (s) => evaluate(s, `window.__shoot.unspot()`) },
      { at: 13400, do: async (s) => evaluate(s, `window.__shoot.spotText("Transactions sent", null, 10)`) },
    ],
  },
  {
    // 1:56.7 waiting, unfinished, the repository
    id: "f",
    url: WATCHER,
    zoom: 1.1,
    steps: [
      { at: 1500, do: async (s) => canvasWide(s) },
      // 2:02.7 what is not done
      { at: 5800, do: async (s, go) => go(local("limits.html")) },
      // 2:10.5 the close
      { at: 13600, do: async (s, go) => go(local("close.html")) },
      { at: 15000, do: async (s, go) => go(REPO) },
    ],
  },
];
const SEGMENTS = SEGMENT_SLOTS.filter((slot) => CHOREOGRAPHY.some((c) => c.id === slot.id)).map((slot) => ({
  ...slot,
  ...CHOREOGRAPHY.find((c) => c.id === slot.id),
}));

{
  const orphan = CHOREOGRAPHY.find((c) => !SEGMENT_SLOTS.some((s) => s.id === c.id));
  if (orphan) throw new Error(`there is choreography for segment ${orphan.id} and no slot for it`);
  const problems = checkSlots();
  if (problems.length > 0) {
    for (const p of problems) console.error(`  ${p}`);
    process.exit(1);
  }
}

// -------------------------------------------------------------------- record

/** Compare what the camera sees against what the page is, before recording. */
async function cameraSeesThePage(s, region) {
  const shot = join(OUT, "preflight-page.png");
  const cam = join(OUT, "preflight-camera.png");
  const { data } = await s.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  writeFileSync(shot, Buffer.from(data, "base64"));

  execFileSync(findFfmpeg(), [
    "-y", "-loglevel", "error",
    "-f", "gdigrab", "-framerate", "2",
    "-offset_x", String(region.x), "-offset_y", String(region.y),
    "-video_size", `${region.w}x${region.h}`,
    "-i", "desktop", "-frames:v", "1", cam,
  ]);

  const run = spawnSync(findFfmpeg(), [
    "-v", "info",
    "-i", shot, "-i", cam,
    "-filter_complex",
    "[0:v]scale=480:270,format=gray[a];[1:v]scale=480:270,format=gray[b];" +
      "[a][b]blend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG",
    "-f", "null", "-",
  ], { encoding: "utf8" });
  const match = /YAVG=([\d.]+)/.exec(`${run.stdout ?? ""}${run.stderr ?? ""}`);
  return match ? Number(match[1]) : null;
}

async function recordSegment(seg, { dry = false } = {}) {
  const length = secondsArg ?? seconds(seg.to) - seconds(seg.from);
  mkdirSync(OUT, { recursive: true });
  const file = join(OUT, `seg-${seg.id}.mp4`);

  console.log(`segment ${seg.id}: ${seg.what}`);
  console.log(`  ${seg.from} to ${seg.to} (${length.toFixed(1)}s)`);

  const mon = pickMonitor(monitorArg);
  if (!dry) {
    console.log(
      `  monitor ${mon.index}: ${mon.width}x${mon.height} at ${mon.x},${mon.y}` +
        (mon.primary ? "  (PRIMARY: this is the screen someone is using)" : ""),
    );
  }

  closeProfileChrome();
  await sleep(1500);
  const browser = await launch({
    width: WIDTH,
    height: HEIGHT,
    x: mon.x,
    y: mon.y,
    port: 9222,
    headless: dry,
    profile: PROFILE,
  });
  const s = browser.session;

  let region = null;
  if (!dry) {
    const { windowId } = await s.send("Browser.getWindowForTarget");
    await s.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "fullscreen" } });
    await sleep(800);
    await s.send("Emulation.setDeviceMetricsOverride", {
      width: WIDTH,
      height: HEIGHT,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await sleep(500);
    const geo = await evaluate(s, `({iw: innerWidth, ih: innerHeight, dpr: devicePixelRatio})`);
    region = { x: mon.x, y: mon.y, w: WIDTH, h: HEIGHT };
    if (geo.iw !== WIDTH || geo.ih !== HEIGHT) {
      console.log(`  note: the page laid out at ${geo.iw}x${geo.ih}, not ${WIDTH}x${HEIGHT}`);
    }
    console.log(`  filming ${region.w}x${region.h} at ${region.x},${region.y}, no scaling`);
  } else {
    await s.send("Emulation.setDeviceMetricsOverride", { width: WIDTH, height: HEIGHT, deviceScaleFactor: 1, mobile: false });
  }

  /** Navigate and wait for the page to be usable, then re-inject the helpers. */
  const go = async (url) => {
    await s.send("Page.enable");
    const loaded = s.once("Page.loadEventFired", { timeout: 45000 });
    await s.send("Page.navigate", { url });
    await loaded.catch(() => null);
    await sleep(1200);
    await evaluate(s, HELPERS);
    if (seg.zoom && !/keeperhub\.com/.test(url)) {
      await evaluate(s, `document.documentElement.style.zoom = ${JSON.stringify(String(seg.zoom))}`);
      await sleep(300);
    }
  };

  try {
    // Setups that talk to the app need a page with its session; open it first.
    await go(ON_DEMAND);
    if (seg.setup) {
      const note = await seg.setup(s);
      console.log(`  setup: ${note ?? "done"}`);
    }
    const url = seg.url ?? seg.urlFrom(loadState());
    await go(url);

    if (!dry) {
      let diff = null;
      for (let i = 0; i < 12; i++) {
        diff = await cameraSeesThePage(s, region);
        if (diff !== null && diff <= 6) break;
        await sleep(1000);
      }
      if (diff === null) {
        console.log("  preflight: could not measure the screen against the page");
      } else if (diff > 6) {
        console.log(`  preflight: FAILED, the screen differs from the page by ${diff.toFixed(1)}/255`);
        console.log(`    something is drawn over the shot. Look at docs/recording/preflight-camera.png`);
        console.log(`    against preflight-page.png; whatever is in one and not the other is the problem.`);
        throw new Error("refusing to record a screen that is not the page");
      } else {
        console.log(`  preflight: the screen is the page (${diff.toFixed(1)}/255 apart)`);
      }
    }

    let capture = null;
    if (!dry) {
      capture = spawn(
        findFfmpeg(),
        [
          "-y", "-loglevel", "error",
          "-f", "gdigrab", "-framerate", "30",
          "-offset_x", String(region.x), "-offset_y", String(region.y),
          "-video_size", `${region.w}x${region.h}`,
          "-i", "desktop",
          "-t", String(length),
          "-c:v", "libx264", "-preset", "veryfast", "-crf", "20",
          "-pix_fmt", "yuv420p",
          file,
        ],
        { stdio: ["ignore", "ignore", "inherit"] },
      );
      await sleep(1200);
    }

    const t0 = Date.now();
    const steps = secondsArg === null ? seg.steps : seg.steps.filter((x) => x.at <= secondsArg * 1000);
    for (const step of steps) {
      const wait = step.at - (Date.now() - t0);
      if (wait > 0) await sleep(wait);
      const mark = ((Date.now() - t0) / 1000).toFixed(1);
      try {
        const got = await step.do(s, go);
        console.log(`  ${mark}s  ok${got && got !== "ready" ? `  ${String(got).slice(0, 60)}` : ""}`);
      } catch (err) {
        console.log(`  ${mark}s  MISSED: ${err.message.split("\n")[0].slice(0, 100)}`);
      }
      // --snap: a frame after every step, so a dry run can be looked at rather
      // than trusted. The page is asked to draw itself; no screen is touched.
      if (snapArg) {
        await sleep(400);
        const { data } = await s.send("Page.captureScreenshot", { format: "png" });
        writeFileSync(join(OUT, `snap-${seg.id}-${String(step.at).padStart(5, "0")}.png`), Buffer.from(data, "base64"));
      }
    }
    const remaining = length * 1000 - (Date.now() - t0);
    if (remaining > 0) await sleep(remaining + 400);

    if (capture) {
      if (capture.exitCode === null) {
        await Promise.race([
          new Promise((r) => capture.on("exit", r)),
          sleep(15000).then(() => capture.kill()),
        ]);
      }
      const probe = execFileSync(findFfmpeg("ffprobe"), [
        "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file,
      ]).toString().trim();
      console.log(`  wrote docs/recording/seg-${seg.id}.mp4 (${Number(probe).toFixed(1)}s)`);
    } else {
      console.log("  dry run: choreography only, nothing captured");
    }
  } finally {
    await browser.close();
  }
}

// ---------------------------------------------------------------------- main

const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(name);
  return i === -1 ? null : argv[i + 1];
};

monitorArg = arg("--monitor");
secondsArg = arg("--seconds") === null ? null : Number(arg("--seconds"));
const snapArg = argv.includes("--snap");

if (argv.includes("--monitors")) {
  for (const m of monitors()) {
    console.log(
      `  ${m.index}  ${String(m.width).padStart(4)}x${String(m.height).padStart(4)} at ` +
        `${String(m.x).padStart(6)},${m.y}${m.primary ? "   PRIMARY" : ""}`,
    );
  }
  const chosen = pickMonitor(null);
  console.log(`\n  with no --monitor, the shoot goes to monitor ${chosen.index}`);
  process.exit(0);
}

if (argv.includes("--list") || argv.length === 0) {
  const { lines } = JSON.parse(readFileSync(join(ROOT, "docs", "demo-script.json"), "utf8"));
  const say = (from, to) =>
    lines.filter((l) => seconds(l.start) >= seconds(from) && seconds(l.start) < seconds(to)).length;
  for (const seg of SEGMENTS) {
    console.log(
      `  ${seg.id}  ${seg.from}-${seg.to}  ${String((seconds(seg.to) - seconds(seg.from)).toFixed(0)).padStart(2)}s  ` +
        `${String(say(seg.from, seg.to)).padStart(2)} lines  ${seg.what}`,
    );
  }
  const covered = SEGMENTS.reduce((n, s) => n + seconds(s.to) - seconds(s.from), 0);
  console.log(`\n  ${covered.toFixed(0)}s of 180s covered`);
  process.exit(0);
}

const dry = argv.includes("--dry");
const wanted = argv.includes("--all") ? SEGMENTS : SEGMENTS.filter((s) => s.id === arg("--segment"));
if (wanted.length === 0) {
  console.error(`no such segment. Try --list.`);
  process.exit(1);
}
for (const seg of wanted) await recordSegment(seg, { dry });
