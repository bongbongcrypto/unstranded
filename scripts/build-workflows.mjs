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

console.log("wrote workflows/on-demand-finalizer.json and workflows/unattended-finalizer.json");
console.log(`nodes ${onDemand.nodes.length}, edges ${onDemand.edges.length}, two gates`);
