import React, { useContext, useState } from "react";
import { Web3Context } from "../context/Web3Context";
import { AlertTriangle, RefreshCw } from "lucide-react";

const KNOWN = { 31337: "Hardhat Local", 2026: "PharmaChain QBFT", 1: "Ethereum Mainnet", 11155111: "Sepolia" };

/**
 * Shown whenever MetaMask is on a different chain than the deployed contracts. Transactions are
 * blocked in that state (the contract objects are withheld), because MetaMask would sign them for
 * the wrong chain ID and the node would reject them with "Wrong chainId".
 */
const NetworkGuard = () => {
  const { wrongNetwork, walletChainId, chainId, networkName, switchNetwork, details } = useContext(Web3Context);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState("");

  if (!wrongNetwork) return null;

  const onSwitch = async () => {
    setBusy(true);
    setFailed("");
    const ok = await switchNetwork();
    if (!ok) setFailed("MetaMask did not switch automatically - add the network manually with the values below.");
    setBusy(false);
  };

  return (
    <div className="mb-6 p-4 rounded-2xl border border-rose-500/40 bg-rose-500/10 text-rose-200">
      <div className="flex flex-wrap items-center gap-3">
        <AlertTriangle className="h-5 w-5 text-rose-400 shrink-0" />
        <p className="text-sm flex-1 min-w-[240px]">
          <b>Wrong network.</b> MetaMask is on chain <b>{walletChainId}</b>
          {KNOWN[walletChainId] ? ` (${KNOWN[walletChainId]})` : ""}, but the contracts are deployed on <b>{networkName}</b> (chain {chainId}). Transactions
          are blocked until you switch.
        </p>
        <button
          onClick={onSwitch}
          disabled={busy}
          className="flex items-center gap-2 px-4 py-2 rounded-xl bg-rose-500 hover:bg-rose-600 disabled:opacity-50 text-white text-xs font-bold"
        >
          <RefreshCw className={`h-4 w-4 ${busy ? "animate-spin" : ""}`} /> Switch to {networkName}
        </button>
      </div>
      {failed && <p className="text-xs mt-3 text-rose-300">{failed}</p>}
      <details className="mt-3 text-xs text-rose-200/90" open={!!failed}>
        <summary className="cursor-pointer font-semibold">Add the network manually in MetaMask</summary>
        <ol className="list-decimal ml-5 mt-2 space-y-1">
          <li>MetaMask → network selector → <b>Add a custom network</b>.</li>
          <li>
            Network name <code className="px-1 bg-slate-900 rounded">{networkName}</code>, RPC URL{" "}
            <code className="px-1 bg-slate-900 rounded">{details?.rpcUrl || "http://127.0.0.1:8545"}</code>, Chain ID{" "}
            <code className="px-1 bg-slate-900 rounded">{chainId}</code>, Currency <code className="px-1 bg-slate-900 rounded">ETH</code>.
          </li>
          <li>
            If MetaMask says the RPC URL is already used, delete the old <b>Hardhat Local</b> network (Settings → Networks), or use{" "}
            <code className="px-1 bg-slate-900 rounded">http://localhost:8545</code> as the RPC URL.
          </li>
          <li>Select the new network, then Settings → Advanced → <b>Clear activity tab data</b> and reload this page.</li>
        </ol>
      </details>
    </div>
  );
};

export default NetworkGuard;
