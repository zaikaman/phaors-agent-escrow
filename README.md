# Pharos Agent Escrow

Reusable Pharos Skill for agent-to-agent work orders. A planner agent escrows native PHRS/PROS or ERC20 tokens, a worker agent accepts and submits proof, and a buyer or verifier agent releases payment only when the work passes review.

## Submission Packet

`pharos-agent-escrow` is a reusable on-chain work-order primitive for AI agents on Pharos. It turns agent work into a verifiable escrow lifecycle: a planner funds a task, a worker accepts and submits proof, and a buyer or verifier releases payment only after the proof satisfies the task metadata.

Pharos needs this because agent economies require more than direct transfers. Agents need a shared way to price work, lock funds, verify completion, refund expired jobs, discover open opportunities, and build event-based reputation that future marketplace agents can reuse.

One-command submission gate:

```powershell
npm run submit-check -- --network atlantic-testnet --escrow 0x047119bdf422fc82021b88cf679ddeddd500f128
```

This runs build, tests, TypeScript typecheck, task/proof metadata validation, skill validation, and judge-mode `doctor`.

One-command preflight for the judge-grade demo:

```powershell
npm run doctor -- --network atlantic-testnet --escrow 0x047119bdf422fc82021b88cf679ddeddd500f128
```

This strict preflight expects `PHAROS_PRIVATE_KEY`, `PHAROS_PRIVATE_KEY_2`, `PHAROS_PRIVATE_KEY_3`, `GROQ_API_KEY`, native PHRS gas on all three wallets, and Atlantic USDC on the planner wallet.

One-command live demo:

```powershell
npm run judge-demo-usdc -- --network atlantic-testnet --escrow 0x047119bdf422fc82021b88cf679ddeddd500f128
```

For reusable agent work, prefer role-specific commands over the all-in-one demo:

| Role | Use when | Commands |
| --- | --- | --- |
| Planner | Create and fund a task | `write-hash-artifact`, `create`, `recommend-worker` |
| Worker | Find, accept, or submit work | `find-open-work`, `rank-open-work`, `work -- accept`, `work -- submit` |
| Verifier | Validate proof and release | `verify-and-release --dry-run`, `verify-and-release` |
| Reputation | Read history and stats | `status`, `events`, `reputation`, `reputation-index` |
| Marketplace | Route jobs or workers | `rank-open-work`, `recommend-worker`, `reputation-index` |

Use `judge-demo-usdc` only for judge walkthroughs, live demos, or submission proof.

Live Pharos Atlantic proof:

- Split-deadline escrow: `0x047119bdf422fc82021b88cf679ddeddd500f128`
- Deployment transaction: https://atlantic.pharosscan.xyz/tx/0x37bb393e45c6df5d6da4eef5a858cc289900cc05f5e3d7090839b8ccf9a9135d
- Recent create: https://atlantic.pharosscan.xyz/tx/0xa067bfbbe68146b14e890ab9c22621c5b35bd709fa70d772b86117f8a3ae955b
- Recent accept: https://atlantic.pharosscan.xyz/tx/0x627d43b98343d09408c3386ed51ab62b55dd2326582f76d9cdf20b8641548112
- Recent proof: https://atlantic.pharosscan.xyz/tx/0x0b67b725160e39595b9b40cdf7ecb4bdbaa85ba05b3582638806f4d39d62946a
- Recent release: https://atlantic.pharosscan.xyz/tx/0xb670740ad2f183cd62908ee8ef8173168f42c8d67774bfa11d3c997b38c2540e

Judging alignment:

- Originality: agent-to-agent escrow is a higher-level work market primitive, not a basic token transfer.
- Technical quality: includes Solidity contract, TypeScript CLIs, schemas, tests, live deployment, and preflight checks.
- Practical use: enables paid agent outsourcing, proof review, refunds, reputation, and marketplace routing.
- Reusability: planner, worker, verifier, reputation, and marketplace agents can all compose the same Skill.
- Pharos relevance: every write action runs on Pharos Atlantic with explorer links.

## Run This In 3 Minutes

From the repository root:

```powershell
npm ci
```

Run local production checks:

```powershell
npm run submit-check -- --network atlantic-testnet --escrow 0x047119bdf422fc82021b88cf679ddeddd500f128
```

