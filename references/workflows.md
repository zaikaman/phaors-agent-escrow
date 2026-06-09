# Pharos Agent Escrow Workflows

## Status Values

Atlantic testnet deployment:

- Current split-deadline contract: `0x047119bdf422fc82021b88cf679ddeddd500f128`
- Current deploy tx: `https://atlantic.pharosscan.xyz/tx/0x37bb393e45c6df5d6da4eef5a858cc289900cc05f5e3d7090839b8ccf9a9135d`
- Legacy single-deadline contract: `0x6f88b3c79325472f6439426e84c9303506661585`
- Legacy deploy tx: `https://atlantic.pharosscan.xyz/tx/0xb79589f425bc952edc30857cbeaed8d83c39cfc3ef16ad06b329be743fbbe611`

The contract exposes `Status` as a Solidity enum:

| Value | Name | Meaning |
| --- | --- | --- |
| 0 | None | Missing work order |
| 1 | Open | Funded and waiting for a worker |
| 2 | Accepted | Worker has accepted |
| 3 | Submitted | Worker submitted proof |
| 4 | Released | Payment released to worker |
| 5 | Refunded | Funds returned to buyer |
| 6 | Cancelled | Open order cancelled before acceptance |

## Contract Methods

## Role-Based Command Recipes

Use these workflows for normal agent jobs. Reserve `judge-demo-usdc` and `marketplace-demo` for explicit demo or judging requests.

### Planner: Post Paid Work

1. Create task JSON with objective, acceptance criteria, output format, buyer agent, worker agent, verifier agent, work deadline, and review deadline.
2. Validate and content-address it.
3. Fund the work order.

```powershell
npm run doctor -- --network atlantic-testnet --escrow <escrow>
npm run validate-metadata -- --kind task --file .\task.json
npm run write-hash-artifact -- --kind task --input .\task.json --out-dir demo-artifacts/hash-artifacts --name task
npm run create -- --network atlantic-testnet --escrow <escrow> --asset 0xcfc8330f4bcab529c625d12781b1c19466a9fc8b --amount 1 --work-deadline-minutes 60 --review-period-minutes 60 --metadata <metadataURI> --metadata-file .\task.json --worker <workerAddress> --verifier <verifierAddress>
```

### Worker: Discover, Accept, Submit

```powershell
npm run find-open-work -- --network atlantic-testnet --escrow <escrow> --worker <workerAddress> --asset 0xcfc8330f4bcab529c625d12781b1c19466a9fc8b --min-amount 1
npm run rank-open-work -- --network atlantic-testnet --escrow <escrow> --worker <workerAddress> --asset 0xcfc8330f4bcab529c625d12781b1c19466a9fc8b --min-amount 1 --limit 10
npm run work -- accept --network atlantic-testnet --escrow <escrow> --id <workOrderId> --signer-env PHAROS_PRIVATE_KEY_2
npm run validate-metadata -- --kind proof --file .\proof.json
npm run write-hash-artifact -- --kind proof --input .\proof.json --out-dir demo-artifacts/hash-artifacts --name proof
npm run work -- submit --network atlantic-testnet --escrow <escrow> --id <workOrderId> --proof <proofURI> --signer-env PHAROS_PRIVATE_KEY_2
```

### Verifier: Validate And Release

```powershell
npm run status -- --network atlantic-testnet --escrow <escrow> --id <workOrderId>
npm run verify-and-release -- --network atlantic-testnet --escrow <escrow> --id <workOrderId> --dry-run
npm run verify-and-release -- --network atlantic-testnet --escrow <escrow> --id <workOrderId> --policy deterministic
```

Use `--policy both` only when semantic LLM review is explicitly requested.

### Reputation Or Marketplace: Rank And Route

```powershell
npm run reputation -- --network atlantic-testnet --escrow <escrow> --agent <agentAddress> --asset 0xcfc8330f4bcab529c625d12781b1c19466a9fc8b
npm run reputation-index -- --network atlantic-testnet --escrow <escrow> --from-block <block> --out demo-artifacts/reputation-index.json
npm run recommend-worker -- --network atlantic-testnet --escrow <escrow> --asset 0xcfc8330f4bcab529c625d12781b1c19466a9fc8b --candidates <workerA>,<workerB> --limit 10
```

### createWorkOrder

```solidity
function createWorkOrder(
    address worker,
    address verifier,
    address asset,
    uint256 amount,
    uint64 workDeadline,
    uint64 reviewDeadline,
    string calldata metadataURI
) external payable returns (uint256 id)
```

