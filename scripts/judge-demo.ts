import "dotenv/config";
import { createHash as createCryptoHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { formatEther, formatUnits } from "viem";
import {
  erc20Abi,
  escrowAbi,
  makeClientsFromPrivateKey,
  parseAmount,
  parseArgs,
  requireArg,
  waitAndPrint,
  zeroAddress,
} from "./config.js";
import {
  validateProofMetadata,
  validateTaskMetadata,
  type ProofMetadata,
  type TaskMetadata,
} from "./metadata-validation.js";

type AgentRole = "Planner Agent" | "Worker Agent" | "Verifier Agent";

type PlannerTaskDraft = {
  title: string;
  objective: string;
  acceptanceCriteria: string[];
  outputFormat: string;
  buyerAgent: string;
  workerAgent: string;
  verifierAgent: string;
};

type WorkerProofDraft = {
  resultSummary: string;
  deliveredArtifact: string;
  criteriaResults: { criterion: string; evidence: string; passed: boolean }[];
  verificationNotes: string;
};

type VerifierDecision = {
  releasePayment: boolean;
  rationale: string;
  failedCriteria: string[];
};

const args = parseArgs();
const escrowAddress = requireArg(args, "escrow") as `0x${string}`;
const assetArg = (args.asset as string | undefined) || "native";
const workDeadlineMinutes = Number((args["work-deadline-minutes"] as string | undefined) || (args["deadline-minutes"] as string | undefined) || "30");
const reviewPeriodMinutes = Number((args["review-period-minutes"] as string | undefined) || "30");
if (!Number.isFinite(workDeadlineMinutes) || workDeadlineMinutes <= 0) {
  throw new Error("--work-deadline-minutes must be a positive number");
}
if (!Number.isFinite(reviewPeriodMinutes) || reviewPeriodMinutes <= 0) {
  throw new Error("--review-period-minutes must be a positive number");
}

const planner = makeClientsFromPrivateKey(args, "PHAROS_PRIVATE_KEY");
const worker = makeClientsFromPrivateKey(args, "PHAROS_PRIVATE_KEY_2");
const verifier = makeClientsFromPrivateKey(args, "PHAROS_PRIVATE_KEY_3");
const publicClient = planner.publicClient;
const network = planner.network;
const asset = resolveAsset(assetArg);
const assetDecimals = asset === zeroAddress()
  ? 18
  : await publicClient.readContract({
      address: asset,
      abi: erc20Abi,
      functionName: "decimals",
    });
const amount = parseAmount((args.amount as string | undefined) || defaultAmountForAsset(asset), assetDecimals);
const assetLabel = asset === zeroAddress()
  ? network.nativeToken
  : assetArg === "usdc"
    ? "USDC"
    : asset;
const now = Math.floor(Date.now() / 1000);
const workDeadline = BigInt(now + Math.floor(workDeadlineMinutes * 60));
const reviewDeadline = BigInt(now + Math.floor((workDeadlineMinutes + reviewPeriodMinutes) * 60));
const taskBrief = (args.task as string | undefined) ||
  "Produce a concise judge-facing explanation of why on-chain escrow matters for AI agent work markets on Pharos.";
const marketplaceMode = Boolean(args.marketplace) || Boolean(args["marketplace-transcript"]);
const transactions: Record<string, string> = {};
const rpcPauseMs = Number(process.env.PHAROS_RPC_PAUSE_MS || "2500");
const rpcWritePauseMs = Number(process.env.PHAROS_RPC_WRITE_PAUSE_MS || "15000");
const rpcWriteRetryCount = Number(process.env.PHAROS_RPC_WRITE_RETRY_COUNT || "5");

type BalanceSnapshot = {
  native: Record<string, string>;
  selectedAsset: Record<string, string> | null;
};

type ReputationSnapshot = {
  accepted: string;
  submitted: string;
  completed: string;
  refunded: string;
  completionRate: number | null;
  selectedAssetVolumeReleased: string;
  selectedAssetVolumeFormatted: string;
};

function sha256Json(value: unknown) {
  return createCryptoHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function hashUri(hash: string) {
  return `sha256:${hash}`;
}

function resolveAsset(requested: string) {
  if (requested === "native") return zeroAddress();
  if (requested === "usdc") {
    if (!network.usdcAddress) {
      throw new Error(`Network ${network.name} does not define a USDC address. Pass --asset <erc20Address>.`);
    }
    return network.usdcAddress as `0x${string}`;
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(requested)) {
    throw new Error("--asset must be native, usdc, or an ERC20 address.");
  }
  return requested as `0x${string}`;
}

function defaultAmountForAsset(resolvedAsset: `0x${string}`) {
  return resolvedAsset === zeroAddress() ? "0.001" : "1";
}

function extractJsonObject<T>(text: string): T {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const first = trimmed.indexOf("{");
    const last = trimmed.lastIndexOf("}");
    if (first === -1 || last === -1 || last <= first) {
      throw new Error(`Groq response did not contain a JSON object: ${trimmed.slice(0, 300)}`);
    }
    return JSON.parse(trimmed.slice(first, last + 1)) as T;
  }
}

function extractResponseText(body: unknown): string {
  if (typeof body !== "object" || body === null) {
    return "";
  }
  const response = body as {
    output_text?: unknown;
    output?: unknown;
  };
  if (typeof response.output_text === "string") {
    return response.output_text;
  }
  if (!Array.isArray(response.output)) {
    return "";
  }

  const chunks: string[] = [];
  for (const item of response.output) {
    if (typeof item !== "object" || item === null) continue;
    const message = item as { content?: unknown };
    if (!Array.isArray(message.content)) continue;
    for (const content of message.content) {
      if (typeof content !== "object" || content === null) continue;
      const part = content as { text?: unknown };
      if (typeof part.text === "string") {
        chunks.push(part.text);
      }
    }
  }
  return chunks.join("\n").trim();
}

function validatePlannerTaskDraft(task: PlannerTaskDraft) {
  if (typeof task.title !== "string" || typeof task.objective !== "string" || !Array.isArray(task.acceptanceCriteria) || task.acceptanceCriteria.length < 3) {
    throw new Error("Planner Agent returned an invalid task shape.");
  }
  if (!task.acceptanceCriteria.every((criterion) => typeof criterion === "string" && criterion.length > 0)) {
    throw new Error("Planner Agent acceptanceCriteria must be non-empty strings.");
  }
  if (typeof task.outputFormat !== "string" || typeof task.buyerAgent !== "string" || typeof task.workerAgent !== "string" || typeof task.verifierAgent !== "string") {
    throw new Error("Planner Agent omitted required task metadata.");
  }
}

function validateWorkerProofDraft(proof: WorkerProofDraft, task: TaskMetadata) {
  if (typeof proof.resultSummary !== "string" || proof.deliveredArtifact === undefined || proof.deliveredArtifact === null || !Array.isArray(proof.criteriaResults)) {
    throw new Error("Worker Agent returned an invalid proof shape.");
  }
  if (proof.criteriaResults.length < task.acceptanceCriteria.length) {
    throw new Error("Worker Agent proof does not address every acceptance criterion.");
  }
  for (const result of proof.criteriaResults) {
    if (typeof result.criterion !== "string" || typeof result.evidence !== "string" || typeof result.passed !== "boolean") {
      throw new Error("Worker Agent criteriaResults must include criterion, evidence, and passed.");
    }
  }
}

function normalizeArtifact(value: unknown) {
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function validateVerifierDecision(decision: VerifierDecision) {
  if (typeof decision.releasePayment !== "boolean" || !decision.rationale || !Array.isArray(decision.failedCriteria)) {
    throw new Error("Verifier Agent returned an invalid decision shape.");
  }
  if (!decision.failedCriteria.every((criterion) => typeof criterion === "string")) {
    throw new Error("Verifier Agent failedCriteria must be strings.");
  }
}

function deterministicPlannerTask(): PlannerTaskDraft {
  return {
    title: "On-Chain Escrow for AI Agent Work Markets on Pharos",
    objective: taskBrief,
    acceptanceCriteria: [
      "Explain how on-chain escrow reduces counterparty risk for AI agent work.",
      "Describe how proof submission and verifier-controlled release protect buyers and workers.",
      "Connect the workflow to reusable Pharos agent marketplace composition.",
    ],
    outputFormat: "markdown",
    buyerAgent: `planner-${planner.account.address}`,
    workerAgent: `worker-${worker.account.address}`,
    verifierAgent: `verifier-${verifier.account.address}`,
  };
}

function deterministicWorkerProof(task: TaskMetadata): WorkerProofDraft {
  return {
    resultSummary: "Completed a concise markdown explanation of how Pharos on-chain escrow coordinates paid AI agent work with funded work orders, proof submission, verifier review, release, refunds, and reputation signals.",
    deliveredArtifact: [
      `# ${task.title}`,
      "",
      "On-chain escrow reduces counterparty risk by locking funds before work starts and releasing them only after proof is submitted and reviewed.",
      "The worker submits a content-addressed proof URI, while the buyer or verifier checks the proof against explicit acceptance criteria before release.",
      "The same work-order events can be reused by planner, worker, verifier, reputation, and marketplace agents to coordinate future Pharos tasks.",
    ].join("\n"),
    criteriaResults: task.acceptanceCriteria.map((criterion) => ({
      criterion,
      evidence: `Addressed in the delivered markdown artifact for work order ${id.toString()}.`,
      passed: true,
    })),
    verificationNotes: "Deterministic worker fallback produced schema-valid proof because the LLM response was unavailable or malformed.",
  };
}

function deterministicVerifierDecision(proof: ProofMetadata): VerifierDecision {
  const failedCriteria = (proof.criteriaResults || [])
    .filter((result) => !result.passed)
    .map((result) => result.criterion);
  return {
    releasePayment: failedCriteria.length === 0,
    rationale: failedCriteria.length === 0
      ? "All proof criteria are marked passed and the proof metadata is schema-valid, content-addressed, and tied to the work order."
      : "One or more proof criteria failed deterministic verification.",
    failedCriteria,
  };
}

async function recommendWorkerTranscript() {
  const stats = await publicClient.readContract({
    address: escrowAddress,
    abi: escrowAbi,
    functionName: "getAgentStats",
    args: [worker.account.address],
  });
  await pauseForRpc();
  const selectedAssetVolume = await publicClient.readContract({
    address: escrowAddress,
    abi: escrowAbi,
    functionName: "getAgentAssetVolumeReleased",
    args: [worker.account.address, asset],
  });
  const accepted = Number(stats.accepted);
  const completed = Number(stats.completed);
  const submitted = Number(stats.submitted);
  const completionRate = accepted === 0 ? 0 : completed / accepted;
  const submissionRate = accepted === 0 ? 0 : submitted / accepted;
  const volumeScore = Math.min(1, Math.log10(Number(formatUnits(selectedAssetVolume, assetDecimals)) + 1) / 3);
  const score = Math.round(100 * (completionRate * 0.45 + submissionRate * 0.25 + volumeScore * 0.2 + (accepted > 0 ? 0.1 : 0)));
  return {
    worker: worker.account.address,
    score,
    recommendation: score >= 75 ? "recommended" : score >= 50 ? "acceptable" : "selected-for-demo",
    reason: accepted === 0
      ? "No prior escrow history on this deployment; selected as the funded Worker Agent for a fresh marketplace task."
      : "Selected from on-chain completion, submission, and selected-asset volume signals.",
    scoreBreakdown: {
      completionRate,
      submissionRate,
      selectedAssetVolumeScore: Math.round(volumeScore * 100) / 100,
    },
    selectedAssetVolumeFormatted: formatUnits(selectedAssetVolume, assetDecimals),
  };
}

function rankCreatedWorkTranscript(workOrderId: bigint, metadata: TaskMetadata) {
  const secondsRemaining = Number(workDeadline - BigInt(Math.floor(Date.now() / 1000)));
  const hoursRemaining = Math.max(secondsRemaining / 3600, 0.01);
  const rewardScore = Math.min(45, Math.log10(Number(formatUnits(amount, assetDecimals)) + 1) * 18);
  const urgencyScore = Math.min(25, 25 / Math.sqrt(hoursRemaining));
  const trustScore = 30;
  const score = Math.round((rewardScore + urgencyScore + trustScore) * 100) / 100;
  return {
    workOrderId: workOrderId.toString(),
    score,
    recommendation: score >= 55 ? "high-priority" : score >= 35 ? "consider" : "low-priority",
    reason: "Designated worker, verifier configured, schema-valid content-addressed metadata, and funded reward.",
    scoreBreakdown: {
      reward: Math.round(rewardScore * 100) / 100,
      urgency: Math.round(urgencyScore * 100) / 100,
      trust: trustScore,
    },
    worker: worker.account.address,
    verifier: verifier.account.address,
    asset: asset === zeroAddress() ? "native" : asset,
    assetLabel,
    amount: formatUnits(amount, assetDecimals),
    metadataURI: hashUri(sha256Json(metadata)),
    acceptCommand: `npx tsx scripts/accept-submit-release.ts accept --network ${network.name} --escrow ${escrowAddress} --id ${workOrderId.toString()}`,
  };
}

async function callGroq<T>(role: AgentRole, prompt: string): Promise<T> {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("Set GROQ_API_KEY before running the judge demo.");
  }

  const response = await fetch("https://api.groq.com/openai/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "qwen/qwen3-32b",
      input: prompt,
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${role} Groq call failed with HTTP ${response.status}: ${body}`);
  }

  const body = await response.json();
  const text = extractResponseText(body);
  if (!text) {
    throw new Error(`${role} Groq response did not include text output.`);
  }
  return extractJsonObject<T>(text);
}

async function callGroqValidated<T>(role: AgentRole, prompt: string, validate: (value: T) => void): Promise<T> {
  const attempts = Number(process.env.GROQ_SHAPE_RETRY_COUNT || "3");
  let validationHint = "";
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const value = await callGroq<T>(
      role,
      `${prompt}
${validationHint}
Return only one JSON object. All string fields must be JSON strings, not arrays or objects.`
    );
    try {
      validate(value);
      return value;
    } catch (error) {
      if (attempt === attempts) throw error;
      validationHint = `Previous response failed validation: ${error instanceof Error ? error.message : String(error)}. Fix the shape exactly.`;
      console.log(`  ${role}: invalid JSON shape, retrying (${attempt}/${attempts})`);
    }
  }
  throw new Error(`${role} failed validation after ${attempts} attempts.`);
}

async function getBalanceSnapshot(): Promise<BalanceSnapshot> {
  const plannerBalance = await publicClient.getBalance({ address: planner.account.address });
  await pauseForRpc();
  const workerBalance = await publicClient.getBalance({ address: worker.account.address });
  await pauseForRpc();
  const verifierBalance = await publicClient.getBalance({ address: verifier.account.address });

  const native = {
    planner: formatEther(plannerBalance),
    worker: formatEther(workerBalance),
    verifier: formatEther(verifierBalance),
  };
  let selectedAsset: Record<string, string> | null = null;
  if (asset !== zeroAddress()) {
    await pauseForRpc();
    const plannerTokenBalance = await publicClient.readContract({
      address: asset,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [planner.account.address],
    });
    await pauseForRpc();
    const workerTokenBalance = await publicClient.readContract({
      address: asset,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [worker.account.address],
    });
    await pauseForRpc();
    const verifierTokenBalance = await publicClient.readContract({
      address: asset,
      abi: erc20Abi,
      functionName: "balanceOf",
      args: [verifier.account.address],
    });
    selectedAsset = {
      planner: formatUnits(plannerTokenBalance, assetDecimals),
      worker: formatUnits(workerTokenBalance, assetDecimals),
      verifier: formatUnits(verifierTokenBalance, assetDecimals),
    };
  }

  return { native, selectedAsset };
}

async function printBalances() {
  const snapshot = await getBalanceSnapshot();
  console.log("wallets");
  console.log(`  Planner Agent:  ${planner.account.address} (${snapshot.native.planner} ${network.nativeToken})`);
  console.log(`  Worker Agent:   ${worker.account.address} (${snapshot.native.worker} ${network.nativeToken})`);
  console.log(`  Verifier Agent: ${verifier.account.address} (${snapshot.native.verifier} ${network.nativeToken})`);

  if (asset === zeroAddress() && parseUnitsLike(snapshot.native.planner) <= amount) {
    throw new Error(`Planner Agent balance must exceed escrow amount ${formatEther(amount)} ${network.nativeToken}.`);
  }
  if (asset !== zeroAddress()) {
    console.log(`  Planner Agent ${assetLabel}: ${snapshot.selectedAsset?.planner}`);
    if (parseUnitsLike(snapshot.selectedAsset?.planner || "0", assetDecimals) < amount) {
      throw new Error(`Planner Agent needs at least ${formatUnits(amount, assetDecimals)} ${assetLabel}.`);
    }
    if (parseUnitsLike(snapshot.native.planner) === 0n) {
      throw new Error("Planner Agent needs native token for ERC20 approve and create gas.");
    }
  }
  if (parseUnitsLike(snapshot.native.worker) === 0n) {
    throw new Error("Worker Agent needs native token for accept and submit gas.");
  }
  if (parseUnitsLike(snapshot.native.verifier) === 0n) {
    throw new Error("Verifier Agent needs native token for release gas.");
  }
  return snapshot;
}

function parseUnitsLike(value: string, decimals = 18) {
  const [whole, fraction = ""] = value.split(".");
  const padded = `${fraction}${"0".repeat(decimals)}`.slice(0, decimals);
  return BigInt(whole || "0") * (10n ** BigInt(decimals)) + BigInt(padded || "0");
}

async function readWorkerReputation(): Promise<ReputationSnapshot> {
  const stats = await publicClient.readContract({
    address: escrowAddress,
    abi: escrowAbi,
    functionName: "getAgentStats",
    args: [worker.account.address],
  });
  await pauseForRpc();
  const assetVolume = await publicClient.readContract({
    address: escrowAddress,
    abi: escrowAbi,
    functionName: "getAgentAssetVolumeReleased",
    args: [worker.account.address, asset],
  });
  const accepted = Number(stats.accepted);
  const completed = Number(stats.completed);
  return {
    accepted: stats.accepted.toString(),
    submitted: stats.submitted.toString(),
    completed: stats.completed.toString(),
    refunded: stats.refunded.toString(),
    completionRate: accepted === 0 ? null : completed / accepted,
    selectedAssetVolumeReleased: assetVolume.toString(),
    selectedAssetVolumeFormatted: formatUnits(assetVolume, assetDecimals),
  };
}

function reputationDelta(before: ReputationSnapshot, after: ReputationSnapshot) {
  return {
    accepted: Number(after.accepted) - Number(before.accepted),
    submitted: Number(after.submitted) - Number(before.submitted),
    completed: Number(after.completed) - Number(before.completed),
    refunded: Number(after.refunded) - Number(before.refunded),
    selectedAssetVolumeReleased: (BigInt(after.selectedAssetVolumeReleased) - BigInt(before.selectedAssetVolumeReleased)).toString(),
    selectedAssetVolumeFormatted: formatUnits(
      BigInt(after.selectedAssetVolumeReleased) - BigInt(before.selectedAssetVolumeReleased),
      assetDecimals
    ),
  };
}

function buildMarkdownSummary(transcript: {
  generatedAt: string;
  workOrderId: string;
  finalStatus: number;
  network: string;
  escrow: string;
  actors: Record<string, string>;
  asset: string;
  assetLabel: string;
  amount: string;
  balances: { before: BalanceSnapshot; after: BalanceSnapshot };
  metadataURI: string;
  proofURI: string;
  verifierDecision: VerifierDecision;
  transactions: Record<string, string>;
  workerReputation: { delta: ReturnType<typeof reputationDelta> };
  localArtifacts: Record<string, string>;
}) {
  const selectedBefore = transcript.balances.before.selectedAsset;
  const selectedAfter = transcript.balances.after.selectedAsset;
  const txLines = Object.entries(transcript.transactions)
    .map(([name, url]) => `- ${name}: ${url}`)
    .join("\n");

  return `# Latest Pharos Agent Escrow Demo

Generated: ${transcript.generatedAt}

## Result

- Work order: ${transcript.workOrderId}
- Final status: ${transcript.finalStatus} (Released)
- Network: ${transcript.network}
- Escrow: ${transcript.escrow}
- Asset: ${transcript.amount} ${transcript.assetLabel} (${transcript.asset})
- Metadata URI: ${transcript.metadataURI}
- Proof URI: ${transcript.proofURI}

## Actors

- Planner Agent: ${transcript.actors.planner}
- Worker Agent: ${transcript.actors.worker}
- Verifier Agent: ${transcript.actors.verifier}

## Balances

| Account | Native Before | Native After | ${transcript.assetLabel} Before | ${transcript.assetLabel} After |
| --- | ---: | ---: | ---: | ---: |
| Planner | ${transcript.balances.before.native.planner} | ${transcript.balances.after.native.planner} | ${selectedBefore?.planner ?? "n/a"} | ${selectedAfter?.planner ?? "n/a"} |
| Worker | ${transcript.balances.before.native.worker} | ${transcript.balances.after.native.worker} | ${selectedBefore?.worker ?? "n/a"} | ${selectedAfter?.worker ?? "n/a"} |
| Verifier | ${transcript.balances.before.native.verifier} | ${transcript.balances.after.native.verifier} | ${selectedBefore?.verifier ?? "n/a"} | ${selectedAfter?.verifier ?? "n/a"} |

## Verifier Decision

- Decision: ${transcript.verifierDecision.releasePayment ? "release payment" : "reject proof"}
- Rationale: ${transcript.verifierDecision.rationale}

## Reputation Delta

- Accepted: ${transcript.workerReputation.delta.accepted}
- Submitted: ${transcript.workerReputation.delta.submitted}
- Completed: ${transcript.workerReputation.delta.completed}
- Refunded: ${transcript.workerReputation.delta.refunded}
- Selected asset volume released: ${transcript.workerReputation.delta.selectedAssetVolumeFormatted} ${transcript.assetLabel}

## Transactions

${txLines}

## Artifacts

- Transcript: ${transcript.localArtifacts.transcript}
- Task: ${transcript.localArtifacts.task}
- Proof: ${transcript.localArtifacts.proof}
- Verifier decision: ${transcript.localArtifacts.verifierDecision}
`;
}

async function pauseForRpc() {
  if (!Number.isFinite(rpcPauseMs) || rpcPauseMs <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, rpcPauseMs));
}

async function pauseForWriteRpc() {
  if (!Number.isFinite(rpcWritePauseMs) || rpcWritePauseMs <= 0) return;
  await new Promise((resolve) => setTimeout(resolve, rpcWritePauseMs));
}

async function sendWithRpcRetry(label: string, fn: () => Promise<`0x${string}`>, isAlreadyApplied?: () => Promise<boolean>) {
  const attempts = Number.isFinite(rpcWriteRetryCount) && rpcWriteRetryCount > 0 ? rpcWriteRetryCount : 5;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    await pauseForWriteRpc();
    try {
      return await fn();
    } catch (error) {
      if (isAlreadyApplied) {
        await pauseForRpc();
        try {
          if (await isAlreadyApplied()) {
            console.log(`  ${label}: transaction effect confirmed on-chain after RPC response loss`);
            return `recovered:${label}` as `0x${string}`;
          }
        } catch (recoverError) {
          if (!isRpcRateLimit(recoverError)) throw recoverError;
          console.log(`  ${label}: recovery check hit RPC quota; retrying send path`);
        }
      }
      if (!isRpcRateLimit(error) || attempt === attempts) {
        throw error;
      }
      const delayMs = Math.max(rpcWritePauseMs, 8000) * attempt;
      console.log(`  ${label}: RPC quota hit, retrying in ${Math.round(delayMs / 1000)}s (${attempt}/${attempts})`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error(`${label} failed after ${attempts} attempts.`);
}

function isRpcRateLimit(error: unknown) {
  const parts: string[] = [];
  const visit = (value: unknown, depth: number) => {
    if (depth > 5 || value === null || value === undefined) return;
    if (typeof value === "string" || typeof value === "number") {
      parts.push(String(value));
      return;
    }
    if (value instanceof Error) {
      parts.push(value.message, value.stack || "");
    }
    if (typeof value !== "object") return;
    const record = value as Record<string, unknown>;
    for (const key of ["details", "shortMessage", "message", "code", "data", "cause"]) {
      visit(record[key], depth + 1);
    }
  };
  visit(error, 0);
  const text = parts.join("\n");
  return text.includes("cu limit exceeded") || text.includes("Request too fast per second") || text.includes("-32011");
}

async function isAllowanceApplied() {
  if (asset === zeroAddress()) return true;
  const allowance = await publicClient.readContract({
    address: asset,
    abi: erc20Abi,
    functionName: "allowance",
    args: [planner.account.address, escrowAddress],
  });
  return allowance >= amount;
}

async function isWorkOrderStatus(expectedStatus: number, expectedProofURI?: string) {
  const current = await publicClient.readContract({
    address: escrowAddress,
    abi: escrowAbi,
    functionName: "getWorkOrder",
    args: [id],
  });
  if (Number(current.status) !== expectedStatus) return false;
  return expectedProofURI ? current.proofURI === expectedProofURI : true;
}

async function printRecoveredOrReceipt(hash: `0x${string}`) {
  if (hash.startsWith("recovered:")) {
    console.log(`tx: ${hash}`);
    console.log("status: recovered from on-chain state");
    return;
  }
  await waitAndPrint(publicClient, network, hash);
}

function txReference(hash: `0x${string}`) {
  return hash.startsWith("recovered:") ? hash : `${network.explorerUrl}/tx/${hash}`;
}

console.log("Pharos Agent Escrow judge demo");
console.log(`network: ${network.name} (${network.chainId})`);
console.log(`escrow: ${escrowAddress}`);
console.log(`asset: ${asset === zeroAddress() ? "native" : asset}`);
console.log(`amount: ${formatUnits(amount, assetDecimals)} ${assetLabel}`);
const balancesBefore = await printBalances();
const reputationBefore = await readWorkerReputation();

let marketplaceTranscript: Record<string, unknown> | undefined;
if (marketplaceMode) {
  console.log("\n0. Marketplace Agent recommends a worker from on-chain reputation");
  const workerRecommendation = await recommendWorkerTranscript();
  marketplaceTranscript = { workerRecommendation };
  console.log(JSON.stringify({ workerRecommendation }, null, 2));
}

console.log("\n1. Planner Agent creates task metadata with Groq");
let taskDraft: PlannerTaskDraft;
try {
  taskDraft = await callGroqValidated<PlannerTaskDraft>(
    "Planner Agent",
    `You are Planner Agent for a Pharos on-chain work-order escrow demo.
Return only valid JSON with keys title, objective, acceptanceCriteria, outputFormat, buyerAgent, workerAgent, verifierAgent.
Use at least 3 concrete acceptanceCriteria.
outputFormat must be a string, for example "markdown".
Buyer wallet: ${planner.account.address}
Worker wallet: ${worker.account.address}
Verifier wallet: ${verifier.account.address}
Task brief: ${taskBrief}`,
    validatePlannerTaskDraft
  );
} catch (error) {
  console.log(`  Planner Agent: using deterministic fallback after Groq validation failed: ${error instanceof Error ? error.message : String(error)}`);
  taskDraft = deterministicPlannerTask();
}
const task: TaskMetadata = {
  schema: "pharos-agent-escrow/task/v1",
  ...taskDraft,
  workDeadline: new Date(Number(workDeadline) * 1000).toISOString().replace(".000Z", "Z"),
  reviewDeadline: new Date(Number(reviewDeadline) * 1000).toISOString().replace(".000Z", "Z"),
  artifactPolicy: {
    storeResultAt: "sha256:local-demo-artifact",
    includeSha256: true,
  },
};
validateTaskMetadata(task);
const taskHash = sha256Json(task);
const metadataURI = hashUri(taskHash);
console.log(`  task: ${task.title}`);
console.log(`  metadataURI: ${metadataURI}`);

const id = await publicClient.readContract({
  address: escrowAddress,
  abi: escrowAbi,
  functionName: "nextWorkOrderId",
});

if (asset !== zeroAddress()) {
  console.log("\n1a. Planner Agent approves ERC20 escrow funding");
  const approveHash = await sendWithRpcRetry("ERC20 approve", () =>
    planner.walletClient.writeContract({
      address: asset,
      abi: erc20Abi,
      functionName: "approve",
      args: [escrowAddress, amount],
      account: planner.account,
    }),
    isAllowanceApplied
  );
  await printRecoveredOrReceipt(approveHash);
  transactions.erc20Approve = txReference(approveHash);
}

const createTxHash = await sendWithRpcRetry("createWorkOrder", () =>
  planner.walletClient.writeContract({
    address: escrowAddress,
    abi: escrowAbi,
    functionName: "createWorkOrder",
    args: [worker.account.address, verifier.account.address, asset, amount, workDeadline, reviewDeadline, metadataURI],
    account: planner.account,
    value: asset === zeroAddress() ? amount : 0n,
  }),
  () => isWorkOrderStatus(1)
);
await printRecoveredOrReceipt(createTxHash);
transactions.createWorkOrder = txReference(createTxHash);

if (marketplaceMode) {
  console.log("\n2. Worker Agent ranks the newly posted open work");
  const rankedWork = rankCreatedWorkTranscript(id, task);
  marketplaceTranscript = { ...(marketplaceTranscript || {}), rankedWork };
  console.log(JSON.stringify({ rankedWork }, null, 2));
}

console.log(`\n${marketplaceMode ? "3" : "2"}. Worker Agent accepts the paid task`);
const acceptHash = await sendWithRpcRetry("acceptWorkOrder", () =>
  worker.walletClient.writeContract({
    address: escrowAddress,
    abi: escrowAbi,
    functionName: "acceptWorkOrder",
    args: [id],
    account: worker.account,
  }),
  () => isWorkOrderStatus(2)
);
await printRecoveredOrReceipt(acceptHash);
transactions.acceptWorkOrder = txReference(acceptHash);

console.log(`\n${marketplaceMode ? "4" : "3"}. Worker Agent performs the task with Groq and submits proof`);
let proofDraft: WorkerProofDraft;
try {
  proofDraft = await callGroqValidated<WorkerProofDraft>(
    "Worker Agent",
    `You are Worker Agent completing this paid Pharos task.
Return only valid JSON with keys resultSummary, deliveredArtifact, criteriaResults, verificationNotes.
criteriaResults must be an array of objects with criterion, evidence, and passed.
Task metadata JSON:
${JSON.stringify(task, null, 2)}`,
    (value) => validateWorkerProofDraft(value, task)
  );
} catch (error) {
  console.log(`  Worker Agent: using deterministic fallback after Groq validation failed: ${error instanceof Error ? error.message : String(error)}`);
  proofDraft = deterministicWorkerProof(task);
}
const deliveredArtifact = normalizeArtifact(proofDraft.deliveredArtifact);
const proof: ProofMetadata = {
  schema: "pharos-agent-escrow/proof/v1",
  workOrderId: id.toString(),
  workerAgent: task.workerAgent,
  resultURI: hashUri(sha256Json(deliveredArtifact)),
  resultSha256: sha256Json(deliveredArtifact),
  deliveredArtifact,
  summary: proofDraft.resultSummary,
  criteriaResults: proofDraft.criteriaResults,
  verificationNotes: [
    proofDraft.verificationNotes,
    `Output format: ${task.outputFormat}`,
    "Artifact is content-addressed with SHA-256.",
  ],
  submittedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
};
validateProofMetadata(proof);
const proofHash = sha256Json(proof);
const proofURI = hashUri(proofHash);
console.log(`  proofURI: ${proofURI}`);

const submitHash = await sendWithRpcRetry("submitProof", () =>
  worker.walletClient.writeContract({
    address: escrowAddress,
    abi: escrowAbi,
    functionName: "submitProof",
    args: [id, proofURI],
    account: worker.account,
  }),
  () => isWorkOrderStatus(3, proofURI)
);
await printRecoveredOrReceipt(submitHash);
transactions.submitProof = txReference(submitHash);

console.log(`\n${marketplaceMode ? "5" : "4"}. Verifier Agent checks metadata/proof with Groq and releases payment`);
let decision: VerifierDecision;
try {
  decision = await callGroqValidated<VerifierDecision>(
    "Verifier Agent",
    `You are Verifier Agent for an on-chain Pharos escrow.
Return only valid JSON with keys releasePayment, rationale, failedCriteria.
Set releasePayment true only if the proof satisfies the task acceptance criteria.
Task hash URI: ${metadataURI}
Proof hash URI: ${proofURI}
Task metadata JSON:
${JSON.stringify(task, null, 2)}
Worker proof JSON:
${JSON.stringify(proof, null, 2)}`,
    validateVerifierDecision
  );
} catch (error) {
  console.log(`  Verifier Agent: using deterministic fallback after Groq validation failed: ${error instanceof Error ? error.message : String(error)}`);
  decision = deterministicVerifierDecision(proof);
}
console.log(`  verifier decision: ${decision.releasePayment ? "release" : "reject"}`);
console.log(`  rationale: ${decision.rationale}`);
if (!decision.releasePayment) {
  throw new Error(`Verifier Agent rejected proof: ${decision.failedCriteria.join(", ") || "no failed criteria supplied"}`);
}

const releaseHash = await sendWithRpcRetry("releasePayment", () =>
  verifier.walletClient.writeContract({
    address: escrowAddress,
    abi: escrowAbi,
    functionName: "releasePayment",
    args: [id],
    account: verifier.account,
  }),
  () => isWorkOrderStatus(4)
);
await printRecoveredOrReceipt(releaseHash);
transactions.releasePayment = txReference(releaseHash);

console.log(`\n${marketplaceMode ? "6" : "5"}. Reputation Agent summarizes worker history`);
const order = await publicClient.readContract({
  address: escrowAddress,
  abi: escrowAbi,
  functionName: "getWorkOrder",
  args: [id],
});
await pauseForRpc();
const balancesAfter = await getBalanceSnapshot();
await pauseForRpc();
const finalReputation = await readWorkerReputation();
const workerReputationDelta = reputationDelta(reputationBefore, finalReputation);
if (marketplaceMode) {
  marketplaceTranscript = {
    ...(marketplaceTranscript || {}),
    verification: {
      verifier: verifier.account.address,
      decision: decision.releasePayment ? "release" : "reject",
      rationale: decision.rationale,
    },
    finalReputation,
    workerReputationDelta,
    transactions,
  };
}

const artifactDir = join(process.cwd(), "demo-artifacts", id.toString());
mkdirSync(artifactDir, { recursive: true });
writeFileSync(join(artifactDir, "task.json"), JSON.stringify(task, null, 2));
writeFileSync(join(artifactDir, "proof.json"), JSON.stringify(proof, null, 2));
writeFileSync(join(artifactDir, "verifier-decision.json"), JSON.stringify(decision, null, 2));
const transcript = {
  schema: "pharos-agent-escrow/judge-transcript/v1",
  generatedAt: new Date().toISOString().replace(/\.\d{3}Z$/, "Z"),
  workOrderId: id.toString(),
  finalStatus: Number(order.status),
  network: network.name,
  escrow: escrowAddress,
  actors: {
    planner: planner.account.address,
    worker: worker.account.address,
    verifier: verifier.account.address,
  },
  asset: asset === zeroAddress() ? "native" : asset,
  assetLabel,
  amount: formatUnits(amount, assetDecimals),
  balances: {
    before: balancesBefore,
    after: balancesAfter,
  },
  metadataURI: order.metadataURI,
  proofURI: order.proofURI,
  hashes: {
    task: taskHash,
    proof: proofHash,
  },
  verifierDecision: decision,
  transactions,
  marketplaceTranscript: marketplaceTranscript || null,
  workerReputation: {
    before: reputationBefore,
    after: finalReputation,
    delta: workerReputationDelta,
  },
  explorer: `${network.explorerUrl}/address/${escrowAddress}`,
  localArtifacts: {
    directory: artifactDir,
    task: join(artifactDir, "task.json"),
    proof: join(artifactDir, "proof.json"),
    verifierDecision: join(artifactDir, "verifier-decision.json"),
    transcript: join(artifactDir, "judge-transcript.json"),
  },
};
const summary = buildMarkdownSummary(transcript);
const latestSummaryPath = join(process.cwd(), "demo-artifacts", "latest-summary.md");
const runSummaryPath = join(artifactDir, "summary.md");
writeFileSync(join(artifactDir, "judge-transcript.json"), JSON.stringify(transcript, null, 2));
writeFileSync(runSummaryPath, summary);
writeFileSync(latestSummaryPath, summary);

console.log(JSON.stringify(transcript, null, 2));
console.log(`latest summary: ${latestSummaryPath}`);
