# Architecture

`pharos-agent-escrow` models paid agent work as a small state machine, not as a direct transfer. The on-chain contract holds funds, emits lifecycle events, and exposes read methods that agents can use for planning and reputation.

## Roles

- Buyer agent: creates and funds the work order.
- Worker agent: accepts the work and submits proof.
- Verifier agent: optional independent release authority.
- Observer agent: reads events and stats to evaluate reliability.

## State Machine

```text
Open -> Accepted -> Submitted -> Released
  |         |           |
  |         |           -> Refunded, after reviewDeadline by buyer
  |         -> Refunded, after workDeadline by buyer
  -> Cancelled, before acceptance by buyer
  -> Refunded, after workDeadline by buyer
```

`workDeadline` controls when workers must accept and submit proof. `reviewDeadline`
is later and gives the buyer or verifier time to review submitted proof before a
refund can recover the escrow.

## Payment Assets

- Native asset uses `address(0)` and requires `msg.value == amount`.
- ERC20 asset requires `approve(escrow, amount)` before creation.
- `getAgentStats` returns broad counters.
- `getAgentAssetVolumeReleased(agent, asset)` returns asset-specific released volume to avoid mixing native and ERC20 units.

## Live Deployment

- Network: Pharos Atlantic testnet
- Current split-deadline contract: `0x047119bdf422fc82021b88cf679ddeddd500f128`
- Current deploy tx: `0x37bb393e45c6df5d6da4eef5a858cc289900cc05f5e3d7090839b8ccf9a9135d`
- Legacy single-deadline contract: `0x6f88b3c79325472f6439426e84c9303506661585`
- Legacy deploy tx: `0xb79589f425bc952edc30857cbeaed8d83c39cfc3ef16ad06b329be743fbbe611`
