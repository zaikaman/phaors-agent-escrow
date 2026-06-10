---
name: pharos-agent-escrow
description: Use when an AI agent needs to create, fund, accept, complete, verify, release, refund, or audit an on-chain work order escrow on Pharos. Supports agent-to-agent task payments with native PHRS/PROS or ERC20 assets, work metadata, proof submission, event-based reputation, and explorer links.
---

# Pharos Agent Escrow

Reusable Pharos Skill for agent-to-agent work orders. Use this when an agent needs to coordinate paid work on-chain instead of sending a direct transfer.

## Usage Priority

Use this as a reusable work-order toolbelt first. Do not run `judge-demo-usdc`, `judge-demo`, or `marketplace-demo` unless the user explicitly asks for a demo, judge walkthrough, end-to-end sample, or submission proof.

For normal user tasks, identify the agent role and run the smallest workflow that satisfies that role:

| User intent | Agent role | Primary commands |
| --- | --- | --- |
| Post or fund paid work | Planner | `write-hash-artifact`, `create`, optional `recommend-worker` |
| Find or claim work | Worker | `find-open-work`, `rank-open-work`, `work -- accept` |
| Submit completed work | Worker | `write-hash-artifact`, `work -- submit` |
| Check delivery and release payment | Verifier | `verify-and-release --dry-run`, then `verify-and-release` |
| Inspect status, events, or reputation | Reputation | `status`, `events`, `reputation`, `reputation-index` |
| Route tasks or workers | Marketplace | `rank-open-work`, `recommend-worker`, `reputation-index` |
| Validate a submission package | Judge/maintainer | `submit-check` |
| Show the complete happy path | Demo only | `judge-demo-usdc` or `marketplace-demo` |

Always run `doctor` before write workflows on a live network. For mainnet writes, require explicit user confirmation.

## Reference Routing

- Need contract roles, state machine, or deployment context: read `references/architecture.md`.
- Need exact methods, status values, or command-level workflows: read `references/workflows.md`.
- Need reusable role-based command selection: read `references/workflows.md`.
- Need a judge demo or live walkthrough only when asked for a demo: read `references/demo.md`.
- Need security posture, production caveats, or validation gates: read `references/security.md`.
- Need Phase 2 composition ideas: read `references/agent-patterns.md`.
- Need a polished Phase 2 marketplace-style mini-agent runbook: read `agents/planner-worker-verifier-demo.md`.

## Core Contract

The bundled contract is `assets/AgentWorkOrderEscrow.sol`.

Workflow:

1. Buyer agent creates a work order with separate work and review deadlines, then escrows native PHRS/PROS or ERC20.
2. Worker agent accepts the job, unless a designated worker was already set.
3. Worker submits a completion proof URI or hash before the work deadline.
4. Buyer or optional verifier releases payment during review.
5. Buyer can refund open/accepted work after the work deadline, or submitted work after the review deadline.

Use `references/workflows.md` for exact method signatures, status values, and safety rules.

Metadata templates:

- Task metadata: `assets/templates/task.metadata.json`
- Proof metadata: `assets/templates/proof.metadata.json`
- Task schema: `assets/schemas/task.schema.json`
- Proof schema: `assets/schemas/proof.schema.json`
- Agent capability manifest: `assets/agent-capabilities.manifest.json`
- Agent command manifest: `assets/agent-command.manifest.json`

## Pharos Network Defaults

Default to Atlantic testnet unless the user explicitly asks for mainnet.

- Atlantic testnet chain ID: `688689`
- Atlantic RPC: `https://atlantic.dplabs-internal.com`
- Atlantic explorer: `https://atlantic.pharosscan.xyz`
- Atlantic USDC: `0xcfc8330f4bcab529c625d12781b1c19466a9fc8b`
- Native token: `PHRS` on Atlantic testnet, `PROS` on mainnet

## Atlantic Deployment

- Current split-deadline `AgentWorkOrderEscrow`: `0x047119bdf422fc82021b88cf679ddeddd500f128`
- Current deployment transaction: `https://atlantic.pharosscan.xyz/tx/0x37bb393e45c6df5d6da4eef5a858cc289900cc05f5e3d7090839b8ccf9a9135d`
- Legacy single-deadline `AgentWorkOrderEscrow`: `0x6f88b3c79325472f6439426e84c9303506661585`
- Legacy deployment transaction: `https://atlantic.pharosscan.xyz/tx/0xb79589f425bc952edc30857cbeaed8d83c39cfc3ef16ad06b329be743fbbe611`

For write actions, never hardcode private keys. Require `PRIVATE_KEY` in the environment and display the derived address before sending.

## Role Workflows

Scripts live in `scripts/` and use TypeScript with viem.

Install dependencies in a project using the skill:

```bash
npm install viem dotenv tsx typescript
```

