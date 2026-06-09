import {
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
const amount = parseAmount((args.amount as string | undefined) || "0.001", 18);
const deadlineMinutes = Number((args["deadline-minutes"] as string | undefined) || "20");
const metadataURI = (args.metadata as string | undefined) || "ipfs://pharos-agent-escrow-demo-task";
const proofURI = (args.proof as string | undefined) || "ipfs://pharos-agent-escrow-demo-proof";
const deadline = BigInt(Math.floor(Date.now() / 1000) + Math.floor(deadlineMinutes * 60));

console.log("running self-contained native escrow demo");
console.log(`network: ${network.name} (${network.chainId})`);
console.log(`account: ${account.address}`);
console.log(`escrow: ${escrowAddress}`);

const id = await publicClient.readContract({
  address: escrowAddress,
  abi: escrowAbi,
  functionName: "nextWorkOrderId",
});

console.log(`expectedWorkOrderId: ${id}`);

const createHash = await walletClient.writeContract({
  address: escrowAddress,
  abi: escrowAbi,
  functionName: "createWorkOrder",
  args: [account.address, account.address, zeroAddress(), amount, deadline, metadataURI],
  account,
  value: amount,
});
await waitAndPrint(publicClient, network, createHash);

const acceptHash = await walletClient.writeContract({
  address: escrowAddress,
  abi: escrowAbi,
  functionName: "acceptWorkOrder",
  args: [id],
  account,
});
await waitAndPrint(publicClient, network, acceptHash);

const submitHash = await walletClient.writeContract({
  address: escrowAddress,
  abi: escrowAbi,
  functionName: "submitProof",
  args: [id, proofURI],
  account,
});
await waitAndPrint(publicClient, network, submitHash);

const releaseHash = await walletClient.writeContract({
  address: escrowAddress,
  abi: escrowAbi,
  functionName: "releasePayment",
  args: [id],
  account,
});
await waitAndPrint(publicClient, network, releaseHash);

const order = await publicClient.readContract({
  address: escrowAddress,
  abi: escrowAbi,
  functionName: "getWorkOrder",
  args: [id],
});

console.log(JSON.stringify(
  {
    workOrderId: id.toString(),
    finalStatus: Number(order.status),
    metadataURI: order.metadataURI,
    proofURI: order.proofURI,
  },
  null,
  2
));
