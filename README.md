# Unstranded

A keeper that finishes withdrawals other people abandoned, and gives the money
back to whoever it already belonged to.

Built on [KeeperHub](https://keeperhub.com). Every transaction linked below was
sent by a KeeperHub workflow, and every number was produced by a script in this
repository that you can run again.

---

## The problem

Moving money from an OP Stack rollup to Ethereum takes three transactions, not
one. You start the withdrawal on the rollup. You prove it on Ethereum. Then you
wait out the challenge period and come back to finalize it.

People do the first two and never come back for the third.

`scripts/survey.mjs` counts them. On Base, sampling ten one day windows between
40 and 100 days ago, and asking the portal's own storage whether each
withdrawal was ever finalized:

| | |
| --- | --- |
| Withdrawals proven in the sampled windows | 271 |
| Finalized | 256 |
| **Proven and never finalized** | **15 (5.5%)** |
| Sitting in those 15 | **68,080.576119 USDT**, 0.008936858245022266 ETH, 0.000480937597936668 DGLD |
| **Would actually deliver if released now** | **13 of 15** |

Those windows are 40 days and older, so none of this is a challenge period
still running. Ten of the fifteen have been sitting for 75 days.

Two of the fifteen are worth being precise about. The release call succeeds for
all fifteen, but the portal marks a withdrawal finalized *before* it calls the
target and a failed target call does not revert the outer call. It surfaces that
failure in one case only, when `tx.origin` is `address(1)`, which the contract
calls its estimation address. Under that simulation two of the fifteen fail: a
0.0297 ETH direct withdrawal and a 0.00048 DGLD one. Releasing either would
consume it and deliver nothing. `scripts/survey.mjs` runs both simulations and
says so, and this is the check to run before pointing a keeper at anything.

Two more things the numbers do not say on their own. Ten of the fifteen have the
same recipient, so this is one holder with most of that money rather than ten
separate people. And the value is not in the withdrawal's `value` field: a token
withdrawal carries zero there and puts the amount inside its calldata, which is
why the survey unwraps `relayMessage` and the bridge call inside it before
counting anything.

### How far back this reaches

The same survey over an older range, ten windows between 110 and 170 days ago,
found 12 of 508 never finalized, a rate of 2.4% rather than 5.5%. Eleven of
those twelve cannot be released by anyone, and the reason is not that they are
old:

| | |
| --- | --- |
| Proven against a dispute game of type 0 | 11 |
| Game type the portal respects today | 621, since 2026-05-26 |

A proof made against a game type the portal no longer respects has to be made
again before the withdrawal can be finalized. Re-proving needs a merkle proof
built from L2 state, which is not something a workflow can do, so a keeper
reaches the withdrawals proven under the current respected game type and no
further back. `scripts/survey.mjs` tells you which those are, per withdrawal,
rather than leaving it to be inferred from a date.

## The part that makes a keeper possible

`OptimismPortal2.finalizeWithdrawalTransactionExternalProof(tx, proofSubmitter)`
lets an address that is not the prover finalize using the prover's proof.

The recipient is fixed inside the withdrawal that was already proven. Change any
field and the hash changes, so the edited withdrawal was never proven and the
call reverts. A keeper cannot send the money anywhere else and cannot take a cut.

That is the whole basis of this project. It needs no key, no signature, and no
permission from the person whose money it is.

What a keeper *can* do wrong is release a withdrawal whose target call fails. The
withdrawal is spent either way, so that turns a pending withdrawal into a spent
one that delivered nothing. Two things bound it. The portal's `callWithMinGas`
reverts unless the target is given the gas limit the withdrawal asked for, so a
keeper cannot cause this by being cheap on gas. And where the target is the
cross domain messenger, which is what the standard bridge produces, a failed
message is recorded and can be relayed again. It is still a decision about
*when*, and `scripts/survey.mjs` is what tells you before you make it.

Note that the plain `finalizeWithdrawalTransaction` will not do: the newer
portal keys a proof by its submitter, so a stranger calling it reverts. The
external proof variant is the one that lets a third party help.

## Who runs it

Whoever is owed the money, for themselves. You withdraw, you prove, you point
this at your own withdrawal, and you stop having to remember. That needs no
trust in anyone, because the keeper cannot send the money anywhere but to you.

Someone can also run it for other people, and there is no way to charge them for
it. The release pays the address inside the withdrawal and nothing else, so
there is no fee to take and no hook to put one on. That is the same property
that makes it safe, seen from the other side.

The 68,080 USDT is not a market. It is the evidence that people stop after the
second transaction, including one holder who did it ten times.

## What it guarantees

| Property | How it is enforced |
| --- | --- |
| Cannot take the money | The recipient is inside the proven withdrawal. Editing any field changes its hash, and a withdrawal with that hash was never proven, so the call reverts. |
| Cannot act on an unproven withdrawal | The gate reads `numProofSubmitters` and refuses at zero. |
| Cannot act twice | The gate reads `finalizedWithdrawals` and refuses when it is already true. |
| Cannot act early | The second gate reads the dispute game backing the proof and refuses unless it has resolved in the defender's favour. The portal enforces this anyway, but asking first means a keeper that is not ready sends nothing rather than a reverted transaction every tick. |
| Cannot tell whether the money will arrive | It cannot. A workflow has no way to simulate, and the portal only reveals a failing target call to a simulation whose `tx.origin` is `address(1)`. `scripts/survey.mjs` runs that check; the keeper trusts whoever configured it. |
| Cannot be pointed at the wrong withdrawal | The gates read state by the withdrawal hash while the write passes the six fields, and nothing inside the workflow checks that the two describe the same withdrawal. If they disagree the write reverts, because a withdrawal with that hash was never proven, so the failure is loud and costs gas rather than money. `scripts/verify-withdrawal.mjs` is what closes it beforehand. |
| Costs the owner nothing | The keeper's KeeperHub organization pays, and on this plan that gas was sponsored. Either way the bill is the keeper's, never the owner's. |

## How it works

```
schedule tick
  -> read finalizedWithdrawals(hash)          already released?
  -> read numProofSubmitters(hash)            proven at all?
  -> gate one: not released AND proof count is not zero
        false -> nothing at all
        true  -> read proofSubmitters(hash, 0)          who proved it
              -> read provenWithdrawals(hash, prover)   which dispute game
              -> read status() on that game             has it resolved?
              -> gate two: status is DEFENDER_WINS
                    false -> nothing at all
                    true  -> finalizeWithdrawalTransactionExternalProof(withdrawal, prover)
                          -> read finalizedWithdrawals(hash) again
```

Every input is read on-chain inside the workflow, immediately before the gate
that uses it. Nothing is carried between runs, and nothing is inferred.

The second gate is why the keeper is quiet while it waits. The dispute game
address is not configured, it is read out of the portal's record of the proof,
and the game's own status decides whether this tick does anything.

There are two variants, both importable JSON in `workflows/`:

- **`on-demand-finalizer.json`** takes the withdrawal as trigger input, for
  releasing one that is already known.
- **`unattended-finalizer.json`** carries one withdrawal and runs on a
  schedule, releasing it the moment the portal will accept it. A schedule
  carries no input, so the withdrawal's fields live in the node.

Both are generated by `scripts/build-workflows.mjs`, so the two cannot drift
apart.

## Proof

All on Ethereum Sepolia, against the Base Sepolia portal.

### It released a stranger's withdrawal to that stranger

Five ether, started on Base Sepolia and proven on 23 July by the account that
owns it, then left unfinalized for forty seven days. The keeper's organization
holds no key belonging to that account and had never interacted with it.

| | |
| --- | --- |
| Withdrawal | `0x375b5a67c76b82564e406cd4bd22482eec71cfd2eb833f9d3c4dc04a60cf2499` |
| Owner | `0xC66E186029E9Ff34e68A320d72239FE1251f86C1` |
| Owner's balance before | 3.186206822535233652 ETH |
| Owner's balance after | 8.186206822535233652 ETH |
| Transaction | [`0xb3c37356...b9c57`](https://sepolia.etherscan.io/tx/0xb3c37356e9af4915eef7fd20189ac739443ac99b79e29284c57c285e55eb9c57) |
| Gas | 308,593, sponsored |

The run's own log is the workflow above, step for step: `finalizedWithdrawals`
false, `numProofSubmitters` `"1"`, gate one **true**, `proofSubmitters(hash, 0)`
returning the prover, `provenWithdrawals` returning dispute game
`0x5B8F56697Fe61d56904Da72F2027A5634f915A67`, that game's `status()` `"2"`, gate
two **true**, the write, then `finalizedWithdrawals` **true**.

An earlier release, of 0.95 ETH on 5 September, was made by the revision that had
only the first gate. It is
[`0xd47911d5...8bf62`](https://sepolia.etherscan.io/tx/0xd47911d516b533e4c0899101cada489a33ebe2f09187df14c2eba249b5f8bf62),
and it is what the second gate was added after.

### It did nothing when it should do nothing

The same workflow, given a withdrawal really started on Base Sepolia and not yet
proven by anybody:

| | |
| --- | --- |
| Withdrawal | `0x1fb7c525a5a23f00c997cebbd5e05f122479233d97576b1692659b93c8e0fefd` |
| `finalizedWithdrawals` | false |
| `numProofSubmitters` | `"0"` |
| Gate one | **false** |
| Transactions sent | **none** |

The run finished successfully with an empty `transactionHashes`.

### It is waiting, unattended, on a live one

A schedule runs every thirty minutes against an abandoned withdrawal of
5.447626998490219023 ETH whose dispute game has not resolved. A tick reads its
way to the answer and stops:

| Step | Read |
| --- | --- |
| `finalizedWithdrawals` | `false` |
| `numProofSubmitters` | `"1"` |
| gate one | **true** |
| `proofSubmitters(hash, 0)` | `0xC562cB60b6424E8F1cAA7C64046AEa1c973b7a69` |
| `provenWithdrawals(hash, prover)` | game `0x99A07BE8703DB10527842F3b1e74c4c6E52571B6` |
| `status()` on that game | `"0"`, in progress |
| gate two | **false** |
| Transactions sent | **none** |

The run ends successfully with an empty `transactionHashes`. When that game
resolves, the same tick will release the money with nobody present.

That tick is from 8 September, and the game was still running on 9 September,
87 hours after it was created. It may have resolved by the time you read this,
in which case the schedule has already released the money and the table above
is the state before that. `npm run check` reads the portal and says which of
the two is true today.

An earlier revision had only the first gate, and it shows in the schedule's own
history: the 19:30 tick reached the portal and was reverted by it, and every
tick since the second gate landed has ended successfully having sent nothing.
Nothing was ever sent either way, but a keeper that throws a failed transaction
every thirty minutes is not one you would leave running.

## Failure modes

| Case | What the keeper does | Status |
| --- | --- | --- |
| Withdrawal proven and abandoned, dispute game resolved | Releases it to the owner in one transaction | proved |
| Withdrawal not proven | Gate closes on a proof count of zero, nothing sent | proved |
| Withdrawal already finalized | Gate closes on the finalized flag, nothing sent | by construction |
| Dispute game not resolved yet | The second gate reads the game's status and closes. Nothing is sent and the run ends successfully. | proved |
| Two ticks overlap | The second finds the flag already true, or reverts on the portal. There is no second payment to make. | stated |
| The keeper's organization runs out of gas | Nothing is sent, and the withdrawal stays exactly as it was | stated |
| Two keepers race for the same withdrawal | One wins. The other finds the finalized flag already true, or the portal rejects it. There is no second release to make. | stated |
| A withdrawal proven more than once | The keeper reads `proofSubmitters(hash, 0)` and no further, so if a later submitter's proof is the usable one it refuses a withdrawal it could have released. That is a missed release, not a loss. Two of twelve on Base carry more than one submitter, and in both the extra one is the same address, so none would be missed here. | measured |
| The proof was made against a game type the portal no longer respects | The release call reverts and nothing is sent. Re-proving is out of scope: it needs a merkle proof from L2 state, which a workflow cannot build. Measured on 11 of 12 withdrawals from 110 to 170 days ago. | proved |
| Wrong withdrawal configured | The portal rejects a withdrawal whose hash was never proven. A wrong hash releases nothing. | stated |
| Configured on one whose target call fails | The withdrawal is spent and nothing is delivered. The keeper cannot detect this; the survey can, and says so. Where the target is the messenger the message can be relayed again. | stated |

## Reproduce

You need a KeeperHub account and its managed wallet. No local key and no funded
wallet of your own.

```
npm install
```

1. Find something to release: `node scripts/survey.mjs base-sepolia`. Take only
   the ones it says would actually deliver.
2. Check the fields you are about to use: `node scripts/verify-withdrawal.mjs <file>`.
   It recomputes the withdrawal hash from the fields and fails on a mismatch.
3. Import `workflows/on-demand-finalizer.json`, set `<WALLET_INTEGRATION_ID>` to
   your organization's wallet integration, and run it with the withdrawal as input.
4. For the unattended variant, import `workflows/unattended-finalizer.json`,
   fill the withdrawal into the two web3 nodes, and enable it.

`npm run check` runs four checkers. The first reads every claim in this file
back off the chain. The second checks that the README, the narration script,
the page generator and the workflow JSON still say the same thing as each
other. The third checks that every shot the demo reaches for has something on
screen to point at, and finds nothing to do on a fresh clone, because the pages
it films are built from the chain rather than committed. The fourth compares
the workflows sitting in a KeeperHub account against the JSON here, and says it
was not checked when there is no key to check it with.

Note that the trigger input for the withdrawal's calldata is called
`withdrawalData`, not `data`. A trigger field called `data` is shadowed by the
trigger envelope's own `data` key, and the reference resolves to the whole
payload instead of the field.

## Known limitations

- Testnet for the demonstration. The measurement is of Base on Ethereum; the
  transactions are on Sepolia against the Base Sepolia portal.
- One withdrawal per workflow. The unattended variant carries its withdrawal in
  the node because a schedule has no input, so watching several means several
  workflows. A workflow-scoped key-value store would change this, and KeeperHub
  does not have one yet.
- It does not discover abandoned withdrawals by itself. `scripts/survey.mjs`
  finds them off-chain and a person decides what to watch.
- It cannot prove, only finalize. Building a withdrawal proof needs L2 state and
  a merkle proof, which is not something a workflow can do. That is also what
  bounds how far back it reaches: a withdrawal proven against a game type the
  portal no longer respects has to be proven again first, and 11 of the 12 found
  between 110 and 170 days ago are in exactly that state.
- Each tick spends an execution whether or not it acts. Thirty minutes is 1,440
  a month against 5,000 on the free plan.
- Only OP Stack portals. Other rollups finish withdrawals differently.

## What building this turned up in KeeperHub

Three of the things in the way were in KeeperHub rather than in this, so they
were fixed there.

| What | Where |
| --- | --- |
| The Condition node compared numeric strings by code unit, so `"9" < "10"` was false, and the verdict flipped at `MAX_SAFE_INTEGER` because larger operands had already been promoted to `BigInt`. That is the node a workflow asks before it writes. | [keeperhub#2319](https://github.com/KeeperHub/keeperhub/pull/2319) |
| The example workflows seeded into every new organisation put the Condition rule group under a config key the runtime never reads, so their template tokens survive unrendered, the leftover-literal scan finds them, and the run aborts before the node is reached. That one needs a data migration as well as a builder fix, because the editor cannot repair the rows. | [keeperhub#2320](https://github.com/KeeperHub/keeperhub/pull/2320) |
| A template token inside an array config field is never rendered but is always reported, so the same reference succeeds as a JSON string and aborts as a JSON array. Filed as an issue rather than a pull request, at the maintainer's request. | [keeperhub#2359](https://github.com/KeeperHub/keeperhub/issues/2359) |

Both gates in this keeper are written as string equality, `String(x) === "false"`
and `=== "2"`, rather than as `<` or `>` against a number. The first of those
three is why.

## Addresses

| What | Where |
| --- | --- |
| Base portal | [`0x49048044D57e1C92A77f79988d21Fa8fAF74E97e`](https://etherscan.io/address/0x49048044D57e1C92A77f79988d21Fa8fAF74E97e) on Ethereum |
| Base Sepolia portal | [`0x49f53e41452C74589E85cA1677426Ba426459e85`](https://sepolia.etherscan.io/address/0x49f53e41452C74589E85cA1677426Ba426459e85) on Sepolia |
| Keeper organization wallet | [`0x4F256eD4420136dfD1e595044626F0dDb9Ac2503`](https://sepolia.etherscan.io/address/0x4F256eD4420136dfD1e595044626F0dDb9Ac2503) |

## License

MIT. See [LICENSE](LICENSE).
