import { decodeEventLog, formatUnits } from "viem";
import { erc20Abi, escrowAbi, makeReadClient, parseArgs, requireArg, zeroAddress } from "./config.js";

type WorkerCounters = {
  accepted: number;
  submitted: number;
  completed: number;
  refunded: number;
  lastActivityBlock: bigint;
};

const args = parseArgs();
const { network, publicClient } = makeReadClient(args);
const escrowAddress = requireArg(args, "escrow") as `0x${string}`;
const assetArg = (args.asset as string | undefined) || "native";
const asset = (assetArg === "native" ? zeroAddress() : assetArg) as `0x${string}`;
const candidatesArg = args.candidates as string | undefined;
const fromBlockArg = args["from-block"] as string | undefined;
const deploymentTx = args["deployment-tx"] as `0x${string}` | undefined;
const scanAll = Boolean(args.all);
const chunkSize = BigInt((args["chunk-size"] as string | undefined) || "1000");
const limit = Number((args.limit as string | undefined) || "10");

if (assetArg !== "native" && !/^0x[0-9a-fA-F]{40}$/.test(assetArg)) {
  throw new Error("--asset must be native or an ERC20 address.");
}
if (scanAll && !fromBlockArg && !deploymentTx) {
  throw new Error("Use --from-block <block> or --deployment-tx <hash> with --all.");
}
if (chunkSize <= 0n) throw new Error("--chunk-size must be positive.");
if (!Number.isInteger(limit) || limit <= 0) throw new Error("--limit must be a positive integer.");

const explicitCandidates = (candidatesArg || "")
  .split(",")
  .map((candidate) => candidate.trim())
  .filter(Boolean) as `0x${string}`[];
for (const candidate of explicitCandidates) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(candidate)) throw new Error(`Invalid candidate address: ${candidate}`);
}

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

const counters = new Map<string, WorkerCounters>();
const orderWorkers = new Map<string, `0x${string}`>();

function ensureWorker(worker: `0x${string}`) {
  const key = worker.toLowerCase();
  if (!counters.has(key)) {
    counters.set(key, { accepted: 0, submitted: 0, completed: 0, refunded: 0, lastActivityBlock: 0n });
  }
  return counters.get(key)!;
}

function markActivity(worker: `0x${string}`, blockNumber: bigint) {
  const counter = ensureWorker(worker);
  if (blockNumber > counter.lastActivityBlock) counter.lastActivityBlock = blockNumber;
}

for (let start = fromBlock; start <= latestBlock; start += chunkSize) {
  const end = start + chunkSize - 1n > latestBlock ? latestBlock : start + chunkSize - 1n;
  const logs = await publicClient.getLogs({ address: escrowAddress, fromBlock: start, toBlock: end });

  for (const log of logs) {
    try {
      const decoded = decodeEventLog({ abi: escrowAbi, data: log.data, topics: log.topics });
      const blockNumber = log.blockNumber || 0n;
      if (decoded.eventName === "WorkOrderAccepted") {
        const event = decoded.args as { id: bigint; worker: `0x${string}` };
        orderWorkers.set(event.id.toString(), event.worker);
        ensureWorker(event.worker).accepted += 1;
        markActivity(event.worker, blockNumber);
      } else if (decoded.eventName === "ProofSubmitted") {
        const event = decoded.args as { id: bigint; worker: `0x${string}` };
        orderWorkers.set(event.id.toString(), event.worker);
        ensureWorker(event.worker).submitted += 1;
        markActivity(event.worker, blockNumber);
      } else if (decoded.eventName === "PaymentReleased") {
        const event = decoded.args as { id: bigint; worker: `0x${string}` };
        orderWorkers.set(event.id.toString(), event.worker);
        ensureWorker(event.worker).completed += 1;
        markActivity(event.worker, blockNumber);
      } else if (decoded.eventName === "WorkOrderRefunded") {
        const event = decoded.args as { id: bigint };
        const worker = orderWorkers.get(event.id.toString());
        if (worker) {
          ensureWorker(worker).refunded += 1;
          markActivity(worker, blockNumber);
        }
      }
    } catch {
      continue;
    }
  }

  if (end < latestBlock) await new Promise((resolve) => setTimeout(resolve, 250));
}

