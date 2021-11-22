import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { Contract } from "ethers";
import { ethers, network } from "hardhat";
import {
  gasOverrides,
  getExistingContract,
  getExistingOrDeployContract,
  getUniswapPair,
  loadContractAddresses,
  printBalances,
  storeContractAddresses,
  strOfZeros,
  useMockDaiFrax,
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

async function step1() {
  const existingContracts = await loadContractAddresses();
  const [deployer] = await ethers.getSigners();
  console.log("Deploying contracts with the account: " + deployer.address);

  // First block epoch occurs
  const firstEpochBlock = "8961000";

  // What epoch will be first epoch
  const firstEpochNumber = "338";

  // How many blocks are in each epoch
  const epochLengthInBlocks = "2200";

  const initialMint = `21${strOfZeros(18)}`; // 19 Frax and  19 DAI

  const usv = await getExistingOrDeployContract({ contractSymbol: "USV" });
  console.log(`USV deployed to ${usv.address}`);

  // Deploy or get existing Frax
  const frax = await getExistingOrDeployContract({
    contractSymbol: "Frax",
    args: [0],
  });
  console.log(`Frax deployed to ${frax.address}`);
  if (useMockDaiFrax) {
    await frax.mint(deployer.address, initialMint);
  }

  const dai = await getExistingOrDeployContract({
    contractSymbol: "DAI",
    args: [0],
  });

  console.log(`DAI deployed to ${dai.address}`);
  if (useMockDaiFrax) {
    await dai.mint(deployer.address, initialMint, gasOverrides);
  }

  // Deploy bartering calc
  const usvBarteringCalculator = await getExistingOrDeployContract({
    contractSymbol: "UniversalBarteringCalculator",
    args: [usv.address],
  });
  console.log(
    `UniversalBarteringCalculator deployed to ${usvBarteringCalculator.address}`
  );

  // Deploy sUSV
  const sUSV = await getExistingOrDeployContract({ contractSymbol: "sUSV" });
  console.log(`sUSV deployed to ${sUSV.address}`);

  // Deploy Staking
  const staking = await getExistingOrDeployContract({
    contractSymbol: "Staking",
    args: [
      usv.address,
      sUSV.address,
      epochLengthInBlocks,
      firstEpochNumber,
      firstEpochBlock,
    ],
  });
  console.log(`Staking deployed to ${staking.address}`);

  // Deploy staking warmpup
  const stakingWarmup = await getExistingOrDeployContract({
    contractSymbol: "StakingWarmpup",
    args: [staking.address, sUSV.address],
  });
  console.log(`StakingWarmpup deployed to ${stakingWarmup.address}`);
  // Deploy staking helper
  const stakingHelper = await getExistingOrDeployContract({
    contractSymbol: "StakingHelper",
    args: [staking.address, usv.address],
  });
  console.log(`StakingHelper deployed to ${stakingHelper.address}`);

  const redeemHelper = await getExistingOrDeployContract({
    contractSymbol: "RedeemHelper",
  });
  console.log(`RedeemHelper deployed to ${redeemHelper.address}`);
  let tx;
  if (!existingContracts["sUSV"]) {
    tx = await sUSV.initialize(staking.address, gasOverrides);
    await tx.wait();
    // Initial staking index
    const initialIndex = "7675210820";
    tx = await sUSV.setIndex(initialIndex, gasOverrides);
    await tx.wait();
  }
  const currentWarmup = await staking.warmupContract();
  if (currentWarmup !== existingContracts["StakingWarmpup"]) {
    tx = await staking.setContract("1", stakingWarmup.address, gasOverrides);
    await tx.wait();
  }

  await storeContractAddresses({
    USV: usv.address,
    Frax: frax.address,
    DAI: dai.address,
    UniversalBarteringCalculator: usvBarteringCalculator.address,
    sUSV: sUSV.address,
    Staking: staking.address,
    StakingWarmpup: stakingWarmup.address,
    StakingHelper: stakingHelper.address,
    RedeemHelper: redeemHelper.address,

    Treasury: existingContracts.Treasury,
    Distributor: existingContracts.Distributor,
    DAIBarter: existingContracts.DAIBarter,
    FraxBarter: existingContracts.FraxBarter,
    DAIUSVBarter: existingContracts.DAIUSVBarter,
  });
}

const deployTreasury = async ({
  usv,
  dai,
  frax,
  withDaiUsvLP,
}: {
  usv: Contract;
  dai: Contract;
  frax: Contract;
  withDaiUsvLP: boolean;
}) => {
  // Deploy treasury
  let treasury;
  if (withDaiUsvLP) {
    const [deployer] = await ethers.getSigners();
    let tx = await usv.setVault(deployer.address, gasOverrides);
    await tx.wait();

    // mint 1 USV for deployer, will be used to create the LP pair
    tx = await usv.mint(
      deployer.address,
      ethers.utils.parseUnits("1", "gwei"),
      gasOverrides
    );
    await tx.wait();

    const daiUsvPair = await getUniswapPair({
      usv,
      otherToken: dai,
      usvAmount: ethers.utils.parseUnits("1", "gwei").toString(),
      otherTokenAmount: ethers.utils.parseUnits("1", "ether").toString(),
    });
    console.log(`Got daiUsvPair at: ${daiUsvPair}`);

    treasury = await getExistingOrDeployContract({
      contractSymbol: "Treasury",
      args: [usv.address, dai.address, frax.address, 0],
    });
    console.log(`Treasury deployed to ${treasury.address}`);

    tx = await usv.setVault(treasury.address, gasOverrides);
    await tx.wait();
  } else {
    treasury = await getExistingOrDeployContract({
      contractSymbol: "Treasury",
      args: [usv.address, dai.address, frax.address, 0],
    });
    console.log(`Treasury deployed to ${treasury.address}`);
  }

  return { treasury };
};

const setupBarters = async ({
  treasury,
  dai,
  usv,
  frax,
  staking,
  stakingHelper,
  usvBarteringCalculator,
  withDaiUsvLP,
}: {
  treasury: Contract;
  dai: Contract;
  usv: Contract;
  frax: Contract;
  staking: Contract;
  stakingHelper: Contract;
  usvBarteringCalculator: Contract;
  withDaiUsvLP: boolean;
}) => {
  const [MockAtlasTeam] = await ethers.getSigners();

  // Ethereum 0 address, used when toggling changes in treasury
  const zeroAddress = `0x${strOfZeros(40)}`;

  // DAI barter BCV
  const daiBarterBCV = "369";

  // Frax barter BCV
  const fraxBarterBCV = "690";

  // Barter vesting length in blocks. 33110 ~ 5 days
  const barterVestingLength = "33110";

  // Min barter price
  const minBarterPrice = "50000";

  // Max barter payout
  const maxBarterPayout = "50";

  // AtlasTeam fee for barter
  const barterFee = "10000";

  // Max debt barter can take on
  const maxBarterDebt = `1${strOfZeros(15)}`;

  // Initial Barter debt
  const intialBarterDebt = "0";

  // Deploy DAI barter
  const daiBarter = await getExistingOrDeployContract({
    contractSymbol: "DAIBarter",
    args: [
      usv.address,
      dai.address,
      treasury.address,
      MockAtlasTeam.address,
      zeroAddress,
    ],
  });
  console.log(`DAIBarter deployed to ${daiBarter.address}`);

  // Deploy Frax barter
  const fraxBarter = await getExistingOrDeployContract({
    contractSymbol: "FraxBarter",
    args: [
      usv.address,
      frax.address,
      treasury.address,
      MockAtlasTeam.address,
      zeroAddress,
    ],
  });
  console.log(`FraxBarter deployed to ${fraxBarter.address}`);

  let tx;

  tx = await treasury.queue("0", daiBarter.address);
  await tx.wait();
  tx = await treasury.queue("0", fraxBarter.address);
  await tx.wait();
  console.log(`treasury.queue("0", fraxBarter.address) done`);
  tx = await treasury.toggle("0", daiBarter.address, zeroAddress, gasOverrides);
  await tx.wait();
  tx = await treasury.toggle(
    "0",
    fraxBarter.address,
    zeroAddress,
    gasOverrides
  );
  await tx.wait();
  console.log(`treasury.toggle("0", fraxBarter.address, zeroAddress); done`);

  tx = await daiBarter.initializeBarterTerms(
    daiBarterBCV,
    barterVestingLength,
    minBarterPrice,
    maxBarterPayout,
    barterFee,
    maxBarterDebt,
    intialBarterDebt,
    {
      gasLimit: 2100000,
      gasPrice: 8000000000,
    }
  );
  await tx.wait();

  // Set staking for DAI and Frax barter
  tx = await daiBarter.setStaking(
    staking.address,
    stakingHelper.address,
    gasOverrides
  );
  await tx.wait();

  tx = await fraxBarter.initializeBarterTerms(
    fraxBarterBCV,
    barterVestingLength,
    minBarterPrice,
    maxBarterPayout,
    barterFee,
    maxBarterDebt,
    intialBarterDebt,
    gasOverrides
  );
  await tx.wait();
  console.log(`11`);
  tx = await fraxBarter.setStaking(
    staking.address,
    stakingHelper.address,
    gasOverrides
  );
  await tx.wait();
  console.log(`11a`);

  if (withDaiUsvLP) {
    const daiUsvPair = await getUniswapPair({
      usv,
      otherToken: dai,
      usvAmount: ethers.utils.parseUnits("1", "gwei").toString(),
      otherTokenAmount: ethers.utils.parseUnits("1", "ether").toString(),
    });
    const daiUsvBarter = await getExistingOrDeployContract({
      contractSymbol: "DAIUSVBarter",
      args: [
        usv.address,
        daiUsvPair,
        treasury.address,
        MockAtlasTeam.address,
        usvBarteringCalculator.address,
      ],
    });

    console.log(
      `DaiUsvBarter deployed to ${daiUsvBarter.address}, with pair at: ${daiUsvPair}`
    );
    tx = await treasury.queue("0", daiUsvBarter.address, gasOverrides);
    await tx.wait();
    tx = await treasury.toggle(
      "0",
      daiUsvBarter.address,
      zeroAddress,
      gasOverrides
    );
    await tx.wait();

    const daiUsvBCV = "119";
    tx = await daiUsvBarter.initializeBarterTerms(
      daiUsvBCV,
      barterVestingLength,
      "0",
      "30",
      barterFee,
      BigInt(5 * 10 ** 22),
      intialBarterDebt,
      gasOverrides
    );
    await tx.wait();

    tx = await daiUsvBarter.setStaking(
      staking.address,
      stakingHelper.address,
      gasOverrides
    );
    await tx.wait();
  }

  return { daiBarter, fraxBarter };
};

async function step2() {
  await loadContractAddresses();
  const [deployer, MockAtlasTeam] = await ethers.getSigners();
  console.log("Deploying contracts with the account: " + deployer.address);

  const usv = await getExistingContract({ contractSymbol: "USV" });
  console.log(`Attached to USV at ${usv.address}`);

  console.log(
    `USV Balance of Deployer: ${await usv.balanceOf(deployer.address)}`
  );

  // Deploy or get existing Frax
  const frax = await getExistingContract({
    contractSymbol: "Frax",
  });
  console.log(`Attached to Frax at ${frax.address}`);

  const dai = await getExistingContract({
    contractSymbol: "DAI",
  });
  console.log(`Attached to DAI at ${dai.address}`);

  // Deploy bartering calc
  const usvBarteringCalculator = await getExistingContract({
    contractSymbol: "UniversalBarteringCalculator",
  });
  console.log(
    `Attached to UniversalBarteringCalculator at ${usvBarteringCalculator.address}`
  );

  // Deploy sUSV
  const sUSV = await getExistingContract({ contractSymbol: "sUSV" });
  console.log(`Attached to SUSV at ${sUSV.address}`);

  // Deploy Staking
  const staking = await getExistingContract({
    contractSymbol: "Staking",
  });
  console.log(`Attached to Staking at ${staking.address}`);

  // Deploy staking warmpup
  const stakingWarmup = await getExistingContract({
    contractSymbol: "StakingWarmpup",
  });
  console.log(`Attached to StakingWarmpup at ${stakingWarmup.address}`);
  // Deploy staking helper
  const stakingHelper = await getExistingContract({
    contractSymbol: "StakingHelper",
  });
  console.log(`Attached to StakingHelper at ${stakingHelper.address}`);

  // First block epoch occurs
  const firstEpochBlock = "8961000";

  // How many blocks are in each epoch
  const epochLengthInBlocks = "2200";

  // Initial reward rate for epoch
  const initialRewardRate = "3000";

  // Ethereum 0 address, used when toggling changes in treasury
  const zeroAddress = `0x${strOfZeros(40)}`;

  // Large number for approval for Frax and DAI
  const largeApproval = `1${strOfZeros(32)}`;

  const { treasury } = await deployTreasury({
    usv,
    dai,
    frax,
    withDaiUsvLP: true,
  });

  // Deploy staking distributor
  const distributor = await getExistingOrDeployContract({
    contractSymbol: "Distributor",
    args: [treasury.address, usv.address, epochLengthInBlocks, firstEpochBlock],
  });
  console.log(`Distributor deployed to ${distributor.address}`);

  console.log(`12`);

  // set distributor contract and warmup contract
  let tx = await staking.setContract("0", distributor.address, gasOverrides);
  await tx.wait();

  console.log(`13`);

  // Set treasury for USV token
  await usv.setVault(treasury.address, gasOverrides);
  console.log(`14`);

  // Add staking contract as distributor recipient
  tx = await distributor.addRecipient(
    staking.address,
    initialRewardRate,
    gasOverrides
  );
  await tx.wait();
  console.log(`15`);

  // queue and toggle reward manager
  tx = await treasury.queue("8", distributor.address, gasOverrides);
  await tx.wait();
  // this one needs manual gas configuration.
  await (
    await treasury.toggle("8", distributor.address, zeroAddress, gasOverrides)
  ).wait();

  console.log(`16`);

  // queue and toggle deployer reserve depositor
  await treasury.queue("0", deployer.address, gasOverrides);
  await treasury.toggle("0", deployer.address, zeroAddress, gasOverrides);
  // queue and toggle liquidity depositor
  await treasury.queue("4", deployer.address, gasOverrides);
  await treasury.toggle("4", deployer.address, zeroAddress, gasOverrides);

  console.log(`17`);

  await dai.approve(treasury.address, largeApproval, gasOverrides);
  await frax.approve(treasury.address, largeApproval, gasOverrides);

  console.log(`19`);
  const { daiBarter, fraxBarter } = await setupBarters({
    treasury,
    usv,
    dai,
    frax,
    staking,
    stakingHelper,
    usvBarteringCalculator,
    withDaiUsvLP: true,
  });
  console.log(`19a`);

  // Approve dai and frax barters to spend deployer's DAI and Frax
  await dai.approve(daiBarter.address, largeApproval);
  await frax.approve(fraxBarter.address, largeApproval);

  console.log(`20`);
  // Approve staking and staking helper contact to spend deployer's USV
  await usv.approve(staking.address, largeApproval);
  await usv.approve(stakingHelper.address, largeApproval);

  // console.log(`Dai balance: ${await dai.balanceOf(deployer.address)}`);
  console.log(`21`);
  await dai.approve(treasury.address, largeApproval);
  // Deposit 13 DAI to treasury, 1 is profit and goes as excess reserves
  await treasury.deposit(
    BigInt(13 * 10 ** 18),
    dai.address,
    BigInt(3 * 10 ** 9),
    gasOverrides
  );
  await tx.wait();
  console.log(
    `USV in deployer's wallet: ${await usv.balanceOf(deployer.address)}`
  );

  console.log(`22`);
  // Deposit 13 Frax to treasury, no profit
  await treasury.deposit(BigInt(13 * 10 ** 18), frax.address, 0, gasOverrides);

  console.log(`23`);
  // Stake all USV through helper
  await stakingHelper.stake(`2${strOfZeros(8)}`, gasOverrides);

  console.log(`24`);
  // Barter 6 DAI and Frax in each of their barters
  await daiBarter.deposit(
    `6${strOfZeros(18)}`,
    "60000",
    deployer.address,
    gasOverrides
  );
  console.log(`USV in AtlasTeam: ${await usv.balanceOf(MockAtlasTeam.address)}`);
  console.log(`25`);
  await fraxBarter.deposit(
    `6${strOfZeros(18)}`,
    "60000",
    deployer.address,
    gasOverrides
  );
  console.log(`USV in AtlasTeam: ${await usv.balanceOf(MockAtlasTeam.address)}`);

  // await Promise.all(
  //   [
  //     { account: deployer.address, accountName: "deployer" },
  //     { account: MockAtlasTeam.address, accountName: "MockAtlasTeam" },
  //     { account: treasury.address, accountName: "treasury" },
  //   ].map(({ account, accountName }) =>
  //     printBalances({ dai, frax, usv, account, accountName })
  //   )
  // );
  // await getDaiAndFraxBack({ usv, dai, frax, treasury, deployer, MockAtlasTeam });
  // await pullExcessReserves({ treasury, deployer, token: frax });
  await Promise.all(
    [
      { account: deployer.address, accountName: "deployer" },
      { account: MockAtlasTeam.address, accountName: "MockAtlasTeam" },
      { account: treasury.address, accountName: "treasury" },
    ].map(({ account, accountName }) =>
      printBalances({ dai, frax, usv, account, accountName })
    )
  );

  console.log(`USV: "${usv.address}"`);
  console.log(`Frax: "${frax.address}"`);
  console.log(`DAI: "${dai.address}"`);
  console.log(`Treasury: "${treasury.address}"`);
  console.log(
    `UniversalBarteringCalculator: "${usvBarteringCalculator.address}"`
  );
  console.log(`Distributor: "${distributor.address}"`);
  console.log(`sUSV: "${sUSV.address}"`);
  console.log(`Staking: "${staking.address}"`);
  console.log(`StakingWarmpup: "${stakingWarmup.address}"`);
  console.log(`StakingHelper: "${stakingHelper.address}"`);
  console.log(`DAIBarter: "${daiBarter.address}"`);
  console.log(`FraxBarter: "${fraxBarter.address}"`);
  // await storeContractAddresses();
}

async function main() {
  console.log(`Deploying on ${network.name}`);
  await step1();
  await step2();
}

main()
  .then(() => process.exit())
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
