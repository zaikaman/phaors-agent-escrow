import "dotenv/config";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createPublicClient,
  createWalletClient,
  http,
  parseEther,
  parseUnits,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

export const networks = {
  "atlantic-testnet": {
    name: "atlantic-testnet",
    chainId: 688689,
    rpcUrl: "https://atlantic.dplabs-internal.com",
    explorerUrl: "https://atlantic.pharosscan.xyz",
    nativeToken: "PHRS",
  },
  mainnet: {
    name: "mainnet",
    chainId: 1672,
    rpcUrl: "https://rpc.pharos.xyz",
    explorerUrl: "https://www.pharosscan.xyz",
    nativeToken: "PROS",
  },
} as const;

export type NetworkName = keyof typeof networks;

export const escrowAbi = [
  {
    type: "event",
    name: "WorkOrderCreated",
    inputs: [
      { name: "id", type: "uint256", indexed: true },
      { name: "buyer", type: "address", indexed: true },
      { name: "worker", type: "address", indexed: true },
      { name: "verifier", type: "address", indexed: false },
      { name: "asset", type: "address", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
      { name: "deadline", type: "uint64", indexed: false },
      { name: "metadataURI", type: "string", indexed: false },
    ],
  },
  {
    type: "event",
    name: "WorkOrderAccepted",
    inputs: [
      { name: "id", type: "uint256", indexed: true },
      { name: "worker", type: "address", indexed: true },
    ],
  },
  {
    type: "event",
    name: "ProofSubmitted",
    inputs: [
      { name: "id", type: "uint256", indexed: true },
      { name: "worker", type: "address", indexed: true },
      { name: "proofURI", type: "string", indexed: false },
    ],
  },
  {
    type: "event",
    name: "PaymentReleased",
    inputs: [
      { name: "id", type: "uint256", indexed: true },
      { name: "worker", type: "address", indexed: true },
      { name: "asset", type: "address", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "WorkOrderRefunded",
    inputs: [
      { name: "id", type: "uint256", indexed: true },
      { name: "buyer", type: "address", indexed: true },
      { name: "asset", type: "address", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "event",
    name: "WorkOrderCancelled",
    inputs: [
      { name: "id", type: "uint256", indexed: true },
      { name: "buyer", type: "address", indexed: true },
      { name: "asset", type: "address", indexed: false },
      { name: "amount", type: "uint256", indexed: false },
    ],
  },
  {
    type: "function",
    name: "nextWorkOrderId",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
  {
    type: "function",
    name: "createWorkOrder",
    stateMutability: "payable",
    inputs: [
      { name: "worker", type: "address" },
      { name: "verifier", type: "address" },
      { name: "asset", type: "address" },
      { name: "amount", type: "uint256" },
      { name: "deadline", type: "uint64" },
      { name: "metadataURI", type: "string" },
    ],
    outputs: [{ name: "id", type: "uint256" }],
  },
  {
    type: "function",
    name: "acceptWorkOrder",
    stateMutability: "nonpayable",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "submitProof",
    stateMutability: "nonpayable",
    inputs: [
      { name: "id", type: "uint256" },
      { name: "proofURI", type: "string" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "releasePayment",
    stateMutability: "nonpayable",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "refundExpired",
    stateMutability: "nonpayable",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "cancelOpen",
    stateMutability: "nonpayable",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [],
  },
  {
    type: "function",
    name: "getWorkOrder",
    stateMutability: "view",
    inputs: [{ name: "id", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "buyer", type: "address" },
          { name: "worker", type: "address" },
          { name: "verifier", type: "address" },
          { name: "asset", type: "address" },
          { name: "amount", type: "uint256" },
          { name: "deadline", type: "uint64" },
          { name: "createdAt", type: "uint64" },
          { name: "acceptedAt", type: "uint64" },
          { name: "submittedAt", type: "uint64" },
          { name: "status", type: "uint8" },
          { name: "metadataURI", type: "string" },
          { name: "proofURI", type: "string" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "getAgentStats",
    stateMutability: "view",
    inputs: [{ name: "agent", type: "address" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "posted", type: "uint256" },
          { name: "accepted", type: "uint256" },
          { name: "submitted", type: "uint256" },
          { name: "completed", type: "uint256" },
          { name: "refunded", type: "uint256" },
          { name: "volumeReleased", type: "uint256" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "getAgentAssetVolumeReleased",
    stateMutability: "view",
    inputs: [
      { name: "agent", type: "address" },
      { name: "asset", type: "address" },
    ],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export const erc20Abi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "decimals",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint8" }],
  },
] as const;

export function parseArgs(argv = process.argv.slice(2)) {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      args[key] = true;
    } else {
      args[key] = next;
      i += 1;
    }
  }
  return args;
}

export function requireArg(args: Record<string, string | boolean>, key: string) {
  const value = args[key];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`Missing required --${key}`);
  }
  return value;
}

export function getNetwork(args: Record<string, string | boolean>) {
  const requested = (args.network || "atlantic-testnet") as NetworkName;
  const network = networks[requested];
  if (!network) {
    throw new Error(`Unknown network "${String(requested)}". Use atlantic-testnet or mainnet.`);
  }
  return network;
}

export function makeClients(args: Record<string, string | boolean>) {
  const network = getNetwork(args);
  const chain = {
    id: network.chainId,
    name: network.name,
    nativeCurrency: { name: network.nativeToken, symbol: network.nativeToken, decimals: 18 },
    rpcUrls: { default: { http: [network.rpcUrl] } },
  };
  const publicClient = createPublicClient({ chain, transport: http(network.rpcUrl) });

  const rawPrivateKey = process.env.PRIVATE_KEY || process.env.PHAROS_PRIVATE_KEY;
  const privateKey = rawPrivateKey?.startsWith("0x") ? rawPrivateKey : `0x${rawPrivateKey || ""}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(privateKey)) {
    throw new Error("Set PRIVATE_KEY or PHAROS_PRIVATE_KEY to a 32-byte hex private key. Do not hardcode it in scripts.");
  }

  const account = privateKeyToAccount(privateKey as `0x${string}`);
  const walletClient = createWalletClient({ account, chain, transport: http(network.rpcUrl) });
  return { account, chain, network, publicClient, walletClient };
}

export function makeReadClient(args: Record<string, string | boolean>) {
  const network = getNetwork(args);
  const chain = {
    id: network.chainId,
    name: network.name,
    nativeCurrency: { name: network.nativeToken, symbol: network.nativeToken, decimals: 18 },
    rpcUrls: { default: { http: [network.rpcUrl] } },
  };
  const publicClient = createPublicClient({ chain, transport: http(network.rpcUrl) });
  return { chain, network, publicClient };
}

export async function waitAndPrint(publicClient: ReturnType<typeof createPublicClient>, network: typeof networks[NetworkName], hash: `0x${string}`) {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  console.log(`tx: ${hash}`);
  console.log(`status: ${receipt.status}`);
  console.log(`explorer: ${network.explorerUrl}/tx/${hash}`);
  return receipt;
}

export function parseAmount(amount: string, decimals = 18) {
  return decimals === 18 ? parseEther(amount) : parseUnits(amount, decimals);
}

export function zeroAddress() {
  return "0x0000000000000000000000000000000000000000" as const;
}

export function loadDeploymentArtifact() {
  const artifactPath = join(process.cwd(), "out", "AgentWorkOrderEscrow.sol", "AgentWorkOrderEscrow.json");
  if (!existsSync(artifactPath)) {
    throw new Error("Missing Foundry artifact. Run `forge build` before deploy.");
  }
  const artifact = JSON.parse(readFileSync(artifactPath, "utf8"));
  return {
    abi: artifact.abi,
    bytecode: artifact.bytecode.object as `0x${string}`,
  };
}
