import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { decodeEventLog, formatUnits } from "viem";
import {
  erc20Abi,
  escrowAbi,
  makeReadClient,
  parseArgs,
  requireArg,
  zeroAddress,
} from "./config.js";

type AgentEntry = {
  address: string;
  posted: number;
  accepted: number;
  submitted: number;
  completed: number;
  refunded: number;
  cancelled: number;
  aggregateVolumeReleased: Record<string, string>;
  assetVolumeReleased: Record<string, string>;
  completionRate: number | null;
  submissionRate: number | null;
  refundRate: number | null;
  averageReviewSeconds: number | null;
  latestProofs: Array<{
    workOrderId: string;
    proofURI: string;
    submittedAt: string | null;
    releasedAt: string | null;
    explorer: string | null;
  }>;
};

type WorkOrderIndex = {
  id: string;
  buyer?: string;
  worker?: string;
  verifier?: string;
  asset?: string;
  amount?: bigint;
  createdBlock?: bigint;
  acceptedBlock?: bigint;
  submittedBlock?: bigint;
  releasedBlock?: bigint;
  refundedBlock?: bigint;
  cancelledBlock?: bigint;
  proofURI?: string;
  createTx?: string;
  acceptTx?: string;
  submitTx?: string;
  releaseTx?: string;
  refundTx?: string;
  cancelTx?: string;
};

const args = parseArgs();
const { network, publicClient } = makeReadClient(args);
const escrowAddress = requireArg(args, "escrow") as `0x${string}`;
const deploymentTx = args["deployment-tx"] as `0x${string}` | undefined;
const fromBlockArg = args["from-block"] as string | undefined;
const scanAll = Boolean(args.all);
const outFile = args.out as string | undefined;
if (scanAll && !fromBlockArg && !deploymentTx) {
  throw new Error("Use --from-block <block> or --deployment-tx <hash> with --all.");
}

const latestBlock = await publicClient.getBlockNumber();
const receipt = scanAll && !fromBlockArg && deploymentTx
  ? await publicClient.getTransactionReceipt({ hash: deploymentTx })
  : undefined;
const chunkSize = BigInt((args["chunk-size"] as string | undefined) || "1000");
const defaultWindowStart = latestBlock > chunkSize ? latestBlock - chunkSize + 1n : 0n;
const fromBlock = fromBlockArg
  ? BigInt(fromBlockArg)
  : scanAll
    ? receipt?.blockNumber || 0n
    : defaultWindowStart;

const logs = [];
for (let start = fromBlock; start <= latestBlock; start += chunkSize) {
  const end = start + chunkSize - 1n > latestBlock ? latestBlock : start + chunkSize - 1n;
  const chunk = await publicClient.getLogs({
    address: escrowAddress,
    fromBlock: start,
    toBlock: end,
  });
  logs.push(...chunk);
  if (end < latestBlock) {
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250));
  }
}

const blockTimestampCache = new Map<string, string>();
const workOrders = new Map<string, WorkOrderIndex>();
const agents = new Map<string, AgentEntry>();
const assetDecimals = new Map<string, number>();

for (const log of logs) {
  const decoded = decodeEventLog({
    abi: escrowAbi,
    data: log.data,
    topics: log.topics,
  });
  const eventName = decoded.eventName;
  const eventArgs = decoded.args as Record<string, unknown>;
  const id = String(eventArgs.id);
  const order = getOrder(id);
  const blockNumber = log.blockNumber;
  const tx = log.transactionHash || undefined;

  if (eventName === "WorkOrderCreated") {
    order.buyer = String(eventArgs.buyer);
    order.worker = String(eventArgs.worker);
    order.verifier = String(eventArgs.verifier);
    order.asset = String(eventArgs.asset);
    order.amount = BigInt(String(eventArgs.amount));
    order.createdBlock = blockNumber;
    order.createTx = tx;
    getAgent(order.buyer).posted += 1;
  } else if (eventName === "WorkOrderAccepted") {
    order.worker = String(eventArgs.worker);
    order.acceptedBlock = blockNumber;
    order.acceptTx = tx;
    getAgent(order.worker).accepted += 1;
  } else if (eventName === "ProofSubmitted") {
    order.worker = String(eventArgs.worker);
    order.proofURI = String(eventArgs.proofURI);
    order.submittedBlock = blockNumber;
    order.submitTx = tx;
    getAgent(order.worker).submitted += 1;
  } else if (eventName === "PaymentReleased") {
    order.worker = String(eventArgs.worker);
    order.asset = String(eventArgs.asset);
    order.amount = BigInt(String(eventArgs.amount));
    order.releasedBlock = blockNumber;
    order.releaseTx = tx;
    const worker = getAgent(order.worker);
    worker.completed += 1;
    addVolume(worker.assetVolumeReleased, order.asset, order.amount);
    addVolume(worker.aggregateVolumeReleased, "aggregate", order.amount);
  } else if (eventName === "WorkOrderRefunded") {
    order.buyer = String(eventArgs.buyer);
    order.asset = String(eventArgs.asset);
    order.amount = BigInt(String(eventArgs.amount));
    order.refundedBlock = blockNumber;
    order.refundTx = tx;
    getAgent(order.buyer).refunded += 1;
  } else if (eventName === "WorkOrderCancelled") {
    order.buyer = String(eventArgs.buyer);
    order.asset = String(eventArgs.asset);
    order.amount = BigInt(String(eventArgs.amount));
    order.cancelledBlock = blockNumber;
    order.cancelTx = tx;
    getAgent(order.buyer).cancelled += 1;
  }
}

