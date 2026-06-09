import { escrowAbi, makeReadClient, parseArgs, requireArg, zeroAddress } from "./config.js";

const args = parseArgs();
const { network, publicClient } = makeReadClient(args);
const escrowAddress = requireArg(args, "escrow") as `0x${string}`;
const agent = requireArg(args, "agent") as `0x${string}`;
const assetArg = (args.asset as string | undefined) || "native";
const asset = (assetArg === "native" ? zeroAddress() : assetArg) as `0x${string}`;

const stats = await publicClient.readContract({
  address: escrowAddress,
  abi: escrowAbi,
  functionName: "getAgentStats",
  args: [agent],
});
const assetVolume = await publicClient.readContract({
  address: escrowAddress,
  abi: escrowAbi,
  functionName: "getAgentAssetVolumeReleased",
  args: [agent, asset],
});

const accepted = Number(stats.accepted);
const completed = Number(stats.completed);
const completionRate = accepted === 0 ? null : completed / accepted;

console.log(JSON.stringify(
  {
    network: network.name,
    agent,
    asset,
    stats: {
      posted: stats.posted.toString(),
      accepted: stats.accepted.toString(),
      submitted: stats.submitted.toString(),
      completed: stats.completed.toString(),
      refunded: stats.refunded.toString(),
      aggregateVolumeReleased: stats.volumeReleased.toString(),
      selectedAssetVolumeReleased: assetVolume.toString(),
      completionRate,
    },
  },
  null,
  2
));
