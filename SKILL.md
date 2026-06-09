---
name: pharos-agent-escrow
description: Use when an AI agent needs to create, fund, accept, complete, verify, release, refund, or audit an on-chain work order escrow on Pharos. Supports agent-to-agent task payments with native PHRS/PROS or ERC20 assets, work metadata, proof submission, event-based reputation, and explorer links.
---

# Pharos Agent Escrow

Reusable Pharos Skill for agent-to-agent work orders. Use this when an agent needs to coordinate paid work on-chain instead of sending a direct transfer.

## Reference Routing

- Need contract roles, state machine, or deployment context: read `references/architecture.md`.
- Need exact methods, status values, or command-level workflows: read `references/workflows.md`.
- Need a judge demo or live walkthrough: read `references/demo.md`.
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

## Pharos Network Defaults

Default to Atlantic testnet unless the user explicitly asks for mainnet.

- Atlantic testnet chain ID: `688689`
- Atlantic RPC: `https://atlantic.dplabs-internal.com`
- Atlantic explorer: `https://atlantic.pharosscan.xyz`
- Atlantic USDC: `0xE0BE08c77f415F577A1B3A9aD7a1Df1479564ec8`
- Native token: `PHRS` on Atlantic testnet, `PROS` on mainnet

## Atlantic Deployment

- Current split-deadline `AgentWorkOrderEscrow`: `0x047119bdf422fc82021b88cf679ddeddd500f128`
- Current deployment transaction: `https://atlantic.pharosscan.xyz/tx/0x37bb393e45c6df5d6da4eef5a858cc289900cc05f5e3d7090839b8ccf9a9135d`
- Legacy single-deadline `AgentWorkOrderEscrow`: `0x6f88b3c79325472f6439426e84c9303506661585`
- Legacy deployment transaction: `https://atlantic.pharosscan.xyz/tx/0xb79589f425bc952edc30857cbeaed8d83c39cfc3ef16ad06b329be743fbbe611`

For write actions, never hardcode private keys. Require `PRIVATE_KEY` in the environment and display the derived address before sending.

## Script Usage

Scripts live in `scripts/` and use TypeScript with viem.

Install dependencies in a project using the skill:

```bash
npm install viem dotenv tsx typescript
```

Common commands:

```bash
npx tsx scripts/deploy.ts
npm run doctor -- --network atlantic-testnet --escrow 0x047119bdf422fc82021b88cf679ddeddd500f128
npx tsx scripts/create-work-order.ts --escrow <address> --asset native --amount 0.1 --work-deadline-minutes 60 --review-period-minutes 60 --metadata "ipfs://..."
npx tsx scripts/accept-submit-release.ts accept --escrow <address> --id 1
npx tsx scripts/accept-submit-release.ts submit --escrow <address> --id 1 --proof "ipfs://..."
npx tsx scripts/accept-submit-release.ts release --escrow <address> --id 1
npx tsx scripts/status.ts --escrow <address> --id 1
npm run validate-metadata -- --kind task --file assets/templates/task.metadata.json
npm run validate-metadata -- --kind proof --file assets/templates/proof.metadata.json
npx tsx scripts/demo-flow.ts --escrow 0x047119bdf422fc82021b88cf679ddeddd500f128 --amount 0.001
npx tsx scripts/judge-demo.ts --escrow 0x047119bdf422fc82021b88cf679ddeddd500f128 --amount 0.001
npm run judge-demo-usdc -- --network atlantic-testnet --escrow 0x047119bdf422fc82021b88cf679ddeddd500f128
npm run marketplace-demo -- --network atlantic-testnet --escrow 0x047119bdf422fc82021b88cf679ddeddd500f128 --asset native --amount 0.001
npx tsx scripts/verify-and-release.ts --escrow 0x047119bdf422fc82021b88cf679ddeddd500f128 --id 1
npx tsx scripts/find-open-work.ts --escrow 0x047119bdf422fc82021b88cf679ddeddd500f128 --worker <workerAddress> --asset native --min-amount 0.001
npm run rank-open-work -- --network atlantic-testnet --escrow 0x047119bdf422fc82021b88cf679ddeddd500f128 --worker <workerAddress> --asset native --min-amount 0.001 --limit 10
npm run recommend-worker -- --network atlantic-testnet --escrow 0x047119bdf422fc82021b88cf679ddeddd500f128 --asset native --candidates <workerA>,<workerB> --limit 10
npx tsx scripts/events.ts --escrow 0x047119bdf422fc82021b88cf679ddeddd500f128
npx tsx scripts/reputation.ts --escrow 0x047119bdf422fc82021b88cf679ddeddd500f128 --agent <agentAddress> --asset native
```

## Judge Demo

Use `npm run judge-demo-usdc` for the strongest Phase 1 walkthrough. It uses Atlantic USDC, three funded wallets, ERC20 approval, on-chain escrow, proof verification, release, and asset-specific reputation. Use `scripts/judge-demo.ts --asset native` for the simpler native-token variant.

Use `npm run marketplace-demo` for the Phase 2 composition walkthrough. It runs the planner, marketplace recommender, worker, verifier, and reputation roles in one command and prints a structured transcript with explorer links.

The USDC demo uses three funded wallets and real Groq LLM calls:

- `PHAROS_PRIVATE_KEY`: Planner Agent, creates and funds the work order.
- `PHAROS_PRIVATE_KEY_2`: Worker Agent, accepts and submits proof.
- `PHAROS_PRIVATE_KEY_3`: Verifier Agent, checks proof and releases payment.
- `GROQ_API_KEY`: Groq Responses API key.

For `judge-demo-usdc`, the Planner Agent wallet must hold Atlantic USDC and native PHRS for approve/create gas. Worker and Verifier wallets need native PHRS for accept, submit, and release gas.

The Reputation Agent is read-only. It summarizes the worker with contract reads after release.

## Worker Discovery

Use `scripts/find-open-work.ts` when a worker agent needs to discover claimable jobs. It scans `WorkOrderCreated` events, confirms each candidate is still `Open`, filters by asset, minimum reward, work deadline, and worker eligibility, then prints claimable jobs with explorer links and accept commands.

Use `--worker <address>` to show only open jobs or jobs designated for that worker. Use `--asset native`, `--asset <erc20Address>`, or omit it for all assets. Use `--all` to scan from deployment, or `--from-block <block>` for a known window.

Use `scripts/rank-open-work.ts` when a worker or marketplace agent needs prioritized jobs instead of a plain claimable list. It scores open work by reward, deadline urgency, verifier presence, metadata evidence, and worker eligibility.

Use `scripts/recommend-worker.ts` when a planner or marketplace agent needs to rank candidate workers. It scores workers by completed jobs, submission rate, refund rate, selected-asset volume, and recent activity. Output is structured JSON for direct agent routing.

## Verifier Policy

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