Verify the live split-deadline Atlantic deployment:

```powershell
& "$env:USERPROFILE\.foundry\bin\cast.exe" call 0x047119bdf422fc82021b88cf679ddeddd500f128 "nextWorkOrderId()(uint256)" --rpc-url https://atlantic.dplabs-internal.com
```

Run the one-wallet lifecycle demo:

```powershell
npm run demo -- --network atlantic-testnet --escrow 0x047119bdf422fc82021b88cf679ddeddd500f128 --amount 0.001
```

Run the judge-grade three-agent USDC Groq demo:

```powershell
npm run judge-demo-usdc -- --network atlantic-testnet --escrow 0x047119bdf422fc82021b88cf679ddeddd500f128
```

The demo writes a clean transcript to `demo-artifacts/<workOrderId>/judge-transcript.json`, including actors, balances before/after, transaction links, verifier decision, hashes, local artifact paths, and worker reputation delta. It also writes `demo-artifacts/latest-summary.md` for a concise judge-readable recap.

Run the Phase 2 mini marketplace composition demo:

```powershell
npm run marketplace-demo -- --network atlantic-testnet --escrow 0x047119bdf422fc82021b88cf679ddeddd500f128 --asset native --amount 0.001
```

Required for the three-agent demo:

- `PHAROS_PRIVATE_KEY`: Planner Agent wallet
- `PHAROS_PRIVATE_KEY_2`: Worker Agent wallet
- `PHAROS_PRIVATE_KEY_3`: Verifier Agent wallet
- `GROQ_API_KEY`: Groq API key for `qwen/qwen3-32b`
- Planner wallet needs Atlantic USDC for `judge-demo-usdc`; all three wallets need native PHRS for gas.

## What Makes This Reusable

This is an economic coordination primitive, not a one-off payment script. Any agent can use the same contract and scripts to post paid work, discover open jobs, accept work, submit proof, verify delivery, release escrow, refund expired work, and build reputation from events.

Reusable surfaces:

- On-chain work-order state machine in `assets/AgentWorkOrderEscrow.sol`
- Native PHRS/PROS and ERC20 escrow support
- Judge-ready Atlantic USDC flow with approve, escrow, verify, release, and asset-specific reputation
- Task and proof metadata templates in `assets/templates/`
- JSON Schemas in `assets/schemas/` with validation reused by create and release scripts
- Worker discovery from `WorkOrderCreated` events
- Split work/review deadlines so submitted proof gets a fair review window before refund
- Deterministic verifier policy before release, with optional Groq semantic review
- Marketplace scoring scripts for ranked open work and worker recommendations
- Event and contract-read based reputation summaries
- Persistent event-backed reputation index in `scripts/reputation-index.ts`
- Structured agent capability manifest in `assets/agent-capabilities.manifest.json`
- JSON-RPC-style agent command manifest in `assets/agent-command.manifest.json`, printable with `npm run agent-commands`
- Content-addressed task/proof artifact writer in `scripts/write-hash-artifact.ts`
- Live Atlantic deployment with explorer links

## What Phase 2 Agents Can Build With It

- Planner agents that outsource subtasks instead of doing everything locally
- Worker agents that scan bounties and accept jobs matching their capabilities
- Verifier agents that compare metadata, proof, hashes, and acceptance criteria before releasing funds
- Reputation agents that rank workers by completed jobs, volume, refund rate, and proof quality
- Marketplace agents that route tasks to the best available workers
- Research, data collection, content bounty, review, and service marketplace agents

See `agents/planner-worker-verifier-demo.md` for a polished Phase 2 mini-agent composition.

## Deployment Proof

- Current split-deadline contract: `0x047119bdf422fc82021b88cf679ddeddd500f128`
- Current deployment tx: https://atlantic.pharosscan.xyz/tx/0x37bb393e45c6df5d6da4eef5a858cc289900cc05f5e3d7090839b8ccf9a9135d
- Legacy single-deadline contract: `0x6f88b3c79325472f6439426e84c9303506661585`
- Network: Pharos Atlantic testnet
- Chain ID: `688689`
- RPC: `https://atlantic.dplabs-internal.com`
- Explorer: `https://atlantic.pharosscan.xyz`
- Legacy deployment tx: https://atlantic.pharosscan.xyz/tx/0xb79589f425bc952edc30857cbeaed8d83c39cfc3ef16ad06b329be743fbbe611

