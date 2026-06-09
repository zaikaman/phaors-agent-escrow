import "dotenv/config";
import { formatEther, formatUnits } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import {
  erc20Abi,
  escrowAbi,
  getNetwork,
  makeReadClient,
  parseArgs,
  zeroAddress,
} from "./config.js";
import {
  readJson,
  validateProofMetadata,
  validateTaskMetadata,
} from "./metadata-validation.js";

type CheckStatus = "pass" | "warn" | "fail";

type Check = {
  name: string;
  status: CheckStatus;
  details: Record<string, unknown>;
};

const args = parseArgs();
const network = getNetwork(args);
const escrowAddress = args.escrow as `0x${string}` | undefined;
const mode = (args.mode as string | undefined) || "judge-usdc";
const requiredEnvNames =
  mode === "one-wallet" ? ["PHAROS_PRIVATE_KEY"] : ["PHAROS_PRIVATE_KEY", "PHAROS_PRIVATE_KEY_2", "PHAROS_PRIVATE_KEY_3"];
const requireGroq = mode !== "one-wallet" && !args["no-groq"];
const checks: Check[] = [];

if (!escrowAddress || !/^0x[0-9a-fA-F]{40}$/.test(escrowAddress)) {
  checks.push({
    name: "escrow-address",
    status: "fail",
    details: { reason: "Pass --escrow <deployed AgentWorkOrderEscrow address>." },
  });
} else {
  checks.push({
    name: "escrow-address",
    status: "pass",
    details: { escrow: escrowAddress },
  });
}

const { publicClient } = makeReadClient(args);

await runCheck("rpc", async () => {
  const [chainId, blockNumber] = await Promise.all([
    publicClient.getChainId(),
    publicClient.getBlockNumber(),
  ]);
  return {
    status: chainId === network.chainId ? "pass" : "fail",
    details: {
      network: network.name,
      expectedChainId: network.chainId,
      actualChainId: chainId,
      latestBlock: blockNumber.toString(),
      rpcUrl: network.rpcUrl,
    },
  };
});

if (escrowAddress && /^0x[0-9a-fA-F]{40}$/.test(escrowAddress)) {
  await runCheck("deployed-contract", async () => {
    const [code, nextWorkOrderId] = await Promise.all([
      publicClient.getCode({ address: escrowAddress }),
      publicClient.readContract({
        address: escrowAddress,
        abi: escrowAbi,
        functionName: "nextWorkOrderId",
      }),
    ]);
    return {
      status: code && code !== "0x" ? "pass" : "fail",
      details: {
        escrow: escrowAddress,
        hasBytecode: Boolean(code && code !== "0x"),
        nextWorkOrderId: nextWorkOrderId.toString(),
        explorer: `${network.explorerUrl}/address/${escrowAddress}`,
      },
    };
  });
}

const walletReports: Array<Record<string, unknown>> = [];
for (const envName of requiredEnvNames) {
  const raw = process.env[envName];
  const normalized = raw?.startsWith("0x") ? raw : `0x${raw || ""}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
    walletReports.push({
      env: envName,
      configured: false,
      status: "fail",
      reason: "Missing or invalid 32-byte hex private key.",
    });
    continue;
  }

  const account = privateKeyToAccount(normalized as `0x${string}`);
  const nativeBalance = await publicClient.getBalance({ address: account.address });
  walletReports.push({
    env: envName,
    configured: true,
    address: account.address,
    nativeBalance: formatEther(nativeBalance),
    nativeToken: network.nativeToken,
    status: nativeBalance > 0n ? "pass" : "fail",
  });
}

checks.push({
  name: "wallet-env-and-gas",
  status: walletReports.every((wallet) => wallet.status === "pass") ? "pass" : "fail",
  details: { wallets: walletReports },
});

if (network.usdcAddress) {
  await runCheck("usdc", async () => {
    const decimals = await publicClient.readContract({
      address: network.usdcAddress as `0x${string}`,
      abi: erc20Abi,
      functionName: "decimals",
    });
    const planner = walletReports.find((wallet) => wallet.env === "PHAROS_PRIVATE_KEY");
    const plannerAddress = planner?.address as `0x${string}` | undefined;
    const balance = plannerAddress
      ? await publicClient.readContract({
          address: network.usdcAddress as `0x${string}`,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [plannerAddress],
        })
      : 0n;
    return {
      status: mode === "judge-usdc" && balance <= 0n ? "fail" : "pass",
      details: {
        asset: network.usdcAddress,
        decimals,
        plannerBalance: formatUnits(balance, decimals),
        planner: plannerAddress || null,
      },
    };
  });
} else {
  checks.push({
    name: "usdc",
    status: mode === "judge-usdc" ? "fail" : "warn",
    details: { reason: `Network ${network.name} does not define a USDC address.` },
  });
}

checks.push({
  name: "groq-api-key",
  status: requireGroq ? (process.env.GROQ_API_KEY ? "pass" : "fail") : "warn",
  details: {
    required: requireGroq,
    configured: Boolean(process.env.GROQ_API_KEY),
  },
});

await runCheck("metadata-templates", async () => {
  validateTaskMetadata(readJson("assets/templates/task.metadata.json"));
  validateProofMetadata(readJson("assets/templates/proof.metadata.json"));
  return {
    status: "pass",
    details: {
      task: "assets/templates/task.metadata.json",
      proof: "assets/templates/proof.metadata.json",
    },
  };
});

const failed = checks.filter((check) => check.status === "fail");
const warned = checks.filter((check) => check.status === "warn");
const report = {
  ok: failed.length === 0,
  mode,
  network: network.name,
  nativeToken: network.nativeToken,
  escrow: escrowAddress || null,
  checks,
  summary: {
    passed: checks.filter((check) => check.status === "pass").length,
    warned: warned.length,
    failed: failed.length,
  },
};

console.log(JSON.stringify(report, null, 2));

if (failed.length > 0) {
  process.exitCode = 1;
}

async function runCheck(
  name: string,
  fn: () => Promise<{ status: CheckStatus; details: Record<string, unknown> }>,
) {
  try {
    checks.push({ name, ...(await fn()) });
  } catch (error) {
    checks.push({
      name,
      status: "fail",
      details: {
        reason: error instanceof Error ? error.message : String(error),
      },
    });
  }
}
