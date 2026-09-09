# Demo video

The narration lives in `docs/demo-script.json`. That file is the only source of truth for
what is said, what is on screen, and how long each line runs. After editing it run:

```
node scripts/retime-script.mjs        give each line the time its words need
node scripts/make-video-assets.mjs    narration text, captions, and the table below
```

## What this video has to prove

Four claims, in this order, because each one earns the next:

1. Money is sitting in the bridge because nobody sent the last transaction, and
   here is how much.
2. Anyone is allowed to send it, and cannot take the money by doing so.
3. A KeeperHub workflow did exactly that, and a stranger's balance moved.
4. It refuses in both of the two ways it can refuse, and sends nothing when it does.

## The voice

`en-US-AndrewNeural`, slowed 4 percent, one audio file per line so a single sentence can
be renudged without recutting the rest. `scripts/make-narration.sh` builds them on the
server that has edge-tts.

## Numbers

Every number spoken aloud comes from a script in this repository:

| Spoken | Where it comes from |
| --- | --- |
| 271 proven, 15 never finished | `scripts/survey.mjs base` |
| 68,080 USDT | the same survey, unwrapping the bridge call inside each withdrawal |
| 75 days | the age of the oldest window that survey sampled |
| all fifteen simulate clean | the survey's per withdrawal release check |
| 0.014 to 0.964 ether | the owner's balance either side of the release transaction |
| 5.4 ether waiting | `docs/example-withdrawal.json`, checked by `verify-withdrawal.mjs` |

`scripts/check-docs.mjs` reads the linked transaction and the portal's own state back and
fails if the README and the chain disagree.

## Before you hit record

- The shoot browser must be signed in. `scripts/open-shoot-profile.mjs` opens that profile
  once; the recorder relaunches it fullscreen on the shoot monitor.
- Nothing in this video is filmed on a monitor anyone is using. The recorder takes a
  screenshot of the page over the DevTools protocol and compares it against what the
  capture sees, and refuses to record a screen that is not the page.
- Regenerate the fact pages first: `node scripts/make-pages.mjs`.

## The shots, line by line

<!-- shots:start -->

| Time | On screen | Narration |
| --- | --- | --- |
| 0:00 | three-steps | Moving money off a rollup takes three transactions, not one. You start it, you prove it, and a week later you come back and finish it. |
| 0:09 | three-steps | People do the first two and never come back. |
| 0:12 | survey | So I counted. On Base, across ten sampled days, two hundred and seventy one withdrawals were proven. |
| 0:20 | survey | Fifteen were never finished. Sixty eight thousand dollars of tether, sitting in the bridge. |
| 0:26 | survey | Ten of them have been there seventy five days. None is still inside a challenge period. |
| 0:32 | external-proof | Here is the part that makes this fixable. Anyone can finish someone else's withdrawal. |
| 0:38 | external-proof | The portal takes the prover's proof from a different caller, and the recipient is already fixed inside the withdrawal that was proven. |
| 0:47 | simulate | So a stranger can push it through and cannot take it. Thirteen of the fifteen would deliver. Two would be spent and deliver nothing, and the survey says which. |
| 0:57 | canvas | This is that, as a KeeperHub workflow. It finds them itself. |
| 1:02 | canvas | It reads whether the withdrawal is finished, whether anyone proved it, who that was, which dispute game the proof rests on, and whether that game resolved. |
| 1:13 | canvas | Two gates. Then one write. |
| 1:16 | run-release | Here it is on Ethereum, giving back six thousand dollars of tether that had sat for seventy five days. |
| 1:23 | https://etherscan.io/tx/0x9bb2ed94bb3ab655a7ff9ab9ef70c46b56d060a239e318a22d8aee224dd3b55a | Six thousand and twenty five tether, to the account that owns it. We never held their key. |
| 1:29 | balances | KeeperHub paid the gas, so getting the money back cost the owner nothing. |
| 1:34 | run-unproven | It also refuses. Give it a withdrawal nobody proved and the first gate closes. |
| 1:41 | run-unresolved | Give it one whose dispute game is still running and the second gate closes. No transaction either time. |
| 1:48 | run-unresolved | The first version had only one gate. It reached for the portal every thirty minutes and was reverted. Nothing was ever sent, and it still was not something you would leave running. |
| 1:59 | watching | So it asks the game first. This one is watching five point four ether, and waiting. |
| 2:05 | run-sweep | Given no withdrawal and no list, one sweep found six, and gave two of them back. |
| 2:11 | upstream | Three of the things in the way were in KeeperHub, not in this. |
| 2:16 | https://github.com/KeeperHub/keeperhub/pull/2319 | Its condition node compared numbers written as text, so nine came out greater than ten, and that is the node a workflow asks before it writes. Two are open pull requests, and the third is filed as an issue. |
| 2:29 | close | The survey that produced those numbers, both workflows, and a checker that reads every claim back off the chain are in the repository. |

<!-- shots:end -->
