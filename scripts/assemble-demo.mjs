#!/usr/bin/env node
// Put the recorded segments, the narration and the captions together.
//
//   node scripts/assemble-demo.mjs            build docs/recording/demo.mp4
//   node scripts/assemble-demo.mjs --no-subs  same, without burned captions
//
// Every segment goes into the exact slot the script gives it, so the picture
// cannot drift away from the voice. A segment that is a second short is padded
// with its own last frame and a segment that is long is cut; either is reported
// rather than silently absorbed, because a segment whose length disagrees with
// the script means one of them is wrong.
//
// A slot with no recording gets a slate saying what belongs there. That is on
// purpose: it makes an unfinished cut watchable end to end, and it makes the
// missing piece obvious instead of looking like a mistake.
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { checkSlots, cutFrom, seconds, slots } from "./lib/cuts.mjs";

const CUT = cutFrom(process.argv);
const SEGMENT_SLOTS = slots(CUT);
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = CUT.recording;
const WIDTH = 1920;
const HEIGHT = 1080;

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
const FFMPEG = findFfmpeg();
const FFPROBE = findFfmpeg("ffprobe");

const duration = (file) =>
  Number(
    execFileSync(FFPROBE, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", file])
      .toString()
      .trim(),
  );

const run = (args) => {
  const r = spawnSync(FFMPEG, ["-y", "-loglevel", "error", ...args], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`ffmpeg failed: ${(r.stderr ?? "").trim().split("\n").slice(-3).join(" ")}`);
};

// ------------------------------------------------------------------- checks
const { lines } = JSON.parse(readFileSync(CUT.script, "utf8"));
const total = seconds(lines.at(-1).end);
const slotProblems = checkSlots(SEGMENT_SLOTS, total);
if (slotProblems.length > 0) {
  for (const p of slotProblems) console.error(`  ${p}`);
  process.exit(1);
}

const narration = CUT.narrationTrack;
if (!existsSync(narration)) {
  console.error(`docs/${CUT.name}.narration.wav is missing. Run scripts/build-narration-track.mjs --cut ${CUT.name} first.`);
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });

