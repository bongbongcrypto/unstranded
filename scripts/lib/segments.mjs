// Where the demo video's five pieces begin and end.
//
// One table, imported by the recorder and by the assembler, because the two
// have to agree about it exactly: a recorder that thinks a segment is 34
// seconds and an assembler that thinks it is 33 produce a video whose narration
// slides a second later with every cut.
//
// The times are the ones in docs/demo-script.json. Nothing here is chosen; each
// boundary is where a run of related shots ends in the script.
export const SEGMENT_SLOTS = [
  { id: "a", from: "00:00.000", to: "00:32.500", what: "three transactions, people stop after two, and the count" },
  { id: "b", from: "00:32.500", to: "00:57.500", what: "anyone may finish someone else's withdrawal, and cannot take it" },
  { id: "c", from: "00:57.500", to: "01:14.600", what: "the workflow: five reads, two gates, one write" },
  { id: "d", from: "01:14.600", to: "01:36.400", what: "a stranger's five ether released, and the balance that moved" },
  { id: "e", from: "01:36.400", to: "02:00.700", what: "both refusals, and the gate that was missing at first" },
  { id: "f", from: "02:00.700", to: "02:14.500", what: "waiting unattended, and what is unfinished" },
  { id: "g", from: "02:14.500", to: "02:41.500", what: "the three that were in KeeperHub, and the close" },
];

/** mm:ss.mmm to seconds. */
export const seconds = (stamp) => {
  const m = /^(\d{1,2}):(\d{2})\.(\d{3})$/.exec(stamp);
  if (!m) throw new Error(`not a mm:ss.mmm timestamp: ${stamp}`);
  return Number(m[1]) * 60 + Number(m[2]) + Number(m[3]) / 1000;
};

/**
 * Fail if the slots do not tile the whole video without gaps or overlaps.
 *
 * Checked rather than trusted: a gap is a black frame in the finished cut and
 * an overlap is a segment that gets truncated, and both are the sort of thing
 * that is only noticed once the video is uploaded.
 */
export function checkSlots(totalSeconds) {
  const problems = [];
  let at = 0;
  for (const slot of SEGMENT_SLOTS) {
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
