import { loadDeploymentArtifact, makeClients, parseArgs, waitAndPrint } from "./config.js";

const args = parseArgs();
const { account, network, publicClient, walletClient } = makeClients(args);
const artifact = loadDeploymentArtifact();

console.log(`deploying AgentWorkOrderEscrow`);
console.log(`network: ${network.name} (${network.chainId})`);
console.log(`account: ${account.address}`);

const hash = await walletClient.deployContract({
  abi: artifact.abi,
  bytecode: artifact.bytecode,
  account,
});

const receipt = await waitAndPrint(publicClient, network, hash);
console.log(`contract: ${receipt.contractAddress}`);
