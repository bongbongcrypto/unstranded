#!/usr/bin/env node
// Do the documents agree with each other?
//
//   node scripts/check-consistency.mjs
//
// The same facts are stated in four places: the README, the narration script,
// the fact pages the video cuts to, and the workflow JSON. Four copies of a
// number is four chances for one of them to be left behind by an edit, and the
// one that gets left behind is always the one on screen.
//
// So every claim below is written once here, with where it has to appear, and
// this fails when any of them is missing. It checks that the claim is present,
// not that it is true; scripts/check-docs.mjs is what asks the chain.
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(ROOT, p), "utf8");

const README = read("README.md");
const SCRIPT = JSON.parse(read("docs/demo-script.json"));
const PAGES = read("scripts/make-pages.mjs");
const VIDEO = read("docs/VIDEO-SCRIPT.md");
const spoken = SCRIPT.lines.map((l) => l.say).join(" ");
const glossed = SCRIPT.lines.map((l) => l.ko).join(" ");

const problems = [];
const note = (m) => problems.push(m);

// A number said aloud is spelled out, so each claim carries both forms.
const CLAIMS = [
  { what: "withdrawals proven in the sample", readme: "271", spoken: "two hundred and seventy one", page: "271" },
  { what: "never finalized", readme: "15 (5.5%)", spoken: "Fifteen were never finished", page: "15" },
  { what: "the amount sitting there", readme: "68,080.576119 USDT", spoken: "Sixty eight thousand", page: "68,080 USDT" },
  { what: "how many would actually deliver", readme: "13 of 15", spoken: "Thirteen of the fifteen would deliver", page: "13" },
  { what: "how many would be spent for nothing", readme: "two of the fifteen fail", spoken: "Two would be spent and deliver nothing", page: "spent, delivering nothing" },
  { what: "how long they have been sitting", readme: "75 days", spoken: "seventy five", page: "75 days ago" },
  { what: "what moved on Ethereum", readme: "6,025.699708", spoken: "Six thousand and twenty five tether", page: "6,025.70" },
  { what: "how long it had sat there", readme: "seventy five days", spoken: "seventy five days", page: "75 days" },
  { what: "what the watcher is watching", readme: "5.447626998490219023 ETH", spoken: "five point four ether", page: null },
  { what: "that it finds them itself", readme: "`sweeper.json` finds them",
    spoken: "It finds them itself", page: "every one a sweep finds" },
  { what: "what one sweep did", readme: "| Proven, game resolved, released | **2** |",
    spoken: "found six, and gave two of them back", page: null },
];

for (const claim of CLAIMS) {
  if (!README.includes(claim.readme)) note(`README does not say ${claim.what} as "${claim.readme}"`);
  if (!spoken.includes(claim.spoken)) note(`the narration does not say ${claim.what} as "${claim.spoken}"`);
  if (claim.page && !PAGES.includes(claim.page)) {
    note(`no fact page carries ${claim.what} as "${claim.page}"`);
  }
}

// Claims that live only in the README, and must not have been quietly dropped.
for (const [what, text] of [
  ["the older sample size", "12 of 508"],
  ["the older rate", "2.4%"],
  ["the game type boundary", "type 0"],
  ["the game type respected now", "621"],
  ["when it changed", "2026-05-26"],
  ["the recipient concentration", "same recipient"],
  ["the estimation address trick", "address(1)"],
  ["who runs it", "## Who runs it"],
  ["the amount released", "Five ether, started on Base Sepolia"],
  ["the unproven withdrawal it refused", "really started on Base Sepolia and not yet"],
  ["the second upstream fix", "keeperhub#2320"],
  ["the upstream finding filed as an issue", "keeperhub#2359"],
  ["why the gates compare strings", "rather than as `<` or `>`"],
  ["what a sweep found", "Proven, game resolved, released"],
  ["how far a sweep reaches", "as wide as one event query"],
  ["the mainnet release", "0x9bb2ed94"],
  ["that it is not a testnet", "Not a testnet"],
]) {
  if (!README.includes(text)) note(`README no longer states ${what} ("${text}")`);
}

