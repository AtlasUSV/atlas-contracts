import { Contract } from "ethers";
import { ethers, network } from "hardhat";
import {
  gasOverrides,
  getExistingContract,
  loadContractAddresses,
} from "./utils";

// Rinkeby
const uniswapV2RouterAddr = "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D";
const uniswapV2RouterAbi = require("./abi/uniswapV2RouterAbi.json");
const uniswapV2FactoryAbi = require("./abi/uniswapV2Factory.json");
const uniswapV2FactoryAddr = "0x5C69bEe701ef814a2B6a3EDD4B1652CB9cc5aA6f";
const wethAddr = "0xc778417e063141139fce010982780140aa0cd5ab"; // get this from
const erc20Abi = require("./abi/erc20.json");

async function main() {
  console.log(`Running on ${network.name}`);
  const [deployer] = await ethers.getSigners();
  const sushiV2Router = new Contract(
    uniswapV2RouterAddr,
    uniswapV2RouterAbi,
    deployer
  );

  const uniswapV2Factory = new Contract(
    uniswapV2FactoryAddr,
    uniswapV2FactoryAbi,
    deployer
  );
  const weth = new Contract(wethAddr, erc20Abi, deployer);
  await loadContractAddresses();

  const usv = await getExistingContract({ contractSymbol: "USV" });

  const deadline = Date.now() + 30000;
  await usv.approve(uniswapV2RouterAddr, BigInt(200 * 10 ** 9));
  await weth.approve(uniswapV2RouterAddr, BigInt(10 ** 18));
  const tx = await sushiV2Router.addLiquidity(
    usv.address,
    wethAddr,
    "7900639646",
    BigInt(10 ** 18),
    "4821633249",
    BigInt(0.5 * 10 ** 18),
    deployer.address,
    deadline,
    gasOverrides
  );
  await tx.wait();

  const pairAddr = await uniswapV2Factory.getPair(usv.address, weth.address);
  console.log(`Pair address: ${pairAddr}`);
  return pairAddr;
}

main()
  .then(() => process.exit())
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
