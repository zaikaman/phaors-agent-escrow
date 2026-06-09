---
name: pharos-agent-escrow
description: Use when an AI agent needs to create, fund, accept, complete, verify, release, refund, or audit an on-chain work order escrow on Pharos. Supports agent-to-agent task payments with native PHRS/PROS or ERC20 assets, work metadata, proof submission, event-based reputation, and explorer links.
license: MIT
metadata:
  author: thinhdinh1706
  version: "0.1.0"
---

# Pharos Agent Escrow

Reusable Pharos Skill for agent-to-agent work orders. Use this when an agent needs to coordinate paid work on-chain instead of sending a direct transfer.

## Reference Routing

- Need contract roles, state machine, or deployment context: read `references/architecture.md`.
- Need exact methods, status values, or command-level workflows: read `references/workflows.md`.
- Need a judge demo or live walkthrough: read `references/demo.md`.
- Need security posture, production caveats, or validation gates: read `references/security.md`.
- Need Phase 2 composition ideas: read `references/agent-patterns.md`.

## Core Contract

The bundled contract is `assets/AgentWorkOrderEscrow.sol`.

Workflow:

1. Buyer agent creates a work order and escrows native PHRS/PROS or ERC20.
2. Worker agent accepts the job, unless a designated worker was already set.
3. Worker submits a completion proof URI or hash.
4. Buyer or optional verifier releases payment.
5. Buyer can refund expired work orders that were not released.

Use `references/workflows.md` for exact method signatures, status values, and safety rules.

Metadata templates:

- Task metadata: `assets/templates/task.metadata.json`
- Proof metadata: `assets/templates/proof.metadata.json`

## Pharos Network Defaults

Default to Atlantic testnet unless the user explicitly asks for mainnet.

- Atlantic testnet chain ID: `688689`
- Atlantic RPC: `https://atlantic.dplabs-internal.com`
- Atlantic explorer: `https://atlantic.pharosscan.xyz`
- Atlantic USDC: `0xE0BE08c77f415F577A1B3A9aD7a1Df1479564ec8`
- Native token: `PHRS` on Atlantic testnet, `PROS` on mainnet

## Live Atlantic Deployment

- `AgentWorkOrderEscrow`: `0x6f88b3c79325472f6439426e84c9303506661585`
- Deployment transaction: `https://atlantic.pharosscan.xyz/tx/0xb79589f425bc952edc30857cbeaed8d83c39cfc3ef16ad06b329be743fbbe611`

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
npx tsx scripts/create-work-order.ts --escrow <address> --asset native --amount 0.1 --deadline-minutes 60 --metadata "ipfs://..."
npx tsx scripts/accept-submit-release.ts accept --escrow <address> --id 1
npx tsx scripts/accept-submit-release.ts submit --escrow <address> --id 1 --proof "ipfs://..."
npx tsx scripts/accept-submit-release.ts release --escrow <address> --id 1
npx tsx scripts/status.ts --escrow <address> --id 1
npx tsx scripts/demo-flow.ts --escrow <address> --amount 0.001
npx tsx scripts/judge-demo.ts --escrow <address> --amount 0.001
npx tsx scripts/events.ts --escrow <address>
npx tsx scripts/reputation.ts --escrow <address> --agent <agentAddress> --asset native
```

## Judge Demo

Use `scripts/judge-demo.ts` for the full Phase 1 walkthrough. It uses three funded wallets and real Groq LLM calls:

- `PHAROS_PRIVATE_KEY`: Planner Agent, creates and funds the work order.
- `PHAROS_PRIVATE_KEY_2`: Worker Agent, accepts and submits proof.
- `PHAROS_PRIVATE_KEY_3`: Verifier Agent, checks proof and releases payment.
- `GROQ_API_KEY`: Groq Responses API key.

The Reputation Agent is read-only. It summarizes the worker with contract reads after release.

## Agent Guidance

- Prefer ERC20 stablecoin escrow for judged demos because the value amount is clearer.
- Use metadata URIs that include task objective, acceptance criteria, requested output format, buyer agent ID, and worker agent ID.
- Use proof URIs that include result summary, artifact links, hashes, and verification notes.
- Return explorer links for every transaction.
- Do not release payment until the proof matches the metadata acceptance criteria.
- Use `getAgentStats(address)`, `getAgentAssetVolumeReleased(address,address)`, and event logs for reputation summaries.
