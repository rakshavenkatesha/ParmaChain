import React from "react";
import { Link } from "react-router-dom";
import {
  Factory,
  Truck,
  Store,
  UserRound,
  ArrowRight,
  CheckCircle2,
  ShieldAlert,
  Copy as CopyIcon,
  Split,
  Send,
  PackageCheck,
  Ban,
  Thermometer,
  PlusSquare,
  Undo2,
  Pill,
  Shuffle,
  GitCommitVertical
} from "lucide-react";
import { SHIPMENT_COLORS, Pill as Tag } from "./ui";
import { statusBadge, shortHash } from "../utils/chain";
import { hashPair, aggregateLeaf } from "../utils/unitMerkle";

const shipmentColor = (shipments, id) => SHIPMENT_COLORS[Math.max(0, shipments.findIndex((s) => s.batchId === id)) % SHIPMENT_COLORS.length];

// ---------------------------------------------------------------------------- Unit map

/**
 * One square per serialised unit of the lot, coloured by the shipment that holds its range.
 * Filled = dispensed (bit set on-chain); red ring = attack evidence recorded for that unit.
 */
export const UnitMap = ({ lotSize, shipments = [], dispensed = [], flagged = {}, highlight, max = 600 }) => {
  const shown = Math.min(lotSize, max);
  const dSet = new Set(dispensed);
  const owner = (i) => shipments.find((s) => i >= s.unitStart && i < s.unitEnd);
  return (
    <div>
      <div className="grid gap-[3px]" style={{ gridTemplateColumns: `repeat(${Math.min(25, shown)}, minmax(0, 1fr))` }}>
        {Array.from({ length: shown }, (_, i) => {
          const s = owner(i);
          const c = s ? shipmentColor(shipments, s.batchId) : "#334155";
          const isD = dSet.has(i);
          const flags = flagged[i];
          return (
            <div
              key={i}
              title={`Unit #${i}${s ? ` · ${s.batchId}` : ""}${isD ? " · dispensed" : " · available"}${flags ? ` · ${flags.join(", ")}` : ""}`}
              className={`aspect-square rounded-[4px] flex items-center justify-center text-[7px] font-bold transition ${highlight === i ? "scale-125 z-10" : ""}`}
              style={{
                background: isD ? c : `${c}26`,
                border: `1px solid ${flags ? "#f43f5e" : `${c}66`}`,
                boxShadow: flags ? "0 0 0 1.5px #f43f5e" : highlight === i ? "0 0 0 2px #fbbf24" : "none",
                color: isD ? "#0f172a" : "transparent"
              }}
            >
              {flags ? <span style={{ color: "#f43f5e" }}>!</span> : isD ? "✓" : ""}
            </div>
          );
        })}
      </div>
      {lotSize > max && <p className="text-[10px] text-slate-500 mt-2">Showing the first {max} of {lotSize.toLocaleString()} units.</p>}
      <div className="flex flex-wrap gap-x-4 gap-y-1.5 mt-3 text-[10px] text-slate-400">
        {shipments.map((s) => (
          <span key={s.batchId} className="flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: shipmentColor(shipments, s.batchId) }} />
            <span className="font-mono">{s.batchId}</span> [{s.unitStart}–{s.unitEnd - 1}]
          </span>
        ))}
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-slate-300" /> filled = dispensed
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm border-2 border-rose-500" /> attack evidence
        </span>
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------- Lineage tree

const RangeBar = ({ start, end, lotSize, color }) => (
  <div className="relative h-1.5 w-full rounded-full bg-slate-800 overflow-hidden mt-2">
    <div className="absolute h-full rounded-full" style={{ left: `${(start / lotSize) * 100}%`, width: `${((end - start) / lotSize) * 100}%`, background: color }} />
  </div>
);

export const LineageTree = ({ shipments = [], owners = {}, lotSize, current }) => {
  const roots = shipments.filter((s) => !s.parentBatchId);
  const childrenOf = (id) => shipments.filter((s) => s.parentBatchId === id);

  const Node = ({ s, depth }) => {
    const color = shipmentColor(shipments, s.batchId);
    const own = owners[s.currentOwnerEthAddress];
    const kids = childrenOf(s.batchId);
    return (
      <div className={depth > 0 ? "ml-6 pl-4 border-l border-dashed border-slate-700 relative" : ""}>
        {depth > 0 && <span className="absolute -left-px top-6 w-4 border-t border-dashed border-slate-700" />}
        <Link
          to={`/batch/${encodeURIComponent(s.batchId)}`}
          className={`block mt-2 p-3 rounded-2xl border transition hover:border-sky-500/40 ${s.batchId === current ? "border-sky-500/50 bg-sky-500/5" : "border-slate-800 bg-slate-900/50"}`}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="flex items-center gap-2 min-w-0">
              <span className="h-2.5 w-2.5 rounded-full shrink-0" style={{ background: color }} />
              <span className="font-mono text-xs font-bold text-slate-200 truncate">{s.batchId}</span>
              {depth === 0 && <Tag accent="violet">lot</Tag>}
            </span>
            <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase border ${statusBadge(s.status)}`}>{s.status}</span>
          </div>
          <div className="flex items-center justify-between text-[10px] text-slate-500 mt-1.5">
            <span>
              units {s.unitStart}–{s.unitEnd - 1} · {s.quantity - (s.dispensedCount || 0)}/{s.quantity} left
            </span>
            <span className="truncate ml-2">{own ? `${own.name}` : shortHash(s.currentOwnerEthAddress, 4)}</span>
          </div>
          <RangeBar start={s.unitStart} end={s.unitEnd} lotSize={lotSize || s.unitEnd} color={color} />
        </Link>
        {kids.map((k) => (
          <Node key={k.batchId} s={k} depth={depth + 1} />
        ))}
      </div>
    );
  };

  return (
    <div>
      {roots.map((r) => (
        <Node key={r.batchId} s={r} depth={0} />
      ))}
    </div>
  );
};

// ---------------------------------------------------------------------------- Custody stepper

const ROLE_ICON = { Manufacturer: Factory, Distributor: Truck, Pharmacy: Store };

export const CustodyStepper = ({ custody = [], owners = {}, pending, dispensed }) => {
  const steps = custody.map((a) => ({ address: a, ...(owners[a] || {}) }));
  if (pending) steps.push({ address: pending, ...(owners[pending] || {}), pending: true });
  if (dispensed) steps.push({ patient: true });
  return (
    <div className="flex items-center gap-2 overflow-x-auto pb-1">
      {steps.map((s, i) => {
        const Icon = s.patient ? UserRound : ROLE_ICON[s.role] || Factory;
        return (
          <React.Fragment key={i}>
            {i > 0 && <ArrowRight className={`h-4 w-4 shrink-0 ${s.pending ? "text-amber-500 animate-pulse" : "text-slate-600"}`} />}
            <div
              className={`shrink-0 min-w-[120px] rounded-2xl border p-3 text-center ${
                s.patient ? "border-emerald-500/40 bg-emerald-500/10" : s.pending ? "border-amber-500/40 border-dashed bg-amber-500/5" : "border-slate-800 bg-slate-900/60"
              }`}
            >
              <div className={`mx-auto h-9 w-9 rounded-xl flex items-center justify-center ${s.patient ? "bg-emerald-500/20 text-emerald-300" : s.pending ? "bg-amber-500/15 text-amber-300" : "bg-sky-500/15 text-sky-300"}`}>
                <Icon className="h-5 w-5" />
              </div>
              <p className="text-[11px] font-bold text-slate-200 mt-1.5 truncate">{s.patient ? "Patient" : s.name || "Unknown"}</p>
              <p className="text-[9px] text-slate-500">{s.patient ? "dispensed" : s.pending ? "awaiting signature" : s.role || shortHash(s.address, 4)}</p>
            </div>
          </React.Fragment>
        );
      })}
    </div>
  );
};

// ---------------------------------------------------------------------------- Merkle path

/**
 * Visualises the hierarchical proof pack -> carton -> case -> lot of a two-part label and compares
 * the recomputed root with the root stored on-chain.
 */
export const MerklePath = ({ originKey, index, leaf, proof, root, packsPerCarton, cartonsPerCase }) => {
  if (!proof || !leaf) return null;
  const carton = Math.floor(index / packsPerCarton);
  const kase = Math.floor(carton / cartonsPerCase);
  const walk = (start, siblings) => {
    const steps = [];
    let h = start;
    for (const s of siblings) {
      const parent = hashPair(h, s);
      steps.push({ node: h, sibling: s });
      h = parent;
    }
    return { steps, top: h };
  };
  const p1 = walk(leaf, proof.pack || []);
  const cartonLeaf = aggregateLeaf(originKey, 1, carton, p1.top);
  const p2 = walk(cartonLeaf, proof.carton || []);
  const caseLeaf = aggregateLeaf(originKey, 2, kase, p2.top);
  const p3 = walk(caseLeaf, proof.kase || []);
  const matches = root && p3.top.toLowerCase() === root.toLowerCase();

  const Level = ({ title, color, entry, steps, top, topLabel }) => (
    <div className="rounded-xl border border-slate-800 bg-slate-950/40 p-2.5 space-y-1">
      <div className="flex items-center justify-between">
        <span className={`text-[10px] font-bold uppercase tracking-wider ${color}`}>{title}</span>
        <span className="text-[9px] text-slate-500">{steps.length} sibling hash{steps.length === 1 ? "" : "es"}</span>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-300">{entry}</span>
        {steps.map((s, k) => (
          <React.Fragment key={k}>
            <span className="text-slate-600">⊕</span>
            <span className="px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-300" title="sibling from proof">
              {shortHash(s.sibling, 4)}
            </span>
          </React.Fragment>
        ))}
        <span className="text-slate-600">→</span>
        <span className="px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-300">
          {topLabel} {shortHash(top, 4)}
        </span>
      </div>
    </div>
  );

  return (
    <div className="space-y-1.5 font-mono text-[10px]">
      <div className={`flex items-center gap-2 p-2.5 rounded-xl border ${matches ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" : "border-rose-500/40 bg-rose-500/10 text-rose-300"}`}>
        {matches ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <ShieldAlert className="h-4 w-4 shrink-0" />}
        <span className="truncate">computed lot root {shortHash(p3.top, 10)}</span>
        <span className="ml-auto shrink-0">{matches ? "= on-chain root" : "≠ on-chain root"}</span>
      </div>
      <Level title={`Lot (case ${kase} → lot)`} color="text-emerald-400" entry={`H(case ${kase})`} steps={p3.steps} top={p3.top} topLabel="lot" />
      <Level title={`Case ${kase} (carton ${carton} → case)`} color="text-violet-400" entry={`H(carton ${carton})`} steps={p2.steps} top={p2.top} topLabel="case" />
      <Level title={`Carton ${carton} (pack #${index} → carton)`} color="text-sky-400" entry={`pack #${index}`} steps={p1.steps} top={p1.top} topLabel="carton" />
      <div className="flex items-center gap-2 pl-1 text-slate-500">
        <GitCommitVertical className="h-3.5 w-3.5 text-amber-500 shrink-0" />
        pack leaf = H(H(lot, {index}, visibleTag, commit(scratchCode))) = {shortHash(leaf, 6)}
      </div>
    </div>
  );
};

// ---------------------------------------------------------------------------- Activity feed

const EVENT_META = {
  BatchRegistered: { icon: PlusSquare, color: "text-sky-400", text: (e) => `Lot ${e.batchId} registered (${e.args?.quantity} units)` },
  TransferInitiated: { icon: Send, color: "text-amber-400", text: (e) => `${e.batchId} dispatched` },
  TransferCancelled: { icon: Undo2, color: "text-slate-400", text: (e) => `${e.batchId} dispatch cancelled` },
  ShipmentAccepted: { icon: PackageCheck, color: "text-emerald-400", text: (e) => `${e.batchId} receipt signed` },
  BatchSplit: { icon: Split, color: "text-violet-400", text: (e) => `${e.args?.parentId} split → ${e.args?.childId}` },
  UnitDispensed: { icon: Pill, color: "text-emerald-400", text: (e) => `Unit #${e.unitIndex} dispensed` },
  CloneDetected: { icon: CopyIcon, color: "text-rose-400", text: (e) => `CLONE of unit #${e.unitIndex} caught` },
  CounterfeitDetected: { icon: ShieldAlert, color: "text-rose-400", text: (e) => `FORGED label (#${e.unitIndex}) caught` },
  DiversionDetected: { icon: Shuffle, color: "text-amber-400", text: (e) => `DIVERTED unit #${e.unitIndex} caught` },
  BatchRecalled: { icon: Ban, color: "text-rose-400", text: (e) => `Lot recalled: ${e.args?.reason || ""}` },
  BatchQuarantined: { icon: Thermometer, color: "text-orange-400", text: (e) => `${e.batchId} quarantined` },
  QuarantineReleased: { icon: CheckCircle2, color: "text-emerald-400", text: (e) => `${e.batchId} released` },
  ColdChainBreach: { icon: Thermometer, color: "text-orange-400", text: (e) => `Cold-chain breach ${Number(e.args?.tempDeci) / 10}°C` }
};

const ago = (d) => {
  const s = Math.max(1, Math.floor((Date.now() - new Date(d).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

export const ActivityFeed = ({ events = [] }) => (
  <ol className="relative space-y-3">
    {events.map((e) => {
      const m = EVENT_META[e.name] || { icon: GitCommitVertical, color: "text-slate-400", text: () => e.name };
      const Icon = m.icon;
      return (
        <li key={`${e.txHash}-${e.logIndex}`} className="flex items-start gap-3">
          <span className="h-7 w-7 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center shrink-0">
            <Icon className={`h-3.5 w-3.5 ${m.color}`} />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs text-slate-200 truncate">{m.text(e)}</p>
            <p className="text-[10px] text-slate-500 font-mono">
              <Link to={`/explorer?tx=${e.txHash}`} className="hover:text-sky-400">
                block #{e.blockNumber}
              </Link>{" "}
              · {e.timestamp ? ago(e.timestamp) : ""}
            </p>
          </div>
        </li>
      );
    })}
  </ol>
);
