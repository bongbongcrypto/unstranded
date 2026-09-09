#!/usr/bin/env node
// Build both keeper workflows as importable JSON.
//
//   node scripts/build-workflows.mjs                 write workflows/*.json
//   node scripts/build-workflows.mjs --create        also create them on KeeperHub
//
// The two variants differ only in where the withdrawal comes from. On demand
// takes it as trigger input. Unattended carries it, because a schedule has no
// input, and is built from a withdrawal file checked by verify-withdrawal.mjs.
//
// Both gate twice. The first gate refuses a withdrawal that is unproven or
// already finalized. The second refuses one whose dispute game has not resolved
// in the defender's favour, which is the condition the portal itself enforces:
// asking first means a keeper that is not ready sends nothing and logs nothing
// alarming, rather than throwing a reverted transaction every tick.
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORTAL = process.env.PORTAL ?? "0x49f53e41452C74589E85cA1677426Ba426459e85";
const NETWORK = process.env.NETWORK ?? "11155111";
const INTEGRATION = "<WALLET_INTEGRATION_ID>";
const CRON = process.env.CRON ?? "*/30 * * * *";
// The sweeper reads the rollup's own message passer, which is where a
// withdrawal is born and where its six fields are written down.
const L2_NETWORK = process.env.L2_NETWORK ?? "84532";
const MESSAGE_PASSER = "0x4200000000000000000000000000000000000016";
const SWEEP_CRON = process.env.SWEEP_CRON ?? "0 */6 * * *";
// One query reaches about this far. Two hundred thousand blocks answered in
// seconds and a million timed out, so the window is the widest one that comes
// back rather than the widest one imaginable.
const SWEEP_BLOCKS = process.env.SWEEP_BLOCKS ?? "200000";
const SWEEP_FROM = process.env.SWEEP_FROM ?? null;
const SWEEP_TO = process.env.SWEEP_TO ?? null;
const SWEEP_MAX = process.env.SWEEP_MAX ?? 25;

const WITHDRAWAL_TUPLE = {
  name: "_tx", type: "tuple", components: [
    { name: "nonce", type: "uint256" }, { name: "sender", type: "address" },
    { name: "target", type: "address" }, { name: "value", type: "uint256" },
    { name: "gasLimit", type: "uint256" }, { name: "data", type: "bytes" }],
};

const PORTAL_ABI = JSON.stringify([
  { inputs: [{ name: "_withdrawalHash", type: "bytes32" }], name: "finalizedWithdrawals",
    outputs: [{ name: "", type: "bool" }], stateMutability: "view", type: "function" },
  { inputs: [{ name: "_withdrawalHash", type: "bytes32" }], name: "numProofSubmitters",
    outputs: [{ name: "", type: "uint256" }], stateMutability: "view", type: "function" },
  { inputs: [{ name: "", type: "bytes32" }, { name: "", type: "uint256" }], name: "proofSubmitters",
    outputs: [{ name: "", type: "address" }], stateMutability: "view", type: "function" },
  { inputs: [{ name: "", type: "bytes32" }, { name: "", type: "address" }], name: "provenWithdrawals",
    outputs: [{ name: "disputeGameProxy", type: "address" }, { name: "timestamp", type: "uint64" }],
    stateMutability: "view", type: "function" },
  { inputs: [WITHDRAWAL_TUPLE, { name: "_proofSubmitter", type: "address" }],
    name: "finalizeWithdrawalTransactionExternalProof", outputs: [],
    stateMutability: "nonpayable", type: "function" },
]);

const PASSER_ABI = JSON.stringify([{
  type: "event", name: "MessagePassed", inputs: [
    { name: "nonce", type: "uint256", indexed: true },
    { name: "sender", type: "address", indexed: true },
    { name: "target", type: "address", indexed: true },
    { name: "value", type: "uint256", indexed: false },
    { name: "gasLimit", type: "uint256", indexed: false },
    { name: "data", type: "bytes", indexed: false },
    { name: "withdrawalHash", type: "bytes32", indexed: false }],
}]);