Recent successful legacy native three-agent demo transactions:

- Create work order: https://atlantic.pharosscan.xyz/tx/0x7e5839ee4d7131fc0308ca0d55cb1920ace4c65ac7bad588761ac0682e5456d0
- Worker accept: https://atlantic.pharosscan.xyz/tx/0x56586e99c790d4837b5e1e85e3981416c8654023fe4e8a9ea988d55cf5c476ac
- Submit proof: https://atlantic.pharosscan.xyz/tx/0x2eeaae0a680b3e5c3ffef1a044876afc75ecbf4a6d38d2d84f76ee703d013df4
- Verifier release: https://atlantic.pharosscan.xyz/tx/0x5b7616536eff6e8de8d24fd5a9b21b4fbb0e5bda37e8be4dc1fc81eb0cc4bb07

## Judge Packet

Recommended live command:

```powershell
npm run judge-demo-usdc -- --network atlantic-testnet --escrow 0x047119bdf422fc82021b88cf679ddeddd500f128
```

Required environment:

- `PHAROS_PRIVATE_KEY`: Planner Agent wallet with Atlantic USDC and native PHRS for gas.
- `PHAROS_PRIVATE_KEY_2`: Worker Agent wallet with native PHRS for gas.
- `PHAROS_PRIVATE_KEY_3`: Verifier Agent wallet with native PHRS for gas.
- `GROQ_API_KEY`: Groq API key for planner, worker, and verifier LLM calls.

Expected output shape:

- Wallet, network, escrow, asset, and amount summary.
- ERC20 approval transaction link.
- Work-order creation, accept, submit-proof, and release transaction links.
- Verifier decision and rationale.
- Final JSON transcript containing `workOrderId`, `finalStatus`, `metadataURI`, `proofURI`, `transactions`, `workerReputation`, and `localArtifacts`.

Deployed contract:

- Atlantic testnet split-deadline escrow: `0x047119bdf422fc82021b88cf679ddeddd500f128`
- Deployment transaction: https://atlantic.pharosscan.xyz/tx/0x37bb393e45c6df5d6da4eef5a858cc289900cc05f5e3d7090839b8ccf9a9135d

Recent successful current-contract transaction links:

- Create work order: https://atlantic.pharosscan.xyz/tx/0xa067bfbbe68146b14e890ab9c22621c5b35bd709fa70d772b86117f8a3ae955b
- Worker accept: https://atlantic.pharosscan.xyz/tx/0x627d43b98343d09408c3386ed51ab62b55dd2326582f76d9cdf20b8641548112
- Submit proof: https://atlantic.pharosscan.xyz/tx/0x0b67b725160e39595b9b40cdf7ecb4bdbaa85ba05b3582638806f4d39d62946a
- Verifier release: https://atlantic.pharosscan.xyz/tx/0xb670740ad2f183cd62908ee8ef8173168f42c8d67774bfa11d3c997b38c2540e

60-second narrative:

`pharos-agent-escrow` is a reusable on-chain work-order primitive for AI agents. A planner agent escrows PHRS, PROS, or ERC20 funds on Pharos with task metadata and acceptance criteria. A worker agent discovers or accepts the job, completes it, and submits content-addressed proof. A buyer or verifier agent checks the proof against the task policy, then releases payment only when the result passes. Every action emits events, so reputation and marketplace agents can rank workers, recommend jobs, and compose the skill into Phase 2 autonomous agent workflows.

## Additional Judge Commands

Run the recommended USDC work-order lifecycle:

```powershell
npm run judge-demo-usdc -- --network atlantic-testnet --escrow 0x047119bdf422fc82021b88cf679ddeddd500f128
```

The USDC demo performs ERC20 approval, creates a funded work order, accepts, submits proof, verifies with Groq, releases payment, and prints worker reputation for the selected asset.

Run the one-command Phase 2 marketplace transcript:

```powershell
npm run marketplace-demo -- --network atlantic-testnet --escrow 0x047119bdf422fc82021b88cf679ddeddd500f128 --asset native --amount 0.001
```

The marketplace demo prints worker recommendation, ranked work, on-chain lifecycle transactions, verifier decision, reputation summary, and explorer links in one JSON transcript.

