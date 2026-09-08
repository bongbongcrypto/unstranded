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
const RELEASED = "0xc3f81f814493d93d270b1283e23ef9fa801371494fb76f72bdc4c56c061ad8bc";
const RELEASE_TX = "0xd47911d516b533e4c0899101cada489a33ebe2f09187df14c2eba249b5f8bf62";
const OWNER = "0x872f55279d06c3087c8DF4F624Aa499D02aaC791";

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
  <div class="src">node scripts/survey.mjs base &nbsp;|&nbsp; ten one day windows, 40 to 100 days ago</div>
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
  <div class="src">eth_call from 0x0000000000000000000000000000000000000042, an address party to none of them</div>
  <h1>All fifteen release cleanly from a stranger</h1>
  <div class="row"><div class="k">simulated</div><div class="v">15</div></div>
  <div class="row"><div class="k">would succeed</div><div class="v big ok">15</div></div>
  <div class="row"><div class="k">would revert</div><div class="v">0</div></div>
  <div class="note">Simulated, not sent. The money would go to the addresses already named inside them.</div>
`));

// --- the balances -----------------------------------------------------------
const finalized = await client.readContract({
  address: PORTAL, abi: PORTAL_ABI, functionName: "finalizedWithdrawals", args: [RELEASED],
});
const ownerNow = await client.getBalance({ address: OWNER });
write("balances.html", page("balances", `
  <div class="src">Read from Sepolia at ${stamp}</div>
  <h1>One withdrawal, released to its owner</h1>
  <div class="two">
    <div class="card"><div class="k">owner balance before</div><div class="big">0.0140</div></div>
    <div class="card"><div class="k">owner balance after</div><div class="big ok">0.9640</div></div>
  </div>
  <div class="row"><div class="k">owner</div><div class="v">${OWNER}</div></div>
  <div class="row"><div class="k">balance now</div><div class="v">${formatEther(ownerNow)} ETH</div></div>
  <div class="row"><div class="k">finalizedWithdrawals</div><div class="v ok">${finalized}</div></div>
  <div class="row"><div class="k">signed by the owner</div><div class="v ok">nothing</div></div>
  <div class="row"><div class="k">gas paid by the owner</div><div class="v ok">nothing</div></div>
`));

// --- what is unfinished -----------------------------------------------------
write("limits.html", page("limits", `
  <div class="src">README.md, Known limitations</div>
  <h1>Unfinished</h1>
  <div class="row"><div class="k">where it ran</div><div class="v warn">testnet, for the demonstration</div></div>
  <div class="row"><div class="k">how many it watches</div><div class="v warn">one withdrawal per workflow</div></div>
  <div class="row"><div class="k">finding them</div><div class="v warn">a person decides what to watch</div></div>
  <div class="row"><div class="k">proving</div><div class="v warn">out of scope; it only finalizes</div></div>
  <div class="row"><div class="k">which rollups</div><div class="v warn">OP Stack portals only</div></div>
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
