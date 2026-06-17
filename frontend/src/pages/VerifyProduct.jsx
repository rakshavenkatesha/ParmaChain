import React, { useState, useEffect } from "react";
import axios from "axios";
import { Html5QrcodeScanner } from "html5-qrcode";
import {
  ShieldCheck,
  ShieldAlert,
  ShieldQuestion,
  CalendarDays,
  Search,
  QrCode,
  Link as LinkIcon,
  User,
  ArrowRight,
  TrendingDown,
  AlertTriangle
} from "lucide-react";

const VerifyProduct = () => {
  const [batchId, setBatchId] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState("");
  const [showScanner, setShowScanner] = useState(false);

  // Counterfeit feedback reporting state
  const [showReportForm, setShowReportForm] = useState(false);
  const [reportDesc, setReportDesc] = useState("");
  const [reportLoading, setReportLoading] = useState(false);
  const [reportSuccess, setReportSuccess] = useState("");

  // Auto scan initialization
  useEffect(() => {
    let scanner;
    if (showScanner) {
      scanner = new Html5QrcodeScanner("reader", {
        fps: 10,
        qrbox: { width: 250, height: 250 }
      }, false);

      scanner.render(
        (decodedText) => {
          // If the scanned text is a URL, parse out the batchId
          let parsedId = decodedText;
          try {
            if (decodedText.startsWith("http")) {
              const url = new URL(decodedText);
              parsedId = url.pathname.split("/").pop() || decodedText;
            }
          } catch (e) {
            console.error("URL parse error:", e);
          }

          setBatchId(parsedId);
          setShowScanner(false);
          scanner.clear();
          verifyBatch(parsedId);
        },
        (err) => {
          // Frame errors are common, we ignore them to avoid console noise
        }
      );
    }

    return () => {
      if (scanner) {
        scanner.clear().catch((e) => console.warn("Scanner clear failed:", e));
      }
    };
  }, [showScanner]);

  const verifyBatch = async (idToVerify) => {
    const targetId = idToVerify || batchId;
    if (!targetId.trim()) {
      setError("Please enter or scan a Batch ID.");
      return;
    }

    setLoading(true);
    setError("");
    setResult(null);

    try {
      const res = await axios.post(`/api/batches/${targetId}/verify`);
      setResult(res.data);
    } catch (err) {
      console.error(err);
      setError(
        err.response?.data?.message ||
          "This Batch ID is not registered on the blockchain. Product is likely counterfeit!"
      );
      setResult({
        authenticityStatus: "Invalid",
        message: "This batch could not be found in the registry."
      });
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
      const activeId = result.data?.batchId || batchId;
      const res = await axios.post(`/api/batches/${activeId}/report`, {
        description: reportDesc
      });
      if (res.data.success) {
        setReportSuccess(res.data.message);
        setReportDesc("");
        // Reload details to show the newly flagged anomaly immediately
        verifyBatch(activeId);
      }
    } catch (err) {
      console.error(err);
      alert("Failed to submit feedback report.");
    } finally {
      setReportLoading(false);
    }
  };

  const getStatusDisplay = (status) => {
    switch (status) {
      case "Genuine":
        return {
          icon: ShieldCheck,
          colorClass: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
          title: "Genuine Pharmaceutical Product",
          desc: "This drug batch is verified on-chain and matches all expected supply chain custody transfer criteria."
        };
      case "Expired":
        return {
          icon: CalendarDays,
          colorClass: "text-red-400 bg-red-500/10 border-red-500/20",
          title: "Expired Pharmaceutical Product",
          desc: "Caution: This batch has reached its expiration date and should not be distributed or consumed."
        };
      case "Suspicious":
      case "Critical Alert":
        return {
          icon: AlertTriangle,
          colorClass: "text-amber-400 bg-amber-500/10 border-amber-500/20",
          title: "Suspicious Batch Activity",
          desc: "Warning: Counterfeit indicators were flagged (e.g. skipped distributor stages, duplicate scans, or unauthorized transfers)."
        };
      case "Invalid":
      default:
        return {
          icon: ShieldAlert,
          colorClass: "text-rose-500 bg-rose-500/10 border-rose-500/20",
          title: "Counterfeit/Invalid Drug ID",
          desc: "Critical: This batch does not exist in the blockchain database. It is highly likely to be counterfeit or unauthorized."
        };
    }
  };

  const display = result ? getStatusDisplay(result.authenticityStatus) : null;
  const StatusIcon = display ? display.icon : null;

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center py-12 px-4">
      <div className="w-full max-w-3xl">
        {/* Title */}
        <div className="text-center mb-10">
          <span className="px-3 py-1 text-xs font-semibold text-sky-400 bg-sky-500/10 rounded-full uppercase tracking-widest border border-sky-500/20">
            Public Verification Portal
          </span>
          <h1 className="text-4xl font-extrabold tracking-tight mt-3 text-slate-100 font-sans">
            Verify Medicine Authenticity
          </h1>
          <p className="text-slate-400 mt-2">
            Scan QR labels or enter drug Batch IDs to audit complete supply chain transfers on the blockchain.
          </p>
        </div>

        {/* Search Panel */}
        <div className="glass-panel rounded-3xl p-6 shadow-2xl mb-8">
          <div className="flex flex-col md:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400 h-5 w-5" />
              <input
                type="text"
                placeholder="Enter Batch ID (e.g. BATCH-001)"
                value={batchId}
                onChange={(e) => setBatchId(e.target.value)}
                className="w-full pl-12 pr-4 py-4 bg-slate-900 border border-slate-800 rounded-2xl text-slate-100 placeholder-slate-500 focus:outline-none focus:border-sky-500 transition font-mono"
              />
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowScanner(!showScanner)}
                className={`flex items-center gap-2 px-5 py-4 border font-semibold rounded-2xl transition ${
                  showScanner
                    ? "bg-red-500/10 text-red-400 border-red-500/20"
                    : "bg-slate-900 text-slate-300 border-slate-850 hover:bg-slate-850"
                }`}
              >
                <QrCode className="h-5 w-5" />
                {showScanner ? "Close" : "Scan QR"}
              </button>
              <button
                onClick={() => verifyBatch()}
                disabled={loading}
                className="flex-1 md:flex-initial px-8 py-4 bg-sky-500 hover:bg-sky-600 disabled:bg-sky-500/50 text-slate-950 font-bold rounded-2xl shadow-lg shadow-sky-500/10 transition"
              >
                {loading ? "Checking..." : "Verify"}
              </button>
            </div>
          </div>

          {/* QR Scan Window */}
          {showScanner && (
            <div className="mt-6 border border-slate-800 rounded-2xl overflow-hidden bg-slate-900 p-4">
              <div id="reader" className="w-full"></div>
            </div>
          )}

          {error && <p className="text-red-400 text-sm mt-3 font-semibold">{error}</p>}
        </div>

        {/* Results Presentation */}
        {result && (
          <div className="space-y-6">
            {/* Verification Status Card */}
            <div className={`glass-panel border rounded-3xl p-8 shadow-2xl flex flex-col md:flex-row items-center gap-6 ${display.colorClass}`}>
              <div className="h-16 w-16 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center shrink-0">
                <StatusIcon className="h-9 w-9" />
              </div>
              <div className="text-center md:text-left">
                <h3 className="text-2xl font-bold font-sans text-slate-100">{display.title}</h3>
                <p className="text-slate-400 text-sm mt-1">{display.desc}</p>
                <div className="mt-4 flex flex-wrap justify-center md:justify-start gap-4 text-xs font-mono text-slate-400">
                  <span>Batch ID: <strong className="text-slate-200">{result.data?.batchId || batchId}</strong></span>
                  <span>•</span>
                  <span>Risk Rating: <strong className={result.riskScore > 30 ? "text-amber-400" : "text-emerald-400"}>{result.riskScore}%</strong></span>
                  <span>•</span>
                  <span>Scanned: <strong className="text-slate-200">{result.data?.verificationCount || 1} times</strong></span>
                </div>
              </div>
            </div>

            {result.data && (
              <>
                {/* Drug Profile details */}
                <div className="glass-panel rounded-3xl p-6 border border-slate-900">
                  <h4 className="text-lg font-bold mb-4 font-sans text-slate-200">Product Specifications</h4>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                    <div className="flex justify-between p-3.5 bg-slate-900/60 rounded-xl border border-slate-900">
                      <span className="text-slate-400">Medicine Name</span>
                      <span className="font-bold text-slate-200">{result.data.drugName}</span>
                    </div>
                    <div className="flex justify-between p-3.5 bg-slate-900/60 rounded-xl border border-slate-900">
                      <span className="text-slate-400">Product Registration Code</span>
                      <span className="font-mono text-slate-200">{result.data.productCode}</span>
                    </div>
                    <div className="flex justify-between p-3.5 bg-slate-900/60 rounded-xl border border-slate-900">
                      <span className="text-slate-400">Production Date</span>
                      <span className="text-slate-200">{new Date(result.data.productionDate).toLocaleDateString()}</span>
                    </div>
                    <div className="flex justify-between p-3.5 bg-slate-900/60 rounded-xl border border-slate-900">
                      <span className="text-slate-400">Expiration Date</span>
                      <span className={`font-semibold ${result.authenticityStatus === "Expired" ? "text-red-400" : "text-slate-200"}`}>
                        {new Date(result.data.expiryDate).toLocaleDateString()}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Anomalies Flagged list */}
                {result.anomalies && result.anomalies.length > 0 && (
                  <div className="glass-panel border border-amber-500/20 rounded-3xl p-6 bg-amber-500/5">
                    <div className="flex items-center gap-2 mb-3">
                      <AlertTriangle className="h-5 w-5 text-amber-400" />
                      <h4 className="text-lg font-bold text-amber-400 font-sans">Flagged Anomaly Triggers</h4>
                    </div>
                    <ul className="space-y-3">
                      {result.anomalies.map((anom, idx) => (
                        <li key={idx} className="p-4 bg-slate-950/80 rounded-2xl border border-slate-900 text-xs">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-400 mr-2 uppercase">
                            {anom.type}
                          </span>
                          <p className="mt-2 text-slate-400">{anom.description}</p>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Audit Trail Timeline */}
                <div className="glass-panel rounded-3xl p-6 border border-slate-900">
                  <h4 className="text-lg font-bold mb-6 font-sans text-slate-200">Blockchain Custody Audit Trail</h4>
                  <div className="relative border-l-2 border-slate-800 ml-4 pl-6 space-y-8">
                    {result.data.history.map((step, idx) => (
                      <div key={idx} className="relative">
                        {/* Dot indicator */}
                        <div className="absolute -left-[31px] top-1.5 h-4.5 w-4.5 rounded-full border-2 border-slate-950 bg-sky-500 flex items-center justify-center">
                          <div className="h-1.5 w-1.5 rounded-full bg-slate-950"></div>
                        </div>

                        <div>
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-bold px-2.5 py-0.5 rounded bg-sky-500/10 text-sky-400 border border-sky-500/20">
                              {step.action}
                            </span>
                            <span className="text-xs text-slate-500">
                              {new Date(step.timestamp).toLocaleString()}
                            </span>
                          </div>

                          <div className="mt-2 text-sm text-slate-300">
                            {step.action === "Created" && (
                              <p>Created by Manufacturer address: <strong className="text-slate-100 font-mono">{step.to}</strong></p>
                            )}
                            {step.action === "Transfer Initiated" && (
                              <p>Ownership dispatched from <strong className="font-mono text-slate-400">{step.from.slice(0, 8)}...</strong> to <strong className="font-mono text-slate-100">{step.to.slice(0, 8)}...</strong></p>
                            )}
                            {step.action === "Shipment Accepted" && (
                              <p>Shipment received and signed by owner: <strong className="text-slate-100 font-mono">{step.to}</strong></p>
                            )}
                            {step.action === "Recalled" && (
                              <p className="text-red-400 font-semibold">Defective Batch recalled by Manufacturer.</p>
                            )}
                          </div>

                          {step.txHash && (
                            <div className="mt-2 flex items-center gap-1.5 text-xs text-slate-500">
                              <LinkIcon className="h-3 w-3" />
                              <span>Tx:</span>
                              <a
                                href={`https://sepolia.etherscan.io/tx/${step.txHash}`}
                                target="_blank"
                                rel="noreferrer"
                                className="font-mono text-sky-500/80 hover:underline hover:text-sky-400 break-all"
                              >
                                {step.txHash}
                              </a>
                            </div>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Consumer Report/Feedback Form */}
                <div className="glass-panel rounded-3xl p-6 border border-slate-900 bg-red-500/5 mt-6">
                  <div className="flex justify-between items-center">
                    <div>
                      <h4 className="text-sm font-bold text-red-400 font-sans">Report Suspicious Product Activity</h4>
                      <p className="text-slate-400 text-xs mt-0.5">Defective packaging, broken seals, or suspected counterfeiting? Alert the administrators.</p>
                    </div>
                    <button
                      onClick={() => setShowReportForm(!showReportForm)}
                      type="button"
                      className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 font-semibold rounded-xl text-xs transition border border-red-500/20 shrink-0"
                    >
                      {showReportForm ? "Cancel" : "Report"}
                    </button>
                  </div>

                  {showReportForm && (
                    <form onSubmit={handleSendReport} className="mt-4 space-y-4">
                      {reportSuccess && (
                        <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-xs font-semibold rounded-xl">
                          {reportSuccess}
                        </div>
                      )}
                      <div>
                        <textarea
                          rows="3"
                          value={reportDesc}
                          onChange={(e) => setReportDesc(e.target.value)}
                          placeholder="Provide details about the issue (e.g. print error on logo, seal broken, or purchased from an unverified store)..."
                          className="w-full px-4 py-3 bg-slate-950 border border-slate-900 rounded-xl text-xs text-slate-200 placeholder-slate-600 focus:outline-none focus:border-red-500/40 transition"
                          required
                        ></textarea>
                      </div>
                      <button
                        type="submit"
                        disabled={reportLoading}
                        className="px-5 py-2.5 bg-red-500 hover:bg-red-650 text-slate-100 text-xs font-bold rounded-xl shadow-lg transition"
                      >
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
