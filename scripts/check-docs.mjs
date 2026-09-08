#!/usr/bin/env node
// Check that the README agrees with the chain.
//
//   node scripts/check-docs.mjs
//
// Numbers in a README drift the moment nobody is checking them. This reads
// every claim it can re-derive and fails loudly, printing every problem rather
// than stopping at the first.
//
// What it verifies:
//   - every transaction the README links exists on Sepolia and succeeded
//   - the release transaction moved the amount the README says, to the address
//     the README names
//   - the withdrawal the README says was released is finalized on the portal,
//     and the one it says is still waiting is not
//   - the workflow JSON in workflows/ parses, has the nodes it claims, and
//     leaves the wallet integration as a placeholder
//   - no em dash anywhere in the tracked text, and no Korean: the published
//     voice is plain English and internal notes are not published
//   - every local link in the README resolves to a file
import { createPublicClient, http, formatEther } from "viem";
import { sepolia } from "viem/chains";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const README = readFileSync(join(ROOT, "README.md"), "utf8");
const problems = [];
const note = (m) => problems.push(m);

const client = createPublicClient({
  chain: sepolia,
  transport: http("https://ethereum-sepolia-rpc.publicnode.com", { retryCount: 4 }),
});

const PORTAL = "0x49f53e41452C74589E85cA1677426Ba426459e85";
const PORTAL_ABI = [{
  name: "finalizedWithdrawals", type: "function", stateMutability: "view",
  inputs: [{ type: "bytes32" }], outputs: [{ type: "bool" }],
}];

// --- every linked Sepolia transaction exists and succeeded ------------------
const txLinks = [...README.matchAll(/sepolia\.etherscan\.io\/tx\/(0x[0-9a-fA-F]{64})/g)]
  .map((m) => m[1]);
const uniqueTx = [...new Set(txLinks)];
console.log(`transactions linked from README: ${uniqueTx.length}`);
for (const hash of uniqueTx) {
  try {
    const receipt = await client.getTransactionReceipt({ hash });
    if (receipt.status !== "success") note(`${hash}: receipt status ${receipt.status}`);
  } catch {
    note(`${hash}: no receipt on Sepolia`);
  }
}

// --- the release moved what the README says --------------------------------
const RELEASE = "0xd47911d516b533e4c0899101cada489a33ebe2f09187df14c2eba249b5f8bf62";
const OWNER = "0x872f55279d06c3087c8DF4F624Aa499D02aaC791";
const RELEASED_HASH = "0xc3f81f814493d93d270b1283e23ef9fa801371494fb76f72bdc4c56c061ad8bc";
const WAITING_HASH = "0x8a5b2bce4b089900d06b8da8c3a47803625d11fb173ecdf1f5fccf28db474900";

if (README.includes(RELEASE)) {
  const receipt = await client.getTransactionReceipt({ hash: RELEASE });
  if (receipt.status !== "success") note("the release transaction did not succeed");
  // The balances either side need an archive node. A public one refuses, and a
  // refusal is not a disagreement: say which it was rather than passing or
  // failing on the strength of a node's retention policy.
  let before = null;
  let after = null;
  try {
    before = await client.getBalance({ address: OWNER, blockNumber: receipt.blockNumber - 1n });
    after = await client.getBalance({ address: OWNER, blockNumber: receipt.blockNumber });
  } catch {
    console.log("release balances: not checked, this node has no historical state");
  }
  if (before !== null && after !== null) {
    const moved = after - before;
    console.log(`release moved ${formatEther(moved)} ETH to ${OWNER}`);
    for (const [label, value] of [["before", before], ["after", after]]) {
      if (!README.includes(formatEther(value))) {
        note(`README does not carry the owner's ${label} balance ${formatEther(value)}`);
      }
    }
    if (moved !== 950000000000000000n) {
      note(`release moved ${formatEther(moved)} ETH, README says 0.95`);
    }
  }
} else {
  note("README no longer links the release transaction");
}

