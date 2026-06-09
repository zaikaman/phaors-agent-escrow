import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import Ajv, { type ErrorObject } from "ajv/dist/2020.js";

export type JsonObject = Record<string, unknown>;
export type MetadataKind = "task" | "proof";

export type TaskMetadata = {
  schema: "pharos-agent-escrow/task/v1";
  title: string;
  buyerAgent: string;
  workerAgent: string;
  verifierAgent: string;
  objective: string;
  acceptanceCriteria: string[];
  outputFormat: string;
  workDeadline: string;
  reviewDeadline: string;
  artifactPolicy: {
    storeResultAt?: string;
    includeSha256: boolean;
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export type ProofMetadata = {
  schema: "pharos-agent-escrow/proof/v1";
  workOrderId: string;
  workerAgent: string;
  resultURI?: string;
  deliveredArtifact?: string;
  resultSha256?: string;
  summary: string;
  criteriaResults?: Array<{
    criterion: string;
    evidence: string;
    passed: boolean;
    [key: string]: unknown;
  }>;
  verificationNotes?: string | string[];
  submittedAt: string;
  [key: string]: unknown;
};

const ajv = new Ajv({ allErrors: true, strict: true, strictRequired: false });
const taskSchema = JSON.parse(readFileSync(resolve("assets", "schemas", "task.schema.json"), "utf8"));
const proofSchema = JSON.parse(readFileSync(resolve("assets", "schemas", "proof.schema.json"), "utf8"));
const validateTaskSchema = ajv.compile<TaskMetadata>(taskSchema);
const validateProofSchema = ajv.compile<ProofMetadata>(proofSchema);

export function readJson(path: string) {
  const text = readFileSync(path, "utf8");
  return JSON.parse(text) as unknown;
}

export function validateMetadata(kind: MetadataKind, value: unknown) {
  if (kind === "task") {
    return validateTaskMetadata(value);
  }
  return validateProofMetadata(value);
}

export function validateTaskMetadata(value: unknown) {
  if (!validateTaskSchema(value)) {
    throw new Error(formatSchemaErrors("task metadata", validateTaskSchema.errors));
  }
  const workDeadline = Date.parse(value.workDeadline);
  const reviewDeadline = Date.parse(value.reviewDeadline);
  if (!Number.isFinite(workDeadline) || !Number.isFinite(reviewDeadline)) {
    throw new Error("Invalid task metadata: workDeadline and reviewDeadline must be valid UTC timestamps.");
  }
  if (reviewDeadline <= workDeadline) {
    throw new Error("Invalid task metadata: reviewDeadline must be after workDeadline.");
  }
  return value;
}

export function validateProofMetadata(value: unknown) {
  if (!validateProofSchema(value)) {
    throw new Error(formatSchemaErrors("proof metadata", validateProofSchema.errors));
  }
  if (!value.criteriaResults && !value.verificationNotes) {
    throw new Error("Invalid proof metadata: include criteriaResults or verificationNotes.");
  }
  return value;
}

function formatSchemaErrors(label: string, errors: ErrorObject[] | null | undefined) {
  const details = (errors || []).map((error) => {
    const path = error.instancePath || "/";
    return `${path} ${error.message || "is invalid"}`;
  });
  return `Invalid ${label}:\n${details.map((detail) => `- ${detail}`).join("\n")}`;
}
