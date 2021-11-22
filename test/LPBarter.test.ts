import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { Contract, ContractFactory } from "ethers";
import { ethers } from "hardhat";
import { getUniswapPair } from "../scripts/utils";
import { initContractFactories, strOfZeros } from "./utils";
const erc20Abi = require("../scripts/abi/erc20.json");

type DeployedContracts = {
  dai: Contract;
  // frax: Contract;
  usv: Contract;
  // staking: Contract,
  treasury: Contract;
  daiUsvLpBarter: Contract;
  daiUsvLp: string;
  barteringCalc: Contract;
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

const attachToDAIUSVLP = async (address: string) => {
  const [deployer] = await ethers.getSigners();
  return new Contract(address, erc20Abi, deployer);
};

const deployContracts = async (
  deployer: SignerWithAddress,
  MockAtlasTeam: SignerWithAddress
): Promise<DeployedContracts> => {
  const usv = await deployContract("USV");

  const dai = await deployContract("DAI", 0);

  const treasury = await deployContract(
    "Treasury",
    usv.address,
    dai.address,
    zeroAddress, // frax
    0
  );

  const barteringCalc = await deployContract(
    "UniversalBarteringCalculator",
    usv.address
  );

  const usvAmount = ethers.utils.parseUnits("1", "gwei").toString();
  const otherTokenAmount = ethers.utils.parseEther("10").toString();
  await usv.setVault(deployer.address);
  await usv.mint(deployer.address, usvAmount);
  await dai.mint(deployer.address, otherTokenAmount);
  await usv.setVault(treasury.address);

  const daiUsvLp = await getUniswapPair({
    usv,
    otherToken: dai,
    usvAmount,
    otherTokenAmount,
  });

  const daiUsvLpBarter = await deployContract(
    "DAIUSVBarter",
    usv.address,
    daiUsvLp,
    treasury.address,
    MockAtlasTeam.address,
    barteringCalc.address
  );

  // Add daiBarter as a liquidity depositor
  await treasury.queue("4", daiUsvLpBarter.address);
  await treasury.toggle("4", daiUsvLpBarter.address, zeroAddress);

  let tx = await usv.connect(deployer).setVault(treasury.address);
  await tx.wait();

  return {
    dai,
    usv,
    treasury,
    daiUsvLpBarter,
    daiUsvLp,
    barteringCalc,
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
    amountOhm,
  }: {
    treasury: Contract;
    dai: Contract;
    usv: Contract;
    amountDai: string; // 18 decimals
    amountOhm: string; // 9 decimals
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
      BigInt(amountDai) / BigInt(`1${strOfZeros(9)}`) - BigInt(amountOhm);

    // deposit amountDai of DAI and get amountOhm of USV out into our deployer's wallet
    tx = await treasury.deposit(amountDai, dai.address, profit);
    await tx.wait();

    // USV supply should increase by amountOhm
    expect(await usv.totalSupply()).to.equal(
      (BigInt(oldSupply) + BigInt(amountOhm)).toString()
    );

    // Treasury reserve should increase by (amountDai / 1e9)
    const expected =
      BigInt(oldReserve) + BigInt(amountDai) / BigInt(`1${strOfZeros(9)}`);
    expect(await treasury.totalReserves()).to.equal(expected.toString());
  };

  // DAI barter BCV
  const daiBarterBCV = "119";
  // Barter vesting length in blocks. 33110 ~ 5 days
  const barterVestingLength = "33110";
  // Max barter payout
  const maxBarterPayout = "50"; // 0.05% of total supply for a single payout.
  // AtlasTeam fee for barter
  const barterFee = "50000";
  // Max debt barter can take on
  const maxBarterDebt = "1000000000000000";
  // Initial Barter debt
  const intialBarterDebt = "0";

  const initBarter = async ({ minBarterPrice }: { minBarterPrice: string }) => {
    const { daiUsvLpBarter } = deployed;

    await daiUsvLpBarter.initializeBarterTerms(
      daiBarterBCV,
      barterVestingLength,
      minBarterPrice,
      maxBarterPayout,
      barterFee,
      maxBarterDebt,
      intialBarterDebt
    );
  };

  describe("maxPayout()", () => {
    it("should return the maxPayout", async () => {
      const { usv, dai, treasury, daiUsvLpBarter } = deployed;

      await initBarter({ minBarterPrice: "0" });

      const maxPayout = await daiUsvLpBarter.maxPayout();
      // The the total supply of USV is zero, so does the maxPayout!
      expect(maxPayout).to.eq(500000);

      // Mint some USV
      await mintUSVWithDai({
        treasury,
        dai,
        usv,
        amountDai: `10${strOfZeros(18)}`,
        amountOhm: `5${strOfZeros(9)}`,
      });

      // Now we have `6${strOfZeros(9)}` number of USV, apply our 0.05% maxBarterPayout ratio
      // to get the maxPayout: `0.0005 * 6${strOfZeros(9)}` = `3${strOfZeros(6)}`
      expect(await daiUsvLpBarter.maxPayout()).to.eq(`3${strOfZeros(6)}`);
    });
  });

  describe("deposit", () => {
    it("should NOT be able to deposit, before we add the LP token as a liquidity token", async () => {
      const { treasury, dai, usv, daiUsvLpBarter } = deployed;
      await initBarter({ minBarterPrice: "0" });
      // Mint some USV
      await mintUSVWithDai({
        treasury,
        dai,
        usv,
        amountDai: `9${strOfZeros(24)}`,
        amountOhm: `84${strOfZeros(14)}`,
      });

      // USV supply: 8400001 * 1e9
      // maxPayout: 8400001 * 1e9 * 0.05% = 4200000500000
      expect(await daiUsvLpBarter.maxPayout()).to.eq(`4200000500000`);

      await dai.mint(deployer.address, BigInt(10 ** 25).toString());
      // Approve the transfer DAI from deployer to our daiBarter
      await dai.approve(daiUsvLpBarter.address, `1${strOfZeros(25)}`);

      // the LP pair token is not a LIQUIDITY token for the treasury, so treasury.valueOf() returns 0
      // uint value = ITreasury( treasury ).valueOf( principle, _amount );
      // uint payout = payoutFor( value ); // payout to barterer is computed
      // require( payout >= 10000000, "Barter too small" ); // must be > 0.01 USV (10e7) ( underflow protection )
      await expect(
        daiUsvLpBarter.deposit(`1${strOfZeros(24)}`, "50000", deployer.address)
      ).to.be.revertedWith("Barter too small");
    });

    it("will get 'ds-math-sub-underflow' when deposit, if we do not have enough funds in the UsvDaiLP token", async () => {
      const { treasury, dai, usv, daiUsvLpBarter, daiUsvLp, barteringCalc } =
        deployed;
      await initBarter({ minBarterPrice: "2000" });
      // Mint some USV
      await mintUSVWithDai({
        treasury,
        dai,
        usv,
        amountDai: `9${strOfZeros(24)}`,
        amountOhm: `84${strOfZeros(14)}`,
      });

      // USV supply: 8400001 * 1e9
      // maxPayout: 8400001 * 1e9 * 0.05% = 4200000500000
      expect(await daiUsvLpBarter.maxPayout()).to.eq(`4200000500000`);

      await treasury.queue("5", daiUsvLp);
      await treasury.toggle("5", daiUsvLp, barteringCalc.address);

      await dai.mint(deployer.address, BigInt(10 ** 25).toString());
      // Approve the transfer DAI from deployer to our daiBarter
      await dai.approve(daiUsvLpBarter.address, `1${strOfZeros(25)}`);

      const amount = `1${strOfZeros(16)}`;

      const lpPair = await attachToDAIUSVLP(daiUsvLp);
      const balance = await lpPair.balanceOf(deployer.address);
      expect(Number(balance)).to.be.lessThan(Number(amount));

      // const value = await treasury.valueOf('');

      // uint value = ITreasury( treasury ).valueOf( principle, _amount );  // 1,000,000,000 (1 USV)
      // uint payout = payoutFor( value ); // payout to barterer is computed // 0.002 USV  002000000  Fraction value/barterPrice
      const value = await barteringCalc.valuation(daiUsvLp, amount);
      const payout = await daiUsvLpBarter.payoutFor(value);
      const maxPayout = await daiUsvLpBarter.maxPayout();
      expect(Number(payout)).to.be.lessThan(Number(maxPayout));
      console.log(`payout: ${payout}, maxPayout: ${maxPayout}`);

      // require( payout >= 10000000, "Barter too small" ); // must be > 0.01 USV (10e7) ( underflow protection )
      // require( payout <= maxPayout(), "Barter too large"); // size protection because there is no slippage

      // // profits are calculated
      // uint fee = payout.mul( terms.fee ).div( 10000 );
      // uint profit = value.sub( payout ).sub( fee );
      await expect(
        daiUsvLpBarter.deposit(amount, "50000", deployer.address)
      ).to.be.revertedWith("ds-math-sub-underflow");
    });

    it("will revert with ds-math-sub-underflow without approving bartering to spend UsvDaiLP token", async () => {
      const { treasury, dai, usv, daiUsvLpBarter, daiUsvLp, barteringCalc } =
        deployed;
      await initBarter({ minBarterPrice: "2000" });
      // Mint some USV
      await mintUSVWithDai({
        treasury,
        dai,
        usv,
        amountDai: `9${strOfZeros(24)}`,
        amountOhm: `84${strOfZeros(14)}`,
      });

      // USV supply: 8400001 * 1e9
      // maxPayout: 8400001 * 1e9 * 0.05% = 4200000500000
      expect(await daiUsvLpBarter.maxPayout()).to.eq(`4200000500000`);

      await treasury.queue("5", daiUsvLp);
      await treasury.toggle("5", daiUsvLp, barteringCalc.address);

      await dai.mint(deployer.address, BigInt(10 ** 25).toString());
      // Approve the transfer DAI from deployer to our daiBarter
      await dai.approve(daiUsvLpBarter.address, `1${strOfZeros(25)}`);

      const amount = `8${strOfZeros(13)}`;

      const lpPair = await attachToDAIUSVLP(daiUsvLp);
      const balance = await lpPair.balanceOf(deployer.address);
      expect(Number(balance)).to.be.greaterThanOrEqual(Number(amount));

      // const value = await treasury.valueOf('');

      // uint value = ITreasury( treasury ).valueOf( principle, _amount );  // 1,000,000,000 (1 USV)
      // uint payout = payoutFor( value ); // payout to barterer is computed // 0.002 USV  002000000  Fraction value/barterPrice
      const value = await barteringCalc.valuation(daiUsvLp, amount);
      const payout = await daiUsvLpBarter.payoutFor(value);
      const maxPayout = await daiUsvLpBarter.maxPayout();
      expect(Number(payout)).to.be.lessThan(Number(maxPayout));
      console.log(`payout: ${payout}, maxPayout: ${maxPayout}`);

      // require( payout >= 10000000, "Barter too small" ); // must be > 0.01 USV (10e7) ( underflow protection )
      // require( payout <= maxPayout(), "Barter too large"); // size protection because there is no slippage

      // // profits are calculated
      // uint fee = payout.mul( terms.fee ).div( 10000 );
      // uint profit = value.sub( payout ).sub( fee );
      await expect(
        daiUsvLpBarter.deposit(amount, "50000", deployer.address)
      ).to.be.revertedWith("ds-math-sub-underflow");
    });

    it("should be able to deposit", async () => {
      const { treasury, dai, usv, daiUsvLpBarter, daiUsvLp, barteringCalc } =
        deployed;
      await initBarter({ minBarterPrice: "2000" });
      // Mint some USV
      await mintUSVWithDai({
        treasury,
        dai,
        usv,
        amountDai: `9${strOfZeros(24)}`,
        amountOhm: `84${strOfZeros(14)}`,
      });

      // USV supply: 8400001 * 1e9
      // maxPayout: 8400001 * 1e9 * 0.05% = 4200000500000
      expect(await daiUsvLpBarter.maxPayout()).to.eq(`4200000500000`);

      await treasury.queue("5", daiUsvLp);
      await treasury.toggle("5", daiUsvLp, barteringCalc.address);

      await dai.mint(deployer.address, BigInt(10 ** 25).toString());
      // Approve the transfer DAI from deployer to our daiBarter
      await dai.approve(daiUsvLpBarter.address, `1${strOfZeros(25)}`);

      const amount = `8${strOfZeros(13)}`;

      const lpPair = await attachToDAIUSVLP(daiUsvLp);
      const balance = await lpPair.balanceOf(deployer.address);
      expect(Number(balance)).to.be.greaterThanOrEqual(Number(amount));

      // uint value = ITreasury( treasury ).valueOf( principle, _amount );  // 1,000,000,000 (1 USV)
      // uint payout = payoutFor( value ); // payout to barterer is computed // 0.002 USV  002000000  Fraction value/barterPrice
      const value = await barteringCalc.valuation(daiUsvLp, amount);
      const payout = await daiUsvLpBarter.payoutFor(value);
      const maxPayout = await daiUsvLpBarter.maxPayout();
      expect(Number(payout)).to.be.lessThan(Number(maxPayout));
      console.log(`payout: ${payout}, maxPayout: ${maxPayout}`);

      // require( payout >= 10000000, "Barter too small" ); // must be > 0.01 USV (10e7) ( underflow protection )
      // require( payout <= maxPayout(), "Barter too large"); // size protection because there is no slippage

      // // profits are calculated
      // uint fee = payout.mul( terms.fee ).div( 10000 );
      // uint profit = value.sub( payout ).sub( fee );
      await lpPair.approve(daiUsvLpBarter.address, amount);
      await daiUsvLpBarter.deposit(amount, "50000", deployer.address);

      expect(await lpPair.balanceOf(treasury.address)).to.equal(amount);
    });

    it("will get 'SafeMath: subtraction overflow' for some settings when deposit", async () => {
      const { treasury, dai, usv, daiUsvLpBarter, daiUsvLp, barteringCalc } =
        deployed;
      await initBarter({ minBarterPrice: "0" });
      // Mint some USV
      await mintUSVWithDai({
        treasury,
        dai,
        usv,
        amountDai: `9${strOfZeros(24)}`,
        amountOhm: `84${strOfZeros(14)}`,
      });

      // USV supply: 8400001 * 1e9
      // maxPayout: 8400001 * 1e9 * 0.05% = 4200000500000
      expect(await daiUsvLpBarter.maxPayout()).to.eq(`4200000500000`);

      await treasury.queue("5", daiUsvLp);
      await treasury.toggle("5", daiUsvLp, barteringCalc.address);

      await dai.mint(deployer.address, BigInt(10 ** 25).toString());
      // Approve the transfer DAI from deployer to our daiBarter
      await dai.approve(daiUsvLpBarter.address, `1${strOfZeros(25)}`);

      const amount = `1${strOfZeros(16)}`;

      // const value = await treasury.valueOf('');

      // uint value = ITreasury( treasury ).valueOf( principle, _amount );  // 1,000,000,000 (1 USV)
      // uint payout = payoutFor( value ); // payout to barterer is computed // 0.002 USV  002000000  Fraction value/barterPrice
      const value = await barteringCalc.valuation(daiUsvLp, amount);
      const payout = await daiUsvLpBarter.payoutFor(value);
      expect(value).to.equal(payout);
      const maxPayout = await daiUsvLpBarter.maxPayout();
      expect(Number(payout)).to.be.lessThan(Number(maxPayout));
      console.log(`payout: ${payout}, maxPayout: ${maxPayout}`);

      // require( payout >= 10000000, "Barter too small" ); // must be > 0.01 USV (10e7) ( underflow protection )
      // require( payout <= maxPayout(), "Barter too large"); // size protection because there is no slippage

      // // profits are calculated
      // uint fee = payout.mul( terms.fee ).div( 10000 );
      // Here, payout equals value, so subtraction overflows for 0.sub(fee)
      // uint profit = value.sub( payout ).sub( fee );
      await expect(
        daiUsvLpBarter.deposit(amount, "50000", deployer.address)
      ).to.be.revertedWith("SafeMath: subtraction overflow");
    });
  });
});
