// Why a withdrawal that can be released would still deliver nothing.
//
// The portal will not say. It marks a withdrawal finalized before it calls the
// target, and a failed target call does not revert the outer call, so the only
// caller it tells is address(1): for that one it reverts with
// OptimismPortal_GasEstimation() and nothing else. That is the whole message -
// the target call failed - with no reason attached.
//
// So ask the target instead, as the portal, and read the difference between
// the gas the withdrawal carries and enough gas for anything.

// A revert with no data comes back as these, which say only that it happened.
const NOT_A_REASON = /unknown reason|^execution reverted\.?$|^rpc request failed\.?$/i;

/** The most specific line the client gives us, or null when it only says it reverted. */
export function reasonOf(error) {
  const seen = [];
  let node = error;
  for (let depth = 0; node && depth < 8; depth += 1) {
    for (const key of ["reason", "shortMessage", "details"]) {
      const line = node[key];
      if (typeof line === "string" && line.trim() !== "") seen.push(line.trim());
    }
    node = node.cause;
  }
  return seen.find((line) => !NOT_A_REASON.test(line)) ?? null;
}

/** One sentence naming why the target refuses, for a withdrawal the portal would consume. */
export async function whyTargetFails(client, portal, withdrawal) {
  const attempt = async (gas) => {
    try {
      await client.call({
        account: portal,
        to: withdrawal.target,
        value: withdrawal.value,
        data: withdrawal.data,
        gas,
      });
      return null;
    } catch (error) {
      return error;
    }
  };

  const asWritten = await attempt(withdrawal.gasLimit);
  if (asWritten === null) {
    return "it does not fail when asked on its own, so the difference is what the portal leaves it";
  }
  if ((await attempt(2_000_000n)) === null) {
    return `it needs more gas than the ${withdrawal.gasLimit} the withdrawal carries`;
  }
  const told = reasonOf(asWritten);
  if (told !== null) return told;

  // Nothing came back but the revert itself, so say what the recipient is.
  const code = await client
    .getCode({ address: withdrawal.target })
    .catch(() => undefined);
  if (code?.startsWith("0xef0100")) {
    return `the recipient has since delegated its account to 0x${code.slice(8)} (EIP-7702), and that code refuses the call`;
  }
  if (code && code !== "0x") {
    return "the recipient is a contract and it reverts without saying why";
  }
  return "the recipient is a plain account and the call still reverts; reason not identified";
}