### Planner Agent

Use this when the user wants to create, price, route, or fund a task.

1. Build task metadata from the user's objective, acceptance criteria, requested output format, buyer agent ID, worker selection policy, asset, amount, work deadline, and review deadline.
2. Validate and content-address metadata.
3. Create the funded work order.

```bash
npm run doctor -- --network atlantic-testnet --escrow <escrow>
npm run validate-metadata -- --kind task --file <task.json>
npm run write-hash-artifact -- --kind task --input <task.json> --out-dir demo-artifacts/hash-artifacts --name task
npm run create -- --network atlantic-testnet --escrow <escrow> --asset 0xcfc8330f4bcab529c625d12781b1c19466a9fc8b --amount 1 --work-deadline-minutes 60 --review-period-minutes 60 --metadata <metadataURI> --metadata-file <task.json> --worker <workerAddress> --verifier <verifierAddress>
```

Use `npm run recommend-worker` before create when the user provides candidate workers and wants routing help.

### Worker Agent

Use this when the user wants to discover, accept, complete, or submit work.

```bash
npm run find-open-work -- --network atlantic-testnet --escrow <escrow> --worker <workerAddress> --asset 0xcfc8330f4bcab529c625d12781b1c19466a9fc8b --min-amount 1
npm run rank-open-work -- --network atlantic-testnet --escrow <escrow> --worker <workerAddress> --asset 0xcfc8330f4bcab529c625d12781b1c19466a9fc8b --min-amount 1 --limit 10
npm run find-open-work -- --network atlantic-testnet --escrow <escrow> --worker <workerAddress> --asset 0xcfc8330f4bcab529c625d12781b1c19466a9fc8b --all --deployment-tx 0x37bb393e45c6df5d6da4eef5a858cc289900cc05f5e3d7090839b8ccf9a9135d
npm run rank-open-work -- --network atlantic-testnet --escrow <escrow> --worker <workerAddress> --asset 0xcfc8330f4bcab529c625d12781b1c19466a9fc8b --all --deployment-tx 0x37bb393e45c6df5d6da4eef5a858cc289900cc05f5e3d7090839b8ccf9a9135d --limit 10
npm run work -- accept --network atlantic-testnet --escrow <escrow> --id <workOrderId> --signer-env PHAROS_PRIVATE_KEY_2
npm run validate-metadata -- --kind proof --file <proof.json>
npm run write-hash-artifact -- --kind proof --input <proof.json> --out-dir demo-artifacts/hash-artifacts --name proof
npm run work -- submit --network atlantic-testnet --escrow <escrow> --id <workOrderId> --proof <proofURI> --signer-env PHAROS_PRIVATE_KEY_2
```

### Verifier Agent

Use this when the user wants to inspect submitted work and release payment only if it passes.

```bash
npm run status -- --network atlantic-testnet --escrow <escrow> --id <workOrderId>
npm run verify-and-release -- --network atlantic-testnet --escrow <escrow> --id <workOrderId> --dry-run
npm run verify-and-release -- --network atlantic-testnet --escrow <escrow> --id <workOrderId> --policy deterministic
```

Use `--policy both` when the user explicitly wants deterministic checks plus Groq semantic review.

### Reputation Or Marketplace Agent

Use this when the user wants ranking, routing, history, or analytics.

```bash
npm run reputation -- --network atlantic-testnet --escrow <escrow> --agent <agentAddress> --asset 0xcfc8330f4bcab529c625d12781b1c19466a9fc8b
npm run reputation-index -- --network atlantic-testnet --escrow <escrow> --from-block <block> --out demo-artifacts/reputation-index.json
npm run recommend-worker -- --network atlantic-testnet --escrow <escrow> --asset 0xcfc8330f4bcab529c625d12781b1c19466a9fc8b --candidates <workerA>,<workerB> --limit 10
npm run rank-open-work -- --network atlantic-testnet --escrow <escrow> --asset 0xcfc8330f4bcab529c625d12781b1c19466a9fc8b --min-amount 1 --limit 10
```

### Maintenance And Submission

Use this when validating the package or preparing the hackathon submission.

```bash
npm run submit-check -- --network atlantic-testnet --escrow 0x047119bdf422fc82021b88cf679ddeddd500f128
npm run agent-commands
npx tsx scripts/deploy.ts
npm run doctor -- --network atlantic-testnet --escrow 0x047119bdf422fc82021b88cf679ddeddd500f128
```

## Demo Commands

Use demo commands only when the user asks for a demo, judge proof, walkthrough, or full sample lifecycle. Do not use them as a substitute for role-specific workflows.

Use `npm run judge-demo-usdc` for the strongest Phase 1 walkthrough. It uses Atlantic USDC, three funded wallets, ERC20 approval, on-chain escrow, proof verification, release, and asset-specific reputation. Use `scripts/judge-demo.ts --asset native` for the simpler native-token variant.

