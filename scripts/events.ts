import { decodeEventLog } from "viem";
import { escrowAbi, makeReadClient, parseArgs, requireArg } from "./config.js";

const args = parseArgs();
const { network, publicClient } = makeReadClient(args);
const escrowAddress = requireArg(args, "escrow") as `0x${string}`;
const deploymentTx = "0xb79589f425bc952edc30857cbeaed8d83c39cfc3ef16ad06b329be743fbbe611" as const;
const fromBlockArg = args["from-block"] as string | undefined;
const scanAll = Boolean(args.all);
const latestBlock = await publicClient.getBlockNumber();
const receipt = scanAll && !fromBlockArg
  ? await publicClient.getTransactionReceipt({ hash: deploymentTx })
  : undefined;
const chunkSize = BigInt((args["chunk-size"] as string | undefined) || "1000");
const defaultWindowStart = latestBlock > chunkSize ? latestBlock - chunkSize + 1n : 0n;
const fromBlock = fromBlockArg
  ? BigInt(fromBlockArg)
  : scanAll
    ? receipt?.blockNumber || 0n
    : defaultWindowStart;

const logs = [];
for (let start = fromBlock; start <= latestBlock; start += chunkSize) {
  const end = start + chunkSize - 1n > latestBlock ? latestBlock : start + chunkSize - 1n;
  const chunk = await publicClient.getLogs({
    address: escrowAddress,
    fromBlock: start,
    toBlock: end,
  });
  logs.push(...chunk);
  if (end < latestBlock) {
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
}

const decoded = logs.map((log) => {
  try {
    const event = decodeEventLog({
      abi: escrowAbi,
      data: log.data,
      topics: log.topics,
    });
    return {
      blockNumber: log.blockNumber?.toString(),
      transactionHash: log.transactionHash,
      eventName: event.eventName,
      args: event.args,
      explorer: log.transactionHash ? `${network.explorerUrl}/tx/${log.transactionHash}` : undefined,
    };
  } catch {
    return {
      blockNumber: log.blockNumber?.toString(),
      transactionHash: log.transactionHash,
      eventName: "Unknown",
      args: {},
    };
  }
});

console.log(JSON.stringify(decoded, bigintReplacer, 2));

function bigintReplacer(_key: string, value: unknown) {
  return typeof value === "bigint" ? value.toString() : value;
}
