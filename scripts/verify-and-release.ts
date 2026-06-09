import "dotenv/config";
import { createHash } from "node:crypto";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  escrowAbi,
  makeClientsFromPrivateKey,
  parseArgs,
  requireArg,
  waitAndPrint,
  zeroAddress,
} from "./config.js";

type JsonObject = Record<string, unknown>;

type CriterionDecision = {
  criterion: string;
  passed: boolean;
  evidence: string;
};

type VerifierDecision = {
  releasePayment: boolean;
  rationale: string;
  criteriaResults: CriterionDecision[];
  outputFormatSatisfied: boolean;
  artifactEvidenceSufficient: boolean;
  riskFlags: string[];
};

const statuses = ["None", "Open", "Accepted", "Submitted", "Released", "Refunded", "Cancelled"];
const args = parseArgs();
const escrowAddress = requireArg(args, "escrow") as `0x${string}`;
const id = BigInt(requireArg(args, "id"));
const releaseEnv = (args["release-env"] as string | undefined) || "PHAROS_PRIVATE_KEY_3";
const dryRun = Boolean(args["dry-run"]);
const ipfsGateway = (args["ipfs-gateway"] as string | undefined) || "https://ipfs.io/ipfs/";

const verifier = makeClientsFromPrivateKey(args, releaseEnv);
const { account, network, publicClient, walletClient } = verifier;

function sha256Text(text: string) {
  return createHash("sha256").update(text).digest("hex");
}

function sha256Json(value: unknown) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function normalizeJsonText(value: unknown) {
  return JSON.stringify(value);
}

function readJsonFile(path: string) {
  const text = readFileSync(path, "utf8");
  return {
    path,
    text,
    json: JSON.parse(text) as JsonObject,
  };
}

function findJsonByHash(root: string, hash: string): { path: string; text: string; json: JsonObject } | undefined {
  if (!existsSync(root)) return undefined;
  for (const name of readdirSync(root)) {
    const fullPath = join(root, name);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) {
      const found = findJsonByHash(fullPath, hash);
      if (found) return found;
    } else if (stat.isFile() && fullPath.endsWith(".json")) {
      const candidate = readJsonFile(fullPath);
      if (sha256Text(normalizeJsonText(candidate.json)) === hash || sha256Text(candidate.text) === hash) {
        return candidate;
      }
    }
  }
  return undefined;
}

async function fetchText(uri: string) {
  const response = await fetch(uri);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${uri}: HTTP ${response.status} ${await response.text()}`);
  }
  return response.text();
}

async function loadJsonFromUri(uri: string, kind: "metadata" | "proof", explicitPath?: string) {
  if (explicitPath) {
    const candidate = readJsonFile(resolve(explicitPath));
    verifyHashUri(uri, candidate.json, candidate.text, kind);
    return { source: candidate.path, json: candidate.json };
  }

  if (uri.startsWith("sha256:")) {
    const hash = uri.slice("sha256:".length);
    const found = findJsonByHash(join(process.cwd(), "demo-artifacts"), hash);
    if (!found) {
      throw new Error(
        `${kind} uses ${uri}, but no matching JSON was found under demo-artifacts/. Pass --${kind}-file <path>.`
      );
    }
    return { source: found.path, json: found.json };
  }

  if (uri.startsWith("file://")) {
    const candidate = readJsonFile(fileURLToPath(uri));
    return { source: candidate.path, json: candidate.json };
  }

  if (uri.startsWith("ipfs://")) {
    const ipfsPath = uri.slice("ipfs://".length);
    const text = await fetchText(`${ipfsGateway.replace(/\/?$/, "/")}${ipfsPath}`);
    return { source: uri, json: JSON.parse(text) as JsonObject };
  }

  if (uri.startsWith("https://") || uri.startsWith("http://")) {
    const text = await fetchText(uri);
    return { source: uri, json: JSON.parse(text) as JsonObject };
  }

  const candidate = readJsonFile(resolve(uri));
  return { source: candidate.path, json: candidate.json };
}

function verifyHashUri(uri: string, json: unknown, rawText: string, kind: string) {
  if (!uri.startsWith("sha256:")) return;
  const expected = uri.slice("sha256:".length);
  const normalizedHash = sha256Text(normalizeJsonText(json));
  const rawHash = sha256Text(rawText);
  if (expected !== normalizedHash && expected !== rawHash) {
    throw new Error(`${kind} file hash mismatch for ${uri}.`);
  }
}

function requireString(value: unknown, field: string) {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Missing required string field: ${field}`);
  }
  return value.trim();
}

function requireStringArray(value: unknown, field: string) {
  if (!Array.isArray(value) || value.length === 0 || value.some((item) => typeof item !== "string" || item.trim().length === 0)) {
    throw new Error(`Missing required non-empty string array field: ${field}`);
  }
  return value.map((item) => String(item).trim());
}

