import { SignerWithAddress } from "@nomiclabs/hardhat-ethers/signers";
import { Contract } from "ethers";
import fs from "fs";
import { ethers, network } from "hardhat";
const abi = require("./abi/erc20.json");

const daiReferenceAddresses: { [key: string]: string } = {
  rinkeby: "0xA899118f4BCCb62F8c6A37887a4F450D8a4E92E0", // mock
  // rinkeby: "0x5592ec0cfb4dbc12d3ab100b257153436a1f0fea",
  polygon: "0x8f3cf7ad23cd3cadbd9735aff958023239c6a063",
  hardhat: "0x8f3cf7ad23cd3cadbd9735aff958023239c6a063",
};

const fraxReferenceAddress: { [key: string]: string } = {
  rinkeby: "0x2B8F5e69C35c1Aff4CCc71458CA26c2F313c3ed3", // mock
  polygon: "0x104592a158490a9228070e0a8e5343b499e125d0",
  hardhat: "0x104592a158490a9228070e0a8e5343b499e125d0",
};

let contractAddresses: { [k: string]: string } = {
  USV: "",
  Frax: "",
  DAI: "",
  UniversalBarteringCalculator: "",
  sUSV: "",
  Staking: "",
  StakingWarmpup: "",
  StakingHelper: "",
  RedeemHelper: "",

  Treasury: "",
  Distributor: "",
  DAIBarter: "",
  FraxBarter: "",
  DAIUSVBarter: "",
};

export const storeContractAddresses = async ({
  USV,
  Frax,
  DAI,
  UniversalBarteringCalculator,
  sUSV,
  Staking,
  StakingWarmpup,
  StakingHelper,
  RedeemHelper,

  Treasury,
  Distributor,
  DAIBarter,
  FraxBarter,
  DAIUSVBarter,
}: {
  // step1
  USV: string;
  Frax: string;
  DAI: string;
  UniversalBarteringCalculator: string;
  sUSV: string;
  Staking: string;
  StakingWarmpup: string;
  StakingHelper: string;
  RedeemHelper: string;

  // step3
  Treasury: string;
  Distributor: string;
  DAIBarter: string;
  FraxBarter: string;
  DAIUSVBarter: string;
}) => {
  const filename = `./scripts/config/addresses-${network.name}.json`;
  await fs.promises.writeFile(
    filename,
    JSON.stringify(
      {
        USV,
        Frax,
        DAI,
        UniversalBarteringCalculator,
        sUSV,
        Staking,
        StakingWarmpup,
        StakingHelper,
        RedeemHelper,

        Treasury,
        Distributor,
        DAIBarter,
        FraxBarter,
        DAIUSVBarter,
      },
      null,
      2
    )
  );
};

export const loadContractAddresses = async () => {
  const filename = `./scripts/config/addresses-${network.name}.json`;
  if (fs.existsSync(filename)) {
    const data = await fs.promises.readFile(filename);
    contractAddresses = JSON.parse(data.toString());
  } else {
    throw new Error(`File not found: ${filename}`);
  }
  return contractAddresses;
};

export const useMockDaiFrax = true;
export const useMockBarters = false;

const getSolidityCalssName = (symbol: string) => {
  const symbolToSolidityClassName: { [key: string]: string } = {
    USV: "UniversalERC20Token",
    Frax: "MockFRAX",
    DAI: "MockDAI",
    UniversalBarteringCalculator: "UniversalBarteringCalculator",
    sUSV: "sUniversal",
    Staking: "UniversalStaking",
    StakingWarmpup: "StakingWarmup",
    StakingHelper: "StakingHelper",
    RedeemHelper: "RedeemHelper",

    Treasury: "UniversalTreasury",
    Distributor: "Distributor",
    DAIBarter: "UniversalBarterDepository",
    FraxBarter: "UniversalBarterDepository",
    DAIUSVBarter: "UniversalBarterDepository",
  };
  return symbolToSolidityClassName[symbol];
};

