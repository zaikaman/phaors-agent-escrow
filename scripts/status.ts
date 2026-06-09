import { escrowAbi, makeReadClient, parseArgs, requireArg } from "./config.js";

const statuses = ["None", "Open", "Accepted", "Submitted", "Released", "Refunded", "Cancelled"];
const args = parseArgs();
const { network, publicClient } = makeReadClient(args);
const escrowAddress = requireArg(args, "escrow") as `0x${string}`;
const id = BigInt(requireArg(args, "id"));

const order = await publicClient.readContract({
  address: escrowAddress,
  abi: escrowAbi,
  functionName: "getWorkOrder",
  args: [id],
});
const buyerStats = await publicClient.readContract({
  address: escrowAddress,
  abi: escrowAbi,
  functionName: "getAgentStats",
  args: [order.buyer],
});
const workerStats =
  order.worker === "0x0000000000000000000000000000000000000000"
    ? undefined
    : await publicClient.readContract({
        address: escrowAddress,
        abi: escrowAbi,
        functionName: "getAgentStats",
        args: [order.worker],
      });
const workerAssetVolume =
  order.worker === "0x0000000000000000000000000000000000000000"
    ? undefined
    : await publicClient.readContract({
        address: escrowAddress,
        abi: escrowAbi,
        functionName: "getAgentAssetVolumeReleased",
        args: [order.worker, order.asset],
      });

console.log(JSON.stringify(
  {
    network: network.name,
    id: id.toString(),
    status: statuses[Number(order.status)],
    order: {
      buyer: order.buyer,
      worker: order.worker,
      verifier: order.verifier,
      asset: order.asset,
      amount: order.amount.toString(),
      deadline: order.deadline.toString(),
      createdAt: order.createdAt.toString(),
      acceptedAt: order.acceptedAt.toString(),
      submittedAt: order.submittedAt.toString(),
      metadataURI: order.metadataURI,
      proofURI: order.proofURI,
    },
    buyerStats: stringifyStats(buyerStats),
    workerStats: workerStats ? stringifyStats(workerStats) : null,
    workerReleasedVolumeForAsset: workerAssetVolume?.toString() || null,
  },
  null,
  2
));

function stringifyStats(stats: {
  posted: bigint;
  accepted: bigint;
  submitted: bigint;
  completed: bigint;
  refunded: bigint;
  volumeReleased: bigint;
}) {
  return {
    posted: stats.posted.toString(),
    accepted: stats.accepted.toString(),
    submitted: stats.submitted.toString(),
    completed: stats.completed.toString(),
    refunded: stats.refunded.toString(),
    volumeReleased: stats.volumeReleased.toString(),
  };
}
