import React, { useState, useEffect, useContext } from "react";
import { keccak256, toUtf8Bytes } from "ethers";
import { Web3Context } from "../context/Web3Context";
import { ROLE_IDS, errorMessage } from "../utils/chain";
import axios from "axios";
import { Users, ShieldAlert, CheckCircle, Clock, Trash2, ArrowUpRight, Award } from "lucide-react";

const AdminDashboard = () => {
  const { registry, isConnected, connectWallet } = useContext(Web3Context);
  const [activeTab, setActiveTab] = useState(window.location.pathname.endsWith("anomalies") ? "anomalies" : "approvals");
  const [users, setUsers] = useState([]);
  const [anomalies, setAnomalies] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionLoading, setActionLoading] = useState({});

  const fetchData = async () => {
    setLoading(true);
    setError("");
    try {
      if (activeTab === "approvals") {
        const usersRes = await axios.get("/api/admin/users");
        setUsers(usersRes.data.data.filter((u) => u.role !== "Admin")); // Don't approve admin accounts
      } else {
        const anomaliesRes = await axios.get("/api/admin/anomalies");
        setAnomalies(anomaliesRes.data.data);
      }
    } catch (err) {
      console.error(err);
      setError("Failed to fetch administrative ledger logs.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [activeTab]);

  /**
   * Admission is a two-step, chain-first process:
   *  1. the regulator wallet signs AccessRegistry.registerParticipant(wallet, role, name, keccak(licence))
   *  2. the backend checks the on-chain role and only then mirrors isApproved = true
   */
  const handleApprove = async (u) => {
    setActionLoading((prev) => ({ ...prev, [u._id]: true }));
    try {
      if (u.onChainRole !== u.role) {
        if (!isConnected || !registry) {
          await connectWallet();
          throw new Error("Connect the regulator wallet (MetaMask) and click Admit again.");
        }
        const tx = await registry.registerParticipant(
          u.ethAddress,
          ROLE_IDS[u.role],
          u.companyName || u.name,
          keccak256(toUtf8Bytes(u.licenseNumber || ""))
        );
        await tx.wait();
      }
      const res = await axios.put(`/api/admin/users/${u._id}/approve`);
      if (res.data.success) fetchData();
    } catch (err) {
      console.error(err);
      alert("Admission failed: " + errorMessage(err));
    } finally {
      setActionLoading((prev) => ({ ...prev, [u._id]: false }));
    }
  };

  const handleResolveAnomaly = async (anomalyId) => {
    setActionLoading((prev) => ({ ...prev, [anomalyId]: true }));
    try {
      const res = await axios.put(`/api/admin/anomalies/${anomalyId}/resolve`);
      if (res.data.success) {
        alert("Anomaly threat marked as resolved.");
        fetchData();
      }
    } catch (err) {
      console.error(err);
      alert("Resolution logging failed: " + (err.response?.data?.message || err.message));
    } finally {
      setActionLoading((prev) => ({ ...prev, [anomalyId]: false }));
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold font-sans">Administrative Console</h1>
        <p className="text-slate-400 text-xs mt-1">
          Admit organisations on-chain (regulator wallet) and review evidence emitted by the smart contracts.
        </p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-900 gap-6">
        <button
          onClick={() => setActiveTab("approvals")}
          className={`flex items-center gap-2 pb-4 text-xs uppercase tracking-wider font-bold transition border-b-2 ${
            activeTab === "approvals"
              ? "border-sky-500 text-sky-400 font-extrabold"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          <Users className="h-4.5 w-4.5" />
          Pending Approvals
        </button>
        <button
          onClick={() => setActiveTab("anomalies")}
          className={`flex items-center gap-2 pb-4 text-xs uppercase tracking-wider font-bold transition border-b-2 ${
            activeTab === "anomalies"
              ? "border-sky-500 text-sky-400 font-extrabold"
              : "border-transparent text-slate-400 hover:text-slate-200"
          }`}
        >
          <ShieldAlert className="h-4.5 w-4.5" />
          Flagged Anomalies
        </button>
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
      ) : activeTab === "approvals" ? (
        /* Approvals tab view */
        <div className="glass-panel rounded-3xl border border-slate-900 overflow-hidden shadow-2xl">
          <div className="p-5 border-b border-slate-900 bg-slate-900/10">
            <h3 className="text-base font-bold font-sans text-slate-200">Organization Registrations</h3>
          </div>
          {users.length === 0 ? (
            <div className="text-center py-12 text-slate-500 text-sm">
              No organization registrations are pending approval.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-900/50 border-b border-slate-900 text-slate-400 uppercase tracking-widest text-[10px] font-bold">
                    <th className="p-4">Contact</th>
                    <th className="p-4">Organization</th>
                    <th className="p-4">Licensing Info</th>
                    <th className="p-4">Eth Address</th>
                    <th className="p-4">Status</th>
                    <th className="p-4">On-chain role</th>
                    <th className="p-4 text-right">Verification</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-900/40 text-slate-300">
                  {users.map((u) => (
                    <tr key={u._id} className="hover:bg-slate-900/10 transition">
                      <td className="p-4">
                        <div>
                          <p className="font-semibold text-slate-200">{u.name}</p>
                          <p className="text-slate-500 text-[10px]">{u.email}</p>
                        </div>
                      </td>
                      <td className="p-4">
                        <div>
                          <p className="font-bold text-slate-200">{u.companyName}</p>
                          <span className="text-[10px] text-sky-400 font-semibold">{u.role}</span>
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-1.5 font-mono">
                          <Award className="h-3.5 w-3.5 text-slate-500" />
                          <span>{u.licenseNumber}</span>
                        </div>
                      </td>
                      <td className="p-4 font-mono text-[10px] text-slate-400">{u.ethAddress}</td>
                      <td className="p-4">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase ${
                            u.isApproved && u.onChainRole === u.role
                              ? "bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
                              : "bg-amber-500/10 text-amber-400 border border-amber-500/20"
                          }`}
                        >
                          {u.isApproved && u.onChainRole === u.role ? "Approved" : u.isApproved ? "Not on this chain" : "Pending Approval"}
                        </span>
                      </td>
                      <td className="p-4 font-mono text-[10px]">
                        <span className={u.onChainRole === u.role ? "text-emerald-400" : "text-slate-500"}>{u.onChainRole || "unknown"}</span>
                      </td>
                      <td className="p-4 text-right">
                        {(!u.isApproved || (u.onChainRole && u.onChainRole !== u.role)) && (
                          <button
                            onClick={() => handleApprove(u)}
                            disabled={actionLoading[u._id]}
                            className="px-3 py-1.5 bg-sky-500 hover:bg-sky-600 disabled:bg-sky-500/50 text-slate-950 font-bold rounded-xl transition shadow-lg text-[10px] uppercase tracking-wider"
                          >
                            {actionLoading[u._id] ? "Signing..." : u.onChainRole === u.role ? "Sync approval" : "Admit on-chain"}
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      ) : (
        /* Anomalies tab view */
        <div className="space-y-4">
          {anomalies.length === 0 ? (
            <div className="glass-panel p-8 text-center text-slate-500 text-sm rounded-3xl border border-slate-900">
              No anomalies detected in the drug supply chain.
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {anomalies.map((anom) => (
                <div
                  key={anom._id}
                  className={`glass-panel border rounded-3xl p-5 flex flex-col md:flex-row justify-between items-start md:items-center gap-4 ${
                    anom.isResolved
                      ? "opacity-60 border-slate-900 bg-slate-900/5"
                      : anom.severity === "Critical"
                      ? "border-rose-500/30 bg-rose-500/5 text-rose-300"
                      : anom.severity === "High"
                      ? "border-red-500/35 bg-red-500/5 text-red-300"
                      : "border-amber-500/20 bg-amber-500/5 text-amber-300"
                  }`}
                >
                  <div className="space-y-2">
                    <div className="flex items-center flex-wrap gap-2 text-xs">
                      <span className="font-bold font-mono text-sky-400">
                        {anom.batchId}
                      </span>
                      <span>•</span>
                      <span className="px-2 py-0.5 rounded-full text-[9px] font-bold uppercase bg-slate-900 text-slate-400">
                        {anom.type}
                      </span>
                      <span>•</span>
                      <span
                        className={`font-semibold ${
                          anom.severity === "Critical"
                            ? "text-rose-400"
                            : anom.severity === "High"
                            ? "text-red-400"
                            : "text-amber-400"
                        }`}
                      >
                        {anom.severity} Severity
                      </span>
                    </div>
                    <p className="text-slate-300 text-xs">{anom.description}</p>
                    <div className="flex items-center gap-1.5 text-[10px] text-slate-500">
                      {anom.isResolved ? (
                        <span className="flex items-center gap-1 text-emerald-400">
                          <CheckCircle className="h-3 w-3" /> Resolved
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-amber-500">
                          <Clock className="h-3 w-3" /> Unresolved threat
                        </span>
                      )}
                      <span>•</span>
                      <span>Log: {new Date(anom.createdAt).toLocaleString()}</span>
                    </div>
                  </div>
                  {!anom.isResolved && (
                    <button
                      onClick={() => handleResolveAnomaly(anom._id)}
                      disabled={actionLoading[anom._id]}
                      className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 disabled:bg-emerald-500/50 text-slate-950 font-bold rounded-xl shadow-lg transition text-xs shrink-0"
                    >
                      {actionLoading[anom._id] ? "Resolving..." : "Mark Resolved"}
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default AdminDashboard;
