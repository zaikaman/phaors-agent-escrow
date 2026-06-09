import { decodeEventLog, formatUnits } from "viem";
import {
  erc20Abi,
  escrowAbi,
  makeReadClient,
  parseAmount,
  parseArgs,
  requireArg,
  zeroAddress,
} from "./config.js";

type CreatedEvent = {
  id: bigint;
  buyer: `0x${string}`;
  worker: `0x${string}`;
  verifier: `0x${string}`;
  asset: `0x${string}`;
  amount: bigint;
  workDeadline: bigint;
  reviewDeadline: bigint;
  metadataURI: string;
};

const statuses = ["None", "Open", "Accepted", "Submitted", "Released", "Refunded", "Cancelled"];
const args = parseArgs();
const { network, publicClient } = makeReadClient(args);
const escrowAddress = requireArg(args, "escrow") as `0x${string}`;
const workerFilter = args.worker as `0x${string}` | undefined;
const assetArg = (args.asset as string | undefined) || "all";
const minAmountArg = args["min-amount"] as string | undefined;
const fromBlockArg = args["from-block"] as string | undefined;
const deploymentTx = args["deployment-tx"] as `0x${string}` | undefined;
const scanAll = Boolean(args.all);
const chunkSize = BigInt((args["chunk-size"] as string | undefined) || "1000");

if (scanAll && !fromBlockArg && !deploymentTx) {
  throw new Error("Use --from-block <block> or --deployment-tx <hash> with --all.");
}
if (chunkSize <= 0n) {
  throw new Error("--chunk-size must be positive");
}
if (assetArg !== "all" && assetArg !== "native" && !/^0x[0-9a-fA-F]{40}$/.test(assetArg)) {
  throw new Error("--asset must be all, native, or an ERC20 address");
}
if (workerFilter && !/^0x[0-9a-fA-F]{40}$/.test(workerFilter)) {
  throw new Error("--worker must be an EVM address");
}

const requestedAsset = assetArg === "native" ? zeroAddress() : assetArg === "all" ? undefined : (assetArg as `0x${string}`);
const latestBlock = await publicClient.getBlockNumber();
const receipt = scanAll && !fromBlockArg
  ? await publicClient.getTransactionReceipt({ hash: deploymentTx! })
  : undefined;
const defaultWindowStart = latestBlock > chunkSize ? latestBlock - chunkSize + 1n : 0n;
const fromBlock = fromBlockArg
  ? BigInt(fromBlockArg)
  : scanAll
    ? receipt?.blockNumber || 0n
    : defaultWindowStart;
const now = BigInt(Math.floor(Date.now() / 1000));
const decimalsCache = new Map<string, number>();

async function getAssetDecimals(asset: `0x${string}`) {
  const key = asset.toLowerCase();
  if (decimalsCache.has(key)) return decimalsCache.get(key)!;
  if (asset === zeroAddress()) {
    decimalsCache.set(key, 18);
    return 18;
  }
  const decimals = await publicClient.readContract({
    address: asset,
    abi: erc20Abi,
    functionName: "decimals",
  });
  decimalsCache.set(key, decimals);
  return decimals;
}

async function minAmountForAsset(asset: `0x${string}`) {
  if (!minAmountArg) return 0n;
  const decimals = await getAssetDecimals(asset);
  return parseAmount(minAmountArg, decimals);
}

function isWorkerEligible(orderWorker: `0x${string}`) {
  if (!workerFilter) return true;
  return orderWorker === zeroAddress() || orderWorker.toLowerCase() === workerFilter.toLowerCase();
}

function isAssetMatch(asset: `0x${string}`) {
  if (!requestedAsset) return true;
  return asset.toLowerCase() === requestedAsset.toLowerCase();
}

