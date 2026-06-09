import {
  erc20Abi,
  escrowAbi,
  makeClients,
  parseAmount,
  parseArgs,
  requireArg,
  waitAndPrint,
  zeroAddress,
} from "./config.js";
import { fileURLToPath } from "node:url";
import { readJson, validateTaskMetadata } from "./metadata-validation.js";

const args = parseArgs();
const { account, network, publicClient, walletClient } = makeClients(args);

const escrowAddress = requireArg(args, "escrow") as `0x${string}`;
const assetArg = requireArg(args, "asset");
const humanAmount = requireArg(args, "amount");
const metadataURI = requireArg(args, "metadata");
const metadataFile = args["metadata-file"] as string | undefined;
const worker = ((args.worker as string | undefined) || zeroAddress()) as `0x${string}`;
const verifier = ((args.verifier as string | undefined) || zeroAddress()) as `0x${string}`;
const workDeadlineMinutes = Number((args["work-deadline-minutes"] as string | undefined) || (args["deadline-minutes"] as string | undefined) || "60");
const reviewPeriodMinutes = Number((args["review-period-minutes"] as string | undefined) || "60");
if (!Number.isFinite(workDeadlineMinutes) || workDeadlineMinutes <= 0) {
  throw new Error("--work-deadline-minutes must be a positive number");
}
if (!Number.isFinite(reviewPeriodMinutes) || reviewPeriodMinutes <= 0) {
  throw new Error("--review-period-minutes must be a positive number");
}

const now = Math.floor(Date.now() / 1000);
const workDeadline = BigInt(now + Math.floor(workDeadlineMinutes * 60));
const reviewDeadline = BigInt(now + Math.floor((workDeadlineMinutes + reviewPeriodMinutes) * 60));
const asset = assetArg === "native" ? zeroAddress() : (assetArg as `0x${string}`);
let amount: bigint;

validateMetadataBeforeCreate(metadataURI, metadataFile);

if (assetArg === "native") {
  amount = parseAmount(humanAmount, 18);
} else {
  const decimals = await publicClient.readContract({
    address: asset,
    abi: erc20Abi,
    functionName: "decimals",
  });
  amount = parseAmount(humanAmount, decimals);
  console.log(`approving ERC20 escrow: asset=${asset} amount=${amount}`);
  const approveHash = await walletClient.writeContract({
    address: asset,
    abi: erc20Abi,
    functionName: "approve",
    args: [escrowAddress, amount],
    account,
  });
  await waitAndPrint(publicClient, network, approveHash);
}

console.log(`creating work order`);
console.log(`network: ${network.name} (${network.chainId})`);
console.log(`account: ${account.address}`);
console.log(`escrow: ${escrowAddress}`);
console.log(`asset: ${assetArg}`);
console.log(`amount base units: ${amount}`);
console.log(`workDeadline: ${workDeadline}`);
console.log(`reviewDeadline: ${reviewDeadline}`);

const hash = await walletClient.writeContract({
  address: escrowAddress,
  abi: escrowAbi,
  functionName: "createWorkOrder",
  args: [worker, verifier, asset, amount, workDeadline, reviewDeadline, metadataURI],
  account,
  value: assetArg === "native" ? amount : 0n,
});

await waitAndPrint(publicClient, network, hash);

function validateMetadataBeforeCreate(uri: string, explicitPath?: string) {
  const localPath = explicitPath || localPathFromUri(uri);
  if (!localPath) {
    throw new Error(
      "Task metadata must be validated before creating a work order. Pass --metadata-file <path> for ipfs://, https://, http://, or sha256: metadata URIs."
    );
  }
  validateTaskMetadata(readJson(localPath));
  console.log(`validated task metadata: ${localPath}`);
}

function localPathFromUri(uri: string) {
  if (uri.startsWith("file://")) return fileURLToPath(uri);
  if (/^(ipfs:\/\/|https:\/\/|http:\/\/|sha256:)/.test(uri)) return undefined;
  return uri;
}
