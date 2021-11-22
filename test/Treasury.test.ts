import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { Contract } from "ethers";
import { ethers } from "hardhat";
import { getUniswapPair, strOfZeros } from "../scripts/utils";
import {
  deployContract,
  depositDaiForUSV,
  unitsOfDai,
  unitsOfUSV,
} from "./utils";

type DeployedContracts = {
  usv: Contract;
  sUsv: Contract;
  dai: Contract;
  treasury: Contract;
  barteringCalc: Contract;
  stakingHelper: Contract;
};

const zeroAddress = `0x${strOfZeros(40)}`;

const deployContracts = async (): Promise<DeployedContracts> => {
  const usv = await deployContract("USV");
  const dai = await deployContract("DAI", 0);

  const treasury = await deployContract(
    "Treasury",
    usv.address,
    dai.address,
    zeroAddress,
    0
  );

  const barteringCalc = await deployContract(
    "UniversalBarteringCalculator",
    usv.address
  );

  const sUsv = await deployContract("sUSV");

  const epochLengthInBlocks = "4";
  const firstEpochNumber = "0";
  const firstEpochBlock = "0";
  const staking = await deployContract(
    "Staking",
    usv.address,
    sUsv.address,
    epochLengthInBlocks,
    firstEpochNumber,
    firstEpochBlock
  );
  await sUsv.initialize(staking.address);
  await sUsv.setIndex("7675210820");

  const stakingHelper = await deployContract(
    "StakingHelper",
    staking.address,
    usv.address
  );

  const stakingWarmup = await deployContract(
    "StakingWarmup",
    staking.address,
    sUsv.address
  );

  await staking.setContract("1", stakingWarmup.address);

  // Deploy staking distributor
  const distributor = await deployContract(
    "Distributor",
    treasury.address,
    usv.address,
    epochLengthInBlocks,
    firstEpochBlock
  );
  await staking.setContract("0", distributor.address);

  await treasury.queue("9", sUsv.address);
  await treasury.toggle("9", sUsv.address, zeroAddress);

  return {
    usv,
    dai,
    treasury,
    barteringCalc,
    sUsv,
    stakingHelper,
  };
};

const addReserveSpender = async ({
  address,
  treasury,
}: {
  address: string;
  treasury: Contract;
}) => {
  await treasury.queue("1", address);
  const tx = await treasury.toggle("1", address, zeroAddress);
  await tx.wait();
};

const addDebtor = async ({
  address,
  treasury,
}: {
  address: string;
  treasury: Contract;
}) => {
  await treasury.queue("7", address);
  const tx = await treasury.toggle("7", address, zeroAddress);
  await tx.wait();
};