Use `npm run marketplace-demo` for the Phase 2 composition walkthrough. It runs the planner, marketplace recommender, worker, verifier, and reputation roles in one command and prints a structured transcript with explorer links.

The judge demo writes `demo-artifacts/<workOrderId>/judge-transcript.json` with actors, balances before/after, transaction links, verifier decision, local artifact paths, and worker reputation delta. It also writes `demo-artifacts/<workOrderId>/summary.md` and updates `demo-artifacts/latest-summary.md` for a concise judge-readable recap.

The USDC demo uses three funded wallets and real Groq LLM calls:

- `PHAROS_PRIVATE_KEY`: Planner Agent, creates and funds the work order.
- `PHAROS_PRIVATE_KEY_2`: Worker Agent, accepts and submits proof.
- `PHAROS_PRIVATE_KEY_3`: Verifier Agent, checks proof and releases payment.
- `GROQ_API_KEY`: Groq Responses API key.

For `judge-demo-usdc`, the Planner Agent wallet must hold Atlantic USDC and native PHRS for approve/create gas. Worker and Verifier wallets need native PHRS for accept, submit, and release gas.

The Reputation Agent is read-only. It summarizes the worker with contract reads after release.

## Worker Discovery

Use `scripts/find-open-work.ts` when a worker agent needs to discover claimable jobs. It scans `WorkOrderCreated` events, confirms each candidate is still `Open`, filters by asset, minimum reward, work deadline, and worker eligibility, then prints claimable jobs with explorer links and accept commands.

Use `--worker <address>` to show only open jobs or jobs designated for that worker. Use `--asset native`, `--asset <erc20Address>`, or omit it for all assets. Omit `--all` for the default recent scan. For a full deployment scan, use `--all --deployment-tx 0x37bb393e45c6df5d6da4eef5a858cc289900cc05f5e3d7090839b8ccf9a9135d` or `--all --from-block <block>`; `--all` is intentionally rejected without one of those anchors.

Use `scripts/rank-open-work.ts` when a worker or marketplace agent needs prioritized jobs instead of a plain claimable list. It scores open work by reward, deadline urgency, verifier presence, metadata evidence, and worker eligibility.

Use `scripts/recommend-worker.ts` when a planner or marketplace agent needs to rank candidate workers. It scores workers by completed jobs, submission rate, refund rate, selected-asset volume, and recent activity. Output is structured JSON for direct agent routing.

Use `assets/agent-capabilities.manifest.json` when an agent needs structured role and capability descriptors for planner, worker, verifier, reputation, and marketplace composition. Use `assets/agent-command.manifest.json` or `npm run agent-commands` when an agent needs JSON-RPC-style method names, required params, environment requirements, and exact local commands.

Use `scripts/reputation-index.ts` when a reputation or marketplace agent needs a persistent JSON index from escrow events. It reports completed jobs, refund rate, selected-asset volume, average review time, latest proofs, and explorer links.

## Verifier Policy

Use `scripts/write-hash-artifact.ts` before create or submit flows when metadata/proof should be content-addressed without IPFS. It validates task or proof JSON, writes normalized JSON, computes `sha256(JSON.stringify(json))`, and prints a `sha256:` URI. `scripts/verify-and-release.ts` can resolve those URIs from `demo-artifacts/` or from explicit `--metadata-file` / `--proof-file` paths.

Use `scripts/verify-and-release.ts` when a buyer or verifier agent needs to check a submitted proof before release. It:

- Reads the work order from-chain.
- Loads task metadata and proof JSON from `https://`, `ipfs://`, `file://`, local paths, or `sha256:` content-addressed local artifacts.
- Validates task and proof JSON against `assets/schemas/`, then checks acceptance criteria, output format, and artifact evidence shape.
- Uses deterministic verification by default, without requiring an LLM.
- Optionally calls Groq `qwen/qwen3-32b` for semantic review with `--policy groq` or `--policy both`.
- Sends `releasePayment` only when the selected policy passes.

Use `--dry-run` to validate without sending a transaction. Use `--no-llm` or `--policy deterministic` for deterministic-only review. Use `--release-env <ENV_NAME>` to choose the signing wallet; default is `PHAROS_PRIVATE_KEY_3`.

## Agent Guidance

- Prefer ERC20 stablecoin escrow for judged demos because the value amount is clearer.
- Use metadata URIs that include task objective, acceptance criteria, requested output format, buyer agent ID, and worker agent ID.
- Use proof URIs that include result summary, artifact links, hashes, and verification notes.
- Return explorer links for every transaction.
- Do not release payment until the proof matches the metadata acceptance criteria.
- Use `getAgentStats(address)`, `getAgentAssetVolumeReleased(address,address)`, and event logs for reputation summaries.