const GAME_ABI = JSON.stringify([
  { inputs: [], name: "status", outputs: [{ name: "", type: "uint8" }],
    stateMutability: "view", type: "function" },
]);

// A resolved game in the defender's favour. 0 is in progress, 1 is the
// challenger, and neither of those may be finalized against.
const DEFENDER_WINS = "2";

const read = (id, label, fn, args, x, address = PORTAL, extra = {}) => ({
  id, type: "action", position: { x, y: 0 },
  data: { type: "action", label, status: "idle", config: {
    actionType: "web3/read-contract", network: NETWORK, contractAddress: address,
    abi: extra.abi ?? PORTAL_ABI, abiFunction: fn,
    functionArgs: JSON.stringify(args), integrationId: INTEGRATION,
    ...(extra.config ?? {}) } },
});

const condition = (id, label, expression, x) => ({
  id, type: "action", position: { x, y: 0 },
  data: { type: "action", label, status: "idle",
          config: { actionType: "Condition", condition: expression } },
});

function build({ trigger, hash, tuple }) {
  // The counts are compared as text on purpose. The Condition node orders
  // numeric strings by code unit below MAX_SAFE_INTEGER, so `!== "0"` and
  // `=== "2"` are exact where `> 0` would not be (KeeperHub#2304).
  const gateOne = `String({{@step-1:Already Released.result}}) === "false"`
    + ` && String({{@step-2:Proof Count.result}}) !== "0"`;
  const gateTwo = `String({{@step-6:Game Resolved.result}}) === "${DEFENDER_WINS}"`;

  const nodes = [
    trigger,
    read("step-1", "Already Released", "finalizedWithdrawals", [hash], 252),
    read("step-2", "Proof Count", "numProofSubmitters", [hash], 504),
    condition("step-3", "Worth Looking At", gateOne, 756),
    read("step-4", "Who Proved It", "proofSubmitters", [hash, "0"], 1008),
    read("step-5", "Proven Where", "provenWithdrawals",
         [hash, "{{@step-4:Who Proved It.result}}"], 1260),
    read("step-6", "Game Resolved", "status", [], 1512,
         "{{@step-5:Proven Where.result.disputeGameProxy}}", { abi: GAME_ABI }),
    condition("step-7", "Ready To Release", gateTwo, 1764),
    { id: "step-8", type: "action", position: { x: 2016, y: 0 },
      data: { type: "action", label: "Release To Owner", status: "idle", config: {
        actionType: "web3/write-contract", network: NETWORK, contractAddress: PORTAL,
        abi: PORTAL_ABI, abiFunction: "finalizeWithdrawalTransactionExternalProof",
        functionArgs: JSON.stringify([tuple, "{{@step-4:Who Proved It.result}}"]),
        integrationId: INTEGRATION } } },
    read("step-9", "Confirm Released", "finalizedWithdrawals", [hash], 2268),
  ];

  const edges = [
    { id: "e1", source: "trigger-1", target: "step-1" },
    { id: "e2", source: "step-1", target: "step-2" },
    { id: "e3", source: "step-2", target: "step-3" },
    { id: "e4", type: "animated", source: "step-3", target: "step-4", sourceHandle: "true" },
    { id: "e5", source: "step-4", target: "step-5" },
    { id: "e6", source: "step-5", target: "step-6" },
    { id: "e7", source: "step-6", target: "step-7" },
    { id: "e8", type: "animated", source: "step-7", target: "step-8", sourceHandle: "true" },
    { id: "e9", source: "step-8", target: "step-9" },
  ];

  return { nodes, edges };
}

const T = "{{@trigger-1:Trigger.";
const manualTrigger = {
  id: "trigger-1", type: "trigger", position: { x: 0, y: 0 },
  data: { type: "trigger", label: "Trigger", status: "idle",
          config: { triggerType: "Manual" } },
};
const scheduleTrigger = {
  id: "trigger-1", type: "trigger", position: { x: 0, y: 0 },
  data: { type: "trigger", label: "Trigger", status: "idle",
          config: { triggerType: "Schedule", scheduleCron: CRON, timezone: "UTC" } },
};

