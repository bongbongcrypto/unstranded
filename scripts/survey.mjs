#!/usr/bin/env node
// Count withdrawals that were proven and then never finalized, and say what
// they are worth.
//
//   node scripts/survey.mjs base            Base, on Ethereum
//   node scripts/survey.mjs base-sepolia    Base Sepolia, on Ethereum Sepolia
//   node scripts/survey.mjs base --days 40 --to 100
//
// Two sources, each used for what it is good for. Proven events come from a
// Blockscout instance, which paginates and takes a block range. Whether a
// withdrawal was ever finalized comes from the portal's own storage, which is
// the definitive answer and needs no archive node.
//
// A window the log provider declines is counted as declined, never as empty.
// A rate computed over a sample of zero is not printed, because it would be a
// statement about nothing.
import { createPublicClient, http, decodeFunctionData, encodeFunctionData, formatEther, formatUnits } from "viem";
import { mainnet, sepolia } from "viem/chains";

const CHAINS = {
  base: {
    label: "Base",
    settlement: mainnet,
    rpc: "https://ethereum-rpc.publicnode.com",
    explorerApi: "https://eth.blockscout.com/api",
    portal: "0x49048044D57e1C92A77f79988d21Fa8fAF74E97e",
    blocksPerDay: 7150,
  },
  "base-sepolia": {
    label: "Base Sepolia",
    settlement: sepolia,
    rpc: "https://ethereum-sepolia-rpc.publicnode.com",
    explorerApi: "https://eth-sepolia.blockscout.com/api",
    portal: "0x49f53e41452C74589E85cA1677426Ba426459e85",
    blocksPerDay: 7150,
  },
};

const WITHDRAWAL_PROVEN =
  "0x67a6208cfcc0801d50f6cbe764733f4fddf66ac0b04442061a8a8c0cb6b63f62";
// Any address. Used to ask whether the call would succeed from someone with no
// relationship to the withdrawal.
const NOBODY = "0x0000000000000000000000000000000000000042";
// The portal marks a withdrawal finalized before it calls the target, and a
// failed target call does not revert the outer call. It surfaces that failure
// in exactly one case: when tx.origin is address(1), which the contract calls
// its estimation address. So a plain simulation answers "would this call
// succeed", and only this one answers "would the money arrive". Two of the
// fifteen found on Base differ between the two, which is the difference between
// releasing a withdrawal and burning it.
const ESTIMATION = "0x0000000000000000000000000000000000000001";

const WITHDRAWAL_TUPLE = {
  name: "_tx", type: "tuple", components: [
    { name: "nonce", type: "uint256" }, { name: "sender", type: "address" },
    { name: "target", type: "address" }, { name: "value", type: "uint256" },
    { name: "gasLimit", type: "uint256" }, { name: "data", type: "bytes" }],
};

const PROVE_ABI = [{
  name: "proveWithdrawalTransaction", type: "function", stateMutability: "nonpayable", outputs: [],
  inputs: [WITHDRAWAL_TUPLE, { name: "_disputeGameIndex", type: "uint256" },
    { name: "_outputRootProof", type: "tuple", components: [
      { name: "version", type: "bytes32" }, { name: "stateRoot", type: "bytes32" },
      { name: "messagePasserStorageRoot", type: "bytes32" }, { name: "latestBlockhash", type: "bytes32" }] },
    { name: "_withdrawalProof", type: "bytes[]" }],
}];

const PORTAL_ABI = [
  { name: "finalizedWithdrawals", type: "function", stateMutability: "view",
    inputs: [{ type: "bytes32" }], outputs: [{ type: "bool" }] },
  { name: "numProofSubmitters", type: "function", stateMutability: "view",
    inputs: [{ type: "bytes32" }], outputs: [{ type: "uint256" }] },
  { name: "proofSubmitters", type: "function", stateMutability: "view",
    inputs: [{ type: "bytes32" }, { type: "uint256" }], outputs: [{ type: "address" }] },
  { name: "provenWithdrawals", type: "function", stateMutability: "view",
    inputs: [{ type: "bytes32" }, { type: "address" }],
    outputs: [{ name: "disputeGameProxy", type: "address" }, { name: "timestamp", type: "uint64" }] },
  { name: "disputeGameBlacklist", type: "function", stateMutability: "view",
    inputs: [{ type: "address" }], outputs: [{ type: "bool" }] },
  { name: "respectedGameType", type: "function", stateMutability: "view",
    inputs: [], outputs: [{ type: "uint32" }] },
  { name: "finalizeWithdrawalTransactionExternalProof", type: "function", stateMutability: "nonpayable",
    inputs: [WITHDRAWAL_TUPLE, { name: "_proofSubmitter", type: "address" }], outputs: [] },
];