// The bounty is a separate submission with a separate video, so the three
// upstream fixes are claimed there rather than in the main track's narration.
// They are checked here all the same: a claim that moves between two scripts is
// exactly the kind that stops being checked by either.
const BOUNTY = JSON.parse(read("docs/bounty-script.json"));
const bountySpoken = BOUNTY.lines.map((l) => l.say).join(" ");
const BOUNTY_CLAIMS = [
  { what: "how many were upstream", readme: "Three of the things in the way were in KeeperHub",
    spoken: "all three were in KeeperHub", page: "Three of them were in KeeperHub" },
  { what: "the upstream fix that matters", readme: "keeperhub#2319",
    spoken: "nine came out greater than ten", page: "pull request 2319" },
  { what: "the seeded workflows", readme: "keeperhub#2320",
    spoken: "abort before their condition node runs", page: "pull request 2320" },
  { what: "the array one", readme: "keeperhub#2382",
    spoken: "works as a string and fails as an array", page: "pull request 2382" },
];
for (const claim of BOUNTY_CLAIMS) {
  if (!README.includes(claim.readme)) note(`README does not say ${claim.what} as "${claim.readme}"`);
  if (!bountySpoken.includes(claim.spoken)) {
    note(`the bounty narration does not say ${claim.what} as "${claim.spoken}"`);
  }
  if (claim.page && !PAGES.includes(claim.page)) {
    note(`no fact page carries ${claim.what} as "${claim.page}"`);
  }
}

// Every line of either script has a Korean gloss, and neither language claims
// the other does not.
[["narration", SCRIPT], ["bounty narration", BOUNTY]].forEach(([which, s]) => {
  s.lines.forEach((line, i) => {
    if (!line.ko || !line.ko.trim()) note(`${which} line ${i + 1} has no Korean gloss`);
    if (!line.say || !line.say.trim()) note(`${which} line ${i + 1} has nothing to say`);
  });
});

// The gloss is what the person whose name is on this reads, so a number that
// was corrected in English and left alone in the gloss is the worst case. The
// check is on the numeral rather than on any wording, so this file carries no
// Korean of its own and cannot be the thing that trips the language check.
const NUMERALS = [
  { spoken: "Thirteen of the fifteen would deliver", numeral: "13" },
  { spoken: "two hundred and seventy one", numeral: "271" },
  { spoken: "seventy five", numeral: "75" },
];
for (const { spoken: phrase, numeral } of NUMERALS) {
  const line = SCRIPT.lines.find((l) => l.say.includes(phrase));
  if (!line) continue;
  if (!line.ko.includes(numeral)) {
    note(`the Korean gloss for "${phrase.slice(0, 34)}" does not carry ${numeral}`);
  }
}
if (glossed.length < spoken.length / 3) note("the Korean gloss looks truncated against the narration");

