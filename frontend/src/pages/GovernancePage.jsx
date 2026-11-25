import React, { useContext, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import { ethers } from "ethers";
import { Web3Context } from "../context/Web3Context";
import { Landmark, Vote, CheckCircle2, Play, Server, FilePlus2, Users } from "lucide-react";
import { PageHeader, Panel, Pill, Spinner, EmptyState } from "../components/ui";
import { waitForIndexer, errorMessage, shortHash } from "../utils/chain";

const ACTIONS = [
  { id: "recall", label: "Recall a production lot", fields: ["batchId", "reason"] },
  { id: "release", label: "Release a quarantined shipment", fields: ["batchId"] },
  { id: "addValidator", label: "Add a QBFT validator", fields: ["address"] },
  { id: "removeValidator", label: "Remove a QBFT validator", fields: ["address"] }
];

/**
 * Regulator multisig: high-impact actions need `threshold` of the officers' signatures.
 * Every step (propose, approve, execute) is an on-chain transaction from the officer's wallet.
 */
const GovernancePage = () => {
  const { governance, details, account, isConnected, connectWallet } = useContext(Web3Context);
  const [data, setData] = useState(null);
  const [validators, setValidators] = useState([]);
  const [form, setForm] = useState({ action: "recall", batchId: "", reason: "", address: "", description: "" });
  const [busy, setBusy] = useState({});
  const [error, setError] = useState("");

  const load = async () => {
    try {
      const [g, o] = await Promise.all([axios.get("/api/governance/proposals"), axios.get("/api/chain/overview").catch(() => null)]);
      setData(g.data.data);
      setValidators(o ? o.data.data.validators : []);
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  useEffect(() => {
    load();
  }, []);

  const me = (account || "").toLowerCase();
  const isSigner = data?.signers.some((s) => s.address === me);

  const send = async (key, fn) => {
    if (!isConnected) return connectWallet();
    if (!governance) return setError("Wallet not on the PharmaChain network.");
    setBusy((b) => ({ ...b, [key]: true }));
    setError("");
    try {
      await waitForIndexer(await (await fn()).wait());
      await load();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy((b) => ({ ...b, [key]: false }));
    }
  };

  const propose = () => {
    const pharma = new ethers.Interface(details.pharmaChain.abi);
    let target;
    let data_;
    let desc = form.description.trim();
    if (form.action === "recall") {
      target = details.pharmaChain.address;
      data_ = pharma.encodeFunctionData("recallBatch", [form.batchId, form.reason || "Regulatory order"]);
      desc ||= `Recall lot ${form.batchId}: ${form.reason}`;
    } else if (form.action === "release") {
      target = details.pharmaChain.address;
      data_ = pharma.encodeFunctionData("releaseQuarantine", [form.batchId]);
      desc ||= `Release quarantine of ${form.batchId}`;
    } else {
      if (!details.validatorSet) return setError("Validator contract not available on this network (Hardhat dev chain).");
      if (!ethers.isAddress(form.address)) return setError("Enter a valid validator address.");
      const vs = new ethers.Interface(details.validatorSet.abi);
      target = details.validatorSet.address;
      data_ = vs.encodeFunctionData(form.action, [form.address]);
      desc ||= `${form.action === "addValidator" ? "Add" : "Remove"} validator ${form.address}`;
    }
    send("propose", () => governance.propose(target, data_, desc));
  };

  if (!data) return <Spinner />;
  const field = (name, placeholder) => (
    <input
      value={form[name]}
      onChange={(e) => setForm({ ...form, [name]: e.target.value })}
      placeholder={placeholder}
      className="w-full px-3 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200 font-mono"
    />
  );
  const action = ACTIONS.find((a) => a.id === form.action);

  return (
    <div className="space-y-6">
      <PageHeader
        crumbs={[{ label: "Regulator" }, { label: "Governance" }]}
        title="Governance Multisig"
        icon={Landmark}
        subtitle={`High-impact actions need ${data.threshold} of ${data.signers.length} regulator officers. No single key can recall a lot, release a quarantine or change the validator set.`}
      />
      {error && <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-xs">{error}</div>}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <Panel title="Officers (signers)" icon={Users}>
          <div className="space-y-2">
            {data.signers.map((s) => (
              <div key={s.address} className={`p-3 rounded-xl border text-xs ${s.address === me ? "border-sky-500/40 bg-sky-500/5" : "border-slate-800"}`}>
                <p className="font-semibold text-slate-200">
                  {s.name || "Officer"} {s.address === me && <Pill accent="sky">you</Pill>}
                </p>
                <p className="font-mono text-[10px] text-slate-500">{s.address}</p>
              </div>
            ))}
            <p className="text-[10px] text-slate-500">
              Multisig contract <span className="font-mono">{shortHash(data.address, 8)}</span> · threshold {data.threshold}
            </p>
          </div>
        </Panel>

        <Panel title="New proposal" icon={FilePlus2}>
          <div className="space-y-3">
            <select value={form.action} onChange={(e) => setForm({ ...form, action: e.target.value })} className="w-full px-3 py-2.5 bg-slate-950 border border-slate-800 rounded-xl text-xs text-slate-200">
              {ACTIONS.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label}
                </option>
              ))}
            </select>
            {action.fields.includes("batchId") && field("batchId", "Batch / lot ID")}
            {action.fields.includes("reason") && field("reason", "Reason")}
            {action.fields.includes("address") && field("address", "Validator address 0x…")}
            {field("description", "Description (optional)")}
            <button
              onClick={propose}
              disabled={busy.propose || !isSigner}
              className="w-full py-2.5 bg-sky-500 hover:bg-sky-600 disabled:opacity-40 text-slate-950 font-bold rounded-xl text-xs uppercase tracking-wider"
            >
              {busy.propose ? "Proposing..." : isSigner ? "Propose (counts as your approval)" : "Only officers can propose"}
            </button>
          </div>
        </Panel>

        <Panel title="QBFT validator set (from ValidatorSet contract)" icon={Server}>
          {validators.length ? (
            validators.map((v) => (
              <p key={v} className="font-mono text-[11px] text-slate-300 flex items-center gap-1.5 py-1">
                <Server className="h-3 w-3 text-emerald-500" /> {v}
              </p>
            ))
          ) : (
            <EmptyState icon={Server} title="No BFT validators (development chain)" />
          )}
          <p className="text-[10px] text-slate-500 mt-2">Besu reads this list from the contract every block; it changes only through an executed proposal.</p>
        </Panel>
      </div>

      <Panel title="Proposals" icon={Vote} bodyClass="p-3">
        {data.proposals.length === 0 ? (
          <EmptyState icon={Vote} title="No proposals yet" />
        ) : (
          <div className="space-y-2">
            {data.proposals.map((p) => {
              const mine = p.approvals.some((a) => a.address === me);
              const ready = p.approvals.length >= data.threshold;
              const open = !p.executed && !p.cancelled;
              return (
                <div key={p.id} className="p-4 rounded-2xl border border-slate-800 bg-slate-900/40 flex flex-wrap items-center gap-4">
                  <div className="flex-1 min-w-[260px]">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-xs text-slate-500">#{p.id}</span>
                      <span className="text-sm font-semibold text-slate-200">{p.description}</span>
                      {p.executed ? <Pill accent="emerald">executed</Pill> : p.cancelled ? <Pill>cancelled</Pill> : ready ? <Pill accent="amber">ready</Pill> : <Pill accent="sky">collecting</Pill>}
                    </div>
                    <p className="text-[11px] text-slate-500 mt-1 font-mono">
                      {p.call.contract}.{p.call.method}({Object.values(p.call.args).join(", ")})
                    </p>
                    <p className="text-[11px] text-slate-400 mt-1">
                      Approvals {p.approvals.length}/{data.threshold}: {p.approvals.map((a) => a.name || shortHash(a.address, 4)).join(", ")}
                    </p>
                  </div>
                  {open && (
                    <div className="flex gap-2">
                      {isSigner && !mine && (
                        <button
                          onClick={() => send(`a${p.id}`, () => governance.approve(p.id))}
                          disabled={busy[`a${p.id}`]}
                          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-violet-500 hover:bg-violet-600 text-slate-950 text-xs font-bold"
                        >
                          <CheckCircle2 className="h-3.5 w-3.5" /> {busy[`a${p.id}`] ? "Signing..." : "Approve"}
                        </button>
                      )}
                      {ready && (
                        <button
                          onClick={() => send(`x${p.id}`, () => governance.execute(p.id))}
                          disabled={busy[`x${p.id}`]}
                          className="flex items-center gap-1.5 px-3 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-600 text-slate-950 text-xs font-bold"
                        >
                          <Play className="h-3.5 w-3.5" /> {busy[`x${p.id}`] ? "Executing..." : "Execute"}
                        </button>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </Panel>
      <p className="text-[11px] text-slate-500">
        Officer accounts for the demo: admin@pharma.com (signer 1), officer2@pharma.com and officer3@pharma.com (password officer123). Switch MetaMask to the
        matching wallet before approving. Executed actions appear in the <Link to="/explorer" className="text-sky-400 hover:underline">ledger explorer</Link>.
      </p>
    </div>
  );
};

export default GovernancePage;
