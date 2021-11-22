import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { expect } from "chai";
import { Contract, ContractFactory } from "ethers";
import { ethers } from "hardhat";
import { strOfZeros } from "../scripts/utils";
import { initContractFactories } from "./utils";

describe("UniversalStaking", () => {
  let contractFactories: {
    [k: string]: ContractFactory;
  };
  let deployed: {
    [k: string]: Contract;
  };
  let deployer: SignerWithAddress;
  let addr1: SignerWithAddress;
  let mockAtlasTeam: SignerWithAddress;

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
  const zeroAddress = `0x${strOfZeros(40)}`;

  const deployContracts = async (): Promise<{ [k: string]: Contract }> => {
    const usv = await deployContract("USV");
    console.log(`USV deployed to ${usv.address}`);

    const sUsv = await deployContract("sUSV");

    // How many blocks are in each epoch
    const epochLengthInBlocks = "4"; // pick a small number for epoch
    // What epoch will be first epoch
    // pick a small number for epoch start, so we will trigger rebase for every staking
    const firstEpochNumber = "0";
    // First block epoch occurs
    const firstEpochBlock = "0";
    const staking = await deployContract(
      "Staking",
      usv.address,
      sUsv.address,
      epochLengthInBlocks,
      firstEpochNumber,
      firstEpochBlock
    );

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
    console.log(`StakingWarmpup deployed to ${stakingWarmup.address}`);

    const dai = await deployContract("DAI", 0);
    const treasury = await deployContract(
      "Treasury",
      usv.address,
      dai.address,
      zeroAddress,
      0
    );

    // Deploy staking distributor
    const distributor = await deployContract(
      "Distributor",
      treasury.address,
      usv.address,
      epochLengthInBlocks,
      firstEpochBlock
    );
    console.log(`Distributor deployed to ${distributor.address}`);

    await sUsv.initialize(staking.address);
    await sUsv.setIndex("7675210820");

    let tx = await staking.setContract("1", stakingWarmup.address);
    await tx.wait();

    tx = await staking.setContract("0", distributor.address);
    await tx.wait();

    // queue and toggle reward manager
    tx = await treasury.queue("8", distributor.address);
    await tx.wait();
    // this one needs manual gas configuration.
    await (await treasury.toggle("8", distributor.address, zeroAddress)).wait();

    return {
      sUsv,
      usv,
      staking,
      stakingHelper,
      treasury,
      dai,
      distributor,
    };
  };

  // Mint 19 USV for both deployer and addr1
  // 2 DAI are stored in treasury as excesss reserve
  beforeEach(async () => {
    const accounts = await ethers.getSigners();
    deployer = accounts[0];
    addr1 = accounts[1];

    deployed = await deployContracts();

    const { dai, usv, treasury } = deployed;

    await dai.mint(deployer.address, BigInt(10 ** 20)); // 100 DAI
    await dai.mint(addr1.address, BigInt(10 ** 20)); // 100 DAI

    const amountDai = ethers.utils.parseEther("20").toString(); // 20 DAI
    const profit = ethers.utils.parseUnits("1", "gwei").toString(); // 1 USV as profit
    await usv.setVault(treasury.address);

    // Set deployer as a ReserveDepositor
    await treasury.queue("0", deployer.address);
    await treasury.toggle("0", deployer.address, zeroAddress);
    await dai.approve(treasury.address, amountDai);
    let tx = await treasury.deposit(amountDai, dai.address, profit);
    await tx.wait();

    expect(await usv.balanceOf(deployer.address)).to.equal(
      ethers.utils.parseUnits("19", "gwei")
    );

    // Set deployer as a ReserveDepositor
    await treasury.queue("0", addr1.address);
    await treasury.toggle("0", addr1.address, zeroAddress);
    await dai.connect(addr1).approve(treasury.address, amountDai);
    tx = await treasury.connect(addr1).deposit(amountDai, dai.address, profit);
    await tx.wait();

    expect(await usv.balanceOf(addr1.address)).to.equal(
      ethers.utils.parseUnits("19", "gwei")
    );

    // All 40 DAI should be in treasury
    expect(await dai.balanceOf(treasury.address)).to.equal(
      ethers.utils.parseUnits("40", "ether")
    );
  });

  describe("stake", () => {
    const amount = ethers.utils.parseUnits("1", "gwei").toString();

    const stake = async ({
      signer,
      amount,
    }: {
      signer: SignerWithAddress;
      amount: string;
    }) => {
      const { staking, usv } = deployed;
      await usv.connect(signer).approve(staking.address, amount);
      let tx = await staking.connect(signer).stake(amount, signer.address);
      await tx.wait();

      tx = await staking.connect(signer).claim(signer.address);
      await tx.wait();
    };

    it("should be NO rewards without setting up receipient for distributor", async () => {
      const { sUsv } = deployed;
      await stake({ signer: deployer, amount });

      expect(await sUsv.balanceOf(deployer.address)).to.equal(amount);
      expect(await sUsv.circulatingSupply()).to.equal(amount);

      await stake({ signer: addr1, amount });

      const balance1 = await sUsv.balanceOf(deployer.address);
      expect(balance1.toString()).to.equal(
        ethers.utils.parseUnits("1", "gwei")
      );

      const balance2 = await sUsv.balanceOf(addr1.address);
      expect(balance2.toString()).to.equal(
        ethers.utils.parseUnits("1", "gwei")
      );
    });

    /**
     * Walk through the test scenario
     * 1. Initial state (
     *        USV total supply = 38 * 1e9,
     *        sUSV circulating supply = 0
     *        sUSV total supply = 5000000 * 1e9,
     * )
     * 2. Deployer stakes 1e9 USV
     *    - triggers rebase
     *    - call sUSV.rebase(), as there is no profit yet, nothing happens
     *    - calls Distributor.distribute(), calculates reward for `stackingContract`
     *       * USV total supply == 38 * 1e9
     *       * Reward rate  == 3000 / 1e6 == 0.003
     *       * Reward = (USV total supply * reward rate) = 0.114 * 1e9 USV
     *       - calls `treasury.mintRewards`, mints reward to `stackingContract`
     *    - update epoch.distribute to 0.114 * 1e9 = 114000000
     *    - transfer 1e9 USV from deployer to `stackingContract`
     *    - transfer 1e9 sUSV to deployer (actually in 2 steps)
     *         a. transfer gons representing 1e9 sUSV from `stackingContract` to warmup contract
     *         b. when user calls claim, transfer 1e9 sUSV from `warmup contract` to deployer
     * 3. Addr1 stakes 1e9 USV, with State (
     *        USV total supply = 38.114 * 1e9,
     *        sUSV circulating supply = 1e9,
     *        sUSV total supply = 5000000 * 1e9
     *    )
     *   - triggers rebase
     *   - call sUSV.rebase() profit = 0.114 * 1e9
     *       * rebaseAmount = profit_.mul( _totalSupply ).div( circulatingSupply_ )
     *                      = 0.114 * 1e9 * 5000000
     *                      = 570000 * 1e9
     *       * update totalSupply_ = totalSupply_.add( rebaseAmount ) = oldTotalSupply_ * 1.114 = 5570000 * 1e9
     *       * update _gonsPerFragment = TOTAL_GONS.div( _totalSupply )
     *                                 = TOTAL_GONS.div( oldTotalSupply_ * 1.114 )
     *             As totalSupply_ increased, _gonsPerFragment should have been decreased
     *             so every existing staking holders' value (number of sUSV) have been increased.
     *        Deployer's sUSV balance is now
     *                _gonBalances[deployer.address] / _gonsPerFragment
     *              = _gonBalances[deployer.address] / TOTAL_GONS.div( oldTotalSupply_ * 1.114 )
     *              = _gonBalances[deployer.address] * 1.114 / TOTAL_GONS.div( oldTotalSupply_ )
     *              = 1.114 * 1e9 sUSV
     *  - calls Distributor.distribute(), calculates reward for `stackingContract`
     *       * USV total supply == 38.114 * 1e9
     *       * Reward rate  == 3000 / 1e6 == 0.003
     *       * Reward = (USV total supply * reward rate) = 0.114342 * 1e9 USV
     *       - calls `treasury.mintRewards`, mints reward to `stackingContract`
     *  - update epoch.distribute to 114342000
     *  - transfer 1e9 USV from addr1 to `stackingContract`
     *  - transfer 1e9 sUSV to addr1
     */
    it("should have rewards with Staking as a receipient for distributor", async () => {
      const { staking, distributor, sUsv, usv } = deployed;
      // Initial reward rate for epoch
      const initialRewardRate = "3000";
      let tx = await distributor.addRecipient(
        staking.address,
        initialRewardRate
      );
      await tx.wait();

      await stake({ signer: deployer, amount });
      const balance1 = await sUsv.balanceOf(deployer.address);
      expect(balance1.toString()).to.equal(
        ethers.utils.parseUnits("1", "gwei")
      );

      console.log(
        `sUSV circulatingSupply befor addr1's staking: ${await sUsv.circulatingSupply()}`
      );
      console.log(
        `USV totalSupply befor addr1's staking: ${await usv.totalSupply()}`
      );

      await stake({ signer: addr1, amount });
      const balance2 = await sUsv.balanceOf(deployer.address);
      console.log(
        `sUSV circulatingSupply after addr1's staking: ${await sUsv.circulatingSupply()}`
      );
      console.log(`USV totalSupply: ${await usv.totalSupply()}`);

      // USV total supply == 38 * 1e9
      // Reward rate  == 3000 / 1e6 == 0.003
      // Reward = (USV total supply * reward rate) = 0.114 sUSV
      expect(balance2.toString()).to.equal(
        ethers.utils.parseUnits("1.114", "gwei")
      );
      expect(await sUsv.balanceOf(addr1.address)).to.equal(
        ethers.utils.parseUnits("1", "gwei")
      );
    });
  });
});
