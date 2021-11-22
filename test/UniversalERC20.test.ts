import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { Contract, ContractFactory } from "ethers";
import { ethers } from "hardhat";
import { initContractFactories } from "./utils";
type DeployedContracts = {
  dai: Contract;
  frax: Contract;
  usv: Contract;
  treasury: Contract;
};
let contractFactories: {
  [k: string]: ContractFactory;
} | null = null;
const zeroAddress = "0x0000000000000000000000000000000000000000";
const deployContract = async (contractName: string, ...args: any[]) => {
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

const deployContracts = async (
  deployer: SignerWithAddress,
  MockAtlasTeam: SignerWithAddress
): Promise<DeployedContracts> => {
  // Initial mint for Frax and DAI (10,000,000)
  const initialMint = "10000000000000000000000000";
  const usv = await deployContract("USV");

  // Deploy or get existing Frax
  const frax = await deployContract("Frax", 0);
  await frax.mint(deployer.address, initialMint);

  const dai = await deployContract("DAI", 0);

  const treasury = await deployContract(
    "Treasury",
    usv.address,
    dai.address,
    frax.address,
    0
  );

  return {
    dai,
    frax,
    usv,
    treasury,
  };
};

describe("UniversalERC20", () => {
  let deployed: DeployedContracts;
  let deployer: SignerWithAddress;
  let addr1: SignerWithAddress;

  before(async () => {
    contractFactories = await initContractFactories();
  });

  beforeEach(async () => {
    const accounts = await ethers.getSigners();
    deployer = accounts[0];
    addr1 = accounts[1];

    deployed = await deployContracts(deployer, addr1);
  });

  describe("setVault", () => {
    it("should NOT let a non-owner to call", async () => {
      const { usv, treasury } = deployed;
      await expect(
        usv.connect(addr1).setVault(treasury.address)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });

    it("should allow owner to set vault", async () => {
      const { usv, treasury } = deployed;
      const tx = await usv.connect(deployer).setVault(treasury.address);
      await tx.wait();
      expect(await usv.vault()).to.equal(treasury.address);
    });
  });

  describe("ownership", () => {
    it("should allow owner to renounce ownership", async () => {
      const { usv, treasury } = deployed;
      await usv.renounceOwnership();

      await expect(usv.setVault(treasury.address)).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );

      await expect(usv.transferOwnership(addr1.address)).to.be.revertedWith(
        "Ownable: caller is not the owner"
      );
    });

    it("should allow owner to transfer ownership", async () => {
      const { usv, treasury } = deployed;
      await usv.transferOwnership(addr1.address);
      await usv.connect(addr1).setVault(treasury.address);

      expect(await usv.vault()).to.equals(treasury.address);
    });
  });

  describe("mint", () => {
    it("should only allow vault to mint USV", async () => {
      const { usv } = deployed;
      const initialMint = "10000000000000000000000000";

      await expect(usv.mint(deployer.address, initialMint)).to.be.revertedWith(
        "VaultOwned: caller is not the Vault"
      );

      let tx = await usv.setVault(addr1.address);
      await tx.wait();

      // Now addr1 is acting as the Vault
      tx = await usv.connect(addr1).mint(addr1.address, initialMint);
      await tx.wait();
      expect(await usv.balanceOf(addr1.address)).to.equal(initialMint);
    });
  });

  describe("burn / burnFrom", () => {
    it("should allow anybody to burn his/her own USV", async () => {
      const { usv } = deployed;
      await usv.setVault(deployer.address);

      const usvAmount = ethers.utils.parseUnits("1", "gwei").toString();
      await usv.mint(addr1.address, usvAmount);
      expect(await usv.balanceOf(addr1.address)).to.equal(usvAmount);
      await usv.connect(addr1).burn(usvAmount);
      expect(await usv.balanceOf(addr1.address)).to.equal("0");
    });

    it('should forbid one account to burn other account"s USV without permission', async () => {
      const { usv } = deployed;
      await usv.setVault(deployer.address);

      const usvAmount = ethers.utils.parseUnits("1", "gwei").toString();
      await usv.mint(addr1.address, usvAmount);
      expect(await usv.balanceOf(addr1.address)).to.equal(usvAmount);
      await expect(
        usv.connect(deployer).burnFrom(addr1.address, usvAmount)
      ).to.be.revertedWith("ERC20: burn amount exceeds allowance");
    });

    it('should allow one account to burn other account"s USV woth permission', async () => {
      const { usv } = deployed;
      await usv.setVault(deployer.address);

      const usvAmount = ethers.utils.parseUnits("1", "gwei").toString();
      await usv.mint(addr1.address, usvAmount);
      expect(await usv.balanceOf(addr1.address)).to.equal(usvAmount);
      await usv.connect(addr1).approve(deployer.address, usvAmount);
      await usv.connect(deployer).burnFrom(addr1.address, usvAmount);
      expect(await usv.balanceOf(addr1.address)).to.equal("0");
    });
  });
});
