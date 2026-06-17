import React, { useState, useContext } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { Web3Context } from "../context/Web3Context";
import { PlusCircle, Wallet, CalendarDays, ClipboardList, Info } from "lucide-react";

const CreateBatch = () => {
  const navigate = useNavigate();
  const { contract, isConnected, connectWallet } = useContext(Web3Context);

  const [formData, setFormData] = useState({
    batchId: "",
    drugName: "",
    productCode: "",
    quantity: "",
    productionDate: "",
    expiryDate: ""
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleChange = (e) => {
    setFormData({ ...formData, [e.target.name]: e.target.value });
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    const { batchId, drugName, productCode, quantity, productionDate, expiryDate } = formData;

    if (!batchId || !drugName || !productCode || !quantity || !productionDate || !expiryDate) {
      setError("Please fill in all fields.");
      return;
    }

    if (new Date(expiryDate) <= new Date(productionDate)) {
      setError("Expiry date must be set after the production date.");
      return;
    }

    if (!isConnected) {
      setError("Please connect your MetaMask wallet using the header button first.");
      await connectWallet();
      return;
    }

    if (!contract) {
      setError("Blockchain contract details not loaded. Compile and deploy your smart contracts.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      // 1. Send transaction to the blockchain
      const prodUnix = Math.floor(new Date(productionDate).getTime() / 1000);
      const expUnix = Math.floor(new Date(expiryDate).getTime() / 1000);
      
      console.log("Registering batch on blockchain...", batchId);
      
      const tx = await contract.registerBatch(
        batchId,
        drugName,
        productCode,
        parseInt(quantity),
        prodUnix,
        expUnix
      );
      
      console.log("MetaMask Transaction Sent:", tx.hash);
      
      // Wait for confirmation
      await tx.wait();
      console.log("On-chain record created!");

      // 2. Log details off-chain in MongoDB Atlas
      const response = await axios.post("/api/batches", {
        batchId,
        drugName,
        productCode,
        quantity: parseInt(quantity),
        productionDate,
        expiryDate,
        txHash: tx.hash
      });

      if (response.data.success) {
        alert("Batch registered and locked on-chain successfully!");
        navigate("/dashboard");
      }
    } catch (err) {
      console.error(err);
      setError("Failed to register batch: " + (err.reason || err.message));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold font-sans">Register Drug Batch</h1>
        <p className="text-slate-400 text-xs mt-1">
          Create an immutable ledger record on the blockchain for newly manufactured medicine.
        </p>
      </div>

      <div className="glass-panel p-6 sm:p-8 rounded-3xl shadow-2xl border border-slate-900">
        {!isConnected && (
          <div className="p-4 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-2xl text-xs flex items-center gap-3 mb-6">
            <Info className="h-5 w-5 shrink-0" />
            <div>
              <p className="font-semibold">MetaMask Wallet Disconnected</p>
              <p className="mt-0.5 opacity-80">
                You must connect MetaMask before registering batches on-chain.
              </p>
              <button
                onClick={connectWallet}
                className="mt-2 px-3.5 py-1.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-xl transition"
              >
                Connect Wallet
              </button>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          {error && (
            <div className="p-4 bg-red-500/10 border border-red-500/20 text-red-400 rounded-2xl text-xs font-semibold">
              {error}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">
                Batch ID *
              </label>
              <input
                type="text"
                name="batchId"
                value={formData.batchId}
                onChange={handleChange}
                placeholder="e.g. BATCH-9908"
                className="w-full px-4 py-3 bg-slate-900 border border-slate-800 rounded-xl text-sm focus:outline-none focus:border-sky-500 transition text-slate-200 font-mono"
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">
                Medicine Name *
              </label>
              <input
                type="text"
                name="drugName"
                value={formData.drugName}
                onChange={handleChange}
                placeholder="e.g. Amoxicillin"
                className="w-full px-4 py-3 bg-slate-900 border border-slate-800 rounded-xl text-sm focus:outline-none focus:border-sky-500 transition text-slate-200"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">
                Product Registration Code *
              </label>
              <input
                type="text"
                name="productCode"
                value={formData.productCode}
                onChange={handleChange}
                placeholder="e.g. PC-66551"
                className="w-full px-4 py-3 bg-slate-900 border border-slate-800 rounded-xl text-sm focus:outline-none focus:border-sky-500 transition text-slate-200 font-mono"
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">
                Quantity (Units) *
              </label>
              <input
                type="number"
                name="quantity"
                min="1"
                value={formData.quantity}
                onChange={handleChange}
                placeholder="e.g. 5000"
                className="w-full px-4 py-3 bg-slate-900 border border-slate-800 rounded-xl text-sm focus:outline-none focus:border-sky-500 transition text-slate-200"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">
                Production Date *
              </label>
              <input
                type="date"
                name="productionDate"
                value={formData.productionDate}
                onChange={handleChange}
                className="w-full px-4 py-3 bg-slate-900 border border-slate-800 rounded-xl text-sm focus:outline-none focus:border-sky-500 transition text-slate-200"
              />
            </div>

            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">
                Expiration Date *
              </label>
              <input
                type="date"
                name="expiryDate"
                value={formData.expiryDate}
                onChange={handleChange}
                className="w-full px-4 py-3 bg-slate-900 border border-slate-800 rounded-xl text-sm focus:outline-none focus:border-sky-500 transition text-slate-200"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-4 bg-sky-500 hover:bg-sky-600 disabled:bg-sky-500/50 text-slate-950 font-bold rounded-xl shadow-lg transition flex justify-center items-center gap-2 mt-4"
          >
            <PlusCircle className="h-5 w-5" />
            {loading ? "Transacting with Blockchain..." : "Deploy Batch on Chain"}
          </button>
        </form>
      </div>
    </div>
  );
};

export default CreateBatch;
