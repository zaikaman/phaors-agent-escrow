import "dotenv/config";
import { createHash as createCryptoHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { formatEther } from "viem";
import {
  escrowAbi,
  makeClientsFromPrivateKey,
  parseAmount,
  parseArgs,
  requireArg,
  waitAndPrint,
  zeroAddress,
} from "./config.js";

type AgentRole = "Planner Agent" | "Worker Agent" | "Verifier Agent";

type PlannerTask = {
  title: string;
  objective: string;
  acceptanceCriteria: string[];
  outputFormat: string;
  buyerAgent: string;
  workerAgent: string;
  verifierAgent: string;
};

type WorkerProof = {
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
const amount = parseAmount((args.amount as string | undefined) || "0.001", 18);
const deadlineMinutes = Number((args["deadline-minutes"] as string | undefined) || "30");
if (!Number.isFinite(deadlineMinutes) || deadlineMinutes <= 0) {
  throw new Error("--deadline-minutes must be a positive number");
}

const planner = makeClientsFromPrivateKey(args, "PHAROS_PRIVATE_KEY");
const worker = makeClientsFromPrivateKey(args, "PHAROS_PRIVATE_KEY_2");
const verifier = makeClientsFromPrivateKey(args, "PHAROS_PRIVATE_KEY_3");
const publicClient = planner.publicClient;
const network = planner.network;
const deadline = BigInt(Math.floor(Date.now() / 1000) + Math.floor(deadlineMinutes * 60));
const taskBrief = (args.task as string | undefined) ||
  "Produce a concise judge-facing explanation of why on-chain escrow matters for AI agent work markets on Pharos.";

function sha256Json(value: unknown) {
  return createCryptoHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function hashUri(hash: string) {
  return `sha256:${hash}`;
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

function validatePlannerTask(task: PlannerTask) {
  if (!task.title || !task.objective || !Array.isArray(task.acceptanceCriteria) || task.acceptanceCriteria.length < 3) {
    throw new Error("Planner Agent returned an invalid task shape.");
  }
  if (!task.outputFormat || !task.buyerAgent || !task.workerAgent || !task.verifierAgent) {
    throw new Error("Planner Agent omitted required task metadata.");
  }
}

function validateWorkerProof(proof: WorkerProof, task: PlannerTask) {
  if (!proof.resultSummary || !proof.deliveredArtifact || !Array.isArray(proof.criteriaResults)) {
    throw new Error("Worker Agent returned an invalid proof shape.");
  }
  if (proof.criteriaResults.length < task.acceptanceCriteria.length) {
    throw new Error("Worker Agent proof does not address every acceptance criterion.");
  }
}

function validateVerifierDecision(decision: VerifierDecision) {
  if (typeof decision.releasePayment !== "boolean" || !decision.rationale || !Array.isArray(decision.failedCriteria)) {
    throw new Error("Verifier Agent returned an invalid decision shape.");
  }
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

async function printBalances() {
  const [plannerBalance, workerBalance, verifierBalance] = await Promise.all([
    publicClient.getBalance({ address: planner.account.address }),
    publicClient.getBalance({ address: worker.account.address }),
    publicClient.getBalance({ address: verifier.account.address }),
  ]);

  console.log("wallets");
  console.log(`  Planner Agent:  ${planner.account.address} (${formatEther(plannerBalance)} ${network.nativeToken})`);
  console.log(`  Worker Agent:   ${worker.account.address} (${formatEther(workerBalance)} ${network.nativeToken})`);
  console.log(`  Verifier Agent: ${verifier.account.address} (${formatEther(verifierBalance)} ${network.nativeToken})`);

  if (plannerBalance <= amount) {
    throw new Error(`Planner Agent balance must exceed escrow amount ${formatEther(amount)} ${network.nativeToken}.`);
  }
  if (workerBalance === 0n) {
    throw new Error("Worker Agent needs native token for accept and submit gas.");
  }
  if (verifierBalance === 0n) {
    throw new Error("Verifier Agent needs native token for release gas.");
  }
}

console.log("Pharos Agent Escrow judge demo");
console.log(`network: ${network.name} (${network.chainId})`);
console.log(`escrow: ${escrowAddress}`);
console.log(`amount: ${formatEther(amount)} ${network.nativeToken}`);
await printBalances();

console.log("\n1. Planner Agent creates task metadata with Groq");
const task = await callGroq<PlannerTask>(
  "Planner Agent",
  `You are Planner Agent for a Pharos on-chain work-order escrow demo.
Return only valid JSON with keys title, objective, acceptanceCriteria, outputFormat, buyerAgent, workerAgent, verifierAgent.
Use at least 3 concrete acceptanceCriteria.
Buyer wallet: ${planner.account.address}
Worker wallet: ${worker.account.address}
Verifier wallet: ${verifier.account.address}
Task brief: ${taskBrief}`
);
validatePlannerTask(task);
const taskHash = sha256Json(task);
const metadataURI = hashUri(taskHash);
console.log(`  task: ${task.title}`);
console.log(`  metadataURI: ${metadataURI}`);

const id = await publicClient.readContract({
  address: escrowAddress,
  abi: escrowAbi,
  functionName: "nextWorkOrderId",
});

const createTxHash = await planner.walletClient.writeContract({
  address: escrowAddress,
  abi: escrowAbi,
  functionName: "createWorkOrder",
  args: [worker.account.address, verifier.account.address, zeroAddress(), amount, deadline, metadataURI],
  account: planner.account,
  value: amount,
});
await waitAndPrint(publicClient, network, createTxHash);

console.log("\n2. Worker Agent accepts the paid task");
const acceptHash = await worker.walletClient.writeContract({
  address: escrowAddress,
  abi: escrowAbi,
  functionName: "acceptWorkOrder",
  args: [id],
  account: worker.account,
});
await waitAndPrint(publicClient, network, acceptHash);

console.log("\n3. Worker Agent performs the task with Groq and submits proof");
const proof = await callGroq<WorkerProof>(
  "Worker Agent",
  `You are Worker Agent completing this paid Pharos task.
Return only valid JSON with keys resultSummary, deliveredArtifact, criteriaResults, verificationNotes.
criteriaResults must be an array of objects with criterion, evidence, and passed.
Task metadata JSON:
${JSON.stringify(task, null, 2)}`
);
validateWorkerProof(proof, task);
const proofHash = sha256Json(proof);
const proofURI = hashUri(proofHash);
console.log(`  proofURI: ${proofURI}`);

const submitHash = await worker.walletClient.writeContract({
  address: escrowAddress,
  abi: escrowAbi,
  functionName: "submitProof",
  args: [id, proofURI],
  account: worker.account,
});
await waitAndPrint(publicClient, network, submitHash);

console.log("\n4. Verifier Agent checks metadata/proof with Groq and releases payment");
const decision = await callGroq<VerifierDecision>(
  "Verifier Agent",
  `You are Verifier Agent for an on-chain Pharos escrow.
Return only valid JSON with keys releasePayment, rationale, failedCriteria.
Set releasePayment true only if the proof satisfies the task acceptance criteria.
Task hash URI: ${metadataURI}
Proof hash URI: ${proofURI}
Task metadata JSON:
${JSON.stringify(task, null, 2)}
Worker proof JSON:
${JSON.stringify(proof, null, 2)}`
);
validateVerifierDecision(decision);
console.log(`  verifier decision: ${decision.releasePayment ? "release" : "reject"}`);
console.log(`  rationale: ${decision.rationale}`);
if (!decision.releasePayment) {
  throw new Error(`Verifier Agent rejected proof: ${decision.failedCriteria.join(", ") || "no failed criteria supplied"}`);
}

const releaseHash = await verifier.walletClient.writeContract({
  address: escrowAddress,
  abi: escrowAbi,
  functionName: "releasePayment",
  args: [id],
  account: verifier.account,
});
await waitAndPrint(publicClient, network, releaseHash);

console.log("\n5. Reputation Agent summarizes worker history");
const [order, stats, assetVolume] = await Promise.all([
  publicClient.readContract({
    address: escrowAddress,
    abi: escrowAbi,
    functionName: "getWorkOrder",
    args: [id],
  }),
  publicClient.readContract({
    address: escrowAddress,
    abi: escrowAbi,
    functionName: "getAgentStats",
    args: [worker.account.address],
  }),
  publicClient.readContract({
    address: escrowAddress,
    abi: escrowAbi,
    functionName: "getAgentAssetVolumeReleased",
    args: [worker.account.address, zeroAddress()],
  }),
]);
const accepted = Number(stats.accepted);
const completed = Number(stats.completed);
const completionRate = accepted === 0 ? null : completed / accepted;

const artifactDir = join(process.cwd(), "demo-artifacts", id.toString());
mkdirSync(artifactDir, { recursive: true });
writeFileSync(join(artifactDir, "task.json"), JSON.stringify(task, null, 2));
writeFileSync(join(artifactDir, "proof.json"), JSON.stringify(proof, null, 2));
writeFileSync(join(artifactDir, "verifier-decision.json"), JSON.stringify(decision, null, 2));

console.log(JSON.stringify(
  {
    workOrderId: id.toString(),
    finalStatus: Number(order.status),
    planner: planner.account.address,
    worker: worker.account.address,
    verifier: verifier.account.address,
    metadataURI: order.metadataURI,
    proofURI: order.proofURI,
    explorer: `${network.explorerUrl}/address/${escrowAddress}`,
    workerReputation: {
      accepted: stats.accepted.toString(),
      submitted: stats.submitted.toString(),
      completed: stats.completed.toString(),
      refunded: stats.refunded.toString(),
      completionRate,
      nativeVolumeReleased: assetVolume.toString(),
    },
    localArtifacts: artifactDir,
  },
  null,
  2
));
