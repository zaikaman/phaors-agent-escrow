import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { parseArgs, requireArg } from "./config.js";
import {
  readJson,
  validateProofMetadata,
  validateTaskMetadata,
} from "./metadata-validation.js";

const args = parseArgs();
const kind = requireArg(args, "kind");
const input = requireArg(args, "input");
const outDir = (args["out-dir"] as string | undefined) || "demo-artifacts/hash-artifacts";
const name = (args.name as string | undefined) || basename(input).replace(/\.json$/i, "");

if (kind !== "task" && kind !== "proof") {
  throw new Error("--kind must be task or proof.");
}

const sourcePath = resolve(input);
const rawText = readFileSync(sourcePath, "utf8");
const json = JSON.parse(rawText) as unknown;

if (kind === "task") {
  validateTaskMetadata(json);
} else {
  validateProofMetadata(json);
}

const normalizedText = JSON.stringify(json, null, 2);
const canonicalText = JSON.stringify(json);
const sha256 = createHash("sha256").update(canonicalText).digest("hex");
const uri = `sha256:${sha256}`;
const targetDir = resolve(outDir);
const outputPath = join(targetDir, `${name}.${kind}.json`);
const manifestPath = join(targetDir, `${name}.${kind}.integrity.json`);

mkdirSync(targetDir, { recursive: true });
writeFileSync(outputPath, normalizedText);
writeFileSync(manifestPath, JSON.stringify({
  schema: "pharos-agent-escrow/integrity/v1",
  kind,
  source: sourcePath,
  artifact: outputPath,
  uri,
  sha256,
  hashMode: "sha256(JSON.stringify(json))",
  validated: true,
}, null, 2));

console.log(JSON.stringify({
  kind,
  source: sourcePath,
  artifact: outputPath,
  integrity: manifestPath,
  uri,
  sha256,
}, null, 2));