function validateTaskMetadata(metadata: JsonObject) {
  const title = requireString(metadata.title, "metadata.title");
  const objective = requireString(metadata.objective, "metadata.objective");
  const acceptanceCriteria = requireStringArray(metadata.acceptanceCriteria, "metadata.acceptanceCriteria");
  const outputFormat = requireString(metadata.outputFormat, "metadata.outputFormat");
  const buyerAgent = requireString(metadata.buyerAgent, "metadata.buyerAgent");
  const workerAgent = requireString(metadata.workerAgent, "metadata.workerAgent");
  const verifierAgent = requireString(metadata.verifierAgent, "metadata.verifierAgent");
  return { title, objective, acceptanceCriteria, outputFormat, buyerAgent, workerAgent, verifierAgent };
}

function validateProof(proof: JsonObject) {
  const summary = typeof proof.summary === "string" ? proof.summary : requireString(proof.resultSummary, "proof.summary or proof.resultSummary");
  const resultURI = typeof proof.resultURI === "string" ? proof.resultURI.trim() : undefined;
  const deliveredArtifact = typeof proof.deliveredArtifact === "string" ? proof.deliveredArtifact.trim() : undefined;
  const resultSha256 = typeof proof.resultSha256 === "string" ? proof.resultSha256.trim() : undefined;
  const criteriaResults = Array.isArray(proof.criteriaResults) ? proof.criteriaResults : undefined;
  const verificationNotes = Array.isArray(proof.verificationNotes) || typeof proof.verificationNotes === "string"
    ? proof.verificationNotes
    : undefined;

  if (!resultURI && !deliveredArtifact) {
    throw new Error("Proof must include either proof.resultURI or proof.deliveredArtifact.");
  }
  if (resultURI && !/^(ipfs:\/\/|https:\/\/|http:\/\/|file:\/\/|sha256:)/.test(resultURI)) {
    throw new Error("proof.resultURI must be ipfs://, https://, http://, file://, or sha256:.");
  }
  if (resultSha256 && !/^[0-9a-fA-F]{64}$/.test(resultSha256)) {
    throw new Error("proof.resultSha256 must be a 64-character hex SHA-256 digest.");
  }
  if (!criteriaResults && !verificationNotes) {
    throw new Error("Proof must include proof.criteriaResults or proof.verificationNotes.");
  }
  return { summary, resultURI, deliveredArtifact, resultSha256, criteriaResults, verificationNotes };
}

function extractJsonObject<T>(text: string): T {
  const trimmed = text.trim();
  try {
    return JSON.parse(trimmed) as T;
  } catch {
    const first = trimmed.indexOf("{");
    const last = trimmed.lastIndexOf("}");
    if (first === -1 || last === -1 || last <= first) {
      throw new Error(`Groq response did not contain JSON: ${trimmed.slice(0, 300)}`);
    }
    return JSON.parse(trimmed.slice(first, last + 1)) as T;
  }
}

function extractResponseText(body: unknown): string {
  if (typeof body !== "object" || body === null) return "";
  const response = body as { output_text?: unknown; output?: unknown };
  if (typeof response.output_text === "string") return response.output_text;
  if (!Array.isArray(response.output)) return "";
  const chunks: string[] = [];
  for (const item of response.output) {
    if (typeof item !== "object" || item === null) continue;
    const message = item as { content?: unknown };
    if (!Array.isArray(message.content)) continue;
    for (const content of message.content) {
      if (typeof content !== "object" || content === null) continue;
      const part = content as { text?: unknown };
      if (typeof part.text === "string") chunks.push(part.text);
    }
  }
  return chunks.join("\n").trim();
}

function validateDecision(decision: VerifierDecision, requiredCriteria: string[]) {
  if (typeof decision.releasePayment !== "boolean") throw new Error("Verifier decision missing releasePayment boolean.");
  if (typeof decision.rationale !== "string" || decision.rationale.trim().length === 0) {
    throw new Error("Verifier decision missing rationale.");
  }
  if (!Array.isArray(decision.criteriaResults) || decision.criteriaResults.length < requiredCriteria.length) {
    throw new Error("Verifier decision did not evaluate every acceptance criterion.");
  }
  if (typeof decision.outputFormatSatisfied !== "boolean") throw new Error("Verifier decision missing outputFormatSatisfied.");
  if (typeof decision.artifactEvidenceSufficient !== "boolean") throw new Error("Verifier decision missing artifactEvidenceSufficient.");
  if (!Array.isArray(decision.riskFlags)) throw new Error("Verifier decision missing riskFlags array.");
}

