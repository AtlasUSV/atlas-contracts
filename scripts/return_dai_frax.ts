import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { Contract } from "ethers";
import { ethers } from "hardhat";
import {
  getExistingOrDeployContract,
  printBalances,
  strOfZeros,
  withdrawAllTokenFromTreasury,
} from "./utils";

const getDaiAndFraxBack = async ({
  dai,
  frax,
  treasury,
  deployer,
  usv,
  MockAtlasTeam,
}: {
  usv: Contract;
  dai: Contract;
  frax: Contract;
  treasury: Contract;
  deployer: SignerWithAddress;
  MockAtlasTeam: SignerWithAddress;
}) => {
  await withdrawAllTokenFromTreasury({
    holder: deployer,
    token: dai,
    usv,
    treasury,
  });
  await withdrawAllTokenFromTreasury({
    holder: deployer,
    token: frax,
    usv,
    treasury,
  });
  await withdrawAllTokenFromTreasury({
    holder: MockAtlasTeam,
    token: dai,
    usv,
    treasury,
  });
  await withdrawAllTokenFromTreasury({
    holder: MockAtlasTeam,
    token: frax,
    usv,
    treasury,
  });
};

async function main() {
  const [deployer, MockAtlasTeam] = await ethers.getSigners();
  console.log(
    `Running script with accounts: ${deployer.address}, ${MockAtlasTeam.address}`
  );

  // Ethereum 0 address, used when toggling changes in treasury
  const zeroAddress = `0x${strOfZeros(40)}`;

  const usv = await getExistingOrDeployContract({ contractSymbol: "USV" });
  console.log(`Attached to USV at ${usv.address}`);

  // Deploy or get existing Frax
  const frax = await getExistingOrDeployContract({
    contractSymbol: "Frax",
  });
  console.log(`Attached to Frax at ${frax.address}`);

  const dai = await getExistingOrDeployContract({
    contractSymbol: "DAI",
  });

  console.log(`Attached to DAI at ${dai.address}`);

  // get the Treasury
  const treasury = await getExistingOrDeployContract({
    contractSymbol: "Treasury",
  });
  console.log(`Attached to Treasury at ${treasury.address}`);

  await Promise.all(
    [
      { account: deployer.address, accountName: "deployer" },
      { account: MockAtlasTeam.address, accountName: "MockAtlasTeam" },
      { account: treasury.address, accountName: "treasury" },
    ].map(({ account, accountName }) =>
      printBalances({ dai, frax, usv, account, accountName })
    )
  );

  await getDaiAndFraxBack({ dai, frax, usv, treasury, deployer, MockAtlasTeam });
  await Promise.all(
    [
      { account: deployer.address, accountName: "deployer" },
      { account: MockAtlasTeam.address, accountName: "MockAtlasTeam" },
      { account: treasury.address, accountName: "treasury" },
    ].map(({ account, accountName }) =>
      printBalances({ dai, frax, usv, account, accountName })
    )
  );
}

main()
  .then(() => process.exit())
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