// Every shot the script names is either a page that gets built or a real URL.
const built = [...PAGES.matchAll(/write\("([^"]+)"/g)].map((m) => m[1].replace(/\.html$/, ""));
const RUNS = ["run-release", "run-unproven", "run-unresolved", "run-sweep"];
const LIVE = ["canvas", "watching"];
for (const line of [...SCRIPT.lines, ...BOUNTY.lines]) {
  const shot = line.shot;
  if (shot.startsWith("http")) continue;
  if (built.includes(shot) || RUNS.includes(shot) || LIVE.includes(shot)) continue;
  note(`the script cuts to "${shot}", which nothing builds and which is not a live page`);
}

// The recorder must be able to find every local page the choreography names.
const RECORDER = read("scripts/record-demo.mjs");
for (const m of RECORDER.matchAll(/local\("([^"]+)"\)/g)) {
  const name = m[1].replace(/\.html$/, "");
  if (!built.includes(name) && !RUNS.includes(name)) {
    note(`the choreography opens ${m[1]}, and nothing writes it`);
  }
}

// The segment table, the script and the shot table have to agree.
const seconds = (s) => {
  const m = /^(\d{1,2}):(\d{2})\.(\d{3})$/.exec(s);
  return m ? Number(m[1]) * 60 + Number(m[2]) + Number(m[3]) / 1000 : NaN;
};
// Both cuts' segment tables tile their own script exactly. A gap is a black
// frame in the finished video and an overlap truncates a segment, and neither
// shows up until it is uploaded.
for (const [which, s, file] of [
  ["the main track", SCRIPT, "docs/demo-segments.json"],
  ["the bounty", BOUNTY, "docs/bounty-segments.json"],
]) {
  if (!existsSync(join(ROOT, file))) {
    note(`${file} does not exist; run scripts/retime-script.mjs for that cut`);
    continue;
  }
  const table = JSON.parse(read(file));
  const scriptEnd = seconds(s.lines.at(-1).end);
  if (table.length === 0) {
    note(`${which} segment table has no slots`);
    continue;
  }
  if (seconds(table[0].from) !== 0) note(`${which}'s first segment does not start at zero`);
  const last = seconds(table.at(-1).to);
  if (Math.abs(last - scriptEnd) > 0.001) {
    note(`${which} segments end at ${last}s and its narration ends at ${scriptEnd}s`);
  }
  for (let i = 1; i < table.length; i++) {
    if (Math.abs(seconds(table[i].from) - seconds(table[i - 1].to)) > 0.001) {
      note(`${which} segment ${table[i].id} does not begin where ${table[i - 1].id} ends`);
    }
  }
}
const shotRows = (VIDEO.match(/^\| \d+:\d\d \| /gm) ?? []).length;
if (shotRows !== SCRIPT.lines.length) {
  note(`VIDEO-SCRIPT.md lists ${shotRows} shots and the script has ${SCRIPT.lines.length} lines`);
}

// The README describes the workflow it ships.
// The sweeper is a different shape: it wraps the same five reads and two gates
// in a query and a loop, so it carries two more nodes than the other two.
{
  const file = "workflows/sweeper.json";
  if (!existsSync(join(ROOT, file))) note(`${file} is missing`);
  else {
    const wf = JSON.parse(read(file));
    const kinds = wf.nodes.map((n) => n.data?.config?.actionType ?? n.data?.config?.triggerType);
    const gates = kinds.filter((k) => k === "Condition").length;
    if (gates !== 2) note(`${file} has ${gates} gates, and the README describes two`);
    for (const need of ["web3/query-events", "For Each", "Collect", "web3/write-contract"]) {
      if (!kinds.includes(need)) note(`${file} has no ${need}, which is what makes it find them`);
    }
    if (!README.includes("sweeper.json")) note("the README no longer mentions the sweeper");
  }
}

for (const file of ["workflows/on-demand-finalizer.json", "workflows/unattended-finalizer.json"]) {
  if (!existsSync(join(ROOT, file))) { note(`${file} is missing`); continue; }
  const wf = JSON.parse(read(file));
  const gates = wf.nodes.filter((n) => n.data?.config?.actionType === "Condition").length;
  if (wf.nodes.length !== 10) note(`${file} has ${wf.nodes.length} nodes, and the README describes ten`);
  if (gates !== 2) note(`${file} has ${gates} gates, and the README describes two`);
  if (!README.includes("Two gates") && !README.includes("gate two")) {
    note("the README no longer describes two gates");
  }
}
if (!spoken.includes("Two gates. Then one write.")) {
  note("the narration no longer says two gates and one write");
}

console.log(`claims cross-checked: ${CLAIMS.length}`);
console.log(
  `narration lines: ${SCRIPT.lines.length} in ${JSON.parse(read("docs/demo-segments.json")).length} segments, ` +
    `bounty ${BOUNTY.lines.length} in ${JSON.parse(read("docs/bounty-segments.json")).length}, shot rows: ${shotRows}`,
);
if (problems.length === 0) {
  console.log("\nthe documents agree");
  process.exit(0);
}
console.log(`\n${problems.length} disagreement${problems.length === 1 ? "" : "s"}:`);
for (const p of problems) console.log("  - " + p);
process.exit(1);