Find claimable work:

```powershell
npm run find-open-work -- --network atlantic-testnet --escrow 0x047119bdf422fc82021b88cf679ddeddd500f128 --worker <workerAddress> --asset 0xcfc8330f4bcab529c625d12781b1c19466a9fc8b --min-amount 1
```

Rank open work for a worker agent:

```powershell
npm run rank-open-work -- --network atlantic-testnet --escrow 0x047119bdf422fc82021b88cf679ddeddd500f128 --worker <workerAddress> --asset 0xcfc8330f4bcab529c625d12781b1c19466a9fc8b --min-amount 1 --limit 10
```

Recommend workers for a planner or marketplace agent:

```powershell
npm run recommend-worker -- --network atlantic-testnet --escrow 0x047119bdf422fc82021b88cf679ddeddd500f128 --asset 0xcfc8330f4bcab529c625d12781b1c19466a9fc8b --candidates <workerA>,<workerB> --limit 10
```

Build a persistent event-backed reputation index:

```powershell
npm run reputation-index -- --network atlantic-testnet --escrow 0x047119bdf422fc82021b88cf679ddeddd500f128 --from-block 23800000 --out demo-artifacts/reputation-index.json
```

Write content-addressed task or proof metadata before create/submit:

```powershell
npm run write-hash-artifact -- --kind task --input .\assets\templates\task.metadata.json --out-dir demo-artifacts/hash-artifacts --name task
npm run write-hash-artifact -- --kind proof --input .\assets\templates\proof.metadata.json --out-dir demo-artifacts/hash-artifacts --name proof
```

Verify and release submitted work:

```powershell
npm run verify-and-release -- --network atlantic-testnet --escrow 0x047119bdf422fc82021b88cf679ddeddd500f128 --id <workOrderId>
```

Deterministic verification is the default and does not require an LLM. Add `--policy both` to require deterministic checks plus Groq semantic review, or `--policy groq` for Groq-only review.

Validate metadata before using it:

```powershell
npm run validate-metadata -- --kind task --file .\assets\templates\task.metadata.json
npm run validate-metadata -- --kind proof --file .\assets\templates\proof.metadata.json
```

Dry-run verifier policy without sending a transaction:

```powershell
npm run verify-and-release -- --network atlantic-testnet --escrow 0x047119bdf422fc82021b88cf679ddeddd500f128 --id <workOrderId> --dry-run
npm run verify-and-release -- --network atlantic-testnet --escrow 0x047119bdf422fc82021b88cf679ddeddd500f128 --id <workOrderId> --dry-run --no-llm
```

Inspect events and worker reputation:

```powershell
npm run events -- --network atlantic-testnet --escrow 0x047119bdf422fc82021b88cf679ddeddd500f128
npm run reputation -- --network atlantic-testnet --escrow 0x047119bdf422fc82021b88cf679ddeddd500f128 --agent <agentAddress> --asset 0xcfc8330f4bcab529c625d12781b1c19466a9fc8b
```

## Why We Built It This Way

`pharos-agent-escrow` directly matches the Pharos AI Agent economy vision: agents can coordinate, transact, verify work, and build reputation on-chain. It is original relative to basic token, NFT, transfer, Uniswap, and x402 demos because it creates a higher-level work market primitive.

Judging alignment:

- Original: agent work-order escrow is distinct from the provided examples.
- Useful: solves paid agent coordination, not just payment execution.
- Complete: contract, scripts, references, templates, tests, live deployment.
- Composable: buyer, worker, verifier, marketplace, and reputation agents can all use it.
- Pharos-native: deployed on Atlantic testnet with explorer links.

## Files To Review

- Skill instructions: `SKILL.md`
- Architecture: `references/architecture.md`
- Security notes: `references/security.md`
- Demo runbook: `references/demo.md`
- Agent composition patterns: `references/agent-patterns.md`
- Contract: `assets/AgentWorkOrderEscrow.sol`
- Metadata templates: `assets/templates/`
- Scripts: `scripts/`
- Agent capability manifest: `assets/agent-capabilities.manifest.json`
- Tests: `test/AgentWorkOrderEscrow.t.sol`
- Phase 2 mini-agent example: `agents/planner-worker-verifier-demo.md`
