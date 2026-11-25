import React, { useContext, useEffect, useState } from "react";
import axios from "axios";
import { Web3Context } from "../context/Web3Context";
import { Undo2, CheckCircle2 } from "lucide-react";
import { PageHeader, Panel, Spinner, EmptyState } from "../components/ui";
import { waitForIndexer, errorMessage, shortHash } from "../utils/chain";

/** Regulator approval of unopened-pack returns: clears the unit's dispensed bit on-chain. */
const ReturnsPage = () => {
  const { contract, isConnected, connectWallet } = useContext(Web3Context);
  const [rows, setRows] = useState(null);
  const [busy, setBusy] = useState({});
  const [error, setError] = useState("");

  const load = () =>
    axios
      .get("/api/admin/returns")
      .then((r) => setRows(r.data.data))
      .catch((e) => setError(errorMessage(e)));
  useEffect(() => {
    load();
  }, []);

  const approve = async (r) => {
    if (!isConnected) return connectWallet();
    if (!contract) return setError("Wallet not on the PharmaChain network.");
    const key = `${r.batchId}:${r.unitIndex}`;
    setBusy((b) => ({ ...b, [key]: true }));
    setError("");
    try {
      await waitForIndexer(await (await contract.approveReturn(r.batchId, r.unitIndex)).wait());
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy((b) => ({ ...b, [key]: false }));
    }
  };

  if (!rows) return <Spinner />;
  return (
    <div className="space-y-6">
      <PageHeader
        crumbs={[{ label: "Regulator" }, { label: "Returns" }]}
        title="Unopened Pack Returns"
        icon={Undo2}
        subtitle="A pharmacy may take back an unopened, already-dispensed pack. After regulator approval the pack's bit is cleared on-chain and it can be dispensed again; the whole history stays on the ledger."
      />
      {error && <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-xs">{error}</div>}
      <Panel title="Awaiting approval" icon={Undo2} bodyClass="p-0">
        {rows.length === 0 ? (
          <EmptyState icon={Undo2} title="No pending returns" />
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-[10px] uppercase tracking-widest text-slate-500 border-b border-slate-800 bg-slate-900/40">
                <th className="p-3 text-left">Shipment</th>
                <th className="p-3 text-left">Unit</th>
                <th className="p-3 text-left">Pharmacy</th>
                <th className="p-3 text-left">Reason</th>
                <th className="p-3 text-left">Requested</th>
                <th className="p-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {rows.map((r) => {
                const key = `${r.batchId}:${r.unitIndex}`;
                return (
                  <tr key={key}>
                    <td className="p-3 font-mono text-sky-400">
                      {r.batchId}
                      <span className="block text-[10px] text-slate-500 font-sans">{r.drugName}</span>
                    </td>
                    <td className="p-3 font-mono">#{r.unitIndex}</td>
                    <td className="p-3">{r.pharmacy}</td>
                    <td className="p-3 text-slate-400">{r.reason}</td>
                    <td className="p-3 text-slate-500">
                      {r.requestedAt ? new Date(r.requestedAt).toLocaleString() : ""}
                      <span className="block font-mono text-[10px]">{shortHash(r.txHash, 6)}</span>
                    </td>
                    <td className="p-3 text-right">
                      <button
                        onClick={() => approve(r)}
                        disabled={busy[key]}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 disabled:opacity-50 text-slate-950 text-xs font-bold"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" /> {busy[key] ? "Signing..." : "Approve return"}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </Panel>
      <p className="text-[11px] text-slate-500">Return approval is a routine action signed by the regulator account (admin@pharma.com) - it does not need the multisig.</p>
    </div>
  );
};

export default ReturnsPage;