export const getExistingContract = async ({
  contractSymbol,
}: {
  contractSymbol: string;
}): Promise<Contract> => {
  const factoryName = getSolidityCalssName(contractSymbol);
  if (!factoryName) {
    throw new Error(`Unknwon contractSymbol ${contractSymbol}`);
  }
  const factory = await ethers.getContractFactory(factoryName);
  if (!factory) {
    throw new Error(`Factory for ${contractSymbol} not found`);
  }
  if (!contractAddresses[contractSymbol]) {
    throw new Error(`Contract address for ${contractSymbol} not found`);
  }

  const contract = await factory.attach(contractAddresses[contractSymbol]);
  // const [deployer] = await ethers.getSigners();
  return contract;
};

export const getExistingOrDeployContract = async ({
  contractSymbol,
  args = [],
}: {
  contractSymbol: string;
  args?: any[];
}) => {
  if (!useMockDaiFrax) {
    if (contractSymbol === "DAI" && daiReferenceAddresses[network.name]) {
      const [deployer] = await ethers.getSigners();
      return new ethers.Contract(
        daiReferenceAddresses[network.name],
        abi,
        deployer
      );
    }
    if (contractSymbol === "Frax" && fraxReferenceAddress[network.name]) {
      const [deployer] = await ethers.getSigners();
      return new ethers.Contract(
        fraxReferenceAddress[network.name],
        abi,
        deployer
      );
    }
  }
  const factoryName = getSolidityCalssName(contractSymbol);
  if (!factoryName) {
    throw new Error(`Unknwon contractSymbol ${contractSymbol}`);
  }
  const factory = await ethers.getContractFactory(factoryName);
  if (!factory) {
    throw new Error(`Factory for ${contractSymbol} not found`);
  }
  if (!contractAddresses[contractSymbol]) {
    console.log(`Deploying new contract for ${contractSymbol}...`);
    const contract = await factory.deploy(...args);
    return contract.deployed();
  }
  const contract = await factory.attach(contractAddresses[contractSymbol]);
  // const [deployer] = await ethers.getSigners();
  return contract;
};

export const strOfZeros = (n: number) => {
  return Array(n).fill("0").join("");
};

export const gasOverrides = {
  gasLimit: 5000000,
  gasPrice: 8000000000,
};

export const withdrawAllTokenFromTreasury = async ({
  holder,
  token,
  usv,
  treasury,
}: {
  holder: SignerWithAddress;
  token: Contract;
  usv: Contract;
  treasury: Contract;
}): Promise<void> => {
  const balance = await usv.balanceOf(holder.address);
  const decimals = await token.decimals();
  const usvDecimals = await usv.decimals();

  const tokenInTreasury = BigInt(await token.balanceOf(treasury.address));

  let tokenToWithdraw =
    (BigInt(balance) * BigInt(`1${strOfZeros(decimals)}`)) /
    BigInt(10 ** usvDecimals);
  if (tokenToWithdraw > tokenInTreasury) {
    tokenToWithdraw = tokenInTreasury;
  }
  console.log(`Approving treasury to burn my usv`);
  // Allow treasury to burn my usv
  let tx = await usv
    .connect(holder)
    .approve(treasury.address, balance, gasOverrides);
  await tx.wait();

  if (!(await treasury.isReserveSpender(holder.address))) {
    tx = await treasury.queue(1, holder.address, gasOverrides);
    await tx.wait();

    const zeroAddress = `0x${strOfZeros(40)}`;
    tx = await treasury.toggle(1, holder.address, zeroAddress, gasOverrides);
    await tx.wait();
  }
  const isReserveSpender = await treasury.isReserveSpender(holder.address);
  console.log(`isReserveSpender: ${isReserveSpender}`);

  // console.log(
  //   `amountTokenInTreasury: ${await token.balanceOf(treasury.address)}`
  // );
  // console.log(`tokenToWithdraw: ${tokenToWithdraw}`);
  tx = await treasury
    .connect(holder)
    .withdraw(tokenToWithdraw, token.address, gasOverrides);
  await tx.wait();
  // console.log(
  //   `amountTokenInTreasury: ${await token.balanceOf(treasury.address)}`
  // );
};

