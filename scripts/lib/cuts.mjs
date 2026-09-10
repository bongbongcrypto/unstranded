// Which video is being built, and where its pieces live.
//
// There are two submissions and so two videos. The main track's is the
// integration; the bounty's is the three pull requests that came out of
// building it, which is a separate BUIDL on DoraHacks and needs a demo video of
// its own. They share every script in this folder, and differ only in the file
// names below.
//
// `--cut bounty` on any of the video scripts switches the whole set. Default is
// the main track, so a command written before there were two still means what
// it meant.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");

const CUTS = {
  demo: { what: "the main track: the integration" },
  bounty: { what: "the bounty: three pull requests into KeeperHub" },
};

/** The cut named by `--cut`, or the main one. */
export function cutFrom(argv) {
  const at = argv.indexOf("--cut");
  const name = at === -1 ? "demo" : argv[at + 1];
  if (!CUTS[name]) {
    throw new Error(`no such cut "${name}". There is ${Object.keys(CUTS).join(" and ")}.`);
  }
  return cut(name);
}

export function cut(name) {
  return {
    name,
    what: CUTS[name].what,
    // The script, and everything generated from it.
    script: join(ROOT, "docs", `${name}-script.json`),
    segments: join(ROOT, "docs", `${name}-segments.json`),
    narrationText: `${name}.narration.txt`,
    narrationDir: join(ROOT, "docs", name === "demo" ? "narration" : `narration-${name}`),
    narrationTrack: join(ROOT, "docs", `${name}.narration.wav`),
    shortAss: `${name}.short.ass`,
    reviewAss: `${name}.review.ass`,
    enSrt: `${name}.en.srt`,
    koSrt: `${name}.ko.srt`,
    // Recordings. Each cut keeps its own folder so a segment "a" of one is
    // never mistaken for a segment "a" of the other.
    recording: join(ROOT, "docs", "recording", name === "demo" ? "." : name),
    video: (review) => join(ROOT, "docs", "recording", name === "demo" ? "." : name,
      review ? `${name}.review.mp4` : `${name}.mp4`),
    shotTable: name === "demo" ? join(ROOT, "docs", "VIDEO-SCRIPT.md") : null,
  };
}

/** The lines of a cut's script. */
export function lines(c) {
  return JSON.parse(readFileSync(c.script, "utf8")).lines;
}

/** mm:ss.mmm to seconds. */
export const seconds = (stamp) => {
  const m = /^(\d{1,2}):(\d{2})\.(\d{3})$/.exec(stamp);
  if (!m) throw new Error(`not a mm:ss.mmm timestamp: ${stamp}`);
  return Number(m[1]) * 60 + Number(m[2]) + Number(m[3]) / 1000;
};

/**
 * A cut's segment table. Written by scripts/retime-script.mjs, which is the
 * only thing that should ever compute it: the recorder and the assembler have
 * to agree about it exactly, and a table maintained in two places drifts.
 */
export function slots(c) {
  if (!existsSync(c.segments)) {
    throw new Error(`${c.segments} does not exist. Run scripts/retime-script.mjs --cut ${c.name}.`);
  }
  return JSON.parse(readFileSync(c.segments, "utf8"));
}

export function writeSlots(c, table) {
  writeFileSync(c.segments, JSON.stringify(table, null, 2) + "\n");
}

/**
 * Fail if the slots do not tile the whole video without gaps or overlaps.
 *
 * Checked rather than trusted: a gap is a black frame in the finished cut and
 * an overlap is a segment that gets truncated, and both are the sort of thing
 * that is only noticed once the video is uploaded.
 */
export function checkSlots(table, totalSeconds) {
  const problems = [];
  let at = 0;
  for (const slot of table) {
    const from = seconds(slot.from);
    const to = seconds(slot.to);
    if (Math.abs(from - at) > 0.001) {
      problems.push(`segment ${slot.id} starts at ${slot.from}, and ${at.toFixed(3)}s is where the last one ended`);
    }
    if (to <= from) problems.push(`segment ${slot.id} ends at or before it starts`);
    at = to;
  }
  if (totalSeconds !== undefined && Math.abs(at - totalSeconds) > 0.001) {
    problems.push(`the segments cover ${at.toFixed(1)}s and the script runs ${totalSeconds.toFixed(1)}s`);
  }
  return problems;
}
