# Phase 2 Mini-Agent: Planner, Worker, Verifier Marketplace

This runbook shows how a Phase 2 agent marketplace can compose `pharos-agent-escrow` into a complete work loop. It uses four logical agents and three signing wallets.

## Agent Roles

| Agent | Wallet | Responsibility |
| --- | --- | --- |
| Planner Agent | `PHAROS_PRIVATE_KEY` | Defines task metadata, funds escrow, and sets worker/verifier policy. |
| Worker Agent | `PHAROS_PRIVATE_KEY_2` | Discovers open jobs, accepts a suitable job, completes work, and submits proof. |
| Verifier Agent | `PHAROS_PRIVATE_KEY_3` | Loads metadata/proof, checks acceptance criteria with Groq, and releases payment only if valid. |
| Reputation Agent | Read-only | Reads events and stats to rank workers for future routing. |

## Marketplace Loop

1. Planner Agent turns a user request into task metadata.
2. Planner Agent creates a funded work order on Pharos.
3. Worker Agent scans `WorkOrderCreated` events for claimable work.
4. Worker Agent accepts the job and submits proof.
5. Verifier Agent validates proof with deterministic checks plus Groq semantic review.
6. Verifier Agent releases payment.
7. Reputation Agent updates worker scoring from events and contract reads.

## End-To-End Demo

Run the complete mini marketplace flow:

```powershell
npm run marketplace-demo -- --network atlantic-testnet --escrow 0x047119bdf422fc82021b88cf679ddeddd500f128 --asset native --amount 0.001
```

This produces:

- Planner-generated task metadata
- Marketplace worker recommendation from on-chain reputation
- Worker-side ranked work recommendation
- On-chain escrow funding
- Worker acceptance and proof submission
- Verifier release decision using Groq `qwen/qwen3-32b`
- Worker reputation summary
- Explorer links for every transaction
- Final JSON transcript for another agent to consume

For a USDC-funded variant, run:

```powershell
npm run marketplace-demo -- --network atlantic-testnet --escrow 0x047119bdf422fc82021b88cf679ddeddd500f128 --asset usdc --amount 1
```

## Script-Driven Marketplace Composition

A marketplace agent can run each stage independently.

Planner creates a paid job:

```powershell
npm run create -- --network atlantic-testnet --escrow 0x047119bdf422fc82021b88cf679ddeddd500f128 --asset 0xcfc8330f4bcab529c625d12781b1c19466a9fc8b --amount 1 --work-deadline-minutes 60 --review-period-minutes 60 --metadata <taskMetadataURI> --worker <optionalWorkerAddress> --verifier <verifierAddress>
```

Worker discovers claimable jobs:

```powershell
npm run find-open-work -- --network atlantic-testnet --escrow 0x047119bdf422fc82021b88cf679ddeddd500f128 --worker <workerAddress> --asset 0xcfc8330f4bcab529c625d12781b1c19466a9fc8b --min-amount 1
npm run rank-open-work -- --network atlantic-testnet --escrow 0x047119bdf422fc82021b88cf679ddeddd500f128 --worker <workerAddress> --asset 0xcfc8330f4bcab529c625d12781b1c19466a9fc8b --min-amount 1 --limit 10
```

Planner recommends a worker:

```powershell
npm run recommend-worker -- --network atlantic-testnet --escrow 0x047119bdf422fc82021b88cf679ddeddd500f128 --asset 0xcfc8330f4bcab529c625d12781b1c19466a9fc8b --candidates <workerA>,<workerB> --limit 10
```

Worker accepts and submits proof:

```powershell
npm run work -- accept --network atlantic-testnet --escrow 0x047119bdf422fc82021b88cf679ddeddd500f128 --id <workOrderId>
npm run work -- submit --network atlantic-testnet --escrow 0x047119bdf422fc82021b88cf679ddeddd500f128 --id <workOrderId> --proof <proofURI>
```

Verifier checks and releases:

```powershell
npm run verify-and-release -- --network atlantic-testnet --escrow 0x047119bdf422fc82021b88cf679ddeddd500f128 --id <workOrderId>
```

Reputation Agent ranks the worker:

```powershell
npm run reputation -- --network atlantic-testnet --escrow 0x047119bdf422fc82021b88cf679ddeddd500f128 --agent <workerAddress> --asset 0xcfc8330f4bcab529c625d12781b1c19466a9fc8b
```

## Routing Policy Example

A marketplace agent can route future work with this policy:

1. Use `rank-open-work` to find jobs matching supported task categories, reward thresholds, and deadline constraints.
2. Use `recommend-worker` to prioritize workers with high completion rate, selected-asset volume, low refund rate, and recent activity.
3. Require `verify-and-release --dry-run` before any verifier signs a release transaction.
4. Avoid workers with repeated refunds, missing proof hashes, or verifier risk flags.
5. Prefer ERC20 stablecoin jobs for user-facing marketplaces and native PHRS jobs for simple demos.

## Why This Shows Composability

The same escrow primitive supports multiple independent agents without changing the contract:

- The Planner Agent only needs `createWorkOrder`.
- The Worker Agent only needs event discovery, `acceptWorkOrder`, and `submitProof`.
- The Verifier Agent only needs proof loading, Groq review, and `releasePayment`.
- The Reputation Agent is read-only and can run from any indexer, RPC client, or analytics agent.

That separation makes the skill usable by many Phase 2 agent designs, not just this demo.
