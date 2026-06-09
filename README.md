# Pharos Agent Escrow

Reusable Pharos Skill for agent-to-agent work orders. A planner agent escrows native PHRS/PROS or ERC20 tokens, a worker agent accepts and submits proof, and a buyer or verifier agent releases payment only when the work passes review.

## Run This In 3 Minutes

From the skill folder:

```powershell
cd D:\pharos-hackathon\pharos-agent-escrow
npm ci
```

Run local production checks:

```powershell
& "$env:USERPROFILE\.foundry\bin\forge.exe" test
npx tsc --noEmit
python C:\Users\admin\.codex\skills\.system\skill-creator\scripts\quick_validate.py .
```

Verify the live split-deadline Atlantic deployment:

```powershell
& "$env:USERPROFILE\.foundry\bin\cast.exe" call 0x047119bdf422fc82021b88cf679ddeddd500f128 "nextWorkOrderId()(uint256)" --rpc-url https://atlantic.dplabs-internal.com
```

Run the one-wallet lifecycle demo:

```powershell
npm run demo -- --network atlantic-testnet --escrow 0x047119bdf422fc82021b88cf679ddeddd500f128 --amount 0.001
```

Run the judge-grade three-agent Groq demo:

```powershell
npm run judge-demo -- --network atlantic-testnet --escrow 0x047119bdf422fc82021b88cf679ddeddd500f128 --amount 0.001
```

Required for the three-agent demo:

- `PHAROS_PRIVATE_KEY`: Planner Agent wallet
- `PHAROS_PRIVATE_KEY_2`: Worker Agent wallet
- `PHAROS_PRIVATE_KEY_3`: Verifier Agent wallet
- `GROQ_API_KEY`: Groq API key for `qwen/qwen3-32b`

## What Makes This Reusable

This is an economic coordination primitive, not a one-off payment script. Any agent can use the same contract and scripts to post paid work, discover open jobs, accept work, submit proof, verify delivery, release escrow, refund expired work, and build reputation from events.

Reusable surfaces:

- On-chain work-order state machine in `assets/AgentWorkOrderEscrow.sol`
- Native PHRS/PROS and ERC20 escrow support
- Task and proof metadata templates in `assets/templates/`
- Worker discovery from `WorkOrderCreated` events
- Split work/review deadlines so submitted proof gets a fair review window before refund
- Groq-powered verifier policy before release
- Event and contract-read based reputation summaries
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

Recent successful three-agent demo transactions:

- Create work order: https://atlantic.pharosscan.xyz/tx/0x7e5839ee4d7131fc0308ca0d55cb1920ace4c65ac7bad588761ac0682e5456d0
- Worker accept: https://atlantic.pharosscan.xyz/tx/0x56586e99c790d4837b5e1e85e3981416c8654023fe4e8a9ea988d55cf5c476ac
- Submit proof: https://atlantic.pharosscan.xyz/tx/0x2eeaae0a680b3e5c3ffef1a044876afc75ecbf4a6d38d2d84f76ee703d013df4
- Verifier release: https://atlantic.pharosscan.xyz/tx/0x5b7616536eff6e8de8d24fd5a9b21b4fbb0e5bda37e8be4dc1fc81eb0cc4bb07

## Judge Commands

Find claimable work:

```powershell
npm run find-open-work -- --network atlantic-testnet --escrow 0x047119bdf422fc82021b88cf679ddeddd500f128 --worker <workerAddress> --asset native --min-amount 0.001
```

Verify and release submitted work:

```powershell
npm run verify-and-release -- --network atlantic-testnet --escrow 0x047119bdf422fc82021b88cf679ddeddd500f128 --id <workOrderId>
```

Dry-run verifier policy without sending a transaction:

```powershell
npm run verify-and-release -- --network atlantic-testnet --escrow 0x047119bdf422fc82021b88cf679ddeddd500f128 --id <workOrderId> --dry-run
```

Inspect events and worker reputation:

```powershell
npm run events -- --network atlantic-testnet --escrow 0x047119bdf422fc82021b88cf679ddeddd500f128
npm run reputation -- --network atlantic-testnet --escrow 0x047119bdf422fc82021b88cf679ddeddd500f128 --agent <agentAddress> --asset native
```

## Why This Can Win

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
- Tests: `test/AgentWorkOrderEscrow.t.sol`
- Phase 2 mini-agent example: `agents/planner-worker-verifier-demo.md`
