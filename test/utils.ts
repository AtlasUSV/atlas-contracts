import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { Contract, ContractFactory } from "ethers";
import { ethers } from "hardhat";

export const strOfZeros = (n: number) => {
  return Array(n).fill("0").join("");
};

export const initContractFactories = async (): Promise<{
  [k: string]: ContractFactory;
}> => {
  return {
    USV: await ethers.getContractFactory("UniversalERC20Token"),
    DAI: await ethers.getContractFactory("MockDAI"),
    Frax: await ethers.getContractFactory("MockFRAX"),
    Treasury: await ethers.getContractFactory("UniversalTreasury"),
    UniversalBarteringCalculator: await ethers.getContractFactory(
      "UniversalBarteringCalculator"
    ),
    Distributor: await ethers.getContractFactory("Distributor"),
    sUSV: await ethers.getContractFactory("sUniversal"),
    Staking: await ethers.getContractFactory("UniversalStaking"),
    StakingWarmup: await ethers.getContractFactory("StakingWarmup"),
    StakingHelper: await ethers.getContractFactory("StakingHelper"),
    DAIBarter: await ethers.getContractFactory("UniversalBarterDepository"),
    FraxBarter: await ethers.getContractFactory("UniversalBarterDepository"),
    DAIUSVBarter: await ethers.getContractFactory("UniversalBarterDepository"),
  };
};

let contractFactories: { [k: string]: ContractFactory } | null = null;

export const deployContract = async (contractName: string, ...args: any[]) => {
  if (!contractFactories) {
    contractFactories = await initContractFactories();
  }
  const factory = contractFactories[contractName];
  if (!factory) {
    throw new Error(`Factory for ${contractName} not found`);
  }
  const contract = await factory.deploy(...args);
  return contract.deployed();
};

export const zeroAddress = `0x${strOfZeros(40)}`;

export const depositDaiForUSV = async ({
  treasury,
  dai,
  usv,
  daiAmount,
  usvAmount,
  deployer,
}: {
  treasury: Contract;
  dai: Contract;
  usv: Contract;
  daiAmount: string;
  usvAmount: string;
  deployer: SignerWithAddress;
}) => {
  let tx = await usv.connect(deployer).setVault(treasury.address);
  await tx.wait();

  const amountDai = BigInt(daiAmount) * BigInt(10 ** 18);
  const amountUsv = BigInt(usvAmount) * BigInt(10 ** 9);

  await dai.mint(deployer.address, amountDai);
  await dai.approve(treasury.address, amountDai);

  if (!(await treasury.isReserveDepositor(deployer.address))) {
    // Set deployer as a reserve depositor
    await treasury.queue("0", deployer.address);
    tx = await treasury.toggle("0", deployer.address, zeroAddress);
    await tx.wait();
    expect(await treasury.isReserveDepositor(deployer.address)).to.be.true;
  }

  const oldReserve = await treasury.totalReserves();
  const oldSupply = await usv.totalSupply();

  const profit =
    BigInt(amountDai) / BigInt(`1${strOfZeros(9)}`) - BigInt(amountUsv);

  // deposit amountDai of DAI and get amountOhm of USV out into our deployer's wallet
  tx = await treasury.deposit(amountDai, dai.address, profit);
  await tx.wait();

  // USV supply should increase by amountOhm
  expect(await usv.totalSupply()).to.equal(
    (BigInt(oldSupply) + BigInt(amountUsv)).toString()
  );

  // Treasury reserve should increase by (amountDai / 1e9)
  const expected =
    BigInt(oldReserve) + BigInt(amountDai) / BigInt(`1${strOfZeros(9)}`);
  expect(await treasury.totalReserves()).to.equal(expected.toString());
};

export const unitsOfDai = (amount: string) => {
  return (BigInt(amount) * BigInt(10 ** 18)).toString();
};

export const unitsOfUSV = (amount: string) => {
  return (BigInt(amount) * BigInt(10 ** 9)).toString();
};
