# Demo Runbook

Use this when a judge wants to see a full live cycle on Pharos Atlantic.

## One-Wallet Lifecycle Demo

This creates a native escrow order where the same wallet plays buyer, worker, and verifier. It proves the complete on-chain lifecycle without needing three funded wallets.

```powershell
cd D:\pharos-hackathon\pharos-agent-escrow
npm ci
npx tsx scripts/demo-flow.ts --network atlantic-testnet --escrow 0x047119bdf422fc82021b88cf679ddeddd500f128 --amount 0.001
```

The script prints transaction hashes and explorer links for create, accept, submit, and release.

## Judge-Grade USDC Three-Agent Demo

This is the recommended live judging flow. It uses Atlantic USDC, three funded wallets, ERC20 approval, on-chain escrow, real Groq LLM calls, and asset-specific reputation:

- `PHAROS_PRIVATE_KEY`: Planner Agent
- `PHAROS_PRIVATE_KEY_2`: Worker Agent
- `PHAROS_PRIVATE_KEY_3`: Verifier Agent
- `GROQ_API_KEY`: Groq Responses API key

The Planner Agent wallet must hold Atlantic USDC and native PHRS for approval and create gas. Worker and Verifier wallets need native PHRS for accept, submit, and release gas.

```powershell
cd D:\pharos-hackathon\pharos-agent-escrow
npm ci
npm run judge-demo-usdc -- --network atlantic-testnet --escrow 0x047119bdf422fc82021b88cf679ddeddd500f128
```

Flow:

1. Planner Agent asks Groq to create task metadata and funds the escrow.
2. Planner Agent approves USDC spending by the escrow contract.
3. Worker Agent accepts the work order.
4. Worker Agent asks Groq to produce the deliverable and submits a proof hash.
5. Verifier Agent asks Groq to compare task metadata with proof, then releases payment if it passes.
6. Reputation Agent reads worker stats and selected-asset volume released.

The script writes generated task, proof, and verifier decision JSON to `demo-artifacts/<workOrderId>/`.

## Standalone Verifier Release

Use this when a work order is already in `Submitted` status and the verifier should decide whether to release funds:

```powershell
npx tsx scripts/verify-and-release.ts --network atlantic-testnet --escrow 0x047119bdf422fc82021b88cf679ddeddd500f128 --id <workOrderId>
```

For a no-transaction validation pass:

```powershell
npx tsx scripts/verify-and-release.ts --network atlantic-testnet --escrow 0x047119bdf422fc82021b88cf679ddeddd500f128 --id <workOrderId> --dry-run
```

## Inspect Events

```powershell
npx tsx scripts/events.ts --network atlantic-testnet --escrow 0x047119bdf422fc82021b88cf679ddeddd500f128
```

By default this scans the latest 1000 blocks to respect Atlantic RPC limits. Add `--from-block <block>` for a specific window, or combine `--all` with `--deployment-tx <hash>` for a deployment-to-latest scan.

## Inspect Reputation

```powershell
npx tsx scripts/reputation.ts --network atlantic-testnet --escrow 0x047119bdf422fc82021b88cf679ddeddd500f128 --agent <agentAddress> --asset native
```

Use `--asset 0x0000000000000000000000000000000000000000` for native PHRS.

## Multi-Agent Demo

For a more realistic demo, use three funded wallets:

1. Buyer creates an order with `--worker <workerAddress>` and optional `--verifier <verifierAddress>`.
2. Worker runs `accept`.
3. Worker runs `submit`.
4. Buyer or verifier runs `release`.

Commands are in `SKILL.md` and `references/workflows.md`.