for (const order of workOrders.values()) {
  if (order.worker && order.proofURI) {
    const agent = getAgent(order.worker);
    agent.latestProofs.push({
      workOrderId: order.id,
      proofURI: order.proofURI,
      submittedAt: order.submittedBlock ? await blockTimestamp(order.submittedBlock) : null,
      releasedAt: order.releasedBlock ? await blockTimestamp(order.releasedBlock) : null,
      explorer: order.submitTx ? `${network.explorerUrl}/tx/${order.submitTx}` : null,
    });
  }
}

for (const agent of agents.values()) {
  agent.completionRate = agent.accepted === 0 ? null : round(agent.completed / agent.accepted);
  agent.submissionRate = agent.accepted === 0 ? null : round(agent.submitted / agent.accepted);
  agent.refundRate = agent.posted === 0 ? null : round(agent.refunded / agent.posted);
  agent.averageReviewSeconds = await averageReviewSeconds(agent.address);
  agent.latestProofs.sort((a, b) => Number(BigInt(b.workOrderId) - BigInt(a.workOrderId)));
  agent.latestProofs = agent.latestProofs.slice(0, Number((args["proof-limit"] as string | undefined) || "5"));
  agent.assetVolumeReleased = await formatVolumeMap(agent.assetVolumeReleased);
  agent.aggregateVolumeReleased = await formatVolumeMap(agent.aggregateVolumeReleased);
}

const report = {
  schema: "pharos-agent-escrow/reputation-index/v1",
  generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  network: network.name,
  escrow: escrowAddress,
  scan: {
    fromBlock: fromBlock.toString(),
    toBlock: latestBlock.toString(),
    logs: logs.length,
    workOrders: workOrders.size,
  },
  agents: [...agents.values()].sort((a, b) => b.completed - a.completed || b.accepted - a.accepted),
  workOrders: [...workOrders.values()].map((order) => ({
    id: order.id,
    buyer: order.buyer || null,
    worker: order.worker || null,
    verifier: order.verifier || null,
    asset: order.asset || null,
    amount: order.amount?.toString() || null,
    proofURI: order.proofURI || null,
    transactions: {
      create: order.createTx ? `${network.explorerUrl}/tx/${order.createTx}` : null,
      accept: order.acceptTx ? `${network.explorerUrl}/tx/${order.acceptTx}` : null,
      submit: order.submitTx ? `${network.explorerUrl}/tx/${order.submitTx}` : null,
      release: order.releaseTx ? `${network.explorerUrl}/tx/${order.releaseTx}` : null,
      refund: order.refundTx ? `${network.explorerUrl}/tx/${order.refundTx}` : null,
      cancel: order.cancelTx ? `${network.explorerUrl}/tx/${order.cancelTx}` : null,
    },
  })),
};

const output = JSON.stringify(report, null, 2);
if (outFile) {
  const target = resolve(outFile);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, output);
}
console.log(output);

function getOrder(id: string) {
  let order = workOrders.get(id);
  if (!order) {
    order = { id };
    workOrders.set(id, order);
  }
  return order;
}

function getAgent(address: string) {
  const normalized = address.toLowerCase();
  let agent = agents.get(normalized);
  if (!agent) {
    agent = {
      address,
      posted: 0,
      accepted: 0,
      submitted: 0,
      completed: 0,
      refunded: 0,
      cancelled: 0,
      aggregateVolumeReleased: {},
      assetVolumeReleased: {},
      completionRate: null,
      submissionRate: null,
      refundRate: null,
      averageReviewSeconds: null,
      latestProofs: [],
    };
    agents.set(normalized, agent);
  }
  return agent;
}

function addVolume(target: Record<string, string>, asset: string, amount: bigint) {
  const current = BigInt(target[asset] || "0");
  target[asset] = (current + amount).toString();
}

async function formatVolumeMap(target: Record<string, string>) {
  const formatted: Record<string, string> = {};
  for (const [asset, amount] of Object.entries(target)) {
    if (asset === "aggregate") {
      formatted[asset] = amount;
      continue;
    }
    const decimals = await decimalsFor(asset as `0x${string}`);
    formatted[asset] = formatUnits(BigInt(amount), decimals);
  }
  return formatted;
}

async function decimalsFor(asset: `0x${string}`) {
  if (asset === zeroAddress()) return 18;
  const cached = assetDecimals.get(asset);
  if (cached !== undefined) return cached;
  const decimals = await publicClient.readContract({
    address: asset,
    abi: erc20Abi,
    functionName: "decimals",
  });
  assetDecimals.set(asset, decimals);
  return decimals;
}

async function blockTimestamp(blockNumber: bigint) {
  const key = blockNumber.toString();
  const cached = blockTimestampCache.get(key);
  if (cached) return cached;
  const block = await publicClient.getBlock({ blockNumber });
  const timestamp = new Date(Number(block.timestamp) * 1000).toISOString().replace(/\.\d{3}Z$/, "Z");
  blockTimestampCache.set(key, timestamp);
  return timestamp;
}

async function averageReviewSeconds(agentAddress: string) {
  const durations: number[] = [];
  for (const order of workOrders.values()) {
    if (!order.worker || order.worker.toLowerCase() !== agentAddress.toLowerCase()) continue;
    if (!order.submittedBlock || !order.releasedBlock) continue;
    const [submitted, released] = await Promise.all([
      publicClient.getBlock({ blockNumber: order.submittedBlock }),
      publicClient.getBlock({ blockNumber: order.releasedBlock }),
    ]);
    durations.push(Number(released.timestamp - submitted.timestamp));
  }
  if (durations.length === 0) return null;
  return Math.round(durations.reduce((sum, item) => sum + item, 0) / durations.length);
}

function round(value: number) {
  return Math.round(value * 10000) / 10000;
}