const createdEvents: Array<CreatedEvent & { blockNumber: bigint; transactionHash: `0x${string}` }> = [];
for (let start = fromBlock; start <= latestBlock; start += chunkSize) {
  const end = start + chunkSize - 1n > latestBlock ? latestBlock : start + chunkSize - 1n;
  const logs = await publicClient.getLogs({
    address: escrowAddress,
    fromBlock: start,
    toBlock: end,
  });

  for (const log of logs) {
    try {
      const decoded = decodeEventLog({
        abi: escrowAbi,
        data: log.data,
        topics: log.topics,
      });
      if (decoded.eventName !== "WorkOrderCreated") continue;
      const event = decoded.args as CreatedEvent;
      createdEvents.push({
        ...event,
        blockNumber: log.blockNumber || 0n,
        transactionHash: log.transactionHash!,
      });
    } catch {
      continue;
    }
  }

  if (end < latestBlock) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

const claimable = [];
for (const created of createdEvents) {
  if (!isAssetMatch(created.asset)) continue;
  if (!isWorkerEligible(created.worker)) continue;
  if (created.workDeadline <= now) continue;

  const minAmount = await minAmountForAsset(created.asset);
  if (created.amount < minAmount) continue;

  const order = await publicClient.readContract({
    address: escrowAddress,
    abi: escrowAbi,
    functionName: "getWorkOrder",
    args: [created.id],
  });
  if (order.status !== 1) continue;
  if (order.workDeadline <= now) continue;
  if (!isWorkerEligible(order.worker)) continue;

  const decimals = await getAssetDecimals(order.asset);
  const native = order.asset === zeroAddress();
  const assetLabel = native ? network.nativeToken : order.asset;

  claimable.push({
    id: created.id.toString(),
    status: statuses[Number(order.status)],
    buyer: order.buyer,
    designatedWorker: order.worker === zeroAddress() ? null : order.worker,
    verifier: order.verifier === zeroAddress() ? null : order.verifier,
    asset: native ? "native" : order.asset,
    assetLabel,
    amount: {
      raw: order.amount.toString(),
      formatted: formatUnits(order.amount, decimals),
    },
    workDeadline: {
      unix: order.workDeadline.toString(),
      iso: new Date(Number(order.workDeadline) * 1000).toISOString(),
      secondsRemaining: (order.workDeadline - now).toString(),
    },
    reviewDeadline: {
      unix: order.reviewDeadline.toString(),
      iso: new Date(Number(order.reviewDeadline) * 1000).toISOString(),
      secondsRemaining: (order.reviewDeadline - now).toString(),
    },
    metadataURI: order.metadataURI,
    createdAt: {
      unix: order.createdAt.toString(),
      iso: new Date(Number(order.createdAt) * 1000).toISOString(),
    },
    createdInBlock: created.blockNumber.toString(),
    createdTx: `${network.explorerUrl}/tx/${created.transactionHash}`,
    workOrderExplorer: `${network.explorerUrl}/address/${escrowAddress}`,
    acceptCommand: `npx tsx scripts/accept-submit-release.ts accept --network ${network.name} --escrow ${escrowAddress} --id ${created.id.toString()}`,
  });
}

claimable.sort((a, b) => {
  const deadlineDiff = BigInt(a.workDeadline.unix) - BigInt(b.workDeadline.unix);
  if (deadlineDiff < 0n) return -1;
  if (deadlineDiff > 0n) return 1;
  const amountDiff = BigInt(b.amount.raw) - BigInt(a.amount.raw);
  if (amountDiff < 0n) return -1;
  if (amountDiff > 0n) return 1;
  return 0;
});

console.log(JSON.stringify(
  {
    network: network.name,
    escrow: escrowAddress,
    scanned: {
      fromBlock: fromBlock.toString(),
      toBlock: latestBlock.toString(),
      createdEvents: createdEvents.length,
    },
    filters: {
      worker: workerFilter || null,
      asset: assetArg,
      minAmount: minAmountArg || null,
    },
    claimableCount: claimable.length,
    claimable,
  },
  null,
  2
));