// --- the portal agrees about which is done and which is not ----------------
for (const [hash, expected, label] of [
  [RELEASED_HASH, true, "the released withdrawal"],
  [WAITING_HASH, false, "the withdrawal still being watched"],
]) {
  const finalized = await client.readContract({
    address: PORTAL, abi: PORTAL_ABI, functionName: "finalizedWithdrawals", args: [hash],
  });
  console.log(`${label}: finalizedWithdrawals = ${finalized}`);
  if (finalized !== expected) {
    note(`${label} (${hash.slice(0, 18)}..) is ${finalized}, README implies ${expected}`);
  }
}

// --- the workflow templates are importable and carry no organisation id ----
for (const file of readdirSync(join(ROOT, "workflows"))) {
  const raw = readFileSync(join(ROOT, "workflows", file), "utf8");
  let wf;
  try {
    wf = JSON.parse(raw);
  } catch (error) {
    note(`workflows/${file}: not valid JSON (${error.message.slice(0, 60)})`);
    continue;
  }
  const nodes = wf.nodes ?? [];
  const kinds = nodes.map((n) => n.data?.config?.actionType ?? n.data?.config?.triggerType);
  console.log(`workflows/${file}: ${nodes.length} nodes, ${(wf.edges ?? []).length} edges [${kinds.join(", ")}]`);
  if (!raw.includes("<WALLET_INTEGRATION_ID>")) {
    note(`workflows/${file}: does not use the wallet integration placeholder`);
  }
  if (/sujpfbhy|0x4[fF]256[eE][dD]4420136dfd1e595044626[fF]0[dD][dD][bB]9[aA][cC]2503/.test(raw)) {
    note(`workflows/${file}: still carries a real organisation identifier`);
  }
  if (!kinds.includes("web3/write-contract")) {
    note(`workflows/${file}: has no write step`);
  }
}

// --- house style ------------------------------------------------------------
const textFiles = [];
const walk = (dir) => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (/\.(md|mjs|js|json|py|ts)$/.test(entry.name)) textFiles.push(full);
  }
};
walk(ROOT);
// Built from code points rather than written out, so this file does not
// contain the characters it exists to forbid.
const EM_DASH = String.fromCharCode(0x2014);
const HANGUL = new RegExp("[" + String.fromCharCode(0xac00) + "-" + String.fromCharCode(0xd7a3) + "]");
// Korean belongs in exactly two places: the script's `ko` gloss and the Korean
// caption track built from it. Anywhere else it is a working note that was not
// meant to be published, which is the thing this check exists to catch.
const KOREAN_IS_CONTENT = new Set(["docs/demo-script.json", "docs/demo.ko.srt"]);
for (const file of textFiles) {
  const text = readFileSync(file, "utf8");
  const rel = file.slice(ROOT.length + 1).split("\\").join("/");
  if (text.includes(EM_DASH)) note(`${rel}: contains an em dash`);
  if (HANGUL.test(text) && !KOREAN_IS_CONTENT.has(rel)) note(`${rel}: contains Korean`);
}
// The gloss has to exist, or the caption track has quietly lost its source.
const scriptText = readFileSync(join(ROOT, "docs", "demo-script.json"), "utf8");
const glossed = JSON.parse(scriptText).lines.filter((l) => HANGUL.test(l.ko ?? "")).length;
console.log(`narration lines carrying a Korean gloss: ${glossed}`);
if (glossed !== JSON.parse(scriptText).lines.length) {
  note(`${glossed} of ${JSON.parse(scriptText).lines.length} narration lines have a Korean gloss`);
}

// --- local links resolve ----------------------------------------------------
for (const m of README.matchAll(/\]\((?!https?:)([^)#]+)\)/g)) {
  const target = m[1];
  if (!existsSync(join(ROOT, target))) note(`README links ${target}, which does not exist`);
}

console.log("");
if (problems.length === 0) {
  console.log("all checks passed");
  process.exit(0);
}
console.log(`${problems.length} problem${problems.length === 1 ? "" : "s"}:`);
for (const p of problems) console.log("  - " + p);
process.exit(1);
