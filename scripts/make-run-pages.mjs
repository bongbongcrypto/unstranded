#!/usr/bin/env node
// Render one page per run, from KeeperHub's own execution log.
//
//   KEEPERHUB_API_KEY=... node scripts/make-run-pages.mjs
//
// Runs where the key is, and writes plain HTML into docs/recording. The
// recorder then films those files and never needs a key of its own.
//
// The runs filmed are the three the video claims: the release, and the two
// refusals. What each page shows is what the log says, in the order the steps
// ran, with the value each read returned. Nothing is written by hand.
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "docs", "recording");
mkdirSync(OUT, { recursive: true });

const BASE = process.env.KEEPERHUB_BASE_URL ?? "https://app.keeperhub.com/api";
let key = process.env.KEEPERHUB_API_KEY;
if (!key && existsSync(join(ROOT, ".env"))) {
  const line = readFileSync(join(ROOT, ".env"), "utf8").split("\n")
    .find((l) => l.startsWith("KEEPERHUB_API_KEY="));
  if (line) key = line.slice(line.indexOf("=") + 1).trim();
}
if (!key) {
  console.error("set KEEPERHUB_API_KEY, or put it in .env next to this repository");
  process.exit(2);
}

const RUNS = [
  { file: "run-release.html", id: "0gn14g1a979r317aa82hh",
    title: "It released a withdrawal to the account that owns it",
    note: "The keeper holds no key belonging to that account. This run was made by the "
      + "revision with one gate, so there is no second one in the log. The proof rests on a "
      + "dispute game resolved for the defender, of the type the portal respects, so the "
      + "second gate would have opened too." },
  { file: "run-unproven.html", id: "vhksgdq08pmz6mpuo8qob",
    title: "Given a withdrawal nobody proved, it does nothing",
    note: "Gate one closes on a proof count of zero. No transaction is sent." },
  { file: "run-unresolved.html", id: "i1coae2gsc0z1mu2kocse",
    title: "Given one whose dispute game is still running, it does nothing",
    note: "Gate two closes on the game's own status. No transaction is sent." },
];

const CSS = `
  :root { color-scheme: dark; }
  body { margin: 0; background: #0b0f14; color: #e6edf3; font: 26px/1.45 ui-monospace, "Cascadia Mono", Consolas, monospace; }
  main { padding: 52px 88px 160px; max-width: 1760px; }
  .src { color: #8b98a5; font-size: 21px; margin-bottom: 24px; }
  h1 { font: 600 40px/1.2 system-ui, "Segoe UI", sans-serif; margin: 0 0 26px; letter-spacing: -0.01em; }
  table { border-collapse: collapse; width: 100%; }
  td { padding: 14px 18px; border-bottom: 1px solid #1f2933; vertical-align: top; }
  .step { color: #8b98a5; width: 300px; }
  .val { color: #e6edf3; word-break: break-all; }
  .ok { color: #7ee787; }
  .no { color: #ffb86b; }
  .tx { color: #7fd1ff; }
  .note { color: #8b98a5; font-size: 23px; margin-top: 30px; }
  .sent { font-size: 34px; margin-top: 26px; }
`;
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);

async function get(path) {
  const res = await fetch(BASE + path, { headers: { authorization: "Bearer " + key } });
  if (!res.ok) throw new Error(`${path} returned ${res.status}`);
  return res.json();
}

/** The one value from a step worth putting on screen. */
function readable(entry) {
  const out = entry.output ?? {};
  if (out.condition !== undefined) {
    return `<span class="${out.condition ? "ok" : "no"}">${out.condition}</span>`;
  }
  if (out.result !== undefined && out.result !== null) {
    if (typeof out.result === "object") {
      return esc(Object.entries(out.result).map(([k, v]) => `${k}: ${v}`).join("   "));
    }
    return esc(String(out.result));
  }
  if (entry.nodeType === "web3/write-contract") {
    return `<span class="tx">sent</span>`;
  }
  return esc(entry.status ?? "");
}

for (const run of RUNS) {
  const body = await get(`/workflows/executions/${run.id}/logs`);
  const entries = (body.logs ?? body.items ?? [])
    .filter((e) => e && e.nodeName)
    .sort((a, b) => String(a.startedAt ?? "").localeCompare(String(b.startedAt ?? "")));

  const wait = await get(`/workflows/executions/${run.id}/wait?timeout=5`).catch(() => ({}));
  const hashes = wait.transactionHashes ?? [];

  const rows = entries.map((e) =>
    `<tr><td class="step">${esc(e.nodeName)}</td><td class="val">${readable(e)}</td></tr>`).join("");
  const sent = hashes.length
    ? `<div class="sent tx">transaction ${esc(hashes[0].hash)}</div>`
    : `<div class="sent no">transactions sent: none</div>`;

  writeFileSync(join(OUT, run.file), `<!doctype html><meta charset="utf-8">` +
    `<title>${esc(run.title)}</title><style>${CSS}</style><main>` +
    `<div class="src">KeeperHub execution ${esc(run.id)}, read from its own log</div>` +
    `<h1>${esc(run.title)}</h1><table>${rows}</table>${sent}` +
    `<div class="note">${esc(run.note)}</div></main>`);
  console.log(`wrote docs/recording/${run.file}  (${entries.length} steps, ${hashes.length} transactions)`);
}
