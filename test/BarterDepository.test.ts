import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { Contract, ContractFactory } from "ethers";
import { ethers, network } from "hardhat";
import { initContractFactories, strOfZeros } from "./utils";
type DeployedContracts = {
  dai: Contract;
  usv: Contract;
  staking?: Contract;
  stakingHelper?: Contract;
  treasury: Contract;
  daiBarter: Contract;
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
  MockAtlasTeam: SignerWithAddress,
  withStaking: boolean = true
): Promise<DeployedContracts> => {
  const usv = await deployContract("USV");

  const dai = await deployContract("DAI", 0);

  const treasury = await deployContract(
    "Treasury",
    usv.address,
    dai.address,
    zeroAddress,
    0
  );

  const daiBarter = await deployContract(
    "DAIBarter",
    usv.address,
    dai.address,
    treasury.address,
    MockAtlasTeam.address,
    zeroAddress
  );

  // Add daiBarter as a reserve depositor
  await treasury.queue("0", daiBarter.address);
  await treasury.toggle("0", daiBarter.address, zeroAddress);

  let tx = await usv.connect(deployer).setVault(treasury.address);
  await tx.wait();

  let staking = undefined;
  let stakingHelper = undefined;
  if (withStaking) {
    const sUsv = await deployContract("sUSV");

    const epochLengthInBlocks = "2200";
    const firstEpochBlock = "0";
    const firstEpochNumber = "0";

    staking = await deployContract(
      "Staking",
      usv.address,
      sUsv.address,
      epochLengthInBlocks,
      firstEpochNumber,
      firstEpochBlock
    );

    await sUsv.initialize(staking.address);
    // Initial staking index
    const initialIndex = "7675210820";
    await sUsv.setIndex(initialIndex);

    stakingHelper = await deployContract(
      "StakingHelper",
      staking.address,
      usv.address
    );
    const stakingWarmup = await deployContract(
      "StakingWarmup",
      staking.address,
      sUsv.address
    );

    const distributor = await deployContract(
      "Distributor",
      treasury.address,
      usv.address,
      epochLengthInBlocks,
      firstEpochBlock
    );

    tx = await treasury.queue("8", distributor.address);
    await treasury.toggle("8", distributor.address, zeroAddress);

    await staking.setContract("1", stakingWarmup.address);
    await staking.setContract("0", distributor.address);

    const initialRewardRate = "3000";
    await distributor.addRecipient(staking.address, initialRewardRate);
  }
  return {
    // sUSV,
    dai,
    usv,
    staking,
    stakingHelper,
    treasury,
    daiBarter,
  };
};

