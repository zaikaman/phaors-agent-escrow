import { existsSync } from "node:fs";
import { delimiter, join } from "node:path";
import { spawnSync } from "node:child_process";

const command = process.argv[2];
if (!command) {
  throw new Error("Usage: tsx scripts/foundry.ts <build|test> [forge args...]");
}

const forge = findForge();
const result = spawnSync(forge, [command, ...process.argv.slice(3)], {
  stdio: "inherit",
  shell: false,
});

if (result.error) {
  throw result.error;
}
process.exit(result.status ?? 1);

function findForge() {
  const names = process.platform === "win32" ? ["forge.exe", "forge.cmd", "forge"] : ["forge"];
  const candidates = [
    ...pathCandidates(names),
    ...homeCandidates(names),
  ];

  const found = candidates.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error("Foundry forge was not found. Install Foundry or add forge to PATH.");
  }
  return found;
}

function pathCandidates(names: string[]) {
  const paths = (process.env.PATH || "").split(delimiter).filter(Boolean);
  return paths.flatMap((path) => names.map((name) => join(path, name)));
}

function homeCandidates(names: string[]) {
  const home = process.env.USERPROFILE || process.env.HOME;
  if (!home) return [];
  return names.map((name) => join(home, ".foundry", "bin", name));
}
