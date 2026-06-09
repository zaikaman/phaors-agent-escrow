# Pharos Agent Escrow Submission

## What It Is

`pharos-agent-escrow` is a reusable Pharos Skill for agent-to-agent work orders. A buyer agent can escrow native PHRS/PROS or ERC20 tokens, a worker agent can accept the task and submit proof, and a buyer or verifier agent can release payment or refund expired work.

Live Atlantic testnet deployment:

- Contract: `0x6f88b3c79325472f6439426e84c9303506661585`
- Deploy tx: https://atlantic.pharosscan.xyz/tx/0xb79589f425bc952edc30857cbeaed8d83c39cfc3ef16ad06b329be743fbbe611

## Why This Can Win

This is not another token, NFT, transfer, Uniswap, or x402 clone. It is a higher-level economic primitive for the Pharos agent economy: agents can hire each other, lock funds, submit verifiable work proofs, settle payments, and build event-based reputation.

That makes it reusable for Phase 2 agents:

- Paid research agents
- Data collection agents
- Content bounty agents
- Verifier/reviewer agents
- Agent service marketplaces
- Reputation and routing agents

It aligns with the judging criteria:

- Original: agent work-order escrow is distinct from the provided examples.
- Useful: solves paid agent coordination, not just payment execution.
- Complete: contract, scripts, references, templates, tests, live deployment.
- Composable: buyer, worker, verifier, marketplace, and reputation agents can all use it.
- Pharos-native: deployed on Atlantic testnet with explorer links.

## How Judges Can Run It

From the skill folder:

```powershell
cd D:\pharos-hackathon\pharos-agent-escrow
npm ci
```

Run local checks:

```powershell
& "$env:USERPROFILE\.foundry\bin\forge.exe" build
& "$env:USERPROFILE\.foundry\bin\forge.exe" test
npx tsc --noEmit
python C:\Users\admin\.codex\skills\.system\skill-creator\scripts\quick_validate.py .
```

Verify the live deployment:

```powershell
& "$env:USERPROFILE\.foundry\bin\cast.exe" call 0x6f88b3c79325472f6439426e84c9303506661585 "nextWorkOrderId()(uint256)" --rpc-url https://atlantic.dplabs-internal.com
```

Run a one-wallet lifecycle demo:

```powershell
npx tsx scripts/demo-flow.ts --network atlantic-testnet --escrow 0x6f88b3c79325472f6439426e84c9303506661585 --amount 0.001
```

Inspect events and reputation:

```powershell
npx tsx scripts/events.ts --network atlantic-testnet --escrow 0x6f88b3c79325472f6439426e84c9303506661585
npx tsx scripts/reputation.ts --network atlantic-testnet --escrow 0x6f88b3c79325472f6439426e84c9303506661585 --agent <agentAddress> --asset native
```

## Files To Review

- Skill instructions: `pharos-agent-escrow/SKILL.md`
- Architecture: `pharos-agent-escrow/references/architecture.md`
- Security notes: `pharos-agent-escrow/references/security.md`
- Demo runbook: `pharos-agent-escrow/references/demo.md`
- Agent composition patterns: `pharos-agent-escrow/references/agent-patterns.md`
- Contract: `pharos-agent-escrow/assets/AgentWorkOrderEscrow.sol`
- Metadata templates: `pharos-agent-escrow/assets/templates/`
- Scripts: `pharos-agent-escrow/scripts/`
- Tests: `pharos-agent-escrow/test/AgentWorkOrderEscrow.t.sol`
