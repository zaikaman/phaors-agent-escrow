import {
  escrowAbi,
  makeClients,
  makeClientsFromPrivateKey,
  parseArgs,
  requireArg,
  waitAndPrint,
} from "./config.js";

const command = process.argv[2];
const args = parseArgs(process.argv.slice(3));
const signerEnv = args["signer-env"] as string | undefined;
const { account, network, publicClient, walletClient } = signerEnv
  ? makeClientsFromPrivateKey(args, signerEnv)
  : makeClients(args);
const escrowAddress = requireArg(args, "escrow") as `0x${string}`;
const id = BigInt(requireArg(args, "id"));

console.log(`command: ${command}`);
console.log(`network: ${network.name} (${network.chainId})`);
console.log(`account: ${account.address}`);
if (signerEnv) console.log(`signerEnv: ${signerEnv}`);
console.log(`escrow: ${escrowAddress}`);
console.log(`workOrderId: ${id}`);

let hash: `0x${string}`;

if (command === "accept") {
  hash = await walletClient.writeContract({
    address: escrowAddress,
    abi: escrowAbi,
    functionName: "acceptWorkOrder",
    args: [id],
    account,
  });
} else if (command === "submit") {
  const proofURI = requireArg(args, "proof");
  hash = await walletClient.writeContract({
    address: escrowAddress,
    abi: escrowAbi,
    functionName: "submitProof",
    args: [id, proofURI],
    account,
  });
} else if (command === "release") {
  hash = await walletClient.writeContract({
    address: escrowAddress,
    abi: escrowAbi,
    functionName: "releasePayment",
    args: [id],
    account,
  });
} else if (command === "refund") {
  hash = await walletClient.writeContract({
    address: escrowAddress,
    abi: escrowAbi,
    functionName: "refundExpired",
    args: [id],
    account,
  });
} else if (command === "cancel") {
  hash = await walletClient.writeContract({
    address: escrowAddress,
    abi: escrowAbi,
    functionName: "cancelOpen",
    args: [id],
    account,
  });
} else {
  throw new Error("Command must be accept, submit, release, refund, or cancel.");
}

await waitAndPrint(publicClient, network, hash);
