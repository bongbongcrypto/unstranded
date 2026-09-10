#!/usr/bin/env node
// Are the caption bursts the generator would write readable, whole, and narrow
// enough for the frame?
//
//   node scripts/check-pops.mjs
//
// Runs the splitter in scripts/lib/pops.mjs over every line of the script and
// over two sentences that shipped badly once, and holds each burst to the
// rules the splitter claims: it fits the line, it is not a lone word, it does
// not end on a word that leans on the next burst, it never cuts a spelled out
// number, and together the bursts say exactly what the line says.
//
// This is the check that catches a bad split before anything is rendered.
// scripts/check-captions.mjs then renders what was written and measures it.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { atoms, fits, leansOn, MIN_POP_CHARS, POP_LINE_PX, popWidth, pops } from "./lib/pops.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const script = JSON.parse(readFileSync(join(ROOT, "docs", "demo-script.json"), "utf8"));
const lines = Array.isArray(script) ? script : script.lines;

// The two that were cut off on screen. They stay here whatever the script
// says today, so the fix cannot quietly stop applying.
const REGRESSIONS = [
  "So I counted. On Base, across ten sampled days, two hundred and seventy one withdrawals were proven.",
  "Here is the part that makes this fixable. Anyone can finish someone else's withdrawal.",
];

const NEWLINE = "\\N";
const problems = [];
let bursts = 0;
let widest = { px: 0, text: "" };

function check(label, say) {
  const out = pops(say);
  bursts += out.length;
  const said = say.trim().split(/\s+/).join(" ");
  const rejoined = out.join(" ").split(NEWLINE).join(" ");
  if (rejoined !== said) problems.push(`${label}: the bursts do not say what the line says\n      line:   ${said}\n      bursts: ${rejoined}`);

  out.forEach((burst, i) => {
    for (const line of burst.split(NEWLINE)) {
      const px = popWidth(line);
      if (px > widest.px) widest = { px, text: line };
      if (!fits(line)) problems.push(`${label}: ${Math.round(px)}px is wider than the ${POP_LINE_PX}px line: "${line}"`);
    }
    const wordsIn = burst.split(NEWLINE).join(" ").split(" ");
    if (out.length > 1 && wordsIn.length < 2) problems.push(`${label}: a lone word in a burst: "${burst}"`);
    if (out.length > 1 && burst.length < MIN_POP_CHARS) problems.push(`${label}: a burst under ${MIN_POP_CHARS} characters flashes: "${burst}"`);
    if (i < out.length - 1 && leansOn(wordsIn.at(-1))) problems.push(`${label}: ends on a word that leans on the next burst: "${burst}"`);
  });

  for (const atom of atoms(say.trim().split(/\s+/))) {
    if (!atom.includes(" ")) continue;
    const whole = out.some((burst) => burst.split(NEWLINE).some((line) => line.includes(atom)));
    if (!whole) problems.push(`${label}: the number "${atom}" is cut between bursts or lines`);
  }
  return out;
}

lines.forEach((line, i) => check(`line ${i + 1}`, line.say));
REGRESSIONS.forEach((say, i) => {
  const out = check(`regression ${i + 1}`, say);
  console.log(`regression ${i + 1}: ${out.map((b) => `[${b}]`).join(" ")}`);
});

console.log(`lines: ${lines.length}, bursts: ${bursts}, widest ${Math.round(widest.px)}px "${widest.text}"`);
if (problems.length === 0) {
  console.log("\nevery burst fits, reads whole, and breaks where a reader would");
  process.exit(0);
}
console.log(`\n${problems.length} problem${problems.length === 1 ? "" : "s"}:`);
for (const p of problems) console.log("  - " + p);
process.exit(1);