- `worker`: set to `address(0)` for an open job, or a worker address for a designated job.
- `verifier`: set to `address(0)` to let only the buyer release payment, or set an independent verifier.
- `asset`: `address(0)` for native PHRS/PROS, otherwise an ERC20 token address.
- `amount`: escrow amount in base units.
- `workDeadline`: Unix timestamp by which a worker must accept and submit proof.
- `reviewDeadline`: Unix timestamp after `workDeadline`; submitted work can be refunded only after this review window expires without release.
- `metadataURI`: IPFS, HTTPS, or content hash describing objective and acceptance criteria.
- Native escrow requires `msg.value == amount`.
- ERC20 escrow requires prior `approve(escrowAddress, amount)`.

### acceptWorkOrder

```solidity
function acceptWorkOrder(uint256 id) external
```

- Only works while status is `Open`.
- If a worker was designated, only that worker can accept.
- If no worker was designated, caller becomes the worker.
- Acceptance must happen before `workDeadline`.
- Worker agents can discover claimable jobs with `scripts/find-open-work.ts`.

```powershell
npx tsx scripts/find-open-work.ts --network atlantic-testnet --escrow <address> --worker <workerAddress> --asset native --min-amount 0.001
npm run rank-open-work -- --network atlantic-testnet --escrow <address> --worker <workerAddress> --asset native --min-amount 0.001 --limit 10
```

### submitProof

```solidity
function submitProof(uint256 id, string calldata proofURI) external
```

- Only the accepted worker can submit proof.
- Submission must happen before `workDeadline`.
- `proofURI` should identify the delivered artifact and include hashes where possible.

### releasePayment

```solidity
function releasePayment(uint256 id) external
```

- Callable by the buyer or the configured verifier.
- Requires status `Submitted`.
- Sends escrowed funds to the worker.
- For agent-driven releases, prefer `scripts/verify-and-release.ts` so metadata, proof shape, acceptance criteria, artifact evidence, and output format are checked before the transaction is sent.
- Deterministic verification is the default and does not require an LLM. Use `--policy both` to add Groq semantic review.

```powershell
npx tsx scripts/verify-and-release.ts --network atlantic-testnet --escrow <address> --id <workOrderId>
```

Add `--dry-run` to validate without releasing funds.

### refundExpired

```solidity
function refundExpired(uint256 id) external
```

- Callable only by the buyer.
- Works for `Open` and `Accepted` orders after `workDeadline`.
- Works for `Submitted` orders only after `reviewDeadline`, giving buyers/verifiers a fair review window.
- Sends escrowed funds back to the buyer.

### cancelOpen

```solidity
function cancelOpen(uint256 id) external
```

- Callable only by the buyer while status is `Open`.
- Useful for mistakenly created orders before any worker accepts.

### Read Methods

```solidity
function getWorkOrder(uint256 id) external view returns (WorkOrder memory)
function getAgentStats(address agent) external view returns (AgentStats memory)
function getAgentAssetVolumeReleased(address agent, address asset) external view returns (uint256)
function nextWorkOrderId() external view returns (uint256)
```

## Marketplace Scoring

- `rank-open-work` returns scored open jobs for worker agents. Scores combine reward size, deadline urgency, verifier presence, metadata evidence, and worker eligibility.
- `recommend-worker` returns scored workers for planner or marketplace agents. Scores combine completion rate, submission rate, refund rate, selected-asset volume, and recent activity.
- Both scripts output JSON designed for another agent to consume without parsing terminal prose.

## Demo Metadata Shape

Use JSON for demo clarity. Task and proof metadata are validated against:

- `assets/schemas/task.schema.json`
- `assets/schemas/proof.schema.json`

Validate local files with:

```powershell
npm run validate-metadata -- --kind task --file .\assets\templates\task.metadata.json
npm run validate-metadata -- --kind proof --file .\assets\templates\proof.metadata.json
```

Task example:

```json
{
  "title": "Summarize Pharos SPN docs",
  "buyerAgent": "planner-agent-alpha",
  "workerAgent": "research-agent-beta",
  "verifierAgent": "review-agent-gamma",
  "objective": "Produce a concise markdown brief for a Phase 2 agent builder.",
  "acceptanceCriteria": [
    "Summarize SPN purpose",
    "Explain why it matters for agent infrastructure",
    "Return source links"
  ],
  "outputFormat": "markdown",
  "workDeadline": "2026-06-15T00:00:00Z",
  "reviewDeadline": "2026-06-15T01:00:00Z"
}
```

When creating a work order with `ipfs://`, `https://`, `http://`, or `sha256:` metadata, pass `--metadata-file <path>` so the script can validate the local JSON before sending the transaction. `verify-and-release` validates loaded task and proof JSON again before any release transaction.

## Safety Rules

- Confirm target network before writes.
- Never print or commit `PRIVATE_KEY`.
- For ERC20 payments, check token decimals before converting human amounts.
- Do not release payment without checking proof against the work-order metadata.
- For mainnet, ask for explicit confirmation before deployment or write transactions.
