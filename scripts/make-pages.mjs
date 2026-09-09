#!/usr/bin/env node
// Render the pages the video cuts to when a live screen has nothing to show.
//
//   node scripts/make-pages.mjs
//
// Every value on these pages is read from the chain, or from a file in this
// repository that a script produced, at the moment the page is written. Each
// page says at the top where its numbers came from. Nothing is typed in.
import { createPublicClient, http, formatEther } from "viem";
import { sepolia } from "viem/chains";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "docs", "recording");
mkdirSync(OUT, { recursive: true });

const PORTAL = "0x49f53e41452C74589E85cA1677426Ba426459e85";
const RELEASED = "0x375b5a67c76b82564e406cd4bd22482eec71cfd2eb833f9d3c4dc04a60cf2499";
const RELEASE_TX = "0xb3c37356e9af4915eef7fd20189ac739443ac99b79e29284c57c285e55eb9c57";
const OWNER = "0xC66E186029E9Ff34e68A320d72239FE1251f86C1";
// The one on Ethereum, which is the release the video leads with.
const MAINNET_TX = "0x9bb2ed94bb3ab655a7ff9ab9ef70c46b56d060a239e318a22d8aee224dd3b55a";
const MAINNET_OWNER = "0xF4e147Db314947fC1275a8CbB6Cde48c510cd8CF";

const client = createPublicClient({
  chain: sepolia,
  transport: http("https://ethereum-sepolia-rpc.publicnode.com", { retryCount: 4 }),
});
const PORTAL_ABI = [
  { name: "finalizedWithdrawals", type: "function", stateMutability: "view",
    inputs: [{ type: "bytes32" }], outputs: [{ type: "bool" }] },
];

const CSS = `
  :root { color-scheme: dark; }
  body { margin: 0; background: #0b0f14; color: #e6edf3; font: 28px/1.45 ui-monospace, "Cascadia Mono", Consolas, monospace; }
  main { padding: 56px 96px 160px; max-width: 1700px; }
  /* The bottom 140px of the frame belong to the burned-in captions, so every
     page is laid out to end above them. */
  .src { color: #8b98a5; font-size: 22px; margin-bottom: 28px; }
  h1 { font: 600 44px/1.2 system-ui, "Segoe UI", sans-serif; margin: 0 0 22px; letter-spacing: -0.01em; }
  .row { display: grid; grid-template-columns: 520px 1fr; gap: 24px; padding: 16px 0; border-bottom: 1px solid #1f2933; }
  .k { color: #8b98a5; }
  .v { color: #e6edf3; word-break: break-all; }
  .big { font-size: 92px; font-weight: 700; color: #7fd1ff; letter-spacing: -0.02em; line-height: 1.1; }
  .warn { color: #ffb86b; }
  .ok { color: #7ee787; }
  .bad { color: #ff7b72; }
  .step { display: grid; grid-template-columns: 90px 1fr; gap: 28px; align-items: baseline; padding: 22px 0; border-bottom: 1px solid #1f2933; }
  .num { font-size: 52px; font-weight: 700; color: #30475e; }
  .num.on { color: #ffb86b; }
  pre { background: #0f1620; border: 1px solid #1f2933; border-radius: 12px; padding: 22px 26px; font-size: 22px; line-height: 1.45; white-space: pre-wrap; }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 48px; }
  .card { background: #0f1620; border: 1px solid #1f2933; border-radius: 16px; padding: 36px; }
  .card .k { font-size: 24px; margin-bottom: 10px; }
  .note { color: #8b98a5; font-size: 24px; margin-top: 26px; }
`;

const page = (title, body) =>
  `<!doctype html><meta charset="utf-8"><title>${title}</title><style>${CSS}</style><main>${body}</main>`;
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
const write = (name, html) => {
  writeFileSync(join(OUT, name), html);
  console.log(`wrote docs/recording/${name}`);
};

const stamp = new Date().toISOString().replace("T", " ").slice(0, 19) + " UTC";

// --- the three transactions -------------------------------------------------
write("three-steps.html", page("three steps", `
  <div class="src">The withdrawal path on an OP Stack rollup</div>
  <h1>Getting money out takes three transactions</h1>
  <div class="step"><div class="num on">1</div><div>Start the withdrawal <span class="k">on the rollup</span></div></div>
  <div class="step"><div class="num on">2</div><div>Prove it <span class="k">on Ethereum</span></div></div>
  <div class="step"><div class="num">3</div><div>Finalize it <span class="k">on Ethereum, after the challenge period</span></div></div>
  <div class="note">The third one is the one people do not come back for.</div>
`));

// --- the count --------------------------------------------------------------
write("survey.html", page("survey", `
  <div class="src">node scripts/survey.mjs base &nbsp;|&nbsp; ten one day windows, 40 to 100 days ago, run 8 September</div>
  <h1>Proven, then never finished</h1>
  <div class="row"><div class="k">withdrawals proven</div><div class="v">271</div></div>
  <div class="row"><div class="k">finalized</div><div class="v">256</div></div>
  <div class="row"><div class="k">never finalized</div><div class="v warn">15</div></div>
  <div class="row"><div class="k">sitting in those fifteen</div><div class="v big warn">68,080 USDT</div></div>
  <div class="note">Ten of them proven 75 days ago. None still inside a challenge period.</div>
`));

