import { readFileSync } from "node:fs";
import { join } from "node:path";

const manifestPath = join(process.cwd(), "assets", "agent-command.manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));

console.log(JSON.stringify(manifest, null, 2));
