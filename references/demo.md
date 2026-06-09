# Demo Runbook

Use this when a judge wants to see a full live cycle on Pharos Atlantic.

## One-Wallet Lifecycle Demo

This creates a native escrow order where the same wallet plays buyer, worker, and verifier. It proves the complete on-chain lifecycle without needing three funded wallets.

```powershell
cd D:\pharos-hackathon\pharos-agent-escrow
npm ci
npx tsx scripts/demo-flow.ts --network atlantic-testnet --escrow 0x6f88b3c79325472f6439426e84c9303506661585 --amount 0.001
```

The script prints transaction hashes and explorer links for create, accept, submit, and release.

## Judge-Grade Three-Agent Demo

This is the recommended live judging flow. It uses three funded wallets and real Groq LLM calls:

- `PHAROS_PRIVATE_KEY`: Planner Agent
- `PHAROS_PRIVATE_KEY_2`: Worker Agent
- `PHAROS_PRIVATE_KEY_3`: Verifier Agent
- `GROQ_API_KEY`: Groq Responses API key

```powershell
cd D:\pharos-hackathon\pharos-agent-escrow
npm ci
npm run judge-demo -- --network atlantic-testnet --escrow 0x6f88b3c79325472f6439426e84c9303506661585 --amount 0.001
```

Flow:

1. Planner Agent asks Groq to create task metadata and funds the escrow.
2. Worker Agent accepts the work order.
3. Worker Agent asks Groq to produce the deliverable and submits a proof hash.
4. Verifier Agent asks Groq to compare task metadata with proof, then releases payment if it passes.
5. Reputation Agent reads worker stats and native volume released.

The script writes generated task, proof, and verifier decision JSON to `demo-artifacts/<workOrderId>/`.

## Inspect Events

```powershell
npx tsx scripts/events.ts --network atlantic-testnet --escrow 0x6f88b3c79325472f6439426e84c9303506661585
```

By default this scans the latest 1000 blocks to respect Atlantic RPC limits. Add `--from-block <block>` for a specific window or `--all` for a deployment-to-latest scan.

## Inspect Reputation

```powershell
npx tsx scripts/reputation.ts --network atlantic-testnet --escrow 0x6f88b3c79325472f6439426e84c9303506661585 --agent <agentAddress> --asset native
```

Use `--asset 0x0000000000000000000000000000000000000000` for native PHRS.

## Multi-Agent Demo

For a more realistic demo, use three funded wallets:

1. Buyer creates an order with `--worker <workerAddress>` and optional `--verifier <verifierAddress>`.
2. Worker runs `accept`.
3. Worker runs `submit`.
4. Buyer or verifier runs `release`.

Commands are in `SKILL.md` and `references/workflows.md`.
