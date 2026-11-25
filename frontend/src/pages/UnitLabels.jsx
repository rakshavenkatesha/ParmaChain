import React, { useState, useEffect, useContext } from "react";
import { useParams } from "react-router-dom";
import axios from "axios";
import QRCode from "qrcode";
import { Web3Context } from "../context/Web3Context";
import { KeyRound, Download, Copy, ChevronLeft, ChevronRight, ShieldCheck, AlertTriangle, QrCode, Boxes, Eye } from "lucide-react";
import { generateLot } from "../utils/unitMerkle";
import { deriveLabelSeed, labelUrl, aggregateLabel, errorMessage, shortHash, publicOrigin } from "../utils/chain";
import { PageHeader, Pill } from "../components/ui";

const PER_PAGE = 12;

const UnitLabels = () => {
  const { batchId } = useParams();
  const { signer, isConnected, connectWallet } = useContext(Web3Context);
  const [batch, setBatch] = useState(null);
  const [lot, setLot] = useState(null);
  const [tab, setTab] = useState("packs");
  const [page, setPage] = useState(0);
  const [qrs, setQrs] = useState({});
  const [aggQrs, setAggQrs] = useState([]);
  const [revealed, setRevealed] = useState({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(null);

  useEffect(() => {
    axios
      .get(`/api/batches/${batchId}`)
      .then((r) => setBatch(r.data.data))
      .catch((e) => setError(errorMessage(e)));
  }, [batchId]);

  const lotSize = batch?.lotSize || 0;

  const unlock = async () => {
    setError("");
    if (!isConnected) return connectWallet();
    setBusy(true);
    try {
      const seed = await deriveLabelSeed(signer, batchId);
      await new Promise((r) => setTimeout(r, 30));
      const l = generateLot(batchId, lotSize, seed, batch.packsPerCarton, batch.cartonsPerCase);
      // Self-check against the root committed on-chain: proves these are the real labels.
      if (l.root.toLowerCase() !== (batch.unitRoot || "").toLowerCase()) {
        throw new Error("Derived labels do not match the on-chain Merkle root. Sign with the wallet that registered this lot.");
      }
      setLot(l);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!lot) return;
    const start = page * PER_PAGE;
    const idx = [];
    for (let i = start; i < Math.min(start + PER_PAGE, lotSize); i++) idx.push(i);
    Promise.all(idx.map((i) => QRCode.toDataURL(labelUrl(batchId, i, lot.labels[i].publicTag), { width: 220, margin: 1 }))).then((urls) => {
      const m = {};
      idx.forEach((i, k) => (m[i] = urls[k]));
      setQrs(m);
    });
  }, [lot, page, batchId, lotSize]);

  useEffect(() => {
    if (!lot || tab !== "aggregates") return;
    const h = lot.hierarchy;
    const items = [
      ...h.caseRoots.map((root, k) => ({ level: 2, index: k, root, first: k * h.packsPerCarton * h.cartonsPerCase, last: Math.min((k + 1) * h.packsPerCarton * h.cartonsPerCase, lotSize) - 1 })),
      ...h.cartonRoots.map((root, c) => ({ level: 1, index: c, root, first: c * h.packsPerCarton, last: Math.min((c + 1) * h.packsPerCarton, lotSize) - 1 }))
    ].slice(0, 48);
    Promise.all(items.map((it) => QRCode.toDataURL(aggregateLabel(batchId, it.level, it.index), { width: 180, margin: 1 }))).then((urls) => setAggQrs(items.map((it, k) => ({ ...it, qr: urls[k] }))));
  }, [lot, tab, batchId, lotSize]);

  const downloadCsv = () => {
    const rows = ["unit_index,carton,case,visible_label_url,scratch_code"];
    lot.labels.forEach((l, i) => {
      const c = Math.floor(i / batch.packsPerCarton);
      rows.push(`${i},${c},${Math.floor(c / batch.cartonsPerCase)},${labelUrl(batchId, i, l.publicTag)},${l.code}`);
    });
    const blob = new Blob([rows.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${batchId}_two_part_labels.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const copy = async (i, withCode) => {
    const text = labelUrl(batchId, i, lot.labels[i].publicTag) + (withCode ? ` ${lot.labels[i].code}` : "");
    await navigator.clipboard.writeText(text);
    setCopied(`${i}-${withCode}`);
    setTimeout(() => setCopied(null), 1500);
  };

  const pages = Math.ceil(lotSize / PER_PAGE);
  const tabCls = (t) => `flex items-center gap-2 pb-3 text-xs uppercase tracking-wider font-bold border-b-2 transition ${tab === t ? "border-sky-500 text-sky-400" : "border-transparent text-slate-500 hover:text-slate-300"}`;

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <PageHeader
        crumbs={[{ label: "Dashboard", to: "/dashboard" }, { label: "Labels" }, { label: batchId }]}
        title={<span>Two-part labels · <span className="font-mono text-sky-400">{batchId}</span></span>}
        icon={QrCode}
        subtitle={
          batch
            ? `${lotSize.toLocaleString()} packs · ${batch.packsPerCarton} per carton · ${batch.cartonsPerCase} cartons per case. Visible QR = anyone can verify. Hidden scratch code = needed to dispense, so a photocopied label can never be sold.`
            : ""
        }
        actions={
          lot && (
            <button onClick={downloadCsv} className="flex items-center gap-2 px-4 py-2 bg-sky-500 hover:bg-sky-600 text-slate-950 font-bold rounded-xl text-xs uppercase tracking-wider">
              <Download className="h-4 w-4" /> Export print file (CSV)
            </button>
          )
        }
      />

      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 text-red-400 rounded-2xl text-xs font-semibold flex gap-2">
          <AlertTriangle className="h-4 w-4 shrink-0" /> {error}
        </div>
      )}

      {!lot ? (
        <div className="glass-panel rounded-3xl p-8 border border-slate-900 text-center space-y-4">
          <KeyRound className="h-10 w-10 text-sky-400 mx-auto" />
          <h3 className="text-lg font-bold">Labels are not stored anywhere</h3>
          <p className="text-slate-400 text-sm max-w-xl mx-auto">
            Both parts of every label are re-derived from a deterministic signature by the manufacturer's wallet. Neither the server nor the blockchain holds
            them; the server only keeps hashes, so a database breach cannot be used to print sellable labels.
          </p>
          <button onClick={unlock} disabled={busy || !batch} className="px-6 py-3 bg-sky-500 hover:bg-sky-600 disabled:bg-sky-500/50 text-slate-950 font-bold rounded-xl">
            {busy ? "Deriving labels..." : isConnected ? "Sign to unlock labels" : "Connect wallet"}
          </button>
        </div>
      ) : (
        <>
          <div className="p-3 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs flex items-center gap-2">
            <ShieldCheck className="h-4 w-4" /> Derived labels reproduce the hierarchical Merkle root stored on-chain ({shortHash(lot.root, 8)}).
          </div>
          <div className="p-3 rounded-2xl bg-sky-500/10 border border-sky-500/20 text-sky-300 text-xs">
            QR codes open <span className="font-mono font-bold">{publicOrigin()}</span> - scan them with any phone camera on the same Wi-Fi network.
            {publicOrigin().includes("localhost") && " (No LAN address detected - connect this laptop to Wi-Fi and restart the frontend.)"}
          </div>

          <div className="flex gap-6 border-b border-slate-800">
            <button className={tabCls("packs")} onClick={() => setTab("packs")}>
              <QrCode className="h-4 w-4" /> Pack labels
            </button>
            <button className={tabCls("aggregates")} onClick={() => setTab("aggregates")}>
              <Boxes className="h-4 w-4" /> Carton & case labels
            </button>
          </div>

          {tab === "packs" ? (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
                {Object.keys(qrs).map((k) => {
                  const i = Number(k);
                  const c = Math.floor(i / batch.packsPerCarton);
                  return (
                    <div key={i} className="glass-panel rounded-2xl p-4 border border-slate-900 text-center">
                      <div className="bg-white rounded-xl p-2 inline-block">
                        <img src={qrs[i]} alt={`Unit ${i}`} className="w-32 h-32" />
                      </div>
                      <p className="font-mono text-xs mt-2 text-slate-300">
                        {batchId} · #{i}
                      </p>
                      <p className="text-[10px] text-slate-500">
                        carton {c} · case {Math.floor(c / batch.cartonsPerCase)}
                      </p>
                      <button
                        onClick={() => setRevealed((r) => ({ ...r, [i]: !r[i] }))}
                        className="mt-2 w-full relative rounded-lg overflow-hidden border border-amber-500/30"
                        title="Hidden scratch-off code - needed to dispense"
                      >
                        <span className={`block py-1.5 font-mono text-[11px] tracking-wider ${revealed[i] ? "bg-slate-950 text-amber-300" : "text-transparent bg-slate-950"}`}>{lot.labels[i].code}</span>
                        {!revealed[i] && (
                          <span className="absolute inset-0 flex items-center justify-center gap-1 text-[10px] font-bold text-slate-900 bg-gradient-to-r from-slate-400 via-slate-300 to-slate-400">
                            <Eye className="h-3 w-3" /> SCRATCH HERE
                          </span>
                        )}
                      </button>
                      <div className="flex justify-center gap-3 mt-2">
                        <button onClick={() => copy(i, false)} className="inline-flex items-center gap-1 text-[10px] text-sky-400 hover:text-sky-300">
                          <Copy className="h-3 w-3" /> {copied === `${i}-false` ? "Copied" : "Visible link"}
                        </button>
                        <button onClick={() => copy(i, true)} className="inline-flex items-center gap-1 text-[10px] text-amber-400 hover:text-amber-300">
                          <Copy className="h-3 w-3" /> {copied === `${i}-true` ? "Copied" : "+ code"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-center items-center gap-4 text-xs text-slate-400">
                <button disabled={page === 0} onClick={() => setPage(page - 1)} className="p-2 rounded-lg bg-slate-900 disabled:opacity-30">
                  <ChevronLeft className="h-4 w-4" />
                </button>
                Page {page + 1} / {pages}
                <button disabled={page >= pages - 1} onClick={() => setPage(page + 1)} className="p-2 rounded-lg bg-slate-900 disabled:opacity-30">
                  <ChevronRight className="h-4 w-4" />
                </button>
              </div>
            </>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-4">
              {aggQrs.map((a) => (
                <div key={`${a.level}-${a.index}`} className={`glass-panel rounded-2xl p-3 border text-center ${a.level === 2 ? "border-violet-500/30" : "border-slate-900"}`}>
                  <Pill accent={a.level === 2 ? "violet" : "sky"}>{a.level === 2 ? `Case ${a.index}` : `Carton ${a.index}`}</Pill>
                  <div className="bg-white rounded-lg p-1.5 inline-block mt-2">
                    <img src={a.qr} alt="" className="w-24 h-24" />
                  </div>
                  <p className="text-[10px] text-slate-400 mt-1">
                    packs #{a.first}–{a.last}
                  </p>
                  <p className="text-[9px] font-mono text-slate-600">{shortHash(a.root, 4)}</p>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
};

export default UnitLabels;
