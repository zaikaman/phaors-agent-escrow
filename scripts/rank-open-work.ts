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
const limit = Number((args.limit as string | undefined) || "20");

if (scanAll && !fromBlockArg && !deploymentTx) {
  throw new Error("Use --from-block <block> or --deployment-tx <hash> with --all.");
}
if (chunkSize <= 0n) throw new Error("--chunk-size must be positive.");
if (!Number.isInteger(limit) || limit <= 0) throw new Error("--limit must be a positive integer.");
if (assetArg !== "all" && assetArg !== "native" && !/^0x[0-9a-fA-F]{40}$/.test(assetArg)) {
  throw new Error("--asset must be all, native, or an ERC20 address.");
}
if (workerFilter && !/^0x[0-9a-fA-F]{40}$/.test(workerFilter)) {
  throw new Error("--worker must be an EVM address.");
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
  return parseAmount(minAmountArg, await getAssetDecimals(asset));
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
  const logs = await publicClient.getLogs({ address: escrowAddress, fromBlock: start, toBlock: end });

  for (const log of logs) {
    try {
      const decoded = decodeEventLog({ abi: escrowAbi, data: log.data, topics: log.topics });
      if (decoded.eventName !== "WorkOrderCreated") continue;
      createdEvents.push({
        ...(decoded.args as CreatedEvent),
        blockNumber: log.blockNumber || 0n,
        transactionHash: log.transactionHash!,
      });
    } catch {
      continue;
    }
  }

  if (end < latestBlock) await new Promise((resolve) => setTimeout(resolve, 250));
}

const ranked = [];
for (const created of createdEvents) {
  if (!isAssetMatch(created.asset) || !isWorkerEligible(created.worker) || created.workDeadline <= now) continue;
  if (created.amount < await minAmountForAsset(created.asset)) continue;

  const order = await publicClient.readContract({
    address: escrowAddress,
    abi: escrowAbi,
    functionName: "getWorkOrder",
    args: [created.id],
  });
  if (order.status !== 1 || order.workDeadline <= now || !isWorkerEligible(order.worker)) continue;

  const decimals = await getAssetDecimals(order.asset);
  const amountFormatted = Number(formatUnits(order.amount, decimals));
  const secondsRemaining = Number(order.workDeadline - now);
  const hoursRemaining = Math.max(secondsRemaining / 3600, 0.01);
  const designatedForRequester = workerFilter && order.worker.toLowerCase() === workerFilter.toLowerCase();
  const openToAnyWorker = order.worker === zeroAddress();
  const hasVerifier = order.verifier !== zeroAddress();
  const contentAddressedMetadata = order.metadataURI.startsWith("sha256:") || order.metadataURI.startsWith("ipfs://");
  const urgencyScore = Math.min(25, 25 / Math.sqrt(hoursRemaining));
  const rewardScore = Math.min(45, Math.log10(amountFormatted + 1) * 18);
  const trustScore = (hasVerifier ? 12 : 0) + (contentAddressedMetadata ? 10 : 0) + (designatedForRequester ? 8 : openToAnyWorker ? 4 : 0);
  const score = Math.round((rewardScore + urgencyScore + trustScore) * 100) / 100;

  ranked.push({
    workOrderId: created.id.toString(),
    score,
    scoreBreakdown: {
      reward: Math.round(rewardScore * 100) / 100,
      urgency: Math.round(urgencyScore * 100) / 100,
      trust: Math.round(trustScore * 100) / 100,
    },
    recommendation: score >= 55 ? "high-priority" : score >= 35 ? "consider" : "low-priority",
    buyer: order.buyer,
    designatedWorker: order.worker === zeroAddress() ? null : order.worker,
    verifier: order.verifier === zeroAddress() ? null : order.verifier,
    asset: order.asset === zeroAddress() ? "native" : order.asset,
    assetLabel: order.asset === zeroAddress() ? network.nativeToken : order.asset,
    amount: {
      raw: order.amount.toString(),
      formatted: formatUnits(order.amount, decimals),
    },
    deadlines: {
      workDeadlineUnix: order.workDeadline.toString(),
      workDeadlineIso: new Date(Number(order.workDeadline) * 1000).toISOString(),
      reviewDeadlineUnix: order.reviewDeadline.toString(),
      reviewDeadlineIso: new Date(Number(order.reviewDeadline) * 1000).toISOString(),
      secondsRemaining: secondsRemaining.toString(),
    },
    metadataURI: order.metadataURI,
    created: {
      block: created.blockNumber.toString(),
      tx: `${network.explorerUrl}/tx/${created.transactionHash}`,
    },
    acceptCommand: `npx tsx scripts/accept-submit-release.ts accept --network ${network.name} --escrow ${escrowAddress} --id ${created.id.toString()}`,
  });
}

ranked.sort((a, b) => b.score - a.score || Number(BigInt(a.deadlines.workDeadlineUnix) - BigInt(b.deadlines.workDeadlineUnix)));

console.log(JSON.stringify({
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
  rankedCount: ranked.length,
  rankedOpenWork: ranked.slice(0, limit),
}, null, 2));
