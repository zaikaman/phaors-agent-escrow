# Security And Production Notes

This Skill is built as a production-style hackathon primitive, but it is not a substitute for an external audit before mainnet funds.

## Contract Controls

- No owner withdrawal path exists.
- No admin can seize escrowed funds.
- Fund-moving functions use a non-reentrant guard.
- ERC20 transfers support tokens that return `true`, return no data, or revert.
- State changes happen before outbound payment transfers.
- Missing work orders revert explicitly.
- Mainnet usage should require explicit confirmation.

## Known Tradeoffs

- Work and review deadlines use block timestamps. This is appropriate for escrow expiry windows measured in minutes or hours, not second-level precision.
- Metadata and proof contents are referenced by URI. Agents should include hashes in the referenced JSON when integrity matters.
- Task and proof metadata are validated against JSON Schemas before create and release flows proceed.
- Disputes are intentionally simple: the buyer or configured verifier controls release. The buyer can refund open/accepted work after `workDeadline`, while submitted work remains reviewable until `reviewDeadline`.
- The aggregate `volumeReleased` stat mixes units across assets. Use `getAgentAssetVolumeReleased(agent, asset)` for precise asset-level reputation.

## Agent Safety Rules

- Never print private keys.
- Confirm account, network, escrow address, asset, amount, work deadline, and review deadline before writes.
- Prefer Atlantic testnet for demos.
- For ERC20 orders, read decimals before amount conversion.
- Verify proof against the metadata acceptance criteria before release. Deterministic verification is the default; Groq semantic review is optional with `--policy groq` or `--policy both`.
- Return explorer links for all writes.

## Validation Gate

Before submission or redeploy:

```powershell
cd D:\pharos-hackathon\pharos-agent-escrow
npm ci
& "$env:USERPROFILE\.foundry\bin\forge.exe" build
& "$env:USERPROFILE\.foundry\bin\forge.exe" test
npx tsc --noEmit
npm run validate-metadata -- --kind task --file .\assets\templates\task.metadata.json
npm run validate-metadata -- --kind proof --file .\assets\templates\proof.metadata.json
python C:\Users\admin\.codex\skills\.system\skill-creator\scripts\quick_validate.py .
```
