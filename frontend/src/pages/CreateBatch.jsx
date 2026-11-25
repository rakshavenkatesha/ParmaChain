import React, { useState, useContext } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { ZeroHash } from "ethers";
import { Web3Context } from "../context/Web3Context";
import { PlusCircle, Info, Thermometer, GitBranch, Check, Boxes, EyeOff, PackageOpen } from "lucide-react";
import { generateLot } from "../utils/unitMerkle";
import { buildZkLot, publishZkLot } from "../utils/zkLot";
import { BATCH_ID_PATTERN, deriveLabelSeed, waitForIndexer, toDeci, errorMessage } from "../utils/chain";
import { PageHeader } from "../components/ui";

const MAX_UNITS_UI = 10000;
const PPC_OPTIONS = [1, 2, 4, 8, 16, 32, 64, 128, 256];

const inputCls = "w-full px-4 py-3 bg-slate-900 border border-slate-800 rounded-xl text-sm focus:outline-none focus:border-sky-500 transition text-slate-200";
const labelCls = "block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2";

const CreateBatch = () => {
  const navigate = useNavigate();
  const { contract, signer, isConnected, connectWallet } = useContext(Web3Context);

  const [formData, setFormData] = useState({
    batchId: "",
    drugName: "",
    productCode: "",
    quantity: "",
    productionDate: "",
    expiryDate: "",
    minTemp: "2",
    maxTemp: "8",
    packsPerCarton: "8",
    cartonsPerCase: "4",
    privateLot: false
  });
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [step, setStep] = useState(-1);
  const [root, setRoot] = useState("");

  const steps = [
    "Sign label seed with wallet",
    "Derive two-part labels & build case → carton → pack Merkle trees",
    ...(formData.privateLot ? ["Build zero-knowledge (Poseidon) tree"] : []),
    "Register lot root on-chain",
    "Publish public commitments to proof server"
  ];

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData({ ...formData, [name]: type === "checkbox" ? checked : value });
  };

  const qty = parseInt(formData.quantity, 10) || 0;
  const ppc = parseInt(formData.packsPerCarton, 10);
  const cpc = parseInt(formData.cartonsPerCase, 10) || 1;
  const cartons = qty ? Math.ceil(qty / ppc) : 0;
  const cases = cartons ? Math.ceil(cartons / cpc) : 0;

  const handleSubmit = async (e) => {
    e.preventDefault();
    const { batchId, drugName, productCode, productionDate, expiryDate, minTemp, maxTemp, privateLot } = formData;
    if (!batchId || !drugName || !productCode || !qty || !productionDate || !expiryDate) return setError("Please fill in all fields.");
    if (!BATCH_ID_PATTERN.test(batchId)) return setError("Batch ID: 3-40 characters, letters, digits, '-' or '_' only.");
    if (!(qty >= 1 && qty <= MAX_UNITS_UI)) return setError(`Quantity must be between 1 and ${MAX_UNITS_UI}.`);
    if (new Date(expiryDate) <= new Date(productionDate)) return setError("Expiry date must be after the production date.");
    if (Number(minTemp) >= Number(maxTemp)) return setError("Minimum storage temperature must be below the maximum.");
    if (!(cpc >= 1 && cpc <= 1000)) return setError("Cartons per case must be between 1 and 1000.");
    if (!isConnected) {
      setError("Connect your MetaMask wallet first.");
      await connectWallet();
      return;
    }
    if (!contract) return setError("MetaMask is not on the PharmaChain network (chain 2026). Use the red banner at the top of the page to switch.");

    setLoading(true);
    setError("");
    let s = 0;
    try {
      setStep(s++);
      const seed = await deriveLabelSeed(signer, batchId);

      setStep(s++);
      await new Promise((r) => setTimeout(r, 30)); // let the UI paint before CPU-bound work
      const lot = generateLot(batchId, qty, seed, ppc, cpc);
      setRoot(lot.root);

      let zk = null;
      if (privateLot) {
        setStep(s++);
        zk = await buildZkLot(batchId, lot.labels, qty);
      }

      setStep(s++);
      const tx = await contract.registerBatch({
        batchId,
        drugName,
        productCode,
        quantity: qty,
        productionDate: Math.floor(new Date(productionDate).getTime() / 1000),
        expiryDate: Math.floor(new Date(expiryDate).getTime() / 1000),
        minTempDeci: toDeci(minTemp),
        maxTempDeci: toDeci(maxTemp),
        unitRoot: lot.root,
        packsPerCarton: ppc,
        cartonsPerCase: cpc,
        zkRoot: zk ? zk.zkRoot : ZeroHash
      });
      const receipt = await tx.wait();
      await waitForIndexer(receipt);

      setStep(s++);
      await axios.post(`/api/batches/${batchId}/units`, { leaves: lot.leaves, commitments: lot.commitments });
      if (zk) await publishZkLot(batchId, zk);
      setStep(s++);
      navigate(`/batches/${batchId}/labels`);
    } catch (err) {
      console.error(err);
      setError("Failed to register batch: " + errorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <PageHeader
        crumbs={[{ label: "Manufacturer" }, { label: "Register lot" }]}
        title="Register Production Lot"
        icon={PackageOpen}
        subtitle="Every pack gets a two-part label: a visible QR anyone can check and a hidden scratch-off code needed to dispense it. Only one Merkle root goes on-chain, whatever the lot size."
      />

      <div className="glass-panel p-6 sm:p-8 rounded-3xl shadow-2xl border border-slate-900">
        {!isConnected && (
          <div className="p-4 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-2xl text-xs flex items-center gap-3 mb-6">
            <Info className="h-5 w-5 shrink-0" />
            <div>
              <p className="font-semibold">MetaMask wallet disconnected</p>
              <button onClick={connectWallet} className="mt-2 px-3.5 py-1.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold rounded-xl transition">
                Connect Wallet
              </button>
            </div>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          {error && <div className="p-4 bg-red-500/10 border border-red-500/20 text-red-400 rounded-2xl text-xs font-semibold">{error}</div>}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Lot / Batch ID *</label>
              <input type="text" name="batchId" value={formData.batchId} onChange={handleChange} placeholder="e.g. INS-2026-0042" className={inputCls + " font-mono"} />
            </div>
            <div>
              <label className={labelCls}>Medicine Name *</label>
              <input type="text" name="drugName" value={formData.drugName} onChange={handleChange} placeholder="e.g. Insulin Glargine" className={inputCls} />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Product Registration Code *</label>
              <input type="text" name="productCode" value={formData.productCode} onChange={handleChange} placeholder="e.g. CDSCO-66551" className={inputCls + " font-mono"} />
            </div>
            <div>
              <label className={labelCls}>Packs in lot * (max {MAX_UNITS_UI.toLocaleString()})</label>
              <input type="number" name="quantity" min="1" max={MAX_UNITS_UI} value={formData.quantity} onChange={handleChange} placeholder="e.g. 96" className={inputCls} />
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className={labelCls}>Production Date *</label>
              <input type="date" name="productionDate" value={formData.productionDate} onChange={handleChange} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Expiration Date *</label>
              <input type="date" name="expiryDate" value={formData.expiryDate} onChange={handleChange} className={inputCls} />
            </div>
          </div>

          <div className="p-4 rounded-2xl border border-slate-800 bg-slate-900/40 space-y-3">
            <p className={labelCls + " flex items-center gap-1.5 mb-0"}>
              <Boxes className="h-3.5 w-3.5" /> Packaging hierarchy (case → carton → pack)
            </p>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] text-slate-500 mb-1">Packs per carton (power of two)</label>
                <select name="packsPerCarton" value={formData.packsPerCarton} onChange={handleChange} className={inputCls}>
                  {PPC_OPTIONS.map((n) => (
                    <option key={n} value={n}>
                      {n}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-[10px] text-slate-500 mb-1">Cartons per case</label>
                <input type="number" min="1" name="cartonsPerCase" value={formData.cartonsPerCase} onChange={handleChange} className={inputCls} />
              </div>
            </div>
            <p className="text-[11px] text-slate-500">
              {qty ? (
                <>
                  {qty.toLocaleString()} packs → <b className="text-slate-300">{cartons}</b> carton{cartons === 1 ? "" : "s"} → <b className="text-slate-300">{cases}</b> case{cases === 1 ? "" : "s"}. A
                  distributor can accept a whole case with one scan; a pharmacy can dispense many packs of a carton in one transaction.
                </>
              ) : (
                "Enter the number of packs to see the resulting cartons and cases."
              )}
            </p>
          </div>

          <div>
            <label className={labelCls + " flex items-center gap-1.5"}>
              <Thermometer className="h-3.5 w-3.5" /> Cold-chain storage range (°C) — judged by Mean Kinetic Temperature from 3 signed sensors
            </label>
            <div className="grid grid-cols-2 gap-4">
              <input type="number" step="0.1" name="minTemp" value={formData.minTemp} onChange={handleChange} className={inputCls} placeholder="min" />
              <input type="number" step="0.1" name="maxTemp" value={formData.maxTemp} onChange={handleChange} className={inputCls} placeholder="max" />
            </div>
          </div>

          <label className="flex items-start gap-3 p-4 rounded-2xl border border-violet-500/20 bg-violet-500/5 cursor-pointer">
            <input type="checkbox" name="privateLot" checked={formData.privateLot} onChange={handleChange} className="mt-1 accent-violet-500" />
            <span>
              <span className="text-sm font-bold text-violet-300 flex items-center gap-1.5">
                <EyeOff className="h-4 w-4" /> Private lot (zero-knowledge dispensing)
              </span>
              <span className="block text-xs text-slate-400 mt-1">
                Pharmacies prove they dispense a valid pack of their shipment without revealing which pack. A one-time nullifier stops double dispensing, and
                packs cannot be linked to patients or competitors.
              </span>
            </span>
          </label>

          {step >= 0 && (
            <div className="p-4 bg-slate-900/60 rounded-2xl border border-slate-800 space-y-2 text-xs">
              {steps.map((st, i) => (
                <div key={st} className={`flex items-center gap-2 ${i < step ? "text-emerald-400" : i === step ? "text-sky-400" : "text-slate-600"}`}>
                  {i < step ? <Check className="h-3.5 w-3.5" /> : <GitBranch className="h-3.5 w-3.5" />}
                  {st}
                </div>
              ))}
              {root && <p className="font-mono text-[10px] text-slate-500 break-all pt-1">lot root {root}</p>}
            </div>
          )}

          <button
            type="submit"
            disabled={loading}
            className="w-full py-4 bg-gradient-to-r from-sky-500 to-violet-500 hover:opacity-90 disabled:opacity-50 text-slate-950 font-bold rounded-xl shadow-lg transition flex justify-center items-center gap-2 mt-4"
          >
            <PlusCircle className="h-5 w-5" />
            {loading ? steps[Math.min(step, steps.length - 1)] + "..." : "Commit Lot to Blockchain"}
          </button>
        </form>
      </div>
    </div>
  );
};

export default CreateBatch;
