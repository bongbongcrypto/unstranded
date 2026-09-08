#!/usr/bin/env node
// Will the camera find what the choreography reaches for?
//
//   node scripts/check-shots.mjs
//
// Every spotText in the recorder names a string that has to be on the page it
// is pointed at, and every node id has to exist in the workflow being filmed.
// A missing one does not fail the recording: the step is logged as MISSED and
// the shot is simply of nothing in particular, which is only noticed later.
//
// Run this after make-pages.mjs and make-run-pages.mjs, and before recording.
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "docs", "recording");
const RECORDER = readFileSync(join(ROOT, "scripts", "record-demo.mjs"), "utf8");

// The fact pages are built from the chain, not committed, so a fresh clone has
// none of them and there is nothing to point a camera at yet. Once the folder
// exists, every page and every string in it has to be there.
if (!existsSync(OUT)) {
  console.log("docs/recording does not exist yet, so there is nothing to film.");
  console.log("Build the pages first: node scripts/make-pages.mjs, then scripts/make-run-pages.mjs.");
  process.exit(0);
}

const problems = [];
const note = (m) => problems.push(m);

// Walk the choreography in order, tracking which page each step is looking at.
// A spotText belongs to whichever page was last opened before it.
const body = RECORDER.slice(RECORDER.indexOf("const CHOREOGRAPHY = ["));
const events = [...body.matchAll(/(?:url:\s*local\("([^"]+)"\)|go\(local\("([^"]+)"\)\)|go\((ON_DEMAND|WATCHER|RELEASE_TX|REPO)\)|spotText\("([^"]+)"|url:\s*(ON_DEMAND|WATCHER))/g)];

let page = null;
let checked = 0;
const live = new Set(["ON_DEMAND", "WATCHER", "RELEASE_TX", "REPO"]);

for (const m of events) {
  const openLocal = m[1] ?? m[2];
  const openLive = m[3] ?? m[5];
  const text = m[4];
  if (openLocal) { page = openLocal; continue; }
  if (openLive) { page = openLive; continue; }
  if (!text) continue;

  if (page === null) { note(`spotText("${text}") before any page is opened`); continue; }
  if (live.has(page)) { checked += 1; continue; }   // a live page, not ours to check

  const file = join(OUT, page);
  if (!existsSync(file)) { note(`${page} does not exist, so "${text}" cannot be found`); continue; }
  const html = readFileSync(file, "utf8");
  // The page carries the text as written, or with the HTML entities the writer escapes.
  const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  if (!html.includes(text) && !html.includes(escaped)) {
    note(`${page} does not contain "${text}"`);
  }
  checked += 1;
}

// Node ids the choreography rings have to exist in the workflow it films.
const wanted = new Set([...RECORDER.matchAll(/data-id="([^"]+)"/g)].map((m) => m[1]));
const wf = JSON.parse(readFileSync(join(ROOT, "workflows", "on-demand-finalizer.json"), "utf8"));
const have = new Set(wf.nodes.map((n) => n.id));
for (const id of wanted) {
  if (!have.has(id)) note(`the choreography rings ${id}, and the workflow has no such node`);
}

// Every page the choreography opens has to exist.
for (const m of RECORDER.matchAll(/local\("([^"]+)"\)/g)) {
  if (!existsSync(join(OUT, m[1]))) note(`the choreography opens ${m[1]}, which is not in docs/recording`);
}

console.log(`spotText targets checked: ${checked}`);
console.log(`node ids checked: ${wanted.size}`);
if (problems.length === 0) {
  console.log("\nevery shot has something to point at");
  process.exit(0);
}
console.log(`\n${problems.length} shot${problems.length === 1 ? "" : "s"} would find nothing:`);
for (const p of problems) console.log("  - " + p);
process.exit(1);