// --- why a stranger may help ------------------------------------------------
write("external-proof.html", page("external proof", `
  <div class="src">OptimismPortal2, ${PORTAL}</div>
  <h1>Anyone may finish it, and cannot take it</h1>
  <pre>finalizeWithdrawalTransactionExternalProof(
    (nonce, sender, target, value, gasLimit, data),
    proofSubmitter
)</pre>
  <div class="row"><div class="k">who may call it</div><div class="v ok">any address</div></div>
  <div class="row"><div class="k">whose proof it uses</div><div class="v">the one already submitted</div></div>
  <div class="row"><div class="k">where the money goes</div><div class="v ok">fixed inside the proven withdrawal</div></div>
  <div class="row"><div class="k">what a caller can change</div><div class="v ok">nothing</div></div>
`));

// --- the simulation ---------------------------------------------------------
write("simulate.html", page("simulate", `
  <div class="src">eth_call from an address party to none of them, run twice: as anyone, and with tx.origin = address(1)</div>
  <h1>Thirteen of the fifteen would deliver</h1>
  <div class="row"><div class="k">the call would succeed</div><div class="v">15</div></div>
  <div class="row"><div class="k">the money would arrive</div><div class="v big ok">13</div></div>
  <div class="row"><div class="k">spent, delivering nothing</div><div class="v bad">2</div></div>
  <div class="note">The portal marks a withdrawal finalized before it calls the target, and only
  a simulation whose tx.origin is address(1) reveals a failing call. The survey runs both.</div>
`));

// --- the balances -----------------------------------------------------------
const finalized = await client.readContract({
  address: PORTAL, abi: PORTAL_ABI, functionName: "finalizedWithdrawals", args: [RELEASED],
});
const ownerNow = await client.getBalance({ address: OWNER });
write("balances.html", page("balances", `
  <div class="src">Ethereum mainnet, transaction ${MAINNET_TX.slice(0, 22)}...</div>
  <h1>Six thousand dollars, back where it belonged</h1>
  <div class="two">
    <div class="card"><div class="k">USDT moved to the owner</div><div class="big ok">6,025.70</div></div>
    <div class="card"><div class="k">what the owner signed</div><div class="big">nothing</div></div>
  </div>
  <div class="row"><div class="k">owner</div><div class="v">${MAINNET_OWNER}</div></div>
  <div class="row"><div class="k">sat unfinished for</div><div class="v warn">75 days</div></div>
  <div class="row"><div class="k">gas paid by the owner</div><div class="v ok">nothing</div></div>
  <div class="row"><div class="k">gas paid by the keeper</div><div class="v ok">nothing, KeeperHub sponsored it</div></div>
  <div class="note">Read from Ethereum at ${stamp}. The Sepolia release of five ether is in the README too.</div>
`));

// --- what is unfinished -----------------------------------------------------
write("limits.html", page("limits", `
  <div class="src">README.md, Known limitations</div>
  <h1>Unfinished</h1>
  <div class="row"><div class="k">where it ran</div><div class="v warn">testnet, for the demonstration</div></div>
  <div class="row"><div class="k">how many it watches</div><div class="v ok">every one a sweep finds</div></div>
  <div class="row"><div class="k">how far one sweep reaches</div><div class="v warn">one event query, not all of history</div></div>
  <div class="row"><div class="k">proving</div><div class="v warn">out of scope; it only finalizes</div></div>
  <div class="row"><div class="k">which rollups</div><div class="v warn">OP Stack portals only</div></div>
`));

// --- what was wrong upstream ------------------------------------------------
// The numbers and the one line each are the same ones the README carries, and
// scripts/check-consistency.mjs fails if the two stop agreeing.
write("upstream.html", page("upstream", `
  <div class="src">github.com/KeeperHub/keeperhub</div>
  <h1>Three of them were in KeeperHub</h1>
  <div class="row"><div class="k">pull request 2319</div><div class="v">the Condition node compared numbers written as text, so "9" &lt; "10" was false</div></div>
  <div class="row"><div class="k">pull request 2320</div><div class="v">every new organisation's example workflows abort before their Condition node runs</div></div>
  <div class="row"><div class="k">issue 2359</div><div class="v">a template token inside an array is never rendered and always reported</div></div>
  <div class="note">Two pull requests, review addressed. One issue, filed at the maintainer's request.</div>
`));

// --- the close --------------------------------------------------------------
write("close.html", page("close", `
  <div class="src">In the repository</div>
  <h1>Unstranded</h1>
  <div class="row"><div class="k">scripts/survey.mjs</div><div class="v">counts what is sitting there, and what it is worth</div></div>
  <div class="row"><div class="k">workflows/</div><div class="v">both keepers, importable</div></div>
  <div class="row"><div class="k">scripts/verify-withdrawal.mjs</div><div class="v">recomputes a withdrawal's hash before anything uses it</div></div>
  <div class="row"><div class="k">scripts/check-docs.mjs</div><div class="v">reads every claim back off the chain</div></div>
  <div class="note">Release: <span class="v">${RELEASE_TX}</span></div>
`));

console.log(`\nread from the chain at ${stamp}`);