describe("UniversalBarterDepository", () => {
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

  const mintUSVWithDai = async ({
    treasury,
    dai,
    usv,
    amountDai,
    amountUsv,
  }: {
    treasury: Contract;
    dai: Contract;
    usv: Contract;
    amountDai: string; // 18 decimals
    amountUsv: string; // 9 decimals
  }) => {
    let tx = await usv.connect(deployer).setVault(treasury.address);
    await tx.wait();

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

    // deposit amountDai of DAI and get amountUsv of USV out into our deployer's wallet
    tx = await treasury.deposit(amountDai, dai.address, profit);
    await tx.wait();

    // USV supply should increase by amountUsv
    expect(await usv.totalSupply()).to.equal(
      (BigInt(oldSupply) + BigInt(amountUsv)).toString()
    );

    // Treasury reserve should increase by (amountDai / 1e9)
    const expected =
      BigInt(oldReserve) + BigInt(amountDai) / BigInt(`1${strOfZeros(9)}`);
    expect(await treasury.totalReserves()).to.equal(expected.toString());
  };

  // DAI barter BCV
  const daiBarterBCV = "369";
  // Barter vesting length in blocks. 33110 ~ 5 days
  const barterVestingLength = "33110";
  // Min barter price
  const minBarterPrice = "50000";
  // Max barter payout
  const maxBarterPayout = "50"; // 0.05% of total supply for a single payout.
  // AtlasTeam fee for barter
  const barterFee = "10000";
  // Max debt barter can take on
  const maxBarterDebt = "1000000000000000";
  // Initial Barter debt
  const intialBarterDebt = "0";

  const initBarter = async ({
    vestingLen,
  }: {
    vestingLen: string | undefined;
  }) => {
    const { daiBarter } = deployed;

    await daiBarter.initializeBarterTerms(
      daiBarterBCV,
      vestingLen,
      minBarterPrice,
      maxBarterPayout,
      barterFee,
      maxBarterDebt,
      intialBarterDebt
    );
  };

  describe("maxPayout()", () => {
    it("should return the maxPayout", async () => {
      const { usv, dai, treasury, daiBarter } = deployed;

      await initBarter({ vestingLen: barterVestingLength });

      const maxPayout = await daiBarter.maxPayout();
      // The the total supply of USV is zero, so does the maxPayout!
      expect(maxPayout).to.eq(0);

      // Mint some USV
      await mintUSVWithDai({
        treasury,
        dai,
        usv,
        amountDai: `10${strOfZeros(18)}`,
        amountUsv: `5${strOfZeros(9)}`,
      });

      // Now we have `5${strOfZeros(9)}` number of USV, apply our 0.05% maxBarterPayout ratio
      // to get the maxPayout: `0.0005 * 5${strOfZeros(9)}` = `25${strOfZeros(5)}`
      expect(await daiBarter.maxPayout()).to.eq(`25${strOfZeros(5)}`);
    });
  });

  describe("deposit", () => {
    it("should be able to deposit", async () => {
      const { treasury, dai, usv, daiBarter } = deployed;
      await initBarter({ vestingLen: barterVestingLength });
      // Mint some USV
      await mintUSVWithDai({
        treasury,
        dai,
        usv,
        amountDai: `9${strOfZeros(24)}`,
        amountUsv: `84${strOfZeros(14)}`,
      });

      // Now we have `5${strOfZeros(9)}` number of USV, apply our 0.05% maxBarterPayout ratio
      // to get the maxPayout: `0.0005 * 84${strOfZeros(14)}` = `42${strOfZeros(11)}`
      expect(await daiBarter.maxPayout()).to.eq(`42${strOfZeros(11)}`);

      await dai.mint(deployer.address, BigInt(10 ** 25).toString());
      // Approve the transfer DAI from deployer to our daiBarter
      await dai.approve(daiBarter.address, `1${strOfZeros(25)}`);
      await daiBarter.deposit(`1${strOfZeros(24)}`, "50000", deployer.address);

      expect(await usv.totalSupply()).to.equal("8404000000000000");

      expect(await dai.balanceOf(treasury.address)).to.equal(
        `1${strOfZeros(25)}`
      );
      // We should have the same amount of USV in the AtlasTeam
      expect(await usv.balanceOf(addr1.address)).to.equal(`2${strOfZeros(12)}`);
      expect(await usv.balanceOf(daiBarter.address)).to.equal(
        `2${strOfZeros(12)}`
      );
    });
  });

  describe("debtRatio", () => {
    it("should calculate the debtRatio correctly", async () => {
      const { treasury, dai, usv, daiBarter } = deployed;
      await initBarter({ vestingLen: barterVestingLength });
      // Mint some USV
      await mintUSVWithDai({
        treasury,
        dai,
        usv,
        amountDai: `9${strOfZeros(24)}`,
        amountUsv: `84${strOfZeros(14)}`,
      });

      let currentDebt = await daiBarter.currentDebt();
      expect(currentDebt).to.equal("0");

      await dai.mint(deployer.address, BigInt(2 * 10 ** 24).toString());
      // Approve the transfer DAI from deployer to our daiBarter
      await dai.approve(daiBarter.address, `1${strOfZeros(24)}`);
      expect(await usv.totalSupply()).to.equal("8400000000000000");

      // ========================Deposit==================================
      await daiBarter.deposit(`1${strOfZeros(24)}`, "50000", deployer.address);
      // =================================================================

      expect(await usv.totalSupply()).to.equal("8404000000000000");

      const totalSupply = await usv.totalSupply();
      expect(totalSupply).to.equal("8404000000000000");

      currentDebt = await daiBarter.currentDebt();
      // We deposited 1e24 DAI, the debt is 1e24 / 1e9 = 1e15
      expect(currentDebt).to.equal(BigInt(10 ** 15).toString());

      const debtRatio = await daiBarter.debtRatio();
      // debtRatio = currentDebt * 1e9 / totalSupply
      //           = 1e15 * 1e9 / 8404000000000000
      //           = 1e12 / 8404
      expect(debtRatio).to.equal("118990956");

      // price_ = terms.controlVariable.mul( debtRatio() ).add( 1000000000 ).div( 1e7 );
      // if ( price_ < terms.minimumPrice ) {
      //     price_ = terms.minimumPrice;
      // }
      // price = (369 * 118990956 + 1000000000) / 1e7 = 4490.7662764
      // As price <  terms.minimumPrice
      // the returned price is the minimum price
      const barterPrice = await daiBarter.barterPrice();
      expect(barterPrice).to.equal(minBarterPrice);
    });

    it("when the demanding for Barter is high, debtRatio and price will increase", async () => {
      const { treasury, dai, usv, daiBarter } = deployed;
      await initBarter({ vestingLen: barterVestingLength });
      // Mint some USV
      await mintUSVWithDai({
        treasury,
        dai,
        usv,
        amountDai: `1${strOfZeros(21)}`, // 1000 DAI
        amountUsv: `4${strOfZeros(11)}`, // 400 USV
      });

      let currentDebt = await daiBarter.currentDebt();
      expect(currentDebt).to.equal("0");

      const barterAmount = BigInt(100 * 10 ** 18).toString();
      let debtRatio = await daiBarter.debtRatio();
      let maxPayout = await daiBarter.maxPayout();
      let payout = await daiBarter.payoutFor(barterAmount);

      // Purchase the Barter many times, the newRatio should be increasing
      // the payout should be decreasing
      for (let i = 0; i < 10; i++) {
        await dai.mint(deployer.address, barterAmount);
        // Approve the transfer DAI from deployer to our daiBarter
        await dai.approve(daiBarter.address, `1${strOfZeros(20)}`);

        const newPayout = await daiBarter.payoutFor(barterAmount);
        expect(BigInt(newPayout) <= BigInt(payout)).to.be.true;
        payout = newPayout;
        console.log(`payout: ${payout}`);

        // ========================Deposit==================================
        await daiBarter.deposit(barterAmount, "100000", deployer.address);
        // =================================================================

        const newMaxPayout = await daiBarter.maxPayout();
        console.log(`newMaxPayout: ${newMaxPayout}`);
        maxPayout = newMaxPayout;

        const newRatio = await daiBarter.debtRatio();
        console.log(`newRatio: ${newRatio}`);
        expect(BigInt(newRatio) > BigInt(debtRatio)).to.be.true;
        debtRatio = newRatio;
      }

      const barterPrice = await daiBarter.barterPrice();
      expect(Number(barterPrice)).to.be.greaterThan(Number(minBarterPrice));
    });
  });

  describe("redeem & stake", () => {
    async function mineBlocks(blockNumber: number) {
      while (blockNumber > 0) {
        blockNumber--;
        await network.provider.request({
          method: "evm_mine",
          params: [],
        });
      }
    }

    it("will revert with 'ERC20: approve to the zero address', if neither staking nor stakingHelper is set", async () => {
      const { treasury, dai, usv, daiBarter } = deployed;
      await initBarter({ vestingLen: "10" }); // set barter versting length to 10, for faster check
      // Mint some USV
      await mintUSVWithDai({
        treasury,
        dai,
        usv,
        amountDai: `1${strOfZeros(21)}`, // 1000 DAI
        amountUsv: `4${strOfZeros(11)}`, // 400 USV
      });

      let currentDebt = await daiBarter.currentDebt();
      expect(currentDebt).to.equal("0");

      const barterAmount = BigInt(100 * 10 ** 18).toString();
      let maxPayout = await daiBarter.maxPayout();
      let payout = await daiBarter.payoutFor(
        BigInt(barterAmount) / BigInt(10 ** 9)
      );

      expect(Number(payout)).to.be.lessThanOrEqual(Number(maxPayout));

      await dai.mint(deployer.address, barterAmount);
      // Approve the transfer DAI from deployer to our daiBarter
      await dai.approve(daiBarter.address, `1${strOfZeros(20)}`);

      // ========================Deposit==================================
      await daiBarter.deposit(barterAmount, "100000", deployer.address);
      // =================================================================

      await mineBlocks(5);
      await expect(daiBarter.redeem(deployer.address, "1")).to.be.revertedWith(
        "ERC20: approve to the zero address"
      );
    });

    it("should be able to redeem with _stake set to true", async () => {
      const { treasury, dai, usv, daiBarter, staking, stakingHelper } =
        deployed;
      await initBarter({ vestingLen: "10" }); // set barter versting length to 10, for faster check
      if (stakingHelper) {
        await daiBarter.setStaking(stakingHelper.address, "1");
      }

      // Mint some USV
      await mintUSVWithDai({
        treasury,
        dai,
        usv,
        amountDai: `1${strOfZeros(21)}`, // 1000 DAI
        amountUsv: `4${strOfZeros(11)}`, // 400 USV
      });

      let currentDebt = await daiBarter.currentDebt();
      expect(currentDebt).to.equal("0");

      const barterAmount = BigInt(100 * 10 ** 18).toString();
      let maxPayout = await daiBarter.maxPayout();
      let payout = await daiBarter.payoutFor(
        BigInt(barterAmount) / BigInt(10 ** 9)
      );

      expect(Number(payout)).to.be.lessThanOrEqual(Number(maxPayout));

      await dai.mint(deployer.address, barterAmount);
      // Approve the transfer DAI from deployer to our daiBarter
      await dai.approve(daiBarter.address, `1${strOfZeros(20)}`);

      // ========================Deposit==================================
      await daiBarter.deposit(barterAmount, "100000", deployer.address);
      // =================================================================

      await mineBlocks(5);
      await daiBarter.redeem(deployer.address, "1");
      // await expect(daiBarter.redeem(deployer.address, "1")).to.be.reverted;
    });
  });
});
