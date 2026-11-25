import React, { useState, useEffect, useContext } from "react";
import axios from "axios";
import { ZeroHash } from "ethers";
import { Html5QrcodeScanner } from "html5-qrcode";
import { Web3Context } from "../context/Web3Context";
import { QrCode, X, ShieldCheck, ShieldAlert, AlertTriangle, Pill, Boxes, Undo2, EyeOff } from "lucide-react";
import { parseLabel, parseLabelLine, isBytes32, waitForIndexer, errorMessage, DISPENSE_RESULTS } from "../utils/chain";
import { decodeCode } from "../utils/unitMerkle";
import { privateDispense, zkAvailable } from "../utils/zkDispense";

const TONE = {
  ok: "bg-emerald-500/10 border-emerald-500/30 text-emerald-400",
  bad: "bg-rose-500/10 border-rose-500/30 text-rose-400",
  warn: "bg-amber-500/10 border-amber-500/30 text-amber-400"
};

const safeCode = (code) => {
  try {
    return decodeCode(code);
  } catch {
    return "0x00000000000000000000";
  }
};

/**
 * Pharmacy point-of-dispense. Two-part labels: the visible QR identifies the pack, the hidden
 * scratch code proves physical possession of the genuine pack.
 */
const DispenseModal = ({ batch, onClose, onDone }) => {
  const { contract, signer, details } = useContext(Web3Context);
  const [mode, setMode] = useState("single");
  const [labelText, setLabelText] = useState("");
  const [code, setCode] = useState("");
  const [bulk, setBulk] = useState("");
  const [reason, setReason] = useState("Unopened - patient's prescription changed");
  const [scanning, setScanning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const privateLot = !!batch.privateLot;

  useEffect(() => {
    if (!scanning) return;
    const scanner = new Html5QrcodeScanner("dispense-reader", { fps: 10, qrbox: { width: 220, height: 220 } }, false);
    scanner.render(
      (text) => {
        setLabelText(text);
        setScanning(false);
        scanner.clear().catch(() => {});
      },
      () => {}
    );
    return () => {
      scanner.clear().catch(() => {});
    };
  }, [scanning]);

  const finish = async (receipt, extra) => {
    await waitForIndexer(receipt);
    setResult({ ...extra, txHash: receipt.hash, block: receipt.blockNumber, gas: Number(receipt.gasUsed) });
    onDone && onDone();
  };

  const proofFor = async (label) => {
    try {
      return (await axios.get(`/api/batches/${encodeURIComponent(label.batchId)}/units/${label.index}`)).data.proof;
    } catch {
      return { pack: [], carton: [], kase: [] }; // unknown lot / index -> recorded as forged by the contract
    }
  };

  // ------------------------------------------------------------------ single pack
  const dispenseSingle = async () => {
    const label = parseLabel(labelText);
    if (!label || label.index === undefined || Number.isNaN(label.index)) throw new Error("Not a unit label. Scan the pack's QR code or paste its label link.");
    if (!code.trim()) throw new Error("Scratch the hidden panel and type its 16-character code.");

    if (privateLot) {
      const r = await privateDispense({ signer, details, holdingBatchId: batch.batchId, lotBatchId: label.batchId, index: label.index, hiddenCode: decodeCode(code) });
      await waitForIndexer({ blockNumber: r.blockNumber });
      setResult({
        tone: r.outcome === "Dispensed" ? "ok" : "bad",
        title: r.outcome === "Dispensed" ? "Dispensed privately (zero-knowledge)" : "CLONED PACK (nullifier already spent)",
        text: "The chain learned only that a valid pack of this shipment was dispensed - not which one.",
        txHash: r.txHash,
        block: r.blockNumber
      });
      onDone && onDone();
      return;
    }

    const claim = { index: label.index, publicTag: isBytes32(label.publicTag) ? label.publicTag : ZeroHash, hiddenCode: safeCode(code) };
    const proof = await proofFor(label);
    const outcome = Number(await contract.decommissionUnit.staticCall(batch.batchId, claim, proof));
    const receipt = await (await contract.decommissionUnit(batch.batchId, claim, proof)).wait();
    await finish(receipt, { ...DISPENSE_RESULTS[outcome], title: `${DISPENSE_RESULTS[outcome].title} - unit #${label.index}` });
    setLabelText("");
    setCode("");
  };

  // ------------------------------------------------------------------ whole carton (multiproof)
  const dispenseCarton = async () => {
    const items = bulk
      .split("\n")
      .map(parseLabelLine)
      .filter((x) => x && x.index !== undefined);
    if (!items.length) throw new Error("Paste one line per pack: <visible label link> <SCRATCH-CODE>");
    if (items.some((x) => !x.code)) throw new Error("Every line needs the pack's scratch code.");
    const ppc = batch.packsPerCarton;
    const cartons = [...new Set(items.map((x) => Math.floor(x.index / ppc)))];
    if (cartons.length !== 1) throw new Error(`All packs must come from ONE carton (found cartons ${cartons.join(", ")}).`);
    const byIndex = Object.fromEntries(items.map((x) => [x.index, x]));
    const mp = (await axios.post(`/api/batches/${encodeURIComponent(items[0].batchId)}/carton-proof`, { cartonIndex: cartons[0], indices: items.map((x) => x.index) })).data.data;
    const claims = mp.indices.map((i) => ({
      index: i,
      publicTag: isBytes32(byIndex[i].publicTag) ? byIndex[i].publicTag : ZeroHash,
      hiddenCode: safeCode(byIndex[i].code)
    }));
    const args = [batch.batchId, cartons[0], claims, mp.multiProof, mp.proofFlags, mp.cartonProof, mp.caseProof];
    await contract.decommissionCarton.staticCall(...args); // surfaces "Invalid carton multiproof" before signing
    const receipt = await (await contract.decommissionCarton(...args)).wait();
    const names = receipt.logs.map((l) => {
      try {
        return contract.interface.parseLog(l)?.name;
      } catch {
        return null;
      }
    });
    const n = (x) => names.filter((y) => y === x).length;
    const ok = n("UnitDispensed");
    await finish(receipt, {
      tone: ok === claims.length ? "ok" : "warn",
      title: `Carton ${cartons[0]}: ${ok} of ${claims.length} packs dispensed in ONE transaction`,
      text: `Merkle multiproof with ${mp.multiProof.length} sibling hashes; ${n("CloneDetected")} clone(s), ${n("DiversionDetected")} diverted pack(s) recorded as evidence. ~${Math.round(
        Number(receipt.gasUsed) / claims.length
      ).toLocaleString()} gas per pack.`
    });
    setBulk("");
  };

  // ------------------------------------------------------------------ return
  const requestReturn = async () => {
    const label = parseLabel(labelText);
    if (!label || label.index === undefined) throw new Error("Scan or paste the returned pack's label.");
    const receipt = await (await contract.requestReturn(batch.batchId, label.index, reason)).wait();
    await finish(receipt, { tone: "warn", title: `Return of unit #${label.index} requested`, text: "A regulator must approve it; the pack's bit is then cleared and it goes back on the shelf." });
    setLabelText("");
  };

  const run = async () => {
    setError("");
    setResult(null);
    setBusy(true);
    try {
      if (mode === "single") await dispenseSingle();
      else if (mode === "carton") await dispenseCarton();
      else await requestReturn();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const Icon = result?.tone === "ok" ? ShieldCheck : result?.tone === "bad" ? ShieldAlert : AlertTriangle;
  const tabs = [
    { id: "single", label: privateLot ? "Private (ZK)" : "Single pack", icon: privateLot ? EyeOff : Pill },
    ...(!privateLot ? [{ id: "carton", label: "Whole carton", icon: Boxes }] : []),
    ...(!privateLot ? [{ id: "return", label: "Return", icon: Undo2 }] : [])
  ];
  const inputCls = "w-full px-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-xs font-mono text-slate-200 focus:outline-none focus:border-sky-500";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
      <div className="max-w-xl w-full rounded-3xl p-6 shadow-2xl relative border border-slate-800 bg-slate-900 space-y-4 max-h-[92vh] overflow-y-auto">
        <button onClick={onClose} className="absolute top-4 right-4 text-slate-500 hover:text-slate-200">
          <X className="h-5 w-5" />
        </button>
        <div>
          <h3 className="text-lg font-bold">Point of dispense</h3>
          <p className="text-xs text-slate-400 mt-1">
            Shelf stock <span className="font-mono text-sky-400">{batch.batchId}</span> · units [{batch.unitStart}, {batch.unitEnd}) · {batch.quantity - batch.dispensedCount} remaining
            {privateLot && <span className="ml-1 text-violet-300">· private lot</span>}
          </p>
        </div>

        <div className="flex gap-2">
          {tabs.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setMode(t.id);
                setResult(null);
                setError("");
              }}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-semibold border ${mode === t.id ? "border-sky-500/50 bg-sky-500/10 text-sky-300" : "border-slate-800 text-slate-400"}`}
            >
              <t.icon className="h-3.5 w-3.5" /> {t.label}
            </button>
          ))}
        </div>

        {result && (
          <div className={`p-4 rounded-2xl border ${TONE[result.tone]}`}>
            <div className="flex items-center gap-2 font-bold">
              <Icon className="h-5 w-5" /> {result.title}
            </div>
            <p className="text-xs mt-1 text-slate-300">{result.text}</p>
            <p className="text-[10px] mt-2 font-mono text-slate-500 break-all">
              block {result.block}
              {result.gas ? ` · gas ${result.gas.toLocaleString()}` : ""} · tx {result.txHash}
            </p>
          </div>
        )}
        {error && <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-xs">{error}</div>}

        {mode !== "carton" ? (
          <>
            <textarea rows="2" value={labelText} onChange={(e) => setLabelText(e.target.value)} placeholder="Scan the pack's QR or paste its visible label link (…/verify?b=LOT&i=12&p=0x…)" className={inputCls} />
            {mode === "single" && (
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="Hidden scratch code  XXXX-XXXX-XXXX-XXXX"
                className={inputCls + " tracking-widest text-amber-200 border-amber-500/30"}
              />
            )}
            {mode === "return" && <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason" className={inputCls} />}
            {privateLot && !zkAvailable && <p className="text-[11px] text-amber-400">The zero-knowledge prover is not installed in this build.</p>}
          </>
        ) : (
          <>
            <textarea
              rows="6"
              value={bulk}
              onChange={(e) => setBulk(e.target.value)}
              placeholder={"One pack per line, all from the same carton:\n<visible label link> XXXX-XXXX-XXXX-XXXX\n<visible label link> XXXX-XXXX-XXXX-XXXX"}
              className={inputCls}
            />
            <p className="text-[11px] text-slate-500">
              All packs are proven with one Merkle multiproof against the carton root and written with a single bitmap update - cheaper per pack than single scans.
            </p>
          </>
        )}
        {scanning && <div id="dispense-reader" className="rounded-xl overflow-hidden bg-slate-950" />}

        <div className="flex gap-2">
          {mode !== "carton" && (
            <button onClick={() => setScanning(!scanning)} className="flex items-center gap-2 px-4 py-3 bg-slate-950 border border-slate-800 rounded-xl text-xs font-semibold text-slate-300">
              <QrCode className="h-4 w-4" /> {scanning ? "Stop camera" : "Scan QR"}
            </button>
          )}
          <button
            onClick={run}
            disabled={busy}
            className={`flex-1 py-3 disabled:opacity-40 text-slate-950 font-bold rounded-xl text-xs uppercase tracking-wider ${mode === "return" ? "bg-amber-500 hover:bg-amber-600" : "bg-emerald-500 hover:bg-emerald-600"}`}
          >
            {busy ? (privateLot && mode === "single" ? "Generating zero-knowledge proof..." : "Verifying on-chain...") : mode === "carton" ? "Dispense carton" : mode === "return" ? "Request return" : "Verify & dispense"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DispenseModal;