for (const candidate of explicitCandidates) ensureWorker(candidate);

const decimals = asset === zeroAddress()
  ? 18
  : await publicClient.readContract({ address: asset, abi: erc20Abi, functionName: "decimals" });

const recommendations = [];
for (const [address, eventCounters] of counters) {
  const agent = address as `0x${string}`;
  const [stats, selectedAssetVolume] = await Promise.all([
    publicClient.readContract({ address: escrowAddress, abi: escrowAbi, functionName: "getAgentStats", args: [agent] }),
    publicClient.readContract({ address: escrowAddress, abi: escrowAbi, functionName: "getAgentAssetVolumeReleased", args: [agent, asset] }),
  ]);
  const accepted = Number(stats.accepted);
  const completed = Number(stats.completed);
  const submitted = Number(stats.submitted);
  const eventRefunds = eventCounters.refunded;
  const completionRate = accepted === 0 ? 0 : completed / accepted;
  const submissionRate = accepted === 0 ? 0 : submitted / accepted;
  const refundRate = accepted === 0 ? 0 : eventRefunds / accepted;
  const inverseRefundScore = accepted === 0 ? 0 : 1 - refundRate;
  const blocksSinceActivity = eventCounters.lastActivityBlock === 0n ? null : Number(latestBlock - eventCounters.lastActivityBlock);
  const recentActivityScore = blocksSinceActivity === null ? 0 : Math.max(0, 1 - blocksSinceActivity / 10000);
  const volumeScore = Math.min(1, Math.log10(Number(formatUnits(selectedAssetVolume, decimals)) + 1) / 3);
  const score = Math.round(100 * (
    completionRate * 0.38 +
    submissionRate * 0.17 +
    inverseRefundScore * 0.2 +
    volumeScore * 0.15 +
    recentActivityScore * 0.1
  ));

  recommendations.push({
    worker: agent,
    score,
    recommendation: score >= 75 ? "recommended" : score >= 50 ? "acceptable" : "needs-more-history",
    scoreBreakdown: {
      completionRate,
      submissionRate,
      refundRate,
      inverseRefundScore,
      selectedAssetVolumeScore: Math.round(volumeScore * 100) / 100,
      recentActivityScore: Math.round(recentActivityScore * 100) / 100,
    },
    contractStats: {
      posted: stats.posted.toString(),
      accepted: stats.accepted.toString(),
      submitted: stats.submitted.toString(),
      completed: stats.completed.toString(),
      refundedAsBuyer: stats.refunded.toString(),
      aggregateVolumeReleased: stats.volumeReleased.toString(),
      selectedAssetVolumeReleased: selectedAssetVolume.toString(),
      selectedAssetVolumeFormatted: formatUnits(selectedAssetVolume, decimals),
    },
    eventWindowStats: {
      accepted: eventCounters.accepted,
      submitted: eventCounters.submitted,
      completed: eventCounters.completed,
      refundedAsWorker: eventCounters.refunded,
      lastActivityBlock: eventCounters.lastActivityBlock === 0n ? null : eventCounters.lastActivityBlock.toString(),
      blocksSinceActivity,
    },
  });
}

recommendations.sort((a, b) => b.score - a.score || Number(BigInt(b.contractStats.completed) - BigInt(a.contractStats.completed)));

console.log(JSON.stringify({
  network: network.name,
  escrow: escrowAddress,
  asset: asset === zeroAddress() ? "native" : asset,
  assetLabel: asset === zeroAddress() ? network.nativeToken : asset,
  scanned: {
    fromBlock: fromBlock.toString(),
    toBlock: latestBlock.toString(),
    explicitCandidates: explicitCandidates.length,
    discoveredWorkers: counters.size,
  },
  rankingWeights: {
    completionRate: 0.38,
    submissionRate: 0.17,
    inverseRefundRate: 0.2,
    selectedAssetVolume: 0.15,
    recentActivity: 0.1,
  },
  recommendations: recommendations.slice(0, limit),
}, null, 2));
