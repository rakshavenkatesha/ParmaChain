import React, { useState, useContext } from "react";
import { Web3Context } from "../context/Web3Context";
import { X, Split } from "lucide-react";
import { BATCH_ID_PATTERN, waitForIndexer, errorMessage } from "../utils/chain";

/** Carves a child shipment off the end of this shipment's unit range (quantity-conserving). */
const SplitModal = ({ batch, onClose, onDone }) => {
  const { contract } = useContext(Web3Context);
  const [childId, setChildId] = useState(`${batch.batchId}-S${Date.now().toString(36).slice(-3).toUpperCase()}`);
  const [qty, setQty] = useState(Math.floor(batch.quantity / 2) || 1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const n = Number(qty);
  const valid = BATCH_ID_PATTERN.test(childId) && n >= 1 && n < batch.quantity;

  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      const tx = await contract.splitBatch(batch.batchId, childId, n);
      await waitForIndexer(await tx.wait());
      onDone();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
      <div className="max-w-md w-full rounded-3xl p-6 shadow-2xl relative border border-slate-800 bg-slate-900 space-y-4">
        <button onClick={onClose} className="absolute top-4 right-4 text-slate-500 hover:text-slate-200">
          <X className="h-5 w-5" />
        </button>
        <h3 className="text-lg font-bold flex items-center gap-2">
          <Split className="h-5 w-5 text-sky-400" /> Split shipment
        </h3>
        <p className="text-xs text-slate-400">
          Units [{batch.unitStart}, {batch.unitEnd}) of lot <span className="font-mono">{batch.originBatchId}</span>. The child takes the
          last <b>{valid ? n : "?"}</b> units: [{batch.unitEnd - (valid ? n : 0)}, {batch.unitEnd}). The contract guarantees the ranges stay
          disjoint, so units can never be created by splitting.
        </p>
        {error && <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-xs">{error}</div>}
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Child shipment ID</label>
          <input value={childId} onChange={(e) => setChildId(e.target.value)} className="w-full px-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-sm font-mono text-slate-200" />
        </div>
        <div>
          <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Units to move (1 - {batch.quantity - 1})</label>
          <input type="number" value={qty} onChange={(e) => setQty(e.target.value)} className="w-full px-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-sm text-slate-200" />
        </div>
        <button
          onClick={submit}
          disabled={!valid || busy}
          className="w-full py-3 bg-sky-500 hover:bg-sky-600 disabled:bg-sky-500/40 text-slate-950 font-bold rounded-xl text-xs uppercase tracking-wider"
        >
          {busy ? "Splitting on-chain..." : "Split"}
        </button>
      </div>
    </div>
  );
};

export default SplitModal;