describe("Treasury", () => {
  let deployed: DeployedContracts;
  let deployer: SignerWithAddress;
  let anotherSigner: SignerWithAddress;

  beforeEach(async () => {
    const accounts = await ethers.getSigners();
    deployer = accounts[0];
    anotherSigner = accounts[1];
    deployed = await deployContracts();
  });

  describe("add liquidity token", () => {
    const addLiquidityTokenToTreasury = async (signer: SignerWithAddress) => {
      const { usv, dai, treasury, barteringCalc } = deployed;
      const usvAmount = ethers.utils.parseUnits("1", "gwei").toString();
      const otherTokenAmount = ethers.utils.parseEther("10").toString();
      await usv.setVault(deployer.address);
      await usv.mint(deployer.address, usvAmount);
      await dai.mint(deployer.address, otherTokenAmount);

      const daiUsvLp = await getUniswapPair({
        usv,
        otherToken: dai,
        usvAmount,
        otherTokenAmount,
      });

      await treasury.connect(signer).queue("5", daiUsvLp);
      await treasury
        .connect(signer)
        .toggle("5", daiUsvLp, barteringCalc.address);

      return daiUsvLp;
    };

    it("allow owner to add liquidity token", async () => {
      await addLiquidityTokenToTreasury(deployer);
    });

    it("should not allow non-owner to add liquidity token", async () => {
      await expect(
        addLiquidityTokenToTreasury(anotherSigner)
      ).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  describe("withdraw", () => {
    it("should allow reserve spender to withdraw", async () => {
      const { usv, dai, treasury } = deployed;
      await depositDaiForUSV({
        deployer,
        usv,
        dai,
        treasury,
        daiAmount: "10",
        usvAmount: "5",
      });
      // we should have 10 total reserves in treasury now
      expect(await treasury.totalReserves()).to.eq(unitsOfUSV("10"));

      await addReserveSpender({ treasury, address: anotherSigner.address });

      await usv.transfer(anotherSigner.address, unitsOfUSV("5"));
      await usv
        .connect(anotherSigner)
        .approve(treasury.address, unitsOfUSV("5"));

      await treasury
        .connect(anotherSigner)
        .withdraw(unitsOfDai("5"), dai.address);
    });

    it("should revert with 'ERC20: burn amount exceeds allowance' if treasury not approved to burn spender's USV", async () => {
      const { usv, dai, treasury } = deployed;
      await depositDaiForUSV({
        deployer,
        usv,
        dai,
        treasury,
        daiAmount: "10",
        usvAmount: "5",
      });
      // we should have 10 total reserves in treasury now
      expect(await treasury.totalReserves()).to.eq(unitsOfUSV("10"));

      await addReserveSpender({ treasury, address: anotherSigner.address });

      await usv.transfer(anotherSigner.address, unitsOfUSV("5"));

      await expect(
        treasury.connect(anotherSigner).withdraw(unitsOfDai("5"), dai.address)
      ).to.be.revertedWith("ERC20: burn amount exceeds allowance");
    });

    it("should revert with 'ERC20: burn amount exceeds balance' if msg.sender does not have enough USV", async () => {
      const { usv, dai, treasury } = deployed;
      await depositDaiForUSV({
        deployer,
        usv,
        dai,
        treasury,
        daiAmount: "10",
        usvAmount: "5",
      });
      // we should have 10 total reserves in treasury now
      expect(await treasury.totalReserves()).to.eq(unitsOfUSV("10"));

      await addReserveSpender({ treasury, address: anotherSigner.address });

      await usv
        .connect(anotherSigner)
        .approve(treasury.address, unitsOfUSV("5"));
      await expect(
        treasury.connect(anotherSigner).withdraw(unitsOfDai("5"), dai.address)
      ).to.be.revertedWith("ERC20: burn amount exceeds balance");
    });
  });

  describe("incurDebt / repayDebt", () => {
    it("should forbid non-debtor accounts to incurDebt", async () => {
      const { dai, treasury } = deployed;

      // Not a debtor
      await expect(
        treasury.connect(anotherSigner).incurDebt(unitsOfDai("6"), dai.address)
      ).to.be.revertedWith("Not approved");
    });

    it("should forbid non-debtor accounts to repay debt", async () => {
      const { dai, treasury } = deployed;

      // Not a debtor
      await expect(
        treasury
          .connect(anotherSigner)
          .repayDebtWithReserve(unitsOfDai("6"), dai.address)
      ).to.be.revertedWith("Not approved");
    });

    it("should allow debtors to incur & repay debt, but no more than the amount of sUSV the debtor holds", async () => {
      const { usv, dai, treasury, stakingHelper } = deployed;
      await depositDaiForUSV({
        deployer,
        usv,
        dai,
        treasury,
        daiAmount: "12",
        usvAmount: "6",
      });

      // Give anotherSigner 5 USV
      await usv.transfer(anotherSigner.address, unitsOfUSV("6"));
      // anotherSigner stake 5 USV
      await usv
        .connect(anotherSigner)
        .approve(stakingHelper.address, unitsOfUSV("5"));
      await stakingHelper
        .connect(anotherSigner)
        .stake(unitsOfUSV("5"), anotherSigner.address);

      await addDebtor({ address: anotherSigner.address, treasury });

      // Cannot borrow more than the amount of USV the debtor has
      await expect(
        treasury.connect(anotherSigner).incurDebt(unitsOfDai("6"), dai.address)
      ).to.be.revertedWith("Exceeds debt limit");

      // Can borrow up to 5 USV
      await treasury
        .connect(anotherSigner)
        .incurDebt(unitsOfDai("5"), dai.address);
      // Debtor should have the borrowed 5 DAI now
      expect(await dai.balanceOf(anotherSigner.address)).to.eq(unitsOfDai("5"));

      // Can repay with reserve token (DAI)
      await dai
        .connect(anotherSigner)
        .approve(treasury.address, unitsOfDai("5"));
      await treasury
        .connect(anotherSigner)
        .repayDebtWithReserve(unitsOfDai("4"), dai.address);
      expect(await dai.balanceOf(anotherSigner.address)).to.eq(unitsOfDai("1"));
      expect(await treasury.debtorBalance(anotherSigner.address)).to.eq(
        unitsOfUSV("1")
      );
      await usv
        .connect(anotherSigner)
        .approve(treasury.address, unitsOfUSV("1"));
      await treasury.connect(anotherSigner).repayDebtWithUSV(unitsOfUSV("1"));

      expect(await treasury.debtorBalance(anotherSigner.address)).to.eq("0");
    });
  });
});
