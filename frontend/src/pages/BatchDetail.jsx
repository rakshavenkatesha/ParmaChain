import React, { useEffect, useState } from "react";
import { useParams, Link } from "react-router-dom";
import axios from "axios";
import {
  PackageSearch,
  GitBranch,
  Grid3x3,
  Route,
  ShieldAlert,
  History,
  Thermometer,
  CalendarDays,
  Hash,
  FileCode2,
  Link as LinkIcon
} from "lucide-react";
import { PageHeader, Panel, Spinner, Pill as Tag, EmptyState, StatCard } from "../components/ui";
import { UnitMap, LineageTree, CustodyStepper } from "../components/lotViz";
import { statusBadge, shortHash, errorMessage } from "../utils/chain";
import { Line } from "react-chartjs-2";
import "../components/charts";

const Row = ({ k, v, mono }) => (
  <div className="flex justify-between gap-4 py-2 border-b border-slate-800/60 last:border-0 text-xs">
    <span className="text-slate-500">{k}</span>
    <span className={`text-slate-200 text-right break-all ${mono ? "font-mono" : "font-semibold"}`}>{v}</span>
  </div>
);

const BatchDetail = () => {
  const { batchId } = useParams();
  const [data, setData] = useState(null);
  const [lineage, setLineage] = useState(null);
  const [error, setError] = useState("");
  const [cold, setCold] = useState(null);

  useEffect(() => {
    setData(null);
    setLineage(null);
    Promise.all([axios.get(`/api/batches/${encodeURIComponent(batchId)}`), axios.get(`/api/batches/${encodeURIComponent(batchId)}/lineage`)])
      .then(([d, l]) => {
        setData(d.data);
        setLineage(l.data.data);
      })
      .catch((e) => setError(errorMessage(e)));
    axios
      .get(`/api/batches/${encodeURIComponent(batchId)}/coldchain`)
      .then((r) => setCold(r.data.data))
      .catch(() => setCold(null));
  }, [batchId]);

  if (error) return <div className="p-4 bg-red-500/10 border border-red-500/20 text-red-400 rounded-2xl text-xs">{error}</div>;
  if (!data || !lineage) return <Spinner />;

  const b = data.data;
  const isLot = b.originBatchId === b.batchId;
  const myRange = { start: b.unitStart, end: b.unitEnd };
  const dispensedHere = lineage.dispensed.filter((i) => i >= myRange.start && i < myRange.end).length;

  return (
    <div className="space-y-6">
      <PageHeader
        crumbs={[{ label: "Dashboard", to: "/dashboard" }, { label: isLot ? "Production lot" : "Shipment" }, { label: b.batchId }]}
        title={
          <span className="flex items-center gap-3">
            <span className="font-mono">{b.batchId}</span>
            <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${statusBadge(b.status)}`}>{b.status}</span>
          </span>
        }
        icon={PackageSearch}
        subtitle={`${b.drugName} · ${b.productCode} · ${isLot ? "production lot" : `split from ${b.parentBatchId} (lot ${b.originBatchId})`}`}
        actions={
          <Link to={`/verify?batchId=${encodeURIComponent(b.batchId)}`} className="px-4 py-2 rounded-xl bg-slate-900 border border-slate-800 hover:border-sky-500/40 text-xs font-semibold">
            Public verification view
          </Link>
        }
      />

      <div className="grid grid-cols-2 xl:grid-cols-4 gap-4">
        <StatCard label="Units in this shipment" value={b.quantity} accent="sky" sub={`unit range #${b.unitStart}–${b.unitEnd - 1}`} />
        <StatCard label="Dispensed here" value={dispensedHere} accent="emerald" sub={`${b.quantity - dispensedHere} still on the shelf`} />
        <StatCard label="Shipments in lineage" value={lineage.shipments.length} accent="violet" sub={`lot of ${lineage.lotSize} units`} />
        <StatCard label="Risk score" value={`${data.riskScore}%`} accent={data.riskScore >= 70 ? "rose" : data.riskScore > 30 ? "amber" : "emerald"} sub={`${data.anomalies.length} open evidence item(s)`} />
      </div>

      <Panel title="Chain of custody" icon={Route} right={<span className="text-[10px] text-slate-500">from PharmaChain.getBatchHistory</span>}>
        <CustodyStepper custody={b.custody} owners={lineage.owners} pending={b.pendingOwnerEthAddress} dispensed={b.status === "Depleted"} />
      </Panel>

      {cold && cold.sensors.length > 0 && (
        <Panel
          title="Cold chain - 2-of-3 signed sensors, Mean Kinetic Temperature"
          icon={Thermometer}
          right={
            cold.breached ? <Tag accent="rose">breach - quarantined</Tag> : <Tag accent="emerald">within limits</Tag>
          }
        >
          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
            <div className="space-y-3">
              <div className="p-3 rounded-xl border border-slate-800">
                <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Mean Kinetic Temperature</p>
                <p className={`text-2xl font-extrabold ${cold.mktC > b.maxTempC ? "text-rose-400" : "text-emerald-400"}`}>{cold.mktC !== null ? `${cold.mktC.toFixed(1)} °C` : "-"}</p>
                <p className="text-[10px] text-slate-500">limit {b.maxTempC} °C · {cold.count} agreed windows</p>
              </div>
              <div className="p-3 rounded-xl border border-slate-800">
                <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Sensors (device-signed)</p>
                {cold.sensors.map((x) => (
                  <p key={x.address} className="text-[11px] font-mono text-slate-300">
                    {x.label || "sensor"} · {shortHash(x.address, 4)}
                  </p>
                ))}
              </div>
              {cold.evidence.length > 0 && (
                <div className="p-3 rounded-xl border border-amber-500/30 bg-amber-500/5 text-[11px] text-amber-300">
                  {cold.evidence.map((e, i) => (
                    <p key={i}>
                      {e.event} · block #{e.blockNumber}
                    </p>
                  ))}
                </div>
              )}
            </div>
            <div className="lg:col-span-3 h-64">
              <Line
                data={{
                  labels: cold.readings.map((r) => `#${r.seq}`),
                  datasets: [
                    { label: "agreed reading (°C)", data: cold.readings.map((r) => r.tempC), borderColor: "#38bdf8", pointRadius: 0, tension: 0.25 },
                    { label: "cumulative MKT (°C)", data: cold.readings.map((r) => r.mktC), borderColor: "#f472b6", borderWidth: 2.5, pointRadius: 0, tension: 0.25 },
                    { label: "storage limit", data: cold.readings.map(() => b.maxTempC), borderColor: "#f43f5e", borderDash: [5, 4], pointRadius: 0 }
                  ]
                }}
                options={{ maintainAspectRatio: false, plugins: { legend: { position: "bottom" } }, scales: { x: { ticks: { maxTicksLimit: 10 }, grid: { display: false } } } }}
              />
            </div>
          </div>
        </Panel>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
        <Panel title="Lot lineage (quantity-conserving splits)" icon={GitBranch} className="xl:col-span-2">
          <LineageTree shipments={lineage.shipments} owners={lineage.owners} lotSize={lineage.lotSize} current={b.batchId} />
        </Panel>
        <Panel title={`Unit bitmap - lot ${lineage.lotBatchId}`} icon={Grid3x3} className="xl:col-span-3" right={<span className="text-[10px] text-slate-500">one square per serialised pack</span>}>
          <UnitMap lotSize={lineage.lotSize} shipments={lineage.shipments} dispensed={lineage.dispensed} flagged={lineage.flagged} />
        </Panel>
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
        <Panel title="On-chain record" icon={FileCode2}>
          <Row k="Drug" v={b.drugName} />
          <Row k="Registration code" v={b.productCode} mono />
          <Row k="Production lot" v={b.originBatchId} mono />
          <Row k="Manufactured" v={new Date(b.productionDate).toLocaleDateString()} />
          <Row k="Expires" v={new Date(b.expiryDate).toLocaleDateString()} />
          <Row k="Storage range" v={`${b.minTempC} – ${b.maxTempC} °C`} />
          <Row k="Packaging" v={`${b.packsPerCarton} packs / carton · ${b.cartonsPerCase} cartons / case`} />
          <Row k="Dispensing mode" v={b.privateLot ? "Private (zero-knowledge)" : "Public (two-part labels)"} />
          <Row k="Unit Merkle root" v={shortHash(b.unitRoot, 14)} mono />
          <Row k="Batch key" v={shortHash(b.batchKey, 14)} mono />
          {b.txHash && (
            <Row
              k="Created in"
              v={
                <Link to={`/explorer?tx=${b.txHash}`} className="text-sky-400 hover:underline">
                  block #{b.blockNumber}
                </Link>
              }
            />
          )}
        </Panel>

        <Panel title="Evidence on this lot" icon={ShieldAlert}>
          {data.anomalies.length === 0 ? (
            <EmptyState icon={ShieldAlert} title="No evidence recorded" text="Clones, forgeries, diversions and cold-chain breaches would appear here." />
          ) : (
            <div className="space-y-2.5">
              {data.anomalies.map((a, i) => (
                <div key={i} className="p-3 rounded-xl border border-rose-500/20 bg-rose-500/5 text-xs">
                  <div className="flex gap-2 flex-wrap">
                    <Tag accent={a.severity === "Critical" ? "rose" : "amber"}>{a.type}</Tag>
                    {a.source === "on-chain" && <Tag accent="sky">on-chain</Tag>}
                  </div>
                  <p className="text-slate-400 mt-1.5">{a.description}</p>
                  {a.txHash && (
                    <Link to={`/explorer?tx=${a.txHash}`} className="text-[10px] font-mono text-sky-500 hover:underline">
                      tx {shortHash(a.txHash, 8)}
                    </Link>
                  )}
                </div>
              ))}
            </div>
          )}
        </Panel>

        <Panel title="Event history" icon={History}>
          <ol className="relative border-l border-slate-800 ml-2 space-y-4">
            {(b.history || []).map((h, i) => (
              <li key={i} className="ml-4">
                <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-sky-500 ring-4 ring-slate-950" />
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs font-bold text-slate-200">{h.action}</span>
                  {h.blockNumber !== undefined && <span className="text-[10px] font-mono text-slate-600">#{h.blockNumber}</span>}
                </div>
                <p className="text-[10px] text-slate-500">{new Date(h.timestamp).toLocaleString()}</p>
                {h.note && <p className="text-[11px] text-slate-400 mt-0.5">{h.note}</p>}
                {h.txHash && (
                  <Link to={`/explorer?tx=${h.txHash}`} className="text-[10px] font-mono text-sky-500/80 hover:underline flex items-center gap-1">
                    <LinkIcon className="h-2.5 w-2.5" /> {shortHash(h.txHash, 8)}
                  </Link>
                )}
              </li>
            ))}
          </ol>
        </Panel>
      </div>
    </div>
  );
};

export default BatchDetail;
