import fs from "fs";
import { ethers, network, run } from "hardhat";
import { strOfZeros } from "./utils";

const verifyContracts = async () => {
  const [deployer, MockAtlasTeam] = await ethers.getSigners();

  let contractAddresses;
  const filename = `./scripts/config/addresses-${network.name}.json`;
  if (fs.existsSync(filename)) {
    const data = await fs.promises.readFile(filename);
    contractAddresses = JSON.parse(data.toString());
  }

  try {
    await run("verify:verify", {
      address: contractAddresses["USV"],
      constructorArguments: [],
    });
  } catch (e) {
    console.log(e);
  }

  try {
    await run("verify:verify", {
      address: contractAddresses["Frax"],
      constructorArguments: ["0"],
    });
  } catch (e) {
    console.log(e);
  }

  try {
    await run("verify:verify", {
      address: contractAddresses["Dai"],
      constructorArguments: ["0"],
    });
  } catch (e) {
    console.log(e);
  }

  try {
    const usvAddress = contractAddresses["USV"];
    await run("verify:verify", {
      address: contractAddresses["UniversalBarteringCalculator"],
      constructorArguments: [usvAddress],
    });
  } catch (e) {
    console.log(e);
  }

  try {
    await run("verify:verify", {
      address: contractAddresses["sUSV"],
      constructorArguments: [],
    });
  } catch (e) {
    console.log(e);
  }

  try {
    // First block epoch occurs
    const firstEpochBlock = "8961000";

    // What epoch will be first epoch
    const firstEpochNumber = "338";

    // How many blocks are in each epoch
    const epochLengthInBlocks = "2200";
    await run("verify:verify", {
      address: contractAddresses["Staking"],
      constructorArguments: [
        contractAddresses["USV"],
        contractAddresses["sUSV"],
        epochLengthInBlocks,
        firstEpochNumber,
        firstEpochBlock,
      ],
    });
  } catch (e) {
    console.log(e);
  }

  try {
    await run("verify:verify", {
      address: contractAddresses["StakingWarmpup"],
      constructorArguments: [
        contractAddresses["Staking"],
        contractAddresses["sUSV"],
      ],
    });
  } catch (e) {
    console.log(e);
  }

  try {
    await run("verify:verify", {
      address: contractAddresses["StakingHelper"],
      constructorArguments: [
        contractAddresses["Staking"],
        contractAddresses["USV"],
      ],
    });
  } catch (e) {
    console.log(e);
  }

  try {
    await run("verify:verify", {
      address: contractAddresses["RedeemHelper"],
      constructorArguments: [],
    });
  } catch (e) {
    console.log(e);
  }
  try {
    await run("verify:verify", {
      address: contractAddresses["Treasury"],
      constructorArguments: [
        contractAddresses["USV"],
        contractAddresses["DAI"],
        contractAddresses["Frax"],
        "0",
      ],
    });
  } catch (e) {
    console.log(e);
  }

  try {
    // How many blocks are in each epoch
    const epochLengthInBlocks = "2200";
    // First block epoch occurs
    const firstEpochBlock = "8961000";
    await run("verify:verify", {
      address: contractAddresses["Distributor"],
      constructorArguments: [
        contractAddresses["Treasury"],
        contractAddresses["USV"],
        epochLengthInBlocks,
        firstEpochBlock,
      ],
    });
  } catch (e) {
    console.log(e);
  }

  try {
    const zeroAddress = `0x${strOfZeros(40)}`;
    await run("verify:verify", {
      address: contractAddresses["DAIBarter"],
      constructorArguments: [
        contractAddresses["USV"],
        contractAddresses["DAI"],
        contractAddresses["Treasury"],
        MockAtlasTeam.address,
        zeroAddress,
      ],
    });
  } catch (e) {
    console.log(e);
  }

  try {
    const zeroAddress = `0x${strOfZeros(40)}`;
    await run("verify:verify", {
      address: contractAddresses["FraxBarter"],
      constructorArguments: [
        contractAddresses["USV"],
        contractAddresses["Frax"],
        contractAddresses["Treasury"],
        MockAtlasTeam.address,
        zeroAddress,
      ],
    });
  } catch (e) {
    console.log(e);
  }
};

verifyContracts()
  .then(() => process.exit())
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
