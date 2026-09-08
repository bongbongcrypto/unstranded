#!/usr/bin/env node
// Check a withdrawal's fields against its own hash before anything uses them.
//
//   node scripts/verify-withdrawal.mjs withdrawal.json
//
// The withdrawal hash is keccak256 over the six fields, so a single wrong
// character anywhere fails here rather than on the chain. Run this on anything
// that was copied, pasted, or typed.
//
// The file is the same shape the workflow takes as input:
//
//   {
//     "withdrawalHash": "0x...",
//     "nonce": "1766...",
//     "sender": "0x...",
//     "target": "0x...",
//     "value": "950000000000000000",
//     "gasLimit": "491310",
//     "withdrawalData": "0x..."
//   }
import { encodeAbiParameters, keccak256, formatEther } from "viem";
import { readFileSync } from "node:fs";

const path = process.argv[2];
if (!path) {
  console.error("usage: node scripts/verify-withdrawal.mjs <withdrawal.json>");
  process.exit(2);
}

const w = JSON.parse(readFileSync(path, "utf8"));
const data = w.withdrawalData ?? w.data;
const missing = ["withdrawalHash", "nonce", "sender", "target", "value", "gasLimit"]
  .filter((k) => w[k] === undefined);
if (missing.length || data === undefined) {
  console.error("missing fields: " + [...missing, data === undefined ? "withdrawalData" : null]
    .filter(Boolean).join(", "));
  process.exit(2);
}

const computed = keccak256(encodeAbiParameters(
  [{ type: "uint256" }, { type: "address" }, { type: "address" },
   { type: "uint256" }, { type: "uint256" }, { type: "bytes" }],
  [BigInt(w.nonce), w.sender, w.target, BigInt(w.value), BigInt(w.gasLimit), data]
));

const ok = computed.toLowerCase() === String(w.withdrawalHash).toLowerCase();
console.log("claimed  " + w.withdrawalHash);
console.log("computed " + computed);
console.log("value    " + formatEther(BigInt(w.value)) + " ETH in the value field");
console.log("data     " + (data.length - 2) / 2 + " bytes");
console.log(ok ? "\nthe fields hash to the claimed withdrawal" : "\nMISMATCH: do not use these fields");
process.exit(ok ? 0 : 1);
