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

const args = parseArgs();
const { account, network, publicClient, walletClient } = makeClients(args);

const escrowAddress = requireArg(args, "escrow") as `0x${string}`;
const assetArg = requireArg(args, "asset");
const humanAmount = requireArg(args, "amount");
const metadataURI = requireArg(args, "metadata");
const worker = ((args.worker as string | undefined) || zeroAddress()) as `0x${string}`;
const verifier = ((args.verifier as string | undefined) || zeroAddress()) as `0x${string}`;
const deadlineMinutes = Number((args["deadline-minutes"] as string | undefined) || "60");
if (!Number.isFinite(deadlineMinutes) || deadlineMinutes <= 0) {
  throw new Error("--deadline-minutes must be a positive number");
}

const deadline = BigInt(Math.floor(Date.now() / 1000) + Math.floor(deadlineMinutes * 60));
const asset = assetArg === "native" ? zeroAddress() : (assetArg as `0x${string}`);
let amount: bigint;

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
console.log(`deadline: ${deadline}`);

const hash = await walletClient.writeContract({
  address: escrowAddress,
  abi: escrowAbi,
  functionName: "createWorkOrder",
  args: [worker, verifier, asset, amount, deadline, metadataURI],
  account,
  value: assetArg === "native" ? amount : 0n,
});

await waitAndPrint(publicClient, network, hash);
