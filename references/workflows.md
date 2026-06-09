# Pharos Agent Escrow Workflows

## Status Values

Atlantic testnet deployment:

- Contract: `0x6f88b3c79325472f6439426e84c9303506661585`
- Deploy tx: `https://atlantic.pharosscan.xyz/tx/0xb79589f425bc952edc30857cbeaed8d83c39cfc3ef16ad06b329be743fbbe611`

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

### createWorkOrder

```solidity
function createWorkOrder(
    address worker,
    address verifier,
    address asset,
    uint256 amount,
    uint64 deadline,
    string calldata metadataURI
) external payable returns (uint256 id)
```

- `worker`: set to `address(0)` for an open job, or a worker address for a designated job.
- `verifier`: set to `address(0)` to let only the buyer release payment, or set an independent verifier.
- `asset`: `address(0)` for native PHRS/PROS, otherwise an ERC20 token address.
- `amount`: escrow amount in base units.
- `deadline`: Unix timestamp after which the buyer can refund if payment was not released.
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

### submitProof

```solidity
function submitProof(uint256 id, string calldata proofURI) external
```

- Only the accepted worker can submit proof.
- `proofURI` should identify the delivered artifact and include hashes where possible.

### releasePayment

```solidity
function releasePayment(uint256 id) external
```

- Callable by the buyer or the configured verifier.
- Requires status `Submitted`.
- Sends escrowed funds to the worker.

### refundExpired

```solidity
function refundExpired(uint256 id) external
```

- Callable only by the buyer after `deadline`.
- Works for `Open`, `Accepted`, or `Submitted` orders.
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

## Demo Metadata Shape

Use JSON for demo clarity:

```json
{
  "title": "Summarize Pharos SPN docs",
  "buyerAgent": "planner-agent-alpha",
  "workerAgent": "research-agent-beta",
  "acceptanceCriteria": [
    "Summarize SPN purpose",
    "Explain why it matters for agent infrastructure",
    "Return source links"
  ],
  "outputFormat": "markdown"
}
```

## Safety Rules

- Confirm target network before writes.
- Never print or commit `PRIVATE_KEY`.
- For ERC20 payments, check token decimals before converting human amounts.
- Do not release payment without checking proof against the work-order metadata.
- For mainnet, ask for explicit confirmation before deployment or write transactions.
