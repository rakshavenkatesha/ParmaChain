import React, { useState, useEffect, useContext } from "react";
import { Link, useSearchParams } from "react-router-dom";
import axios from "axios";
import { ZeroHash } from "ethers";
import { Html5QrcodeScanner } from "html5-qrcode";
import { Web3Context } from "../context/Web3Context";
import {
  ShieldCheck,
  ShieldAlert,
  CalendarDays,
  Search,
  QrCode,
  Link as LinkIcon,
  AlertTriangle,
  Fingerprint,
  Ban,
  Thermometer,
  Blocks
} from "lucide-react";
import { parseLabel, isBytes32, STATUS_NAMES, shortHash, errorMessage } from "../utils/chain";
import { packLeaf, hiddenCommitment, decodeCode, batchKey } from "../utils/unitMerkle";
import ScanLocation from "../components/ScanLocation";
import { MerklePath, UnitMap, CustodyStepper } from "../components/lotViz";
import { Panel } from "../components/ui";
import { GitBranch, Grid3x3, Route } from "lucide-react";

const ACTION_TEXT = {
  Created: (s) => <>Lot manufactured and committed on-chain by <Addr a={s.to} /></>,
  "Transfer Initiated": (s) => <>Dispatched from <Addr a={s.from} /> to <Addr a={s.to} /></>,
  "Transfer Cancelled": (s) => <>Dispatch cancelled by <Addr a={s.from} /></>,
  "Shipment Accepted": (s) => <>Receipt signed by <Addr a={s.to} /></>,
  Split: (s) => <>Shipment split: {s.note}</>,
  Recalled: (s) => <span className="text-rose-400 font-semibold">Lot recalled: {s.note}</span>,
  Quarantined: (s) => <span className="text-orange-400 font-semibold">Quarantined: {s.note}</span>,
  "Quarantine Released": () => <>Quarantine released by regulator</>
};

const Addr = ({ a }) => <strong className="font-mono text-slate-100">{a ? `${a.slice(0, 8)}…${a.slice(-4)}` : "-"}</strong>;

