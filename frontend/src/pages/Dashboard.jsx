import React, { useState, useEffect, useContext } from "react";
import { Link, useNavigate } from "react-router-dom";
import axios from "axios";
import QRCode from "qrcode";
import { AuthContext } from "../context/AuthContext";
import { Web3Context } from "../context/Web3Context";
import {
  Package,
  TrendingUp,
  AlertTriangle,
  ArrowRightLeft,
  Truck,
  CheckCircle,
  AlertCircle,
  FileSpreadsheet,
  Plus,
  Send,
  Eye,
  Activity,
  QrCode as QrIcon
} from "lucide-react";

const Dashboard = () => {
  const { user } = useContext(AuthContext);
  const { contract, isConnected, connectWallet, account } = useContext(Web3Context);
  const navigate = useNavigate();

  const [batches, setBatches] = useState([]);
  const [adminStats, setAdminStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionLoading, setActionLoading] = useState({});

  // QR Label Modal state
  const [showQrModal, setShowQrModal] = useState(false);
  const [qrCodeUrl, setQrCodeUrl] = useState("");
  const [qrBatchId, setQrBatchId] = useState("");

  const handleShowQr = async (batchId) => {
    try {
      // Points to public verification portal url
      const verifyUrl = `${window.location.origin}/verify?batchId=${batchId}`;
      const url = await QRCode.toDataURL(verifyUrl, { width: 300, margin: 2 });
      setQrCodeUrl(url);
      setQrBatchId(batchId);
      setShowQrModal(true);
    } catch (err) {
      console.error("Failed to generate QR Code:", err);
      alert("Failed to render QR Code label.");
    }
  };

  // Fetch inventory
  const fetchDashboardData = async () => {
    setLoading(true);
    setError("");
    try {
      if (user.role === "Admin") {
        const statsRes = await axios.get("/api/admin/stats");
        setAdminStats(statsRes.data.data);
      } else {
        const batchesRes = await axios.get("/api/batches");
        setBatches(batchesRes.data.data);
      }
    } catch (err) {
      console.error(err);
      setError("Failed to fetch dashboard intelligence logs.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user) {
      fetchDashboardData();
    }
  }, [user]);

  // Handle Accept Shipment via MetaMask
  const handleAcceptShipment = async (batchId) => {
    if (!isConnected) {
      alert("Please connect your MetaMask wallet first using the top header button.");
      await connectWallet();
      return;
    }

    if (!contract) {
      alert("Smart contract is not linked. Please ensure deploy.js has run successfully.");
      return;
    }

    setActionLoading((prev) => ({ ...prev, [batchId]: true }));
    try {
      // 1. Send transaction to blockchain
      const tx = await contract.acceptShipment(batchId);
      console.log("Transaction sent:", tx.hash);
      
      // Wait for completion
      await tx.wait();
      console.log("Transaction confirmed:", tx.hash);

      // 2. Report receipt to off-chain server
      const res = await axios.post("/api/transfers/accept", {
        batchId,
        txHash: tx.hash
      });

      if (res.data.success) {
        alert(`Shipment for batch ${batchId} accepted successfully and logged on-chain.`);
        fetchDashboardData();
      }
    } catch (err) {
      console.error(err);
      alert("Blockchain transaction failed: " + (err.reason || err.message));
    } finally {
      setActionLoading((prev) => ({ ...prev, [batchId]: false }));
    }
  };

  // Render Admin Dashboard
  if (user.role === "Admin") {
    return (
      <div className="space-y-6">
        <div className="flex justify-between items-center">
          <div>
            <h1 className="text-2xl font-bold font-sans">Administrative Analytics</h1>
            <p className="text-slate-400 text-xs mt-1">
              Verify organizations, review audits, and monitor counterfeit alarm logs.
            </p>
          </div>
          <Activity className="h-7 w-7 text-sky-400" />
        </div>

        {error && (
          <div className="p-4 bg-red-500/10 border border-red-500/20 text-red-400 rounded-2xl text-xs font-semibold">
            {error}
          </div>
        )}

        {loading ? (
          <div className="flex justify-center py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-sky-500 border-t-transparent"></div>
          </div>
        ) : (
          adminStats && (
            <>
              {/* Summary Stats Grid */}
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div className="glass-panel p-5 rounded-2xl border border-slate-900">
                  <div className="flex justify-between items-center text-slate-400">
                    <span className="text-xs uppercase font-bold tracking-wider">Organizations</span>
                    <Plus className="h-4 w-4 text-sky-400" />
                  </div>
                  <p className="text-2xl font-bold mt-2">{adminStats.users.total}</p>
                  <p className="text-[10px] text-slate-500 mt-1">
                    {adminStats.users.manufacturers} MFRs | {adminStats.users.distributors} Dist | {adminStats.users.pharmacies} Rx
                  </p>
                </div>

                <div className="glass-panel p-5 rounded-2xl border border-slate-900">
                  <div className="flex justify-between items-center text-slate-400">
                    <span className="text-xs uppercase font-bold tracking-wider">Pending Approvals</span>
                    <AlertCircle className="h-4 w-4 text-amber-500" />
                  </div>
                  <p className="text-2xl font-bold mt-2 text-amber-400">{adminStats.users.pending}</p>
                  <Link to="/admin/approvals" className="text-[10px] text-sky-400 hover:underline block mt-1">
                    Review pendings &rarr;
                  </Link>
                </div>

                <div className="glass-panel p-5 rounded-2xl border border-slate-900">
                  <div className="flex justify-between items-center text-slate-400">
                    <span className="text-xs uppercase font-bold tracking-wider">Total Batches</span>
                    <Package className="h-4 w-4 text-emerald-400" />
                  </div>
                  <p className="text-2xl font-bold mt-2">{adminStats.batches.total}</p>
                  <p className="text-[10px] text-slate-500 mt-1">
                    {adminStats.batches.active} Active | {adminStats.batches.recalled} Recalled
                  </p>
                </div>

                <div className="glass-panel p-5 rounded-2xl border border-slate-900">
                  <div className="flex justify-between items-center text-slate-400">
                    <span className="text-xs uppercase font-bold tracking-wider">Active Anomalies</span>
                    <AlertTriangle className="h-4 w-4 text-red-400" />
                  </div>
                  <p className="text-2xl font-bold mt-2 text-red-400">{adminStats.anomalies.active}</p>
                  <Link to="/admin/anomalies" className="text-[10px] text-red-400 hover:underline block mt-1">
                    Inspect alert logs &rarr;
                  </Link>
                </div>
              </div>

              {/* Integrity Indicator card */}
              <div className="glass-panel p-6 rounded-3xl border border-slate-900 flex flex-col md:flex-row items-center gap-6 bg-slate-900/10">
                <div className="relative h-20 w-20 flex items-center justify-center shrink-0">
                  <svg className="w-full h-full transform -rotate-90" viewBox="0 0 36 36">
                    <path className="text-slate-800" strokeWidth="2.5" stroke="currentColor" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                    <path className="text-sky-400" strokeDasharray={`${100 - adminStats.avgRiskScore}, 100`} strokeWidth="2.5" strokeLinecap="round" stroke="currentColor" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                  </svg>
                  <div className="absolute text-center">
                    <span className="text-lg font-bold">{100 - adminStats.avgRiskScore}%</span>
                  </div>
                </div>
                <div>
                  <h3 className="text-lg font-bold font-sans">Global Chain Integrity Index</h3>
                  <p className="text-slate-400 text-sm mt-1">
                    Calculated off-chain based on flagged duplicate registrations, unauthorized ownership transitions, expirations, and missing nodes. Currently sitting at a secure margin.
                  </p>
                </div>
              </div>
            </>
          )
        )}
      </div>
    );
  }

  // Render Manufacturer/Distributor/Pharmacy Dashboard
  const incomingShipments = batches.filter(
    (b) => b.status === "In Transit" && b.currentOwnerEthAddress === account.toLowerCase()
  );

  return (
    <div className="space-y-6">
      {/* Top Banner */}
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold font-sans">Workspace Dashboard</h1>
          <p className="text-slate-400 text-xs mt-1">
            Ethereum Account Connected: <span className="font-mono text-slate-300">{account || "No wallet linked"}</span>
          </p>
        </div>
        {user.role === "Manufacturer" && (
          <Link
            to="/batches/new"
            className="flex items-center gap-1.5 px-4 py-2 bg-sky-500 hover:bg-sky-600 text-slate-950 font-bold rounded-xl shadow-lg transition text-xs uppercase tracking-wider"
          >
            <Plus className="h-4 w-4" />
            New Batch
          </Link>
        )}
      </div>

      {error && (
        <div className="p-4 bg-red-500/10 border border-red-500/20 text-red-400 rounded-2xl text-xs font-semibold">
          {error}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-sky-500 border-t-transparent"></div>
        </div>
      ) : (
        <>
          {/* Summary Cards */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="glass-panel p-5 rounded-2xl border border-slate-900">
              <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Total Inventory</span>
              <p className="text-3xl font-extrabold mt-1 text-slate-100">{batches.length}</p>
            </div>
            <div className="glass-panel p-5 rounded-2xl border border-slate-900">
              <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Incoming Shipments</span>
              <p className="text-3xl font-extrabold mt-1 text-amber-400">{incomingShipments.length}</p>
            </div>
            <div className="glass-panel p-5 rounded-2xl border border-slate-900">
              <span className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">Recalled / Suspicious</span>
              <p className="text-3xl font-extrabold mt-1 text-red-400">
                {batches.filter((b) => b.status === "Recalled" || b.riskScore > 30).length}
              </p>
            </div>
          </div>

          {/* Incoming shipments alert panel */}
          {incomingShipments.length > 0 && (
            <div className="glass-panel border-amber-500/20 rounded-3xl p-5 bg-amber-500/5">
              <div className="flex items-center gap-2 mb-3">
                <Truck className="h-5 w-5 text-amber-400" />
                <h3 className="text-base font-bold text-amber-400 font-sans">Action Required: Shipments in Transit</h3>
              </div>
              <div className="space-y-3">
                {incomingShipments.map((shipment) => (
                  <div
                    key={shipment.batchId}
                    className="flex flex-col md:flex-row justify-between items-start md:items-center p-4 bg-slate-950/80 rounded-2xl border border-slate-900 text-xs"
                  >
                    <div>
                      <p className="font-bold text-slate-200">
                        {shipment.drugName} <span className="font-mono text-slate-400 ml-1">({shipment.batchId})</span>
                      </p>
                      <p className="text-slate-400 mt-1">Quantity: {shipment.quantity} units</p>
                    </div>
                    <button
                      onClick={() => handleAcceptShipment(shipment.batchId)}
                      disabled={actionLoading[shipment.batchId]}
                      className="mt-3 md:mt-0 px-4 py-2 bg-emerald-500 hover:bg-emerald-600 disabled:bg-emerald-500/50 text-slate-950 font-bold rounded-xl shadow-lg transition"
                    >
                      {actionLoading[shipment.batchId] ? "Signing..." : "Confirm Receipt"}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Primary batch logs table */}
          <div className="glass-panel rounded-3xl overflow-hidden border border-slate-900 shadow-2xl">
            <div className="p-5 border-b border-slate-900 bg-slate-900/20">
              <h3 className="text-base font-bold font-sans text-slate-200">Drug Batch Registry</h3>
            </div>
            {batches.length === 0 ? (
              <div className="text-center py-12 text-slate-500 text-sm">
                No pharmaceutical batches found in your inventory.
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-900/55 border-b border-slate-900 text-slate-400 uppercase tracking-widest text-[10px] font-bold">
                      <th className="p-4">Batch ID</th>
                      <th className="p-4">Drug Details</th>
                      <th className="p-4">Status</th>
                      <th className="p-4">Risk Index</th>
                      <th className="p-4">Expires</th>
                      <th className="p-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-900/50 text-slate-300">
                    {batches.map((batch) => (
                      <tr key={batch._id} className="hover:bg-slate-900/20 transition">
                        <td className="p-4 font-mono font-bold text-sky-400">{batch.batchId}</td>
                        <td className="p-4">
                          <div>
                            <span className="font-semibold text-slate-200">{batch.drugName}</span>
                            <span className="text-slate-500 font-mono block mt-0.5">Code: {batch.productCode}</span>
                          </div>
                        </td>
                        <td className="p-4">
                          <span
                            className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                              batch.status === "Manufactured"
                                ? "bg-sky-500/10 text-sky-400 border border-sky-500/20"
                                : batch.status === "In Transit"
                                ? "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                                : batch.status === "Received"
                                ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                                : "bg-rose-500/10 text-rose-400 border border-rose-500/20"
                            }`}
                          >
                            {batch.status}
                          </span>
                        </td>
                        <td className="p-4 font-mono font-bold">
                          <span
                            className={
                              batch.riskScore >= 70
                                ? "text-rose-500"
                                : batch.riskScore > 30
                                ? "text-amber-400"
                                : "text-emerald-400"
                            }
                          >
                            {batch.riskScore}%
                          </span>
                        </td>
                        <td className="p-4">{new Date(batch.expiryDate).toLocaleDateString()}</td>
                        <td className="p-4 text-right space-x-2">
                          <button
                            onClick={() => handleShowQr(batch.batchId)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-850 rounded-xl transition"
                          >
                            <QrIcon className="h-3.5 w-3.5" />
                            Label
                          </button>
                          <Link
                            to={`/verify`}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-850 rounded-xl transition"
                          >
                            <Eye className="h-3.5 w-3.5" />
                            Audit
                          </Link>
                          {batch.currentOwnerEthAddress === account.toLowerCase() &&
                            batch.status !== "In Transit" &&
                            batch.status !== "Recalled" && (
                              <Link
                                to={`/batches/transfer/${batch.batchId}`}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-sky-500 hover:bg-sky-600 text-slate-950 font-bold rounded-xl shadow-lg transition"
                              >
                                <Send className="h-3.5 w-3.5" />
                                Handoff
                              </Link>
                            )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}

      {/* QR Code Modal */}
      {showQrModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm">
          <div className="glass-panel max-w-sm w-full rounded-3xl p-6 text-center shadow-2xl relative border border-slate-800 bg-slate-900">
            <h3 className="text-lg font-bold text-slate-100 font-sans mb-1">Drug Packaging Label</h3>
            <p className="text-slate-400 text-xs mb-4">Scan using any scanner to trace this batch on-chain.</p>
            
            <div className="bg-white p-4 rounded-2xl inline-block shadow-inner mb-4 border border-slate-200">
              <img src={qrCodeUrl} alt="Drug Batch QR Code" className="w-56 h-56" />
            </div>
            
            <p className="font-mono text-sm text-sky-400 font-bold mb-6">Batch ID: {qrBatchId}</p>
            
            <div className="flex gap-2">
              <a
                href={qrCodeUrl}
                download={`QR_Label_${qrBatchId}.png`}
                className="flex-1 py-3 bg-sky-500 hover:bg-sky-600 text-slate-950 font-bold rounded-xl text-center text-xs uppercase tracking-wider transition shadow-lg"
              >
                Download
              </a>
              <button
                onClick={() => setShowQrModal(false)}
                className="flex-1 py-3 bg-slate-950 hover:bg-slate-900 text-slate-300 font-semibold rounded-xl text-xs uppercase tracking-wider transition border border-slate-800"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default Dashboard;
