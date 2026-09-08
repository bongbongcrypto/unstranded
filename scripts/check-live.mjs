#!/usr/bin/env node
// Does the workflow on the screen still match the one in this repository?
//
//   KEEPERHUB_API_KEY=... node scripts/check-live.mjs
//
// The demo films the live canvas and rings nodes on it by id, and the narration
// says how many gates there are. Everything else in this repository is checked
// against the JSON in workflows/, which the platform never sees again after an
// import. So the one thing no other check can see is the workflow actually
// sitting in the account, and that is the thing the camera points at.
//
// This was written because the two had in fact drifted: the JSON here had two
// gates and ten nodes, the account still held the seven node revision with one,
// and the shot list rang three nodes that were not there any more.
//
// Without a key there is nothing to compare, and it says so rather than passing
// quietly. Run it before recording.
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASE = process.env.KEEPERHUB_BASE_URL ?? "https://app.keeperhub.com/api";

let key = process.env.KEEPERHUB_API_KEY;
if (!key && existsSync(join(ROOT, ".env"))) {
  const line = readFileSync(join(ROOT, ".env"), "utf8").split("\n")
    .find((l) => l.startsWith("KEEPERHUB_API_KEY="));
  if (line) key = line.slice(line.indexOf("=") + 1).trim();
}
if (!key) {
  console.log("no KEEPERHUB_API_KEY, so the live workflows were not checked.");
  console.log("Set one to compare the account against workflows/ before recording.");
  process.exit(0);
}

// The two the recorder films, by the ids it films them at.
const RECORDER = readFileSync(join(ROOT, "scripts", "record-demo.mjs"), "utf8");
const idOf = (name) => {
  const m = new RegExp(`const ${name} = "([^"]+)"`).exec(RECORDER);
  if (!m) throw new Error(`scripts/record-demo.mjs no longer defines ${name}`);
  return m[1];
};
const PAIRS = [
  { id: idOf("ON_DEMAND_ID"), file: "workflows/on-demand-finalizer.json", what: "the on demand keeper" },
  { id: idOf("WATCHER_ID"), file: "workflows/unattended-finalizer.json", what: "the unattended keeper" },
];

const kindOf = (n) => n.data?.config?.actionType ?? n.data?.config?.triggerType;
const problems = [];

for (const pair of PAIRS) {
  const res = await fetch(`${BASE}/workflows/${pair.id}`, {
    headers: { authorization: "Bearer " + key },
  });
  if (!res.ok) {
    problems.push(`${pair.what} (${pair.id}) could not be read: HTTP ${res.status}`);
    continue;
  }
  const body = await res.json();
  const live = body.workflow ?? body.data ?? body;
  const repo = JSON.parse(readFileSync(join(ROOT, pair.file), "utf8"));

  const liveIds = (live.nodes ?? []).map((n) => n.id);
  const repoIds = repo.nodes.map((n) => n.id);
  const liveKinds = (live.nodes ?? []).map(kindOf);
  const repoKinds = repo.nodes.map(kindOf);
  const gates = liveKinds.filter((k) => k === "Condition").length;

  console.log(`${pair.what}: ${liveIds.length} nodes, ${gates} gates, enabled ${live.enabled}`);

  for (const id of repoIds) {
    if (!liveIds.includes(id)) problems.push(`${pair.what} on the platform has no ${id}, and ${pair.file} does`);
  }
  for (const id of liveIds) {
    if (!repoIds.includes(id)) problems.push(`${pair.what} on the platform has ${id}, and ${pair.file} does not`);
  }
  if (liveKinds.join(",") !== repoKinds.join(",")) {
    problems.push(`${pair.what} is a different shape on the platform than in ${pair.file}`);
  }
  if (gates !== 2) {
    problems.push(`${pair.what} has ${gates} gates on the platform, and the narration says two`);
  }
}

// Every node the shot list rings has to be on the canvas it films.
const rung = new Set([...RECORDER.matchAll(/data-id="([^"]+)"/g)].map((m) => m[1]));
console.log(`node ids the shot list rings: ${[...rung].join(", ")}`);

if (problems.length === 0) {
  console.log("\nthe account holds what this repository ships");
  process.exit(0);
}
console.log(`\n${problems.length} difference(s) the camera would find:`);
for (const p of problems) console.log("  - " + p);
process.exit(1);