const GAME_ABI = [
  { name: "status", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
  { name: "gameType", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint32" }] },
];
const GAME_STATUS = ["in progress", "the challenger won", "resolved"];

/** Why the portal will not accept this release, read from the portal itself. */
async function whyBlocked(portal, hash, prover, respected) {
  try {
    const [game] = await client.readContract({
      address: portal, abi: PORTAL_ABI, functionName: "provenWithdrawals", args: [hash, prover],
    });
    const blacklisted = await client.readContract({
      address: portal, abi: PORTAL_ABI, functionName: "disputeGameBlacklist", args: [game],
    }).catch(() => null);
    if (blacklisted) return "its dispute game is blacklisted";
    const type = await client.readContract({ address: game, abi: GAME_ABI, functionName: "gameType" }).catch(() => null);
    if (type !== null && respected !== null && Number(type) !== Number(respected)) {
      return `proven against game type ${type}, and the portal respects ${respected}: it has to be proven again`;
    }
    const status = await client.readContract({ address: game, abi: GAME_ABI, functionName: "status" }).catch(() => null);
    if (status !== null && Number(status) !== 2) {
      return `its dispute game is ${GAME_STATUS[Number(status)] ?? status}`;
    }
    return "reason not identified";
  } catch {
    return "reason not readable";
  }
}

// A withdrawal to the cross-domain messenger carries its real payload in
// calldata, so the value field alone says nothing about what is inside.
const RELAY_ABI = [{
  name: "relayMessage", type: "function", stateMutability: "payable", outputs: [],
  inputs: [{ name: "_nonce", type: "uint256" }, { name: "_sender", type: "address" },
    { name: "_target", type: "address" }, { name: "_value", type: "uint256" },
    { name: "_minGasLimit", type: "uint256" }, { name: "_message", type: "bytes" }],
}];
const BRIDGE_ABI = [
  { name: "finalizeBridgeERC20", type: "function", stateMutability: "nonpayable", outputs: [],
    inputs: [{ name: "_localToken", type: "address" }, { name: "_remoteToken", type: "address" },
      { name: "_from", type: "address" }, { name: "_to", type: "address" },
      { name: "_amount", type: "uint256" }, { name: "_extraData", type: "bytes" }] },
  { name: "finalizeBridgeETH", type: "function", stateMutability: "payable", outputs: [],
    inputs: [{ name: "_from", type: "address" }, { name: "_to", type: "address" },
      { name: "_amount", type: "uint256" }, { name: "_extraData", type: "bytes" }] },
];
const ERC20_ABI = [
  { name: "symbol", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "string" }] },
  { name: "decimals", type: "function", stateMutability: "view", inputs: [], outputs: [{ type: "uint8" }] },
];

const argv = process.argv.slice(2);
const chainKey = argv[0] ?? "base";
const chain = CHAINS[chainKey];
if (!chain) {
  console.error("unknown chain: " + chainKey + ". Try one of: " + Object.keys(CHAINS).join(", "));
  process.exit(2);
}
const arg = (name, fallback) => {
  const i = argv.indexOf("--" + name);
  return i === -1 ? fallback : Number(argv[i + 1]);
};
const FROM_DAYS = arg("days", 40);
const TO_DAYS = arg("to", 100);
const STEP = arg("step", 5);