const VerifyProduct = () => {
  const [params] = useSearchParams();
  const { readContract } = useContext(Web3Context);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [unit, setUnit] = useState(null);
  const [lineage, setLineage] = useState(null);
  const [lastLabel, setLastLabel] = useState(null);
  const [scratch, setScratch] = useState("");
  const [scratchResult, setScratchResult] = useState(null);
  const [error, setError] = useState("");
  const [showScanner, setShowScanner] = useState(false);

  const [showReportForm, setShowReportForm] = useState(false);
  const [reportDesc, setReportDesc] = useState("");
  const [reportLoading, setReportLoading] = useState(false);
  const [reportSuccess, setReportSuccess] = useState("");

  // Label links open this page directly: /verify?b=LOT&i=12&s=0x...
  useEffect(() => {
    const b = params.get("b") || params.get("batchId");
    if (b) {
      const label = { batchId: b, index: params.get("i") !== null ? Number(params.get("i")) : undefined, publicTag: params.get("p") || params.get("s") };
      setInput(label.index !== undefined ? window.location.href : b);
      verify(label);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let scanner;
    if (showScanner) {
      scanner = new Html5QrcodeScanner("reader", { fps: 10, qrbox: { width: 250, height: 250 } }, false);
      scanner.render(
        (text) => {
          setInput(text);
          setShowScanner(false);
          scanner.clear().catch(() => {});
          verify(parseLabel(text));
        },
        () => {}
      );
    }
    return () => {
      if (scanner) scanner.clear().catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showScanner]);

  const verifyUnit = async (label) => {
    let proofInfo = { proof: [], timeline: [] };
    try {
      proofInfo = (await axios.get(`/api/batches/${encodeURIComponent(label.batchId)}/units/${label.index}`)).data;
    } catch {
      /* no proof available -> cannot be authentic */
    }
    if (!readContract) throw new Error("Contract configuration missing");
    // Gas-free eth_call: the authenticity decision is made by the contract, not by our server.
    const publicTag = isBytes32(label.publicTag) ? label.publicTag : ZeroHash;
    const commitment = isBytes32(proofInfo.commitment) ? proofInfo.commitment : ZeroHash;
    const proof = proofInfo.proof && proofInfo.proof.pack ? proofInfo.proof : { pack: [], carton: [], kase: [] };
    const r = await readContract.verifyUnit(label.batchId, label.index, publicTag, commitment, proof);
    let onchainRoot = null;
    let lotId = label.batchId;
    let originKey = batchKey(label.batchId);
    let ppc = 1;
    let cpc = 1;
    let privateLot = false;
    try {
      const v = await readContract.getBatch(label.batchId);
      onchainRoot = v.batch.unitRoot;
      originKey = v.batch.originKey;
      ppc = Number(v.batch.packsPerCarton);
      cpc = Number(v.batch.cartonsPerCase);
      privateLot = v.batch.zkRoot !== ZeroHash;
      const lot = await readContract.getBatchByKey(originKey);
      lotId = lot.batch.batchId;
    } catch {
      /* unknown batch */
    }
    return {
      index: label.index,
      authentic: r.authentic,
      dispensed: r.dispensed,
      lotStatus: STATUS_NAMES[Number(r.lotStatus)],
      expired: r.expired,
      proofDepth: proof.pack.length + proof.carton.length + proof.kase.length,
      root: proofInfo.root,
      onchainRoot,
      proof,
      originKey,
      ppc,
      cpc,
      privateLot,
      lotId,
      commitment,
      leaf: packLeaf(originKey, label.index, publicTag, commitment),
      timeline: proofInfo.timeline || []
    };
  };

  /** After purchase: the patient scratches the hidden panel and checks it belongs to this very pack. */
  const checkScratch = () => {
    try {
      const code = decodeCode(scratch);
      const ok = hiddenCommitment(unit.originKey, unit.index, code).toLowerCase() === (unit.commitment || "").toLowerCase();
      setScratchResult(ok ? "match" : "mismatch");
    } catch (e) {
      setScratchResult(e.message);
    }
  };

  const verify = async (label) => {
    if (!label || !label.batchId) {
      setError("Enter a batch ID, paste a label link, or scan a QR code.");
      return;
    }
    setLoading(true);
    setError("");
    setResult(null);
    setUnit(null);
    setLineage(null);
    setLastLabel(label);
    setScratch("");
    setScratchResult(null);
    axios
      .get(`/api/batches/${encodeURIComponent(label.batchId)}/lineage`)
      .then((r) => setLineage(r.data.data))
      .catch(() => {});
    try {
      const unitPromise = label.index !== undefined ? verifyUnit(label).catch((e) => ({ error: errorMessage(e) })) : Promise.resolve(null);
      const batchPromise = axios
        .post(`/api/batches/${encodeURIComponent(label.batchId)}/verify`)
        .then((r) => r.data)
        .catch((err) => ({
          authenticityStatus: "Invalid",
          message: err.response?.data?.message || "This batch is not registered on the ledger."
        }));
      const [u, b] = await Promise.all([unitPromise, batchPromise]);
      setUnit(u);
      setResult(b);
    } finally {
      setLoading(false);
    }
  };

  const handleSendReport = async (e) => {
    e.preventDefault();
    if (!reportDesc.trim()) return;
    setReportLoading(true);
    setReportSuccess("");
    try {
      const activeId = result.data?.batchId || parseLabel(input)?.batchId;
      const res = await axios.post(`/api/batches/${encodeURIComponent(activeId)}/report`, { description: reportDesc });
      setReportSuccess(res.data.message);
      setReportDesc("");
    } catch (err) {
      alert("Failed to submit report: " + errorMessage(err));
    } finally {
      setReportLoading(false);
    }
  };

  const batchDisplay = (status) => {
    switch (status) {
      case "Genuine":
        return { icon: ShieldCheck, cls: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20", title: "Registered on the ledger", desc: "This lot was committed on-chain by a regulator-approved manufacturer and has a clean custody record." };
      case "Expired":
        return { icon: CalendarDays, cls: "text-red-400 bg-red-500/10 border-red-500/20", title: "Expired product", desc: "This lot is past its expiry date. Do not consume." };
      case "Recalled":
        return { icon: Ban, cls: "text-rose-400 bg-rose-500/10 border-rose-500/20", title: "RECALLED - do not use", desc: "The manufacturer or regulator has recalled this production lot." };
      case "Quarantined":
        return { icon: Thermometer, cls: "text-orange-400 bg-orange-500/10 border-orange-500/20", title: "Quarantined shipment", desc: "This shipment is held after a cold-chain excursion or regulatory order." };
      case "Suspicious":
      case "Critical Alert":
        return { icon: AlertTriangle, cls: "text-amber-400 bg-amber-500/10 border-amber-500/20", title: "Counterfeit activity detected on this lot", desc: "On-chain evidence of cloned, forged or diverted packs exists for this lot. Check your individual pack below." };
      default:
        return { icon: ShieldAlert, cls: "text-rose-500 bg-rose-500/10 border-rose-500/20", title: "Not registered - likely counterfeit", desc: result?.message || "This ID does not exist on the PharmaChain ledger." };
    }
  };

  const unitVerdict = (u) => {
    if (u.error) return { cls: "border-slate-700 text-slate-300", icon: AlertTriangle, title: "Unit check unavailable", desc: u.error };
    if (!u.authentic)
      return { cls: "border-rose-500/40 bg-rose-500/10 text-rose-400", icon: ShieldAlert, title: `COUNTERFEIT LABEL (unit #${u.index})`, desc: "This label is not part of the manufacturer's cryptographic commitment. Do not use this product and report it." };
    if (u.privateLot)
      return {
        cls: "border-violet-500/40 bg-violet-500/10 text-violet-300",
        icon: ShieldCheck,
        title: `Genuine unit #${u.index} - private lot`,
        desc: "This lot uses zero-knowledge dispensing: pharmacies prove a valid pack was sold without revealing which one, so the sale status of an individual pack is confidential by design."
      };
    const dispensedEv = u.timeline.find((t) => t.event === "UnitDispensed");
    const clones = u.timeline.filter((t) => t.event === "CloneDetected").length;
    if (u.dispensed)
      return {
        cls: clones ? "border-amber-500/40 bg-amber-500/10 text-amber-400" : "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
        icon: clones ? AlertTriangle : ShieldCheck,
        title: `Genuine unit #${u.index} - dispensed${dispensedEv ? ` by ${dispensedEv.pharmacy?.name || dispensedEv.pharmacy?.address}` : ""}`,
        desc:
          (dispensedEv ? `Dispensed ${new Date(dispensedEv.at).toLocaleString()}. ` : "") +
          "If you bought this pack there, it is yours and authentic. If you bought it anywhere else, its label is a COPY." +
          (clones ? ` ${clones} copy attempt(s) of this label have already been caught on-chain.` : "")
      };
    return {
      cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
      icon: ShieldCheck,
      title: `Genuine unit #${u.index} - not yet dispensed`,
      desc: "Authentic and still in the supply chain. A pharmacy must scan it at sale; if you already bought it, the seller skipped that step."
    };
  };

  const display = result ? batchDisplay(result.authenticityStatus) : null;
  const StatusIcon = display?.icon;
  const uv = unit ? unitVerdict(unit) : null;

  return (
    <div className="min-h-screen text-slate-100 flex flex-col items-center py-12 px-4 bg-grid">
      <div className="w-full max-w-5xl">
        <div className="text-center mb-10">
          <span className="px-3 py-1 text-xs font-semibold text-sky-400 bg-sky-500/10 rounded-full uppercase tracking-widest border border-sky-500/20">
            Public Verification Portal
          </span>
          <h1 className="text-4xl font-extrabold tracking-tight mt-3 text-slate-100 font-sans">Verify Your Medicine</h1>
          <p className="text-slate-400 mt-2">
            Scan the QR code on your pack. Each pack has a unique one-time label checked directly against the blockchain - no login, no fees.
          </p>
          <Link to="/explorer" className="inline-flex items-center gap-1 text-xs text-sky-400 hover:underline mt-2">
            <Blocks className="h-3.5 w-3.5" /> Inspect the ledger
          </Link>
        </div>

        <div className="glass-panel rounded-3xl p-6 shadow-2xl mb-8">
          <div className="flex flex-col md:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 h-5 w-5" />
              <input
                type="text"
                placeholder="Label link or Batch ID"
                value={input}
                onChange={(e) => setInput(e.target.value)}
                className="w-full pl-12 pr-4 py-4 bg-slate-900 border border-slate-800 rounded-2xl text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-500 transition font-mono text-sm"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowScanner(!showScanner)}
                className={`flex items-center gap-2 px-5 py-4 border font-semibold rounded-2xl transition ${
                  showScanner ? "bg-red-500/10 text-red-400 border-red-500/20" : "bg-slate-900 text-slate-300 border-slate-800"
                }`}
              >
                <QrCode className="h-5 w-5" />
                {showScanner ? "Close" : "Scan"}
              </button>
              <button
                onClick={() => verify(parseLabel(input))}
                disabled={loading}
                className="flex-1 md:flex-initial px-8 py-4 bg-sky-500 hover:bg-sky-600 disabled:bg-sky-500/50 text-slate-950 font-bold rounded-2xl shadow-lg transition"
              >
                {loading ? "Checking..." : "Verify"}
              </button>
            </div>
          </div>
          {showScanner && (
            <div className="mt-6 border border-slate-800 rounded-2xl overflow-hidden bg-slate-900 p-4">
              <div id="reader" className="w-full"></div>
            </div>
          )}
          {error && <p className="text-red-400 text-sm mt-3 font-semibold">{error}</p>}
        </div>

        {uv && (
          <div className={`glass-panel border-2 rounded-3xl p-6 mb-6 ${uv.cls}`}>
            <div className="flex items-start gap-4">
              <uv.icon className="h-10 w-10 shrink-0" />
              <div>
                <p className="text-[10px] uppercase tracking-widest font-bold opacity-70 flex items-center gap-1">
                  <Fingerprint className="h-3 w-3" /> This pack
                </p>
                <h3 className="text-xl font-bold font-sans">{uv.title}</h3>
                <p className="text-sm text-slate-300 mt-1">{uv.desc}</p>
                {!unit.error && (
                  <p className="text-[10px] text-slate-500 font-mono mt-3">
                    Merkle proof depth {unit.proofDepth} · verified by contract call PharmaChain.verifyUnit · lot status {unit.lotStatus}
                    {unit.expired ? " · EXPIRED" : ""}
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        {unit && !unit.error && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
            <Panel title="Merkle proof, recomputed in your browser" icon={GitBranch}>
              <MerklePath
                originKey={unit.originKey}
                index={unit.index}
                leaf={unit.leaf}
                proof={unit.proof}
                root={unit.onchainRoot}
                packsPerCarton={unit.ppc}
                cartonsPerCase={unit.cpc}
              />
              <p className="text-[10px] text-slate-500 mt-3">
                Your pack's visible tag and the public commitment to its hidden scratch code form a leaf, which climbs the carton, case and lot trees with{" "}
                {unit.proofDepth} sibling hashes. Only if the result equals the root the manufacturer committed on-chain is the pack authentic.
              </p>
              <div className="mt-4 p-3 rounded-xl border border-amber-500/20 bg-amber-500/5">
                <p className="text-[11px] font-semibold text-amber-300">Bought it? Scratch the hidden panel and check it belongs to this pack</p>
                <div className="flex gap-2 mt-2">
                  <input
                    value={scratch}
                    onChange={(e) => setScratch(e.target.value.toUpperCase())}
                    placeholder="XXXX-XXXX-XXXX-XXXX"
                    className="flex-1 px-3 py-2 bg-slate-950 border border-slate-800 rounded-lg text-xs font-mono tracking-widest text-amber-200"
                  />
                  <button onClick={checkScratch} className="px-3 py-2 rounded-lg bg-amber-500 text-slate-950 text-xs font-bold">
                    Check
                  </button>
                </div>
                {scratchResult && (
                  <p className={`text-[11px] mt-2 ${scratchResult === "match" ? "text-emerald-400" : "text-rose-400"}`}>
                    {scratchResult === "match"
                      ? "Match - the hidden code was committed by the manufacturer for exactly this pack. You hold the original."
                      : scratchResult === "mismatch"
                      ? "Mismatch - this scratch code does not belong to this pack. Report it."
                      : scratchResult}
                  </p>
                )}
              </div>
            </Panel>
            {lineage && (
              <Panel title={`Where this pack sits in lot ${lineage.lotBatchId}`} icon={Grid3x3}>
                <UnitMap lotSize={lineage.lotSize} shipments={lineage.shipments} dispensed={lineage.dispensed} flagged={lineage.flagged} highlight={unit.index} max={300} />
              </Panel>
            )}
          </div>
        )}

        {lastLabel && lastLabel.index !== undefined && (
          <div className="mb-6">
            <ScanLocation batchId={lastLabel.batchId} index={lastLabel.index} publicTag={lastLabel.publicTag} authentic={unit ? unit.authentic : undefined} />
          </div>
        )}

        {result && (
          <div className="space-y-6">
            <div className={`glass-panel border rounded-3xl p-8 shadow-2xl flex flex-col md:flex-row items-center gap-6 ${display.cls}`}>
              <div className="h-16 w-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                <StatusIcon className="h-9 w-9" />
              </div>
              <div className="text-center md:text-left">
                <p className="text-[10px] uppercase tracking-widest font-bold opacity-70">Production lot</p>
                <h3 className="text-2xl font-bold font-sans text-slate-100">{display.title}</h3>
                <p className="text-slate-400 text-sm mt-1">{display.desc}</p>
                {result.data && (
                  <div className="mt-4 flex flex-wrap justify-center md:justify-start gap-4 text-xs font-mono text-slate-400">
                    <span>Batch: <strong className="text-slate-200">{result.data.batchId}</strong></span>
                    <span>Risk: <strong className={result.riskScore > 30 ? "text-amber-400" : "text-emerald-400"}>{result.riskScore}%</strong></span>
                    {result.onChain && <span>On-chain status: <strong className="text-slate-200">{result.onChain.status}</strong></span>}
                  </div>
                )}
              </div>
            </div>

            {result.data && (
              <>
                <div className="glass-panel rounded-3xl p-6 border border-slate-900">
                  <h4 className="text-lg font-bold mb-4 font-sans text-slate-200">Product Specifications</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                    {[
                      ["Medicine", result.data.drugName],
                      ["Registration Code", result.data.productCode],
                      ["Manufactured", new Date(result.data.productionDate).toLocaleDateString()],
                      ["Expires", new Date(result.data.expiryDate).toLocaleDateString()],
                      ["Storage range", result.data.minTempC !== undefined ? `${result.data.minTempC} - ${result.data.maxTempC} degC` : "-"],
                      ["Manufacturer", result.data.manufacturer?.companyName || result.data.manufacturerEthAddress]
                    ].map(([k, v]) => (
                      <div key={k} className="flex justify-between p-3.5 bg-slate-900/60 rounded-xl border border-slate-900">
                        <span className="text-slate-400">{k}</span>
                        <span className="font-semibold text-slate-200 text-right">{v}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {result.anomalies && result.anomalies.length > 0 && (
                  <div className="glass-panel border border-amber-500/20 rounded-3xl p-6 bg-amber-500/5">
                    <div className="flex items-center gap-2 mb-3">
                      <AlertTriangle className="h-5 w-5 text-amber-400" />
                      <h4 className="text-lg font-bold text-amber-400 font-sans">Evidence on this lot</h4>
                    </div>
                    <ul className="space-y-3">
                      {result.anomalies.map((a, idx) => (
                        <li key={idx} className="p-4 bg-slate-950/80 rounded-2xl border border-slate-900 text-xs">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-400 mr-2 uppercase">{a.type}</span>
                          {a.source === "on-chain" && (
                            <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-500/20 text-sky-400 uppercase">on-chain evidence</span>
                          )}
                          <p className="mt-2 text-slate-400">{a.description}</p>
                          {a.txHash && (
                            <Link to={`/explorer?tx=${a.txHash}`} className="mt-1 inline-block font-mono text-[10px] text-sky-500 hover:underline">
                              tx {shortHash(a.txHash, 10)}
                            </Link>
                          )}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {result.custody && result.custody.length > 0 && (
                  <Panel title="Chain of custody" icon={Route}>
                    <CustodyStepper
                      custody={result.custody.map((c) => c.address)}
                      owners={Object.fromEntries(result.custody.map((c) => [c.address, { name: c.name, role: c.role }]))}
                      dispensed={unit?.dispensed}
                    />
                  </Panel>
                )}

                <div className="glass-panel rounded-3xl p-6 border border-slate-900">
                  <h4 className="text-lg font-bold mb-6 font-sans text-slate-200">Blockchain Custody Trail</h4>
                  <div className="relative border-l-2 border-slate-800 ml-4 pl-6 space-y-8">
                    {(result.data.history || []).map((step, idx) => (
                      <div key={idx} className="relative">
                        <div className="absolute -left-[31px] top-1.5 h-4 w-4 rounded-full border-2 border-slate-950 bg-sky-500" />
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-bold px-2.5 py-0.5 rounded bg-sky-500/10 text-sky-400 border border-sky-500/20">{step.action}</span>
                          <span className="text-xs text-slate-500">{new Date(step.timestamp).toLocaleString()}</span>
                          {step.blockNumber !== undefined && <span className="text-[10px] font-mono text-slate-600">block #{step.blockNumber}</span>}
                        </div>
                        <div className="mt-2 text-sm text-slate-300">{(ACTION_TEXT[step.action] || (() => step.action))(step)}</div>
                        {step.txHash && (
                          <div className="mt-2 flex items-center gap-1.5 text-xs text-slate-500">
                            <LinkIcon className="h-3 w-3" />
                            <Link to={`/explorer?tx=${step.txHash}`} className="font-mono text-sky-500/80 hover:underline break-all">
                              {step.txHash}
                            </Link>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="glass-panel rounded-3xl p-6 border border-slate-900 bg-red-500/5 mt-6">
                  <div className="flex justify-between items-center">
                    <div>
                      <h4 className="text-sm font-bold text-red-400 font-sans">Report Suspicious Product</h4>
                      <p className="text-slate-400 text-xs mt-0.5">Broken seal, wrong print, or bought from an unverified seller?</p>
                    </div>
                    <button onClick={() => setShowReportForm(!showReportForm)} className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 font-semibold rounded-xl text-xs border border-red-500/20 shrink-0">
                      {showReportForm ? "Cancel" : "Report"}
                    </button>
                  </div>
                  {showReportForm && (
                    <form onSubmit={handleSendReport} className="mt-4 space-y-4">
                      {reportSuccess && <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold rounded-xl">{reportSuccess}</div>}
                      <textarea
                        rows="3"
                        value={reportDesc}
                        onChange={(e) => setReportDesc(e.target.value)}
                        placeholder="Describe the issue..."
                        className="w-full px-4 py-3 bg-slate-950 border border-slate-900 rounded-xl text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-red-500/40"
                        required
                      ></textarea>
                      <button type="submit" disabled={reportLoading} className="px-5 py-2.5 bg-red-500 hover:bg-red-600 text-slate-100 text-xs font-bold rounded-xl">
                        {reportLoading ? "Sending..." : "Submit Safety Report"}
                      </button>
                    </form>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default VerifyProduct;
