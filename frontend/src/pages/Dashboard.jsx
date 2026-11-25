import React, { useState, useEffect, useContext } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import { Doughnut, Bar } from "react-chartjs-2";
import { AuthContext } from "../context/AuthContext";
import { Web3Context } from "../context/Web3Context";
import {
  Package,
  AlertTriangle,
  Truck,
  Plus,
  Send,
  Eye,
  QrCode as QrIcon,
  Split,
  Pill,
  Undo2,
  Ban,
  Boxes,
  LayoutDashboard,
  Activity,
  PieChart,
  BarChart3,
  Users,
  ShieldAlert,
  Network,
  Gauge,
  Layers
} from "lucide-react";
import DispenseModal from "../components/DispenseModal";
import SplitModal from "../components/SplitModal";
import { PageHeader, Panel, StatCard, Spinner, EmptyState, Pill as Tag } from "../components/ui";
import { ActivityFeed } from "../components/lotViz";
import { NetworkTopology } from "../components/networkViz";
import { STATUS_COLORS, ANOMALY_COLORS, doughnutOptions, barOptions } from "../components/charts";
import { statusBadge, waitForIndexer, errorMessage } from "../utils/chain";

const btn =
  "inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-800 rounded-lg transition";
const btnPrimary = "inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-sky-500 hover:bg-sky-600 text-slate-950 font-bold rounded-lg shadow-lg transition";

