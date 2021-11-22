import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { ContractFactory } from "ethers";
import { ethers } from "hardhat";
import { initContractFactories } from "./utils";

describe("sUniversal", () => {
  let contractFactories: {
    [k: string]: ContractFactory;
  };
  let deployed: any;
  let deployer: SignerWithAddress;
  let addr1: SignerWithAddress;
  let addr2: SignerWithAddress;

  before(async () => {
    contractFactories = await initContractFactories();
  });

  const deployContract = async (contractName: string, ...args: any[]) => {
    const factory = contractFactories[contractName];
    if (!factory) {
      throw new Error(`Factory for ${contractName} not found`);
    }
    const contract = await factory.deploy(...args);
    return contract.deployed();
  };

  const deploysUniversalToken = async () => {
    const usv = await deployContract("USV");
    console.log(`USV deployed to ${usv.address}`);

    const sUsv = await deployContract("sUSV");

    return {
      sUsv,
      usv,
    };
  };

  beforeEach(async () => {
    deployed = await deploysUniversalToken();
    const accounts = await ethers.getSigners();
    deployer = accounts[0];
    addr1 = accounts[1];
    addr2 = accounts[2];
  });

  describe("rebase & totalSupply", () => {
    it("Rebase(profit) should increase totalSupply by the percentage of increased circulatingSupply", async () => {
      const { sUsv } = deployed;

      // Let deployer action as stakingContract for sUSV
      let tx = await sUsv.initialize(deployer.address);
      await tx.wait();

      // two accounts with share of 1/3 and 2/3
      // Circulating supply is now 3 * 1e9
      await sUsv.transfer(addr1.address, ethers.utils.parseUnits("1", "gwei"));
      await sUsv.transfer(addr2.address, ethers.utils.parseUnits("2", "gwei"));

      expect(await sUsv.circulatingSupply()).to.eq(
        ethers.utils.parseUnits("3", "gwei")
      );

      const balance1 = await sUsv.balanceOf(addr1.address);
      const balance2 = await sUsv.balanceOf(addr2.address);

      const totalSupply = await sUsv.totalSupply();

      // Increase the circulatingSupply by 1/3, totalSupply should be increased by 1/3 as well
      tx = await sUsv.rebase(ethers.utils.parseUnits("1", "gwei"), 1);
      await tx.wait();
      const totalSupplyAfter = await sUsv.totalSupply();
      const expected = BigInt(totalSupply) + BigInt(totalSupply) / BigInt(3);
      expect(totalSupplyAfter).to.eq(expected);
      console.log(
        `totalSupply: ${totalSupply.toString()}, totalSupplyAfter: ${totalSupplyAfter.toString()}`
      );

      const balance1After = await sUsv.balanceOf(addr1.address);
      const balance2After = await sUsv.balanceOf(addr2.address);
      expect(balance1After / balance2After).to.eq(balance1 / balance2);
    });
  });
});
