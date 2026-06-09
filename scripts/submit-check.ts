import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

const args = process.argv.slice(2);
const escrow = readArg("escrow") || process.env.PHAROS_ESCROW_ADDRESS || "0x047119bdf422fc82021b88cf679ddeddd500f128";
const network = readArg("network") || "atlantic-testnet";
const quickValidate = process.env.SKILL_QUICK_VALIDATE ||
  join(process.env.USERPROFILE || "", ".codex", "skills", ".system", "skill-creator", "scripts", "quick_validate.py");

const commands: Array<{ label: string; command: string; args: string[] }> = [
  { label: "Solidity build", command: "npm", args: ["run", "build"] },
  { label: "Contract tests", command: "npm", args: ["test"] },
  { label: "TypeScript typecheck", command: "npx", args: ["tsc", "--noEmit"] },
  {
    label: "Task metadata schema",
    command: "npm",
    args: ["run", "validate-metadata", "--", "--kind", "task", "--file", ".\\assets\\templates\\task.metadata.json"],
  },
  {
    label: "Proof metadata schema",
    command: "npm",
    args: ["run", "validate-metadata", "--", "--kind", "proof", "--file", ".\\assets\\templates\\proof.metadata.json"],
  },
  { label: "Skill package validation", command: "python", args: [quickValidate, "."] },
  { label: "Agent command manifest", command: "npm", args: ["run", "agent-commands"] },
  { label: "Judge-mode live preflight", command: "npm", args: ["run", "doctor", "--", "--network", network, "--escrow", escrow] },
];

if (!existsSync(quickValidate)) {
  throw new Error(`Missing skill validator at ${quickValidate}. Set SKILL_QUICK_VALIDATE to the validator path.`);
}

console.log("Pharos Agent Escrow submit check");
console.log(`network: ${network}`);
console.log(`escrow: ${escrow}`);

for (const item of commands) {
  console.log(`\n== ${item.label} ==`);
  const command = resolveCommand(item.command, item.args);
  const result = spawnSync(command.command, command.args, {
    cwd: process.cwd(),
    env: process.env,
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.exitCode = result.status || 1;
    throw new Error(`${item.label} failed with exit code ${process.exitCode}.`);
  }
}

console.log("\nSubmit check passed.");

function readArg(name: string) {
  const flag = `--${name}`;
  const index = args.indexOf(flag);
  if (index === -1) return undefined;
  const value = args[index + 1];
  return value && !value.startsWith("--") ? value : undefined;
}

function resolveCommand(command: string, args: string[]) {
  if (process.platform !== "win32") return { command, args };
  if (command === "npm" || command === "npx") {
    return {
      command: process.env.ComSpec || "cmd.exe",
      args: ["/d", "/s", "/c", command, ...args],
    };
  }
  return { command, args };
}