// On demand: everything comes from the trigger. Note `withdrawalData` rather
// than `data`: a trigger field called `data` is shadowed by the trigger
// envelope's own `data` key and resolves to the whole payload.
const onDemand = build({
  trigger: manualTrigger,
  hash: T + "withdrawalHash}}",
  tuple: { nonce: T + "nonce}}", sender: T + "sender}}", target: T + "target}}",
           value: T + "value}}", gasLimit: T + "gasLimit}}", data: T + "withdrawalData}}" },
});

writeFileSync(join(ROOT, "workflows", "on-demand-finalizer.json"), JSON.stringify({
  _comment: "Release one abandoned withdrawal. Supply it as trigger input: "
    + "withdrawalHash, nonce, sender, target, value, gasLimit, withdrawalData.",
  name: "Unstranded: release an abandoned withdrawal",
  ...onDemand,
  enabled: false,
}, null, 2) + "\n");

// Unattended: the withdrawal is written into the workflow, because a schedule
// carries no input.
const file = process.env.WITHDRAWAL ?? join(ROOT, "docs", "example-withdrawal.json");
const w = existsSync(file)
  ? JSON.parse(readFileSync(file, "utf8"))
  : { withdrawalHash: "<WITHDRAWAL_HASH>", nonce: "<NONCE>", sender: "<SENDER>",
      target: "<TARGET>", value: "<VALUE>", gasLimit: "<GAS_LIMIT>", withdrawalData: "<WITHDRAWAL_DATA>" };

const unattended = build({
  trigger: scheduleTrigger,
  hash: w.withdrawalHash,
  tuple: { nonce: w.nonce, sender: w.sender, target: w.target,
           value: w.value, gasLimit: w.gasLimit, data: w.withdrawalData },
});

writeFileSync(join(ROOT, "workflows", "unattended-finalizer.json"), JSON.stringify({
  _comment: "Watch one abandoned withdrawal and release it the moment the portal "
    + "will accept it. Fill in the withdrawal and the wallet integration, then enable.",
  name: "Unstranded: watch " + String(w.withdrawalHash).slice(0, 14),
  ...unattended,
  enabled: false,
}, null, 2) + "\n");

// --- the sweeper -----------------------------------------------------------
//
// The two workflows above are pointed at a withdrawal somebody already found.
// This one finds them. The rollup's message passer emits every field the portal
// later hashes, so a query over that event is a list of withdrawals with
// everything needed to finish them, and the loop asks the portal about each in
// turn. Nothing is carried between runs and nothing is read off chain.
//
// What bounds it is the width of one query. Two hundred thousand blocks come
// back in seconds; a million does not. So a run sweeps a window, and a schedule
// walks the window forward.
const ITEM = "{{@step-2:Each Withdrawal.currentItem";
const itemHash = ITEM + ".args.withdrawalHash}}";
const itemTuple = {
  nonce: ITEM + ".args.nonce}}", sender: ITEM + ".args.sender}}",
  target: ITEM + ".args.target}}", value: ITEM + ".args.value}}",
  gasLimit: ITEM + ".args.gasLimit}}", data: ITEM + ".args.data}}",
};

const sweepGateOne = `String({{@step-3:Already Released.result}}) === "false"`
  + ` && String({{@step-4:Proof Count.result}}) !== "0"`;
const sweepGateTwo = `String({{@step-8:Game Resolved.result}}) === "${DEFENDER_WINS}"`;