/** A stand-in for a slot with no recording, saying what belongs there. */
function slate(slot, length, file) {
  // The font is named outright. There is no fontconfig on Windows, so drawtext
  // with no fontfile fails with "Cannot load default config file: (null)",
  // which reads like a broken filter rather than a missing font.
  const font = [
    "C:/Windows/Fonts/segoeui.ttf",
    "C:/Windows/Fonts/arial.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
    "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf",
    "/usr/share/fonts/TTF/DejaVuSans.ttf",
    "/System/Library/Fonts/Supplemental/Arial.ttf",
  ].find((f) => existsSync(f));
  if (!font) {
    throw new Error("no font for the slate. Set one of the paths in slate() to a .ttf on this machine.");
  }
  const fontArg = font.replace(/\\/g, "/").replace(/^([A-Za-z]):/, "$1\\:");

  // One drawtext per line rather than a newline inside the text.
  //
  // drawtext's own \n survived neither the argument nor the filter parser here:
  // the slate came out reading "THE LIVE MAINNET PAYMENTnnthis one needs", with
  // both breaks flattened into the letter n. Two filters have nothing to escape.
  const lines = slot.owner ? [slot.what.toUpperCase(), slot.owner] : [slot.what, "not recorded yet"];
  // Apostrophes are dropped, not escaped. drawtext's text sits inside single
  // quotes and ffmpeg's parser has no way to put a single quote inside them: a
  // \' ended the quoted section early, and the rest of the sentence was read as
  // filter options, which is why this failed with "option w not found".
  const escape = (t) => t.replace(/[\\']/g, "").replace(/:/g, "\\:").replace(/[%,;]/g, " ");
  const draw = lines.map(
    (line, i) =>
      `drawtext=fontfile='${fontArg}':text='${escape(line)}':fontcolor=${i === 0 ? "0xc8d8ee" : "0x8aa0c0"}:` +
      `fontsize=${i === 0 ? 52 : 36}:x=(w-text_w)/2:y=(h/2)${i === 0 ? "-60" : "+30"}`,
  );
  run([
    "-f", "lavfi", "-i", `color=c=0x0b1220:s=${WIDTH}x${HEIGHT}:d=${length}`,
    "-vf", [...draw, "drawbox=x=0:y=0:w=iw:h=ih:color=0x7fd1ff@0.25:t=6"].join(","),
    "-r", "30", "-c:v", "libx264", "-preset", "veryfast", "-pix_fmt", "yuv420p", file,
  ]);
}

// -------------------------------------------------------------- the picture
const parts = [];
const report = [];
for (const slot of SEGMENT_SLOTS) {
  const length = seconds(slot.to) - seconds(slot.from);
  const source = join(OUT, `seg-${slot.id}.mp4`);
  const fitted = join(OUT, `fit-${slot.id}.mp4`);

  if (!existsSync(source)) {
    slate(slot, length, fitted);
    report.push(`  ${slot.id}  ${length.toFixed(1)}s  SLATE${slot.owner ? " (owner's shot)" : ""}`);
  } else {
    const have = duration(source);
    // tpad holds the last frame if the take is short; -t cuts it if it is long.
    // Both are stated in the report rather than absorbed quietly.
    run([
      "-i", source,
      "-vf", `tpad=stop_mode=clone:stop_duration=${Math.max(0, length - have + 0.5).toFixed(3)},fps=30`,
      "-t", String(length),
      "-an", "-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p", fitted,
    ]);
    const drift = have - length;
    report.push(
      `  ${slot.id}  ${length.toFixed(1)}s  recorded ${have.toFixed(1)}s` +
        (Math.abs(drift) < 0.15 ? "" : drift > 0 ? `  (${drift.toFixed(1)}s trimmed)` : `  (${(-drift).toFixed(1)}s held)`),
    );
  }
  parts.push(fitted);
}

for (const line of report) console.log(line);

const listFile = join(OUT, "parts.txt");
writeFileSync(listFile, parts.map((p) => `file '${p.replace(/\\/g, "/")}'`).join("\n"));

const silent = join(OUT, "picture.mp4");
run(["-f", "concat", "-safe", "0", "-i", listFile, "-c", "copy", silent]);

const picture = duration(silent);
if (Math.abs(picture - total) > 0.4) {
  console.error(`the picture came out ${picture.toFixed(1)}s and the script runs ${total.toFixed(1)}s`);
  process.exit(1);
}

// ----------------------------------------------------- voice, then captions
// The review copy carries a Korean gloss under each English burst. It is not
// the cut: the video is in English and goes out that way. It exists so
// the person whose name is on it can read what the video says before it is
// public, which is not a thing to leave to trust.
const review = process.argv.includes("--review");
const final = CUT.video(review);
const assFile = review ? CUT.reviewAss : CUT.shortAss;
// Refuse to burn a caption track that does not fit the frame. The generator
// estimates each burst's width; this renders them and measures.
const captions = spawnSync(process.execPath, [join(ROOT, "scripts", "check-captions.mjs"), join("docs", assFile)], {
  stdio: "inherit",
});
if (captions.status !== 0) {
  console.error(`${assFile} has captions that do not fit the frame; nothing assembled`);
  process.exit(1);
}
const ass = join(ROOT, "docs", assFile).replace(/\\/g, "/").replace(/^([A-Za-z]):/, "$1\\:");
// Said out loud because this is the slow part and silence reads like a hang.
// The preset is deliberate: this is the copy people watch.
console.log(`\nburning ${assFile} and the narration at preset slow, crf 19.` +
  ` This is minutes, not seconds.`);
run([
  "-i", silent,
  "-i", narration,
  ...(process.argv.includes("--no-subs") ? [] : ["-vf", `subtitles='${ass}'`]),
  "-map", "0:v:0", "-map", "1:a:0",
  "-c:v", "libx264", "-preset", "slow", "-crf", "19", "-pix_fmt", "yuv420p",
  "-c:a", "aac", "-b:a", "192k",
  "-shortest", final,
]);

const built = duration(final);
console.log(
  `\nwrote ${final.slice(final.indexOf("docs"))}  ` +
    `${Math.floor(built / 60)}:${String(Math.round(built % 60)).padStart(2, "0")}`,
);
const missing = SEGMENT_SLOTS.filter((s) => !existsSync(join(OUT, `seg-${s.id}.mp4`)));
if (missing.length > 0) {
  console.log(`still on a slate: ${missing.map((s) => s.id).join(", ")}`);
}
