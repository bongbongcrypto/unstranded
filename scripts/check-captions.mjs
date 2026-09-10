#!/usr/bin/env node
// Does every English caption fit the frame it is burned into?
//
//   node scripts/check-captions.mjs [docs/demo.short.ass]
//
// The Pop style does not wrap (WrapStyle 2), so a burst wider than the frame is
// cut off at both ends, and nothing downstream notices: the OCR sweep still
// matches the words it can see. This shipped once. "days, two hundred and
// seventy one withdrawals were proven." reached the screen as ", two hundred
// and seventy one withdrawals were pro".
//
// The generator estimates each burst's width from a per-character table. This
// is the proof: every Pop event is rendered with the renderer the video uses,
// libass through ffmpeg, onto a black frame, and the lit width is measured. A
// caption fails when it touches a frame edge, or when it is wider than the
// margin box during the 112% pop-in the style applies for two frames.
//
// Skips with a message when ffmpeg or the caption file is absent, since a
// fresh clone may have neither. Run it after make-video-assets.mjs; the
// assembler runs it before burning anything.
import { spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FILE = join(ROOT, process.argv[2] ?? "docs/demo.short.ass");
const WIDTH = 1920;
const HEIGHT = 1080;
const MARGIN_BOX = WIDTH - 2 * 140; // the Pop style's MarginL and MarginR
const POP_IN = 1.12; // the burst is scaled to 112% for its first two frames
const LIT = 40; // grey level above which a pixel counts as caption

if (!existsSync(FILE)) {
  console.log(`${process.argv[2] ?? "docs/demo.short.ass"} does not exist yet, so there are no captions to measure.`);
  console.log("Build it first: node scripts/make-video-assets.mjs.");
  process.exit(0);
}
const probe = spawnSync("ffmpeg", ["-version"], { encoding: "utf8" });
if (probe.error || probe.status !== 0) {
  console.log("ffmpeg is not on the PATH, so the captions were not rendered.");
  console.log("Install ffmpeg to measure them the way the video does.");
  process.exit(0);
}

const source = readFileSync(FILE, "utf8").split("\n");
const header = source.filter((l) => !l.startsWith("Dialogue:"));
// Nine fields precede the text, and the text itself carries commas inside its
// effect tags, so the split stops at the ninth comma and keeps the rest whole.
// (A split with a limit drops the remainder, which once turned every caption
// into "{\fad(50" and passed all of them.)
const fields = (line) => {
  const rest = line.slice("Dialogue:".length).trim();
  const parts = [];
  let from = 0;
  for (let n = 0; n < 9; n++) {
    const at = rest.indexOf(",", from);
    parts.push(rest.slice(from, at));
    from = at + 1;
  }
  parts.push(rest.slice(from));
  return parts;
};
const bursts = source
  .filter((l) => l.startsWith("Dialogue:"))
  .map(fields)
  .filter((f) => f[3] === "Pop")
  .map((f) => f[9].replace(/\{[^}]*\}/g, ""));
if (bursts.some((b) => b.includes("{") || b.length === 0)) {
  console.error("a caption still carries a tag or is empty after parsing; the parser is wrong, not the captions");
  process.exit(1);
}

const work = mkdtempSync(join(tmpdir(), "captions-"));
const measured = [];
try {
  for (const text of bursts) {
    // The pop-in animation is stripped so the resting width is what is measured;
    // the 112% moment is applied as a factor below.
    const one = [...header, `Dialogue: 0,0:00:00.00,0:00:02.00,Pop,,0,0,0,,${text}`];
    writeFileSync(join(work, "one.ass"), `${one.join("\n")}\n`, "utf8");
    // cwd is the temp dir so the filter sees a bare filename: a drive colon in
    // the path is read as a filter option on Windows.
    const r = spawnSync(
      "ffmpeg",
      ["-v", "error", "-f", "lavfi", "-i", `color=c=black:s=${WIDTH}x${HEIGHT}:d=1`, "-vf", "ass=one.ass", "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "gray", "-"],
      { cwd: work, maxBuffer: WIDTH * HEIGHT * 2 },
    );
    if (r.status !== 0 || !r.stdout || r.stdout.length < WIDTH * HEIGHT) {
      console.error(`ffmpeg could not render "${text}": ${r.stderr?.toString() ?? "no output"}`);
      process.exit(1);
    }
    let left = -1;
    let right = -1;
    // Captions sit in the bottom band; scanning only that keeps this quick.
    for (let y = HEIGHT - 400; y < HEIGHT; y++) {
      const row = y * WIDTH;
      for (let x = 0; x < WIDTH; x++) {
        if (r.stdout[row + x] > LIT) {
          if (left === -1 || x < left) left = x;
          if (x > right) right = x;
        }
      }
    }
    const width = left === -1 ? 0 : right - left + 1;
    measured.push({ text, width, left, right });
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}

measured.sort((a, b) => b.width - a.width);
const problems = [];
for (const m of measured) {
  if (m.left <= 1 || m.right >= WIDTH - 2) {
    problems.push(`cut off at the frame edge (${m.width}px visible): "${m.text}"`);
  } else if (m.width * POP_IN > MARGIN_BOX) {
    problems.push(`${m.width}px, ${Math.round(m.width * POP_IN)}px during the pop-in, past the ${MARGIN_BOX}px margin box: "${m.text}"`);
  }
}

console.log(`captions rendered and measured: ${measured.length}`);
console.log(`widest: ${measured[0]?.width ?? 0}px "${measured[0]?.text ?? ""}"`);
if (problems.length === 0) {
  console.log("\nevery caption fits the frame, pop-in included");
  process.exit(0);
}
console.log(`\n${problems.length} caption${problems.length === 1 ? "" : "s"} would not fit:`);
for (const p of problems) console.log("  - " + p);
process.exit(1);
