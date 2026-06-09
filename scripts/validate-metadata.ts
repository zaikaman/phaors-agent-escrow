import { parseArgs, requireArg } from "./config.js";
import { readJson, validateMetadata, type MetadataKind } from "./metadata-validation.js";

const args = parseArgs();
const kind = requireArg(args, "kind") as MetadataKind;
const file = requireArg(args, "file");

if (kind !== "task" && kind !== "proof") {
  throw new Error("--kind must be task or proof.");
}

const json = readJson(file);
validateMetadata(kind, json);

console.log(JSON.stringify(
  {
    valid: true,
    kind,
    file,
  },
  null,
  2
));
