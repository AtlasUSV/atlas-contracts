import { ethers, network } from "hardhat";
import {
  gasOverrides,
  getExistingContract,
  loadContractAddresses,
} from "./utils";

async function main() {
  console.log(`Running on ${network.name}`);
  const [deployer] = await ethers.getSigners();

  await loadContractAddresses();

  const usv = await getExistingContract({ contractSymbol: "USV" });
  await usv.setVault(deployer.address, gasOverrides);

  let tx = await usv.mint(deployer.address, BigInt(10 ** 13), gasOverrides);
  await tx.wait();
}

main()
  .then(() => process.exit())
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
