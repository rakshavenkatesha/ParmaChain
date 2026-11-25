import React, { useState, useEffect, useContext } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import axios from "axios";
import { Web3Context } from "../context/Web3Context";
import { AuthContext } from "../context/AuthContext";
import { Wallet, ArrowLeftRight } from "lucide-react";
import { waitForIndexer, errorMessage } from "../utils/chain";

const TransferBatch = () => {
  const { batchId } = useParams();
  const navigate = useNavigate();
  
  const { user } = useContext(AuthContext);
  const { contract, isConnected, connectWallet, account } = useContext(Web3Context);

  const [batch, setBatch] = useState(null);
  const [recipients, setRecipients] = useState([]);
  const [selectedRecipientId, setSelectedRecipientId] = useState("");
  const [manualAddress, setManualAddress] = useState("");
  const [isManual, setIsManual] = useState(false);
  const [loading, setLoading] = useState(true);
  const [submitLoading, setSubmitLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const fetchTransferDetails = async () => {
      setLoading(true);
      setError("");
      try {
        // 1. Fetch batch details
        const batchRes = await axios.get(`/api/batches/${batchId}`);
        setBatch(batchRes.data.data);

        // 2. Fetch approved downstream partners. Mirrors the on-chain route policy:
        //    Manufacturer -> Distributor, Distributor -> Distributor | Pharmacy.
        const targetRoles = user.role === "Manufacturer" ? ["Distributor"] : ["Pharmacy", "Distributor"];
        try {
          const lists = await Promise.all(targetRoles.map((r) => axios.get(`/api/auth/partners?role=${r}`)));
          const partners = lists
            .flatMap((l) => l.data.data)
            .filter((p) => p.ethAddress && p.ethAddress.toLowerCase() !== (user.ethAddress || "").toLowerCase());
          setRecipients(partners);
          if (partners.length > 0) {
            setSelectedRecipientId(partners[0]._id);
            setIsManual(false);
          } else {
            setIsManual(true);
          }
        } catch (partnerErr) {
          console.warn("Could not load partner directory, switching to manual address input.", partnerErr);
          setIsManual(true);
        }

      } catch (err) {
        console.error(err);
        setError("Failed to load batch transfer specification details.");
      } finally {
        setLoading(false);
      }
    };

    if (batchId) {
      fetchTransferDetails();
    }
  }, [batchId]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    // Determine target address
    let targetAddress = "";
    if (isManual) {
      targetAddress = manualAddress.trim();
    } else {
      const selected = recipients.find((r) => r._id === selectedRecipientId);
      targetAddress = selected ? selected.ethAddress : "";
    }

    if (!targetAddress) {
      setError("Please select a partner or enter an Ethereum address.");
      return;
    }

    if (!/^0x[a-fA-F0-9]{40}$/.test(targetAddress)) {
      setError("Please enter a valid Ethereum hex address (0x...).");
      return;
    }

    if (targetAddress.toLowerCase() === account.toLowerCase()) {
      setError("You cannot transfer a batch to your own connected address.");
      return;
    }

    if (!isConnected) {
      setError("Please link your MetaMask wallet first using the top header button.");
      await connectWallet();
      return;
    }

    if (!contract) {
      setError("MetaMask is not on the PharmaChain network (chain 2026). Use the red banner at the top of the page to switch.");
      return;
    }

    setSubmitLoading(true);

    try {
      // The contract enforces the route policy; the backend indexer mirrors the event.
      const tx = await contract.transferOwnership(batchId, targetAddress);
      const receipt = await tx.wait();
      await waitForIndexer(receipt);
      navigate("/dashboard");
    } catch (err) {
      console.error(err);
      setError("Blockchain transaction failed: " + errorMessage(err));
    } finally {
      setSubmitLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center py-12">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-sky-500 border-t-transparent"></div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold font-sans">Initiate Handoff</h1>
        <p className="text-slate-400 text-xs mt-1">
          Transfer custody of batch <span className="font-mono text-slate-300 font-bold">{batchId}</span> down the supply chain route.
        </p>
      </div>

      <div className="glass-panel p-6 sm:p-8 rounded-3xl shadow-2xl border border-slate-900">
        {batch && (
          <div className="p-4 bg-slate-900/40 rounded-2xl border border-slate-900 text-xs mb-6 space-y-2">
            <p className="text-slate-400">
              Drug: <strong className="text-slate-200">{batch.drugName}</strong>
            </p>
            <p className="text-slate-400">
              Registration: <strong className="text-slate-200">{batch.productCode}</strong>
            </p>
            <p className="text-slate-400">
              Quantity: <strong className="text-slate-200">{batch.quantity} units</strong>
            </p>
            <p className="text-slate-400">
              Current Owner Wallet: <strong className="text-slate-300 font-mono">{batch.currentOwnerEthAddress}</strong>
            </p>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          {error && (
            <div className="p-4 bg-red-500/10 border border-red-500/20 text-red-400 rounded-2xl text-xs font-semibold">
              {error}
            </div>
          )}

          {/* Partner Selector */}
          {!isManual && recipients.length > 0 ? (
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">
                Select Downstream Partner *
              </label>
              <select
                value={selectedRecipientId}
                onChange={(e) => setSelectedRecipientId(e.target.value)}
                className="w-full px-4 py-3 bg-slate-900 border border-slate-800 rounded-xl text-sm focus:outline-none focus:border-sky-500 transition text-slate-200"
              >
                {recipients.map((r) => (
                  <option key={r._id} value={r._id}>
                    {r.companyName || r.name} ({r.role}) - {r.ethAddress.slice(0, 8)}...
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => setIsManual(true)}
                className="text-xs text-sky-400 hover:text-sky-300 transition mt-2 font-semibold"
              >
                Or enter Ethereum Address manually
              </button>
            </div>
          ) : (
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">
                Recipient Wallet Address (Hex 0x...) *
              </label>
              <div className="relative">
                <Wallet className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 h-4 w-4" />
                <input
                  type="text"
                  required
                  value={manualAddress}
                  onChange={(e) => setManualAddress(e.target.value)}
                  placeholder="0x..."
                  className="w-full pl-11 pr-4 py-3 bg-slate-900 border border-slate-800 rounded-xl text-sm focus:outline-none focus:border-sky-500 transition text-slate-200 font-mono text-xs"
                />
              </div>
              {recipients.length > 0 && (
                <button
                  type="button"
                  onClick={() => setIsManual(false)}
                  className="text-xs text-sky-400 hover:text-sky-300 transition mt-2 font-semibold"
                >
                  Choose from registered companies directory
                </button>
              )}
            </div>
          )}

          <button
            type="submit"
            disabled={submitLoading}
            className="w-full py-4 bg-sky-500 hover:bg-sky-600 disabled:bg-sky-500/50 text-slate-950 font-bold rounded-xl shadow-lg transition flex justify-center items-center gap-2 mt-4"
          >
            <ArrowLeftRight className="h-5 w-5" />
            {submitLoading ? "Authorizing Transfer on Blockchain..." : "Dispatch Shipment"}
          </button>
        </form>
      </div>
    </div>
  );
};

export default TransferBatch;
