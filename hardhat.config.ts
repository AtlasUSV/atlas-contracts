import "@nomiclabs/hardhat-ethers";
import "@nomiclabs/hardhat-etherscan";
import "@nomiclabs/hardhat-waffle";
import { config } from "dotenv";
config();

const accounts = [
  process.env.PRIVATE_KEY_1 ||
    "f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9",
  process.env.PRIVATE_KEY_2 ||
    "f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9f9",
];

export default {
  solidity: "0.7.5",
  // defaultNetwork: "rinkeby",
  networks: {
    hardhat: {
      forking: {
        url: "https://polygon-rpc.com",
      },
    },
    polygon: {
      url: "https://rpc-mainnet.maticvigil.com",
      accounts,
    },
    ropsten: {
      url: "https://ropsten.infura.io/v3/9aa3d95b3bc440fa88ea12eaa4456161",
      accounts,
    },
    ethereum: {
      url: "https://mainnet.infura.io/v3/9aa3d95b3bc440fa88ea12eaa4456161",
      accounts,
    },
    rinkeby: {
      url:
        process.env.RINKEBY_URL ||
        "https://eth-rinkeby.alchemyapi.io/v2/Lu1mxr3KF32O-krSRn8YcibzSVAN2JUe",
      accounts,
    },
  },
  ...(process.env.ETHERSCAN_API_KEY && {
    etherscan: {
      apiKey: process.env.ETHERSCAN_API_KEY,
    },
  }),
};