const Dashboard = () => {
  const { user } = useContext(AuthContext);
  const { contract, isConnected, connectWallet, account } = useContext(Web3Context);

  const [batches, setBatches] = useState([]);
  const [activity, setActivity] = useState([]);
  const [adminStats, setAdminStats] = useState(null);
  const [anomalies, setAnomalies] = useState([]);
  const [validators, setValidators] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [actionLoading, setActionLoading] = useState({});
  const [dispenseBatch, setDispenseBatch] = useState(null);
  const [splitBatch, setSplitBatch] = useState(null);

  const fetchDashboardData = async (quiet = false) => {
    if (!quiet) setLoading(true);
    setError("");
    try {
      if (user.role === "Admin") {
        const [s, a, v, act] = await Promise.all([
          axios.get("/api/admin/stats"),
          axios.get("/api/admin/anomalies"),
          axios.get("/api/chain/validators").catch(() => null),
          axios.get("/api/batches/activity?limit=12").catch(() => null)
        ]);
        setAdminStats(s.data.data);
        setAnomalies(a.data.data);
        setValidators(v ? v.data.data : null);
        setActivity(act ? act.data.data : []);
      } else {
        const [b, act] = await Promise.all([axios.get("/api/batches"), axios.get("/api/batches/activity?limit=12").catch(() => null)]);
        setBatches(b.data.data);
        setActivity(act ? act.data.data : []);
      }
    } catch (err) {
      console.error(err);
      setError("Failed to fetch dashboard data.");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (user) fetchDashboardData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // live refresh of the regulator's network panel
  useEffect(() => {
    if (user?.role !== "Admin") return;
    const t = setInterval(() => axios.get("/api/chain/validators").then((r) => setValidators(r.data.data)).catch(() => {}), 4000);
    return () => clearInterval(t);
  }, [user]);

  const runTx = async (key, fn) => {
    if (!isConnected) {
      await connectWallet();
      return;
    }
    if (!contract) return alert("MetaMask is not on the PharmaChain network (chain 2026). Use the red banner at the top of the page to switch.");
    setActionLoading((p) => ({ ...p, [key]: true }));
    try {
      const tx = await fn();
      await waitForIndexer(await tx.wait());
      await fetchDashboardData(true);
    } catch (err) {
      console.error(err);
      alert("Blockchain transaction failed: " + errorMessage(err));
    } finally {
      setActionLoading((p) => ({ ...p, [key]: false }));
    }
  };

  const handleAccept = (batchId) => runTx(batchId, () => contract.acceptShipment(batchId));
  /** Aggregation: prove the scanned case / carton labels cover exactly this shipment. */
  const handleAcceptByScan = async (batchId) => {
    let scans;
    try {
      scans = (await axios.get(`/api/batches/${encodeURIComponent(batchId)}/aggregation`)).data.data.scans;
    } catch (e) {
      return alert(errorMessage(e));
    }
    runTx(batchId + "-agg", () =>
      contract.acceptWithAggregation(
        batchId,
        scans.map(({ level, index, root, up1, up2 }) => ({ level, index, root, up1, up2 }))
      )
    );
  };
  const handleCancel = (batchId) => runTx(batchId, () => contract.cancelTransfer(batchId));
  const handleRecall = (batchId) => {
    const reason = window.prompt(`Recall the ENTIRE production lot of ${batchId}? Enter the reason:`);
    if (reason) runTx(batchId, () => contract.recallBatch(batchId, reason));
  };

  if (loading) return <Spinner />;

  // ================================================================== Regulator view
  if (user.role === "Admin") {
    if (!adminStats) return <div className="p-4 text-red-400 text-xs">{error}</div>;
    const integrity = 100 - adminStats.avgRiskScore;
    const byType = anomalies.filter((a) => !a.isResolved).reduce((m, a) => ({ ...m, [a.type]: (m[a.type] || 0) + 1 }), {});
    const types = Object.keys(byType);
    const dist = adminStats.batches.statusDistribution || [];
    const onlineNodes = validators ? validators.nodes.filter((n) => n.online).length : 0;

    return (
      <div className="space-y-6">
        <PageHeader
          crumbs={[{ label: "Regulator" }, { label: "Network overview" }]}
          title="Regulator Command Centre"
          icon={LayoutDashboard}
          subtitle="Admit organisations on-chain, watch consensus health and act on evidence emitted by the smart contracts."
          actions={
            <Link to="/explorer" className="flex items-center gap-1.5 px-4 py-2 bg-slate-900 border border-slate-800 hover:border-sky-500/40 rounded-xl text-xs font-semibold">
              <Network className="h-4 w-4 text-sky-400" /> Ledger explorer
            </Link>
          }
        />

        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
          <StatCard label="Organisations" value={adminStats.users.total} icon={Users} accent="sky" sub={`${adminStats.users.manufacturers} MFR · ${adminStats.users.distributors} DIST · ${adminStats.users.pharmacies} RX`} />
          <StatCard label="Pending admission" value={adminStats.users.pending} icon={Users} accent="amber" sub={<Link to="/admin/approvals" className="text-sky-400 hover:underline">review →</Link>} />
          <StatCard label="Lots & shipments" value={adminStats.batches.total} icon={Package} accent="emerald" sub={`${adminStats.batches.active} active · ${adminStats.batches.recalled} recalled`} />
          <StatCard label="Open evidence" value={adminStats.anomalies.active} icon={ShieldAlert} accent="rose" sub={`${adminStats.anomalies.critical} critical`} />
          <StatCard label="Validators online" value={validators ? `${onlineNodes}/${validators.nodes.length}` : "-"} icon={Network} accent="violet" sub={validators ? `quorum ${validators.quorum} · head #${validators.head}` : "explorer unavailable"} />
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <Panel title="Consensus network (live)" icon={Network} right={<span className="text-[10px] text-slate-500">blocks proposed · last {validators?.window || 0}</span>}>
            {validators ? <NetworkTopology nodes={validators.nodes} quorum={validators.quorum} height={300} /> : <EmptyState icon={Network} title="Explorer API unavailable" />}
          </Panel>
          <Panel title="Open evidence by type" icon={BarChart3}>
            <div className="h-[260px]">
              {types.length ? (
                <Bar
                  data={{ labels: types, datasets: [{ data: types.map((t) => byType[t]), backgroundColor: types.map((t) => ANOMALY_COLORS[t] || "#64748b"), borderRadius: 6 }] }}
                  options={barOptions(true)}
                />
              ) : (
                <EmptyState icon={ShieldAlert} title="No open evidence" text="Attacks caught by the contracts appear here." />
              )}
            </div>
          </Panel>
          <Panel title="Batch status distribution" icon={PieChart}>
            <div className="h-[260px]">
              {dist.length ? (
                <Doughnut
                  data={{ labels: dist.map((d) => d._id), datasets: [{ data: dist.map((d) => d.count), backgroundColor: dist.map((d) => STATUS_COLORS[d._id] || "#64748b"), borderWidth: 0 }] }}
                  options={doughnutOptions}
                />
              ) : (
                <EmptyState icon={Package} title="No batches yet" />
              )}
            </div>
          </Panel>
        </div>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <Panel title="Latest on-chain evidence" icon={ShieldAlert} className="xl:col-span-2" right={<Link to="/admin/anomalies" className="text-[10px] text-sky-400 hover:underline">all evidence →</Link>}>
            {anomalies.length === 0 ? (
              <EmptyState icon={ShieldAlert} title="No evidence recorded" />
            ) : (
              <div className="space-y-2.5">
                {anomalies.slice(0, 6).map((a) => (
                  <div key={a._id} className={`p-3 rounded-xl border text-xs ${a.severity === "Critical" ? "border-rose-500/30 bg-rose-500/5" : "border-amber-500/20 bg-amber-500/5"}`}>
                    <div className="flex items-center gap-2 flex-wrap">
                      <Tag accent={a.severity === "Critical" ? "rose" : "amber"}>{a.type}</Tag>
                      {a.source === "on-chain" && <Tag accent="sky">on-chain</Tag>}
                      <span className="font-mono text-sky-400">{a.batchId}</span>
                      {a.txHash && (
                        <Link to={`/explorer?tx=${a.txHash}`} className="ml-auto font-mono text-[10px] text-slate-500 hover:text-sky-400">
                          block #{a.blockNumber}
                        </Link>
                      )}
                    </div>
                    <p className="text-slate-400 mt-1.5">{a.description}</p>
                  </div>
                ))}
              </div>
            )}
          </Panel>
          <div className="space-y-6">
            <Panel title="Network integrity index" icon={Gauge}>
              <div className="flex items-center gap-5">
                <div className="relative h-24 w-24 shrink-0">
                  <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
                    <path className="text-slate-800" strokeWidth="3" stroke="currentColor" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                    <path className={integrity > 70 ? "text-emerald-400" : integrity > 40 ? "text-amber-400" : "text-rose-400"} strokeDasharray={`${integrity}, 100`} strokeWidth="3" strokeLinecap="round" stroke="currentColor" fill="none" d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831" />
                  </svg>
                  <span className="absolute inset-0 flex items-center justify-center text-xl font-extrabold">{integrity}%</span>
                </div>
                <p className="text-xs text-slate-400">
                  Derived from open on-chain evidence (clones, forgeries, diversions, cold-chain breaches), recalls and expiries across all lots.
                </p>
              </div>
            </Panel>
            <Panel title="Ledger activity" icon={Activity}>
              {activity.length ? <ActivityFeed events={activity.slice(0, 6)} /> : <EmptyState icon={Activity} title="No activity yet" />}
            </Panel>
          </div>
        </div>
      </div>
    );
  }

  // ================================================================== Participant view
  const me = (account || user.ethAddress || "").toLowerCase();
  const incoming = batches.filter((b) => b.status === "In Transit" && b.pendingOwnerEthAddress === me);
  const isMfr = user.role === "Manufacturer";
  const isDist = user.role === "Distributor";
  const isRx = user.role === "Pharmacy";
  const shelfStates = ["Manufactured", "Received"];
  const held = batches.filter((b) => b.currentOwnerEthAddress === me);
  const unitsHeld = held.reduce((s, b) => s + (b.quantity - (b.dispensedCount || 0)), 0);
  const dispensedTotal = batches.reduce((s, b) => s + (b.dispensedCount || 0), 0);
  const risky = batches.filter((b) => ["Recalled", "Quarantined"].includes(b.status) || b.riskScore > 30).length;

  const statusCounts = batches.reduce((m, b) => ({ ...m, [b.status]: (m[b.status] || 0) + 1 }), {});
  const statuses = Object.keys(statusCounts);
  const topShipments = held.slice(0, 8);

  return (
    <div className="space-y-6">
      <PageHeader
        crumbs={[{ label: user.role }, { label: "Dashboard" }]}
        title={isMfr ? "Manufacturing Workspace" : isDist ? "Distribution Workspace" : "Pharmacy Workspace"}
        icon={LayoutDashboard}
        subtitle={
          <>
            Signed in as <b className="text-slate-300">{user.companyName}</b> · wallet <span className="font-mono text-slate-300">{me || "not linked"}</span>
          </>
        }
        actions={
          isMfr && (
            <Link to="/batches/new" className="flex items-center gap-1.5 px-4 py-2.5 bg-gradient-to-r from-sky-500 to-violet-500 text-slate-950 font-bold rounded-xl shadow-lg shadow-sky-500/20 text-xs uppercase tracking-wider">
              <Plus className="h-4 w-4" /> New Lot
            </Link>
          )
        }
      />

      {error && <div className="p-4 bg-red-500/10 border border-red-500/20 text-red-400 rounded-2xl text-xs font-semibold">{error}</div>}
      {!isConnected && (
        <div className="p-4 bg-amber-500/10 border border-amber-500/20 text-amber-400 rounded-2xl text-xs">
          Connect MetaMask with your registered wallet to sign actions.
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard label="Lots / shipments" value={batches.length} icon={Layers} accent="sky" sub={`${held.length} currently in my custody`} />
        <StatCard label="Units in custody" value={unitsHeld.toLocaleString()} icon={Boxes} accent="violet" sub="serialised packs held" />
        {isRx ? (
          <StatCard label="Units dispensed" value={dispensedTotal.toLocaleString()} icon={Pill} accent="emerald" sub="bits set on-chain" />
        ) : (
          <StatCard label="Incoming shipments" value={incoming.length} icon={Truck} accent="amber" sub="awaiting my signature" />
        )}
        <StatCard label="Recalled / quarantined / risky" value={risky} icon={AlertTriangle} accent="rose" sub="needs attention" />
      </div>

      {incoming.length > 0 && (
        <div className="glass-panel border border-amber-500/30 rounded-3xl p-5 bg-amber-500/5">
          <div className="flex items-center gap-2 mb-1">
            <Truck className="h-5 w-5 text-amber-400" />
            <h3 className="text-base font-bold text-amber-400 font-sans">Shipments awaiting your signature</h3>
          </div>
          <p className="text-[11px] text-slate-400 mb-3">Custody only passes to you once you sign receipt (two-phase handshake enforced by the contract).</p>
          <div className="grid md:grid-cols-2 gap-3">
            {incoming.map((s) => (
              <div key={s.batchId} className="flex justify-between items-center p-4 bg-slate-950/80 rounded-2xl border border-slate-800 text-xs">
                <div>
                  <p className="font-bold text-slate-200">
                    {s.drugName} <span className="font-mono text-slate-400 ml-1">{s.batchId}</span>
                  </p>
                  <p className="text-slate-500 mt-1">
                    {s.quantity} units · units #{s.unitStart}–{s.unitEnd - 1} · from <span className="font-mono">{s.currentOwnerEthAddress.slice(0, 10)}…</span>
                  </p>
                </div>
                <div className="flex flex-col gap-2 items-end">
                <button
                  onClick={() => handleAcceptByScan(s.batchId)}
                  disabled={actionLoading[s.batchId + "-agg"]}
                  title="Scan the case / carton labels instead of every pack; the contract checks they cover exactly this shipment"
                  className="px-4 py-2 bg-violet-500 hover:bg-violet-600 disabled:bg-violet-500/50 text-slate-950 font-bold rounded-xl shadow-lg"
                >
                  {actionLoading[s.batchId + "-agg"] ? "Verifying cases..." : "Accept by case scan"}
                </button>
                <button
                  onClick={() => handleAccept(s.batchId)}
                  disabled={actionLoading[s.batchId]}
                  className="px-4 py-2 bg-emerald-500 hover:bg-emerald-600 disabled:bg-emerald-500/50 text-slate-950 font-bold rounded-xl shadow-lg"
                >
                  {actionLoading[s.batchId] ? "Signing..." : "Confirm Receipt"}
                </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <Panel title="Portfolio by status" icon={PieChart}>
          <div className="h-56">
            {statuses.length ? (
              <Doughnut
                data={{ labels: statuses, datasets: [{ data: statuses.map((s) => statusCounts[s]), backgroundColor: statuses.map((s) => STATUS_COLORS[s] || "#64748b"), borderWidth: 0 }] }}
                options={doughnutOptions}
              />
            ) : (
              <EmptyState icon={PieChart} title="No batches yet" />
            )}
          </div>
        </Panel>
        <Panel title="Units per shipment in custody" icon={BarChart3}>
          <div className="h-56">
            {topShipments.length ? (
              <Bar
                data={{
                  labels: topShipments.map((b) => b.batchId),
                  datasets: [
                    { label: "available", data: topShipments.map((b) => b.quantity - (b.dispensedCount || 0)), backgroundColor: "#38bdf8", borderRadius: 4, stack: "u" },
                    { label: "dispensed", data: topShipments.map((b) => b.dispensedCount || 0), backgroundColor: "#34d399", borderRadius: 4, stack: "u" }
                  ]
                }}
                options={{ ...barOptions(), plugins: { legend: { display: true, position: "bottom" } }, scales: { x: { stacked: true, grid: { display: false }, ticks: { font: { size: 9 } } }, y: { stacked: true, ticks: { precision: 0 } } } }}
              />
            ) : (
              <EmptyState icon={Boxes} title="Nothing in custody" />
            )}
          </div>
        </Panel>
        <Panel title="Live ledger activity" icon={Activity}>
          {activity.length ? <ActivityFeed events={activity.slice(0, 6)} /> : <EmptyState icon={Activity} title="No on-chain activity yet" />}
        </Panel>
      </div>

      <Panel title="Ledger view of your lots and shipments" icon={Boxes} bodyClass="p-0" right={<span className="text-[10px] text-slate-500">mirrored from contract events</span>}>
        {batches.length === 0 ? (
          <EmptyState icon={Boxes} title="No batches in your custody history yet" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-900/55 border-b border-slate-800 text-slate-500 uppercase tracking-widest text-[10px] font-bold">
                  <th className="p-4">Batch</th>
                  <th className="p-4">Drug</th>
                  <th className="p-4">Status</th>
                  <th className="p-4">Units</th>
                  <th className="p-4">Risk</th>
                  <th className="p-4">Expires</th>
                  <th className="p-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-900/60 text-slate-300">
                {batches.map((b) => {
                  const owner = b.currentOwnerEthAddress === me;
                  const onShelf = owner && shelfStates.includes(b.status);
                  const isLot = b.originBatchId === b.batchId;
                  const busy = actionLoading[b.batchId];
                  const pct = b.quantity ? ((b.quantity - (b.dispensedCount || 0)) / b.quantity) * 100 : 0;
                  return (
                    <tr key={b._id} className="hover:bg-slate-900/30 transition">
                      <td className="p-4">
                        <Link to={`/batch/${encodeURIComponent(b.batchId)}`} className="font-mono font-bold text-sky-400 hover:underline">
                          {b.batchId}
                        </Link>
                        {!isLot && <span className="block text-[10px] text-slate-500 mt-0.5">split of {b.parentBatchId}</span>}
                        {!owner && b.status !== "In Transit" && <span className="block text-[10px] text-slate-600 mt-0.5">previously held</span>}
                      </td>
                      <td className="p-4">
                        <span className="font-semibold text-slate-200">{b.drugName}</span>
                        <span className="text-slate-500 font-mono block mt-0.5">{b.productCode}</span>
                      </td>
                      <td className="p-4">
                        <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${statusBadge(b.status)}`}>{b.status}</span>
                      </td>
                      <td className="p-4 w-36">
                        <div className="flex justify-between font-mono text-[11px]">
                          <span>
                            {b.quantity - (b.dispensedCount || 0)}/{b.quantity}
                          </span>
                          <span className="text-slate-500">
                            #{b.unitStart}–{b.unitEnd - 1}
                          </span>
                        </div>
                        <div className="h-1 rounded-full bg-slate-800 mt-1.5 overflow-hidden">
                          <div className="h-full bg-sky-400 rounded-full" style={{ width: `${pct}%` }} />
                        </div>
                      </td>
                      <td className="p-4 font-mono font-bold">
                        <span className={b.riskScore >= 70 ? "text-rose-500" : b.riskScore > 30 ? "text-amber-400" : "text-emerald-400"}>{b.riskScore}%</span>
                      </td>
                      <td className="p-4">{new Date(b.expiryDate).toLocaleDateString()}</td>
                      <td className="p-4 text-right space-x-1.5 whitespace-nowrap">
                        {isMfr && isLot && b.manufacturerEthAddress === me && (
                          <Link to={`/batches/${b.batchId}/labels`} className={btn}>
                            <QrIcon className="h-3.5 w-3.5" /> Labels
                          </Link>
                        )}
                        <Link to={`/batch/${encodeURIComponent(b.batchId)}`} className={btn}>
                          <Eye className="h-3.5 w-3.5" /> Trace
                        </Link>
                        {onShelf && (isMfr || isDist) && b.quantity > 1 && (
                          <button onClick={() => setSplitBatch(b)} className={btn}>
                            <Split className="h-3.5 w-3.5" /> Split
                          </button>
                        )}
                        {onShelf && !isRx && !b.dispensedCount && (
                          <Link to={`/batches/transfer/${b.batchId}`} className={btnPrimary}>
                            <Send className="h-3.5 w-3.5" /> Handoff
                          </Link>
                        )}
                        {owner && isRx && b.status === "Received" && (
                          <button onClick={() => setDispenseBatch(b)} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-emerald-500 hover:bg-emerald-600 text-slate-950 font-bold rounded-lg">
                            <Pill className="h-3.5 w-3.5" /> Dispense
                          </button>
                        )}
                        {owner && b.status === "In Transit" && (
                          <button disabled={busy} onClick={() => handleCancel(b.batchId)} className={btn}>
                            <Undo2 className="h-3.5 w-3.5" /> {busy ? "..." : "Cancel"}
                          </button>
                        )}
                        {isMfr && b.manufacturerEthAddress === me && b.status !== "Recalled" && (
                          <button disabled={busy} onClick={() => handleRecall(b.batchId)} className="inline-flex items-center gap-1.5 px-2.5 py-1.5 bg-rose-500/10 hover:bg-rose-500/20 text-rose-400 border border-rose-500/20 rounded-lg">
                            <Ban className="h-3.5 w-3.5" /> Recall
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Panel>

      {dispenseBatch && (
        <DispenseModal
          batch={batches.find((x) => x.batchId === dispenseBatch.batchId) || dispenseBatch}
          onClose={() => setDispenseBatch(null)}
          onDone={() => fetchDashboardData(true)}
        />
      )}
      {splitBatch && (
        <SplitModal
          batch={splitBatch}
          onClose={() => setSplitBatch(null)}
          onDone={() => {
            setSplitBatch(null);
            fetchDashboardData(true);
          }}
        />
      )}
    </div>
  );
};

export default Dashboard;