const sweepNodes = [
  { id: "trigger-1", type: "trigger", position: { x: 0, y: 0 },
    data: { type: "trigger", label: "Trigger", status: "idle",
            config: { triggerType: "Schedule", scheduleCron: SWEEP_CRON, timezone: "UTC" } } },
  { id: "step-1", type: "action", position: { x: 252, y: 0 },
    data: { type: "action", label: "Withdrawals Started", status: "idle", config: {
      actionType: "web3/query-events", network: L2_NETWORK, contractAddress: MESSAGE_PASSER,
      abi: PASSER_ABI, eventName: "MessagePassed", failOnError: true,
      ...(SWEEP_FROM && SWEEP_TO ? { fromBlock: SWEEP_FROM, toBlock: SWEEP_TO }
                                 : { blockCount: SWEEP_BLOCKS }) } } },
  { id: "step-2", type: "action", position: { x: 504, y: 0 },
    data: { type: "action", label: "Each Withdrawal", status: "idle", config: {
      actionType: "For Each", arraySource: "{{@step-1:Withdrawals Started.events}}",
      concurrency: "sequential", maxIterations: Number(SWEEP_MAX) } } },
  read("step-3", "Already Released", "finalizedWithdrawals", [itemHash], 756,
       PORTAL, { config: { failOnError: false } }),
  read("step-4", "Proof Count", "numProofSubmitters", [itemHash], 1008,
       PORTAL, { config: { failOnError: false } }),
  condition("step-5", "Worth Looking At", sweepGateOne, 1260),
  read("step-6", "Who Proved It", "proofSubmitters", [itemHash, "0"], 1512,
       PORTAL, { config: { failOnError: false } }),
  read("step-7", "Proven Where", "provenWithdrawals",
       [itemHash, "{{@step-6:Who Proved It.result}}"], 1764,
       PORTAL, { config: { failOnError: false } }),
  read("step-8", "Game Resolved", "status", [], 2016,
       "{{@step-7:Proven Where.result.disputeGameProxy}}",
       { abi: GAME_ABI, config: { failOnError: false } }),
  condition("step-9", "Ready To Release", sweepGateTwo, 2268),
  { id: "step-10", type: "action", position: { x: 2520, y: 0 },
    data: { type: "action", label: "Release To Owner", status: "idle", config: {
      actionType: "web3/write-contract", network: NETWORK, contractAddress: PORTAL,
      abi: PORTAL_ABI, abiFunction: "finalizeWithdrawalTransactionExternalProof",
      functionArgs: JSON.stringify([itemTuple, "{{@step-6:Who Proved It.result}}"]),
      integrationId: INTEGRATION } } },
  { id: "step-11", type: "action", position: { x: 2772, y: 0 },
    data: { type: "action", label: "Released This Run", status: "idle",
            config: { actionType: "Collect" } } },
];

const sweepEdges = [
  { id: "s1", source: "trigger-1", target: "step-1" },
  { id: "s2", source: "step-1", target: "step-2" },
  { id: "s3", source: "step-2", target: "step-3" },
  { id: "s4", source: "step-3", target: "step-4" },
  { id: "s5", source: "step-4", target: "step-5" },
  { id: "s6", type: "animated", source: "step-5", target: "step-6", sourceHandle: "true" },
  { id: "s7", source: "step-6", target: "step-7" },
  { id: "s8", source: "step-7", target: "step-8" },
  { id: "s9", source: "step-8", target: "step-9" },
  { id: "s10", type: "animated", source: "step-9", target: "step-10", sourceHandle: "true" },
  { id: "s11", source: "step-10", target: "step-11" },
];

writeFileSync(join(ROOT, "workflows", "sweeper.json"), JSON.stringify({
  _comment: "Find abandoned withdrawals and finish them, without being told which. "
    + "Reads the rollup's message passer for withdrawals started in a window, then "
    + "asks the portal about each one. Fill in the wallet integration and enable.",
  name: "Unstranded: sweep for abandoned withdrawals",
  nodes: sweepNodes,
  edges: sweepEdges,
  enabled: false,
}, null, 2) + "\n");

console.log("wrote workflows/on-demand-finalizer.json and workflows/unattended-finalizer.json");
console.log("wrote workflows/sweeper.json");
console.log(`nodes ${onDemand.nodes.length}, edges ${onDemand.edges.length}, two gates; sweeper ${sweepNodes.length} nodes, ${sweepEdges.length} edges`);
