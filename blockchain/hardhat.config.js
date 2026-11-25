require("@nomicfoundation/hardhat-toolbox");

// Hardhat's well-known development mnemonic. The same 5 accounts are pre-funded in the
// Besu genesis block (see network/scripts/generate-genesis.js), so MetaMask accounts work
// identically on both networks. NEVER use this mnemonic on a public network.
const DEV_MNEMONIC = "test test test test test test test test test test test junk";

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
      // The Besu QBFT genesis activates Cancun at block 0 (OZ 5.6 ECDSA uses MCOPY).
      evmVersion: "cancun"
    }
  },
  networks: {
    hardhat: {
      chainId: 31337
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337
    },
    // 4-validator Hyperledger Besu QBFT consortium network (network/docker-compose.yml)
    besu: {
      url: process.env.BESU_RPC_URL || "http://127.0.0.1:8545",
      chainId: 2026,
      accounts: { mnemonic: DEV_MNEMONIC, count: 10 },
      gasPrice: 1_000_000_000
    },
    // Public-chain stand-in for checkpoint anchoring demos: `npx hardhat node --port 8600`
    publicLocal: {
      url: process.env.PUBLIC_RPC_URL || "http://127.0.0.1:8600",
      chainId: 31337,
      accounts: { mnemonic: DEV_MNEMONIC, count: 10 }
    },
    // Polygon Amoy testnet (public checkpoints). Only enabled when AMOY_RPC_URL is set;
    // fund CHECKPOINT_PRIVATE_KEY with free test POL from the Polygon faucet first.
    ...(process.env.AMOY_RPC_URL
      ? {
          amoy: {
            url: process.env.AMOY_RPC_URL,
            chainId: 80002,
            accounts: process.env.CHECKPOINT_PRIVATE_KEY ? [process.env.CHECKPOINT_PRIVATE_KEY] : []
          }
        }
      : {})
  },
  gasReporter: {
    enabled: process.env.REPORT_GAS === "true",
    currency: "USD"
  },
  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts"
  }
};
