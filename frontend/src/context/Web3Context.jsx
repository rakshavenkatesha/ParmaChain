import React, { createContext, useState, useEffect, useMemo, useCallback } from "react";
import { ethers } from "ethers";

export const Web3Context = createContext();

// contractDetails.json is written by blockchain/scripts/deploy.js
const detailModules = import.meta.glob("../config/contractDetails.json", { eager: true });
const DETAILS = Object.values(detailModules)[0]?.default || null;

const NETWORK_LABELS = { 2026: "PharmaChain QBFT", 31337: "Hardhat Local" };

export const Web3Provider = ({ children }) => {
  const [account, setAccount] = useState("");
  const [signer, setSigner] = useState(null);
  const [isConnected, setIsConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [walletChainId, setWalletChainId] = useState(null);

  const chainId = DETAILS?.chainId || 31337;
  const chainIdHex = "0x" + chainId.toString(16);
  const networkName = NETWORK_LABELS[chainId] || `Chain ${chainId}`;
  // MetaMask is on a different chain than the contracts were deployed to -> never send transactions
  const wrongNetwork = isConnected && walletChainId !== null && walletChainId !== chainId;

  // Read-only provider through the Vite /rpc proxy: no wallet needed (consumer verification).
  const readProvider = useMemo(() => {
    if (!DETAILS) return null;
    return new ethers.JsonRpcProvider(`${window.location.origin}/rpc`, chainId, { staticNetwork: true });
  }, [chainId]);

  const readContract = useMemo(
    () => (DETAILS && readProvider ? new ethers.Contract(DETAILS.pharmaChain.address, DETAILS.pharmaChain.abi, readProvider) : null),
    [readProvider]
  );

  const contract = useMemo(
    () => (DETAILS && signer && !wrongNetwork ? new ethers.Contract(DETAILS.pharmaChain.address, DETAILS.pharmaChain.abi, signer) : null),
    [signer, wrongNetwork]
  );
  const registry = useMemo(
    () => (DETAILS && signer && !wrongNetwork ? new ethers.Contract(DETAILS.registry.address, DETAILS.registry.abi, signer) : null),
    [signer, wrongNetwork]
  );
  // optional v3 modules (signer-bound; null when absent or on the wrong network)
  const bindOpt = (d) => (d && signer && !wrongNetwork ? new ethers.Contract(d.address, d.abi, signer) : null);
  const governance = useMemo(() => bindOpt(DETAILS?.governance), [signer, wrongNetwork]); // eslint-disable-line react-hooks/exhaustive-deps
  const monitor = useMemo(() => bindOpt(DETAILS?.coldChain), [signer, wrongNetwork]); // eslint-disable-line react-hooks/exhaustive-deps

  const readWalletChain = async () => Number(await window.ethereum.request({ method: "eth_chainId" }));

  /**
   * Puts MetaMask on the chain the contracts live on. Tries a switch first; if MetaMask doesn't
   * know the chain yet it is added. Some MetaMask versions refuse to add a second network on an
   * RPC URL already used by another network (e.g. the old "Hardhat Local" on 127.0.0.1:8545),
   * so an equivalent alternative URL is tried. Throws a clear error if the wallet still differs.
   */
  const ensureNetwork = useCallback(async () => {
    const primary = DETAILS?.rpcUrl || "http://127.0.0.1:8545";
    const alternative = primary.includes("127.0.0.1") ? primary.replace("127.0.0.1", "localhost") : primary.replace("localhost", "127.0.0.1");
    const add = (url) =>
      window.ethereum.request({
        method: "wallet_addEthereumChain",
        params: [{ chainId: chainIdHex, chainName: networkName, rpcUrls: [url], nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 } }]
      });
    try {
      await window.ethereum.request({ method: "wallet_switchEthereumChain", params: [{ chainId: chainIdHex }] });
    } catch (switchError) {
      if (switchError.code === 4001) throw new Error("Network switch was rejected in MetaMask.");
      try {
        await add(primary);
      } catch (addError) {
        if (addError.code === 4001) throw new Error("Adding the PharmaChain network was rejected in MetaMask.");
        await add(alternative);
      }
    }
    const now = await readWalletChain();
    setWalletChainId(now);
    if (now !== chainId) {
      throw new Error(`MetaMask is still on chain ${now}. Switch it to "${networkName}" (chain ${chainId}).`);
    }
  }, [chainId, chainIdHex, networkName]);

  const bind = useCallback(async () => {
    const provider = new ethers.BrowserProvider(window.ethereum);
    const s = await provider.getSigner();
    setWalletChainId(await readWalletChain());
    setSigner(s);
    setAccount((await s.getAddress()).toLowerCase());
    setIsConnected(true);
  }, []);

  const connectWallet = async () => {
    if (!window.ethereum) {
      setError("Please install the MetaMask browser extension.");
      return false;
    }
    if (!DETAILS) {
      setError("contractDetails.json missing - run the deploy script.");
    }
    setLoading(true);
    setError("");
    try {
      await ensureNetwork();
      await window.ethereum.request({ method: "eth_requestAccounts" });
      await bind();
      return true;
    } catch (err) {
      console.error(err);
      setError("Failed to link MetaMask: " + (err.message || err));
      setIsConnected(false);
      return false;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!window.ethereum) return;
    (async () => {
      try {
        const accounts = await window.ethereum.request({ method: "eth_accounts" });
        if (accounts.length > 0) {
          await ensureNetwork().catch(() => {});
          await bind();
        }
      } catch (err) {
        console.warn("Auto wallet link skipped:", err);
      }
    })();

    const handleAccounts = (accounts) => {
      if (accounts.length > 0) bind();
      else {
        setAccount("");
        setSigner(null);
        setIsConnected(false);
      }
    };
    const handleChain = () => window.location.reload();
    window.ethereum.on("accountsChanged", handleAccounts);
    window.ethereum.on("chainChanged", handleChain);
    return () => {
      window.ethereum.removeListener("accountsChanged", handleAccounts);
      window.ethereum.removeListener("chainChanged", handleChain);
    };
  }, [bind, ensureNetwork]);

  return (
    <Web3Context.Provider
      value={{
        account,
        signer,
        contract,
        registry,
        governance,
        monitor,
        readContract,
        readProvider,
        details: DETAILS,
        chainId,
        networkName,
        contractAddress: DETAILS?.pharmaChain.address || "",
        isConnected,
        wrongNetwork,
        walletChainId,
        switchNetwork: async () => {
          try {
            await ensureNetwork();
            setError("");
            return true;
          } catch (e) {
            setError(e.message);
            return false;
          }
        },
        loading,
        error,
        connectWallet
      }}
    >
      {children}
    </Web3Context.Provider>
  );
};