async function callGroqVerifier(metadata: unknown, proof: unknown) {
  const apiKey = process.env.GROQ_API_KEY;
  if (!apiKey) throw new Error("Set GROQ_API_KEY before running verify-and-release.");

  const response = await fetch("https://api.groq.com/openai/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "qwen/qwen3-32b",
      temperature: 0.1,
      input: `You are a strict Verifier Agent for a Pharos on-chain escrow.
Return only valid JSON with keys:
releasePayment boolean,
rationale string,
criteriaResults array of {criterion string, passed boolean, evidence string},
outputFormatSatisfied boolean,
artifactEvidenceSufficient boolean,
riskFlags string[].

Release only if every acceptance criterion is satisfied, the requested output format is respected, and artifact evidence is sufficient.

Task metadata:
${JSON.stringify(metadata, null, 2)}

Worker proof:
${JSON.stringify(proof, null, 2)}`,
    }),
  });

  if (!response.ok) {
    throw new Error(`Groq verifier failed with HTTP ${response.status}: ${await response.text()}`);
  }
  const text = extractResponseText(await response.json());
  if (!text) throw new Error("Groq verifier returned no text output.");
  return extractJsonObject<VerifierDecision>(text);
}

console.log("Pharos Agent Escrow verifier policy");
console.log(`network: ${network.name} (${network.chainId})`);
console.log(`verifier account: ${account.address}`);
console.log(`escrow: ${escrowAddress}`);
console.log(`workOrderId: ${id}`);

const order = await publicClient.readContract({
  address: escrowAddress,
  abi: escrowAbi,
  functionName: "getWorkOrder",
  args: [id],
});

const status = statuses[Number(order.status)] || `Unknown(${Number(order.status)})`;
console.log(`status: ${status}`);
console.log(`metadataURI: ${order.metadataURI}`);
console.log(`proofURI: ${order.proofURI}`);

if (order.status !== 3 && !dryRun) {
  throw new Error(`Work order must be Submitted before release. Current status: ${status}. Use --dry-run to validate without releasing.`);
}
if (order.verifier !== zeroAddress() && order.verifier.toLowerCase() !== account.address.toLowerCase() && order.buyer.toLowerCase() !== account.address.toLowerCase()) {
  throw new Error(`Account ${account.address} is not buyer or configured verifier for this work order.`);
}

const metadataFile = args["metadata-file"] as string | undefined;
const proofFile = args["proof-file"] as string | undefined;
const loadedMetadata = await loadJsonFromUri(order.metadataURI, "metadata", metadataFile);
const loadedProof = await loadJsonFromUri(order.proofURI, "proof", proofFile);
const normalizedTask = validateTaskMetadata(loadedMetadata.json);
const normalizedProof = validateProof(loadedProof.json);

console.log(`metadata source: ${loadedMetadata.source}`);
console.log(`proof source: ${loadedProof.source}`);
console.log(`task: ${normalizedTask.title}`);
console.log(`artifact mode: ${normalizedProof.resultURI ? "external-uri" : "inline-deliveredArtifact"}`);

const decision = await callGroqVerifier(loadedMetadata.json, loadedProof.json);
validateDecision(decision, normalizedTask.acceptanceCriteria);

const passedCriteria = decision.criteriaResults.filter((criterion) => criterion.passed).length;
console.log(`criteria passed: ${passedCriteria}/${normalizedTask.acceptanceCriteria.length}`);
console.log(`output format satisfied: ${decision.outputFormatSatisfied}`);
console.log(`artifact evidence sufficient: ${decision.artifactEvidenceSufficient}`);
console.log(`verifier decision: ${decision.releasePayment ? "release" : "reject"}`);
console.log(`rationale: ${decision.rationale}`);
if (decision.riskFlags.length > 0) {
  console.log(`risk flags: ${decision.riskFlags.join("; ")}`);
}

const shouldRelease =
  decision.releasePayment &&
  decision.outputFormatSatisfied &&
  decision.artifactEvidenceSufficient &&
  decision.criteriaResults.every((criterion) => criterion.passed);

if (!shouldRelease) {
  throw new Error("Verifier policy rejected release. Payment was not released.");
}

if (dryRun) {
  console.log("dry-run: validation passed; release transaction was not sent.");
} else {
  const hash = await walletClient.writeContract({
    address: escrowAddress,
    abi: escrowAbi,
    functionName: "releasePayment",
    args: [id],
    account,
  });
  await waitAndPrint(publicClient, network, hash);
}

console.log(JSON.stringify(
  {
    workOrderId: id.toString(),
    verifier: account.address,
    metadataHash: sha256Json(loadedMetadata.json),
    proofHash: sha256Json(loadedProof.json),
    released: !dryRun,
    dryRun,
    decision,
  },
  null,
  2
));