const client = createPublicClient({
  chain: chain.settlement,
  transport: http(chain.rpc, { retryCount: 4 }),
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function provenIn(fromBlock, toBlock) {
  const url = `${chain.explorerApi}?module=logs&action=getLogs` +
    `&fromBlock=${fromBlock}&toBlock=${toBlock}` +
    `&address=${chain.portal}&topic0=${WITHDRAWAL_PROVEN}`;
  for (let attempt = 0; attempt < 6; attempt++) {
    try {
      const res = await fetch(url, { headers: { accept: "application/json" } });
      if (res.ok) {
        const body = await res.json();
        if (Array.isArray(body.result)) return body.result;
        const message = String(body.message ?? "").toLowerCase();
        if (message.includes("no records") || message.includes("no logs")) return [];
      }
    } catch { /* fall through to the wait */ }
    await sleep(3000 * (attempt + 1));
  }
  return null;                                    // declined, not empty
}

/** What the withdrawal actually moves, unwrapped from its calldata. */
async function payloadOf(withdrawal) {
  if (!withdrawal.data || withdrawal.data === "0x") {
    return { kind: "ETH", amount: withdrawal.value, to: withdrawal.target, symbol: "ETH", decimals: 18 };
  }
  try {
    const relay = decodeFunctionData({ abi: RELAY_ABI, data: withdrawal.data });
    const inner = decodeFunctionData({ abi: BRIDGE_ABI, data: relay.args[5] });
    if (inner.functionName === "finalizeBridgeETH") {
      return { kind: "ETH", amount: inner.args[2], to: inner.args[1], symbol: "ETH", decimals: 18 };
    }
    const token = inner.args[0];
    let symbol = token;
    let decimals = 18;
    try {
      symbol = await client.readContract({ address: token, abi: ERC20_ABI, functionName: "symbol" });
      decimals = await client.readContract({ address: token, abi: ERC20_ABI, functionName: "decimals" });
    } catch { /* an unlabelled token is still a token */ }
    return { kind: "token", amount: inner.args[4], to: inner.args[3], symbol, decimals };
  } catch {
    return { kind: "message", amount: withdrawal.value, to: withdrawal.target, symbol: "ETH", decimals: 18 };
  }
}

const head = Number(await client.getBlockNumber());
console.log(`${chain.label}: portal ${chain.portal} on ${chain.settlement.name}`);
console.log(`windows: one day each, from ${TO_DAYS} to ${FROM_DAYS} days ago, every ${STEP} days`);
console.log(`settlement head block ${head}\n`);

const proven = [];
let answered = 0;
let declined = 0;

for (let daysAgo = FROM_DAYS; daysAgo <= TO_DAYS; daysAgo += STEP) {
  const to = head - daysAgo * chain.blocksPerDay;
  const rows = await provenIn(to - chain.blocksPerDay, to);
  if (rows === null) {
    declined += 1;
    console.log(`  ~${daysAgo}d  declined by the log provider`);
  } else {
    answered += 1;
    console.log(`  ~${daysAgo}d  ${rows.length} proven`);
    for (const row of rows) {
      proven.push({ hash: row.topics[1], tx: row.transactionHash, daysAgo });
    }
  }
  await sleep(1500);
}

console.log(`\nwindows answered ${answered}, declined ${declined}`);
if (answered === 0) {
  console.log("no sample: every window was declined. This is not a measurement.");
  process.exit(1);
}
console.log(`withdrawals proven in the answered windows: ${proven.length}`);
if (proven.length === 0) {
  process.exit(0);
}

const abandoned = [];
let finalized = 0;
for (const item of proven) {
  const done = await client.readContract({
    address: chain.portal, abi: PORTAL_ABI, functionName: "finalizedWithdrawals", args: [item.hash],
  });
  if (done) finalized += 1;
  else abandoned.push(item);
}
const rate = (100 * abandoned.length) / proven.length;
console.log(`finalized ${finalized}   never finalized ${abandoned.length}   (${rate.toFixed(1)}%)\n`);

const respected = await client.readContract({
  address: chain.portal, abi: PORTAL_ABI, functionName: "respectedGameType",
}).catch(() => null);

const totals = new Map();
let releasableNow = 0;
let wouldBurn = 0;

for (const item of abandoned) {
  const tx = await client.getTransaction({ hash: item.tx });
  let withdrawal;
  try {
    ({ args: [withdrawal] } = decodeFunctionData({ abi: PROVE_ABI, data: tx.input }));
  } catch {
    console.log(`  ${item.hash.slice(0, 18)}..  prove calldata not decodable`);
    continue;
  }

  const payload = await payloadOf(withdrawal);
  const key = `${payload.symbol}|${payload.decimals}`;
  totals.set(key, (totals.get(key) ?? 0n) + payload.amount);

  const prover = await client.readContract({
    address: chain.portal, abi: PORTAL_ABI, functionName: "proofSubmitters", args: [item.hash, 0n],
  });
  const call = encodeFunctionData({
    abi: PORTAL_ABI, functionName: "finalizeWithdrawalTransactionExternalProof",
    args: [withdrawal, prover],
  });
  const simulate = async (from) => {
    try {
      await client.call({ account: from, to: chain.portal, data: call });
      return true;
    } catch {
      return false;
    }
  };
  const callSucceeds = await simulate(NOBODY);
  const moneyArrives = await simulate(ESTIMATION);
  if (moneyArrives) releasableNow += 1;
  if (callSucceeds && !moneyArrives) wouldBurn += 1;

  console.log(`  ${item.hash}`);
  console.log(`     ${formatUnits(payload.amount, payload.decimals)} ${payload.symbol}` +
    `  to ${payload.to}  proven ~${item.daysAgo}d ago`);
  if (moneyArrives) {
    console.log("     releasable now, and the money arrives");
  } else if (callSucceeds) {
    console.log("     DO NOT RELEASE: the call succeeds but the target fails, so it would be");
    console.log("     spent and deliver nothing");
  } else {
    console.log(`     not releasable: ${await whyBlocked(chain.portal, item.hash, prover, respected)}`);
  }
}

console.log("\nsitting in the bridge, from the answered windows alone:");
for (const [key, amount] of totals) {
  const [symbol, decimals] = key.split("|");
  console.log(`   ${formatUnits(amount, Number(decimals))} ${symbol}`);
}
console.log(abandoned.length === 0
  ? "\nnothing abandoned in the answered windows"
  : `\nwould actually deliver if released now: ${releasableNow} of ${abandoned.length}`);
if (wouldBurn > 0) {
  console.log(`WARNING: ${wouldBurn} would be consumed by the release and deliver nothing.`);
  console.log("The portal marks a withdrawal finalized before it calls the target, so");
  console.log("releasing one of those spends it for nothing. Do not point a keeper at them.");
}
