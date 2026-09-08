#!/usr/bin/env node
// Give every narration line the time its own words need.
//
//   node scripts/retime-script.mjs           rewrite docs/demo-script.json
//   node scripts/retime-script.mjs --dry     print what it would do
//
// Timings were written by hand first, and hand-written timings are wrong in
// two directions at once: a line with too many words is rushed, and a line with
// too few leaves the picture sitting in silence. This sets each slot from the
// line's word count at a speaking rate, adds a breath, and lays them end to
// end. Segment boundaries follow, so the recorder and the assembler stay in
// agreement with the script.
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DRY = process.argv.includes("--dry");

// The voice reads at about this rate. Below it a line sounds unhurried; much
// above it the numbers stop landing.
const WORDS_PER_MINUTE = 168;
const BREATH = 0.7;
const MIN_SLOT = 3.0;

const stamp = (s) => {
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${String(m).padStart(2, "0")}:${rest.toFixed(3).padStart(6, "0")}`;
};

const script = JSON.parse(readFileSync(join(ROOT, "docs", "demo-script.json"), "utf8"));

// Segment boundaries are named by the line each one starts at, so a retime
// moves them rather than breaking them.
const SEGMENT_STARTS = { 0: "a", 5: "b", 8: "c", 11: "d", 14: "e", 17: "f" };
const WHAT = {
  a: "three transactions, people stop after two, and the count",
  b: "anyone may finish someone else's withdrawal, and cannot take it",
  c: "the workflow: five reads, two gates, one write",
  d: "a stranger's 0.95 ETH released, and the balance that moved",
  e: "both refusals, and the gate that was missing at first",
  f: "waiting unattended, what is unfinished, the close",
};

// Once the audio exists, measure it. The word rate is only an estimate, and it
// was out by two tenths of a second on three lines, which is enough to push a
// sentence past the picture it belongs to.
const NARRATION = join(ROOT, "docs", "narration");
const measured = script.lines.map((_, index) => {
  const file = join(NARRATION, String(index + 1).padStart(2, "0") + ".mp3");
  if (!existsSync(file)) return null;
  const probe = spawnSync("ffprobe", ["-v", "error", "-show_entries", "format=duration",
    "-of", "csv=p=0", file], { encoding: "utf8" });
  const seconds = Number(String(probe.stdout).trim());
  return Number.isFinite(seconds) && seconds > 0 ? seconds : null;
});
const haveAudio = measured.every((d) => d !== null);
console.log(haveAudio
  ? "timing from the narration audio itself"
  : `timing from ${WORDS_PER_MINUTE} words per minute, because the audio is not built yet`);

let at = 0;
const slots = [];
script.lines.forEach((line, index) => {
  const words = line.say.trim().split(/\s+/).length;
  const spoken = measured[index] ?? (words / WORDS_PER_MINUTE) * 60;
  const slot = Math.max(MIN_SLOT, Math.ceil((spoken + BREATH) * 10) / 10);
  const from = at;
  at = Math.round((at + slot) * 1000) / 1000;
  slots.push({ index, words, spoken, slot, from, to: at });
  line.start = stamp(from);
  line.end = stamp(at);
});

const segments = [];
for (const [indexText, id] of Object.entries(SEGMENT_STARTS)) {
  const index = Number(indexText);
  const nextStart = Object.keys(SEGMENT_STARTS).map(Number).sort((a, b) => a - b)
    .find((i) => i > index);
  segments.push({
    id,
    from: stamp(slots[index].from),
    to: stamp(nextStart === undefined ? at : slots[nextStart].from),
    what: WHAT[id],
  });
}

for (const s of slots) {
  console.log(`  line ${String(s.index + 1).padStart(2)}  ${s.words} words  ` +
    `speaks ${s.spoken.toFixed(1)}s  slot ${s.slot.toFixed(1)}s  ` +
    `slack ${(s.slot - s.spoken).toFixed(1)}s`);
}
console.log(`\ntotal ${at.toFixed(1)}s, timed from ` +
  (haveAudio ? "the narration audio" : `${WORDS_PER_MINUTE} words per minute`));
for (const s of segments) console.log(`  segment ${s.id}  ${s.from} to ${s.to}`);

if (DRY) {
  console.log("\ndry run, nothing written");
  process.exit(0);
}

writeFileSync(join(ROOT, "docs", "demo-script.json"), JSON.stringify(script, null, 2) + "\n");

const segmentsFile = join(ROOT, "scripts", "lib", "segments.mjs");
const source = readFileSync(segmentsFile, "utf8");
const table = "export const SEGMENT_SLOTS = [\n" + segments.map((s) =>
  `  { id: "${s.id}", from: "${s.from}", to: "${s.to}", what: "${s.what}" },`).join("\n") + "\n];\n";
const start = source.indexOf("export const SEGMENT_SLOTS");
const end = source.indexOf("];", start) + 3;
writeFileSync(segmentsFile, source.slice(0, start) + table + source.slice(end));

console.log("\nwrote docs/demo-script.json and scripts/lib/segments.mjs");