export const pullExcessReserves = async ({
  treasury,
  deployer,
  token,
}: {
  token: Contract;
  treasury: Contract;
  deployer: SignerWithAddress;
}) => {
  const isReserveManager = await treasury.isReserveManager(deployer.address);
  if (!isReserveManager) {
    let tx = await treasury.queue(3, deployer.address, gasOverrides);
    await tx.wait();

    const zeroAddress = `0x${strOfZeros(40)}`;
    tx = await treasury.toggle(3, deployer.address, zeroAddress, gasOverrides);
    await tx.wait();
  }
  const totalTokensOwnedByTreasury = await token.balanceOf(treasury.address);
  const totalReserves = await treasury.totalReserves();
  const excessReserves = await treasury.excessReserves();
  console.log(
    `totalTokensOwnedByTreasury: ${totalTokensOwnedByTreasury},
     totalReserves: ${totalReserves},
     excessReserves: ${excessReserves}`
  );
  const toPull = BigInt(excessReserves) * BigInt(10 ** 9);
  let tx = await treasury
    .connect(deployer)
    .manage(token.address, toPull, gasOverrides);
  await tx.wait();
};

export const printBalances = async ({
  dai,
  frax,
  usv,
  account,
  accountName,
}: {
  dai: Contract;
  frax: Contract;
  usv: Contract;
  accountName: string;
  account: string;
}) => {
  console.log(
    `${accountName} ===> daiBalance: ${await dai.balanceOf(
      account
    )}, fraxBalance: ${await frax.balanceOf(
      account
    )}, usvBalance: ${await usv.balanceOf(account)}`
  );
};

export const getUniswapPair = async ({
  usv,
  otherToken,
  usvAmount = BigInt(1 * 10 ** 9),
  otherTokenAmount = BigInt(1 * 10 ** 18),
}: {
  usv: Contract;
  otherToken: Contract;
  usvAmount: string | number | BigInt;
  otherTokenAmount: string | number | BigInt;
}) => {
  console.log(`Running on ${network.name}`);

  // const uniswapV2RouterAddr = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
  const uniswapV2RouterAbi = require("./abi/uniswapV2RouterAbi.json");
  const uniswapV2FactoryAbi = require("./abi/uniswapV2Factory.json");
  // const uniswapV2FactoryAddr = "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f";

  const sushiSwapV2RouterAddr = "0x1b02dA8Cb0d097eB8D57A175b88c7D8b47997506";
  const sushiSwapV2FactoryAddr = "0xc35dadb65012ec5796536bd9864ed8773abc74c4";

  const [deployer] = await ethers.getSigners();
  const sushiV2Router = new Contract(
    sushiSwapV2RouterAddr,
    uniswapV2RouterAbi,
    deployer
  );

  const uniswapV2Factory = new Contract(
    sushiSwapV2FactoryAddr,
    uniswapV2FactoryAbi,
    deployer
  );
  // const weth = new Contract(wethAddr, erc20Abi, deployer);

  let pairAddr = await uniswapV2Factory.getPair(
    usv.address,
    otherToken.address
  );
  console.log(`Pair address: ${pairAddr}`);

  if (pairAddr === "0x0000000000000000000000000000000000000000") {
    // Pair doesn't exist, create it
    const deadline = Date.now() + 30000;
    await usv.approve(sushiSwapV2RouterAddr, usvAmount);
    await otherToken.approve(sushiSwapV2RouterAddr, otherTokenAmount);
    const tx = await sushiV2Router.addLiquidity(
      usv.address,
      otherToken.address,
      usvAmount,
      otherTokenAmount,
      BigInt(0.5 * Number(usvAmount)),
      BigInt(0.5 * Number(otherTokenAmount)),
      deployer.address,
      deadline,
      gasOverrides
    );
    await tx.wait();

    pairAddr = await uniswapV2Factory.getPair(usv.address, otherToken.address);
    console.log(`Pair address: ${pairAddr}`);
  }
  return pairAddr;
};
