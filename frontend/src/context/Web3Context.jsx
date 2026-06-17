import React, { createContext, useState, useEffect } from "react";
import { ethers } from "ethers";

export const Web3Context = createContext();

export const Web3Provider = ({ children }) => {
  const [account, setAccount] = useState("");
  const [contract, setContract] = useState(null);
  const [contractAddress, setContractAddress] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const loadContractDetails = async () => {
    try {
      // Dynamically load to prevent compilation errors if deploy.js has not run yet
      const details = await import("../config/contractDetails.json");
      if (details && details.default) {
        setContractAddress(details.default.address);
        return details.default;
      }
      if (details && details.address) {
        setContractAddress(details.address);
        return details;
      }
    } catch (err) {
      console.warn(
        "Contract configuration not found. Smart contract interactions will be unavailable until deploy.js executes."
      );
    }
    return null;
  };

  const connectWallet = async () => {
    if (!window.ethereum) {
      setError("Please install the MetaMask browser extension to log blockchain audits.");
      return false;
    }

    setLoading(true);
    setError("");

    try {
      const provider = new ethers.BrowserProvider(window.ethereum);

      // Force MetaMask to switch to the Hardhat Local chain (31337)
      try {
        await window.ethereum.request({
          method: "wallet_switchEthereumChain",
          params: [{ chainId: "0x7a69" }], // 31337 in hex
        });
      } catch (switchError) {
        if (switchError.code === 4902) {
          try {
            await window.ethereum.request({
              method: "wallet_addEthereumChain",
              params: [
                {
                  chainId: "0x7a69",
                  chainName: "Hardhat Local",
                  rpcUrls: ["http://127.0.0.1:8545"],
                  nativeCurrency: { name: "Ethereum", symbol: "ETH", decimals: 18 }
                }
              ]
            });
          } catch (addError) {
            console.error("Failed to add Hardhat Local network:", addError);
          }
        } else {
          console.error("Failed to switch network:", switchError);
        }
      }

      // Request account permissions
      const accounts = await provider.send("eth_requestAccounts", []);
      if (accounts.length === 0) {
        throw new Error("No authorized account found.");
      }

      const currentAccount = accounts[0];
      setAccount(currentAccount);
      setIsConnected(true);

      const signer = await provider.getSigner();

      // Attempt to bind the SupplyChain contract instance
      const details = await loadContractDetails();
      if (details) {
        const supplyChainContract = new ethers.Contract(
          details.address,
          details.abi,
          signer
        );
        setContract(supplyChainContract);
      }

      setLoading(false);
      return true;
    } catch (err) {
      console.error(err);
      setError("Failed to link MetaMask: " + err.message);
      setLoading(false);
      setIsConnected(false);
      return false;
    }
  };

  // Check connection status on mount if already authorized
  useEffect(() => {
    const checkConnected = async () => {
      if (window.ethereum) {
        try {
          const provider = new ethers.BrowserProvider(window.ethereum);
          const accounts = await provider.listAccounts();
          if (accounts.length > 0) {
            // Auto switch network to Hardhat Local if connected
            try {
              await window.ethereum.request({
                method: "wallet_switchEthereumChain",
                params: [{ chainId: "0x7a69" }],
              });
            } catch (err) {
              console.warn("Auto network switch on mount bypassed:", err);
            }

            setAccount(accounts[0].address);
            setIsConnected(true);
            const signer = await provider.getSigner();
            const details = await loadContractDetails();
            if (details) {
              const supplyChainContract = new ethers.Contract(
                details.address,
                details.abi,
                signer
              );
              setContract(supplyChainContract);
            }
          }
        } catch (err) {
          console.warn("Auto web3 link check bypassed:", err);
        }
      }
    };

    checkConnected();
  }, []);

  // Listen to MetaMask account / network switches
  useEffect(() => {
    if (window.ethereum) {
      const handleAccounts = (accounts) => {
        if (accounts.length > 0) {
          setAccount(accounts[0]);
          setIsConnected(true);
          connectWallet(); // Rebind contract with the new signer
        } else {
          setAccount("");
          setIsConnected(false);
          setContract(null);
        }
      };

      const handleChain = () => {
        window.location.reload();
      };

      window.ethereum.on("accountsChanged", handleAccounts);
      window.ethereum.on("chainChanged", handleChain);

      return () => {
        window.ethereum.removeListener("accountsChanged", handleAccounts);
        window.ethereum.removeListener("chainChanged", handleChain);
      };
    }
  }, []);

  return (
    <Web3Context.Provider
      value={{
        account,
        contract,
        contractAddress,
        isConnected,
        loading,
        error,
        connectWallet
      }}
    >
      {children}
    </Web3Context.Provider>
  );
};
