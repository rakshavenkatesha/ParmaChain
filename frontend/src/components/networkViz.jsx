import React, { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import axios from "axios";
import { Boxes } from "lucide-react";
import { shortHash } from "../utils/chain";

const SHORT = { regulator: "Regulator", manufacturer: "Manufacturers", distributor: "Distributors", pharmacy: "Pharmacies", hardhat: "Dev node" };

/**
 * Animated full-mesh topology of the QBFT validators. The latest block proposer pulses,
 * offline nodes turn red and their links break, and the centre shows the quorum.
 */
export const NetworkTopology = ({ nodes = [], quorum, height = 280 }) => {
  const W = 520;
  const H = Math.max(height, 300);
  const cx = W / 2;
  const cy = H / 2;
  const RX = W / 2 - 95;
  const RY = H / 2 - 78;
  const pos = nodes.map((_, i) => {
    if (nodes.length === 4) {
      // square layout: top-left, top-right, bottom-right, bottom-left
      const sx = [-1, 1, 1, -1][i];
      const sy = [-1, -1, 1, 1][i];
      return { x: cx + sx * RX * 0.82, y: cy + sy * RY };
    }
    const a = (Math.PI * 2 * i) / Math.max(nodes.length, 1) - Math.PI / 2;
    return { x: cx + RX * Math.cos(a), y: cy + RY * Math.sin(a) };
  });
  const online = nodes.filter((n) => n.online).length;
  const healthy = quorum ? online >= quorum : true;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: H }}>
      <defs>
        <radialGradient id="nodeOn" cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.9" />
          <stop offset="100%" stopColor="#0c4a6e" stopOpacity="0.9" />
        </radialGradient>
        <radialGradient id="nodeOff" cx="50%" cy="40%" r="60%">
          <stop offset="0%" stopColor="#f43f5e" stopOpacity="0.8" />
          <stop offset="100%" stopColor="#4c0519" stopOpacity="0.9" />
        </radialGradient>
      </defs>

      {/* full-mesh links */}
      {nodes.map((a, i) =>
        nodes.map((b, j) =>
          j > i ? (
            <line
              key={`${i}-${j}`}
              x1={pos[i].x}
              y1={pos[i].y}
              x2={pos[j].x}
              y2={pos[j].y}
              stroke={a.online && b.online ? "#38bdf8" : "#475569"}
              strokeOpacity={a.online && b.online ? 0.45 : 0.25}
              strokeWidth="1.5"
              className={a.online && b.online ? "edge-flow" : ""}
              strokeDasharray={a.online && b.online ? undefined : "3 6"}
            />
          ) : null
        )
      )}

      {/* quorum badge */}
      <g>
        <circle cx={cx} cy={cy} r="34" fill="#0f172a" stroke={healthy ? "#34d399" : "#f43f5e"} strokeOpacity="0.6" />
        <text x={cx} y={cy - 4} textAnchor="middle" fontSize="15" fontWeight="800" fill={healthy ? "#34d399" : "#f43f5e"}>
          {online}/{nodes.length}
        </text>
        <text x={cx} y={cy + 11} textAnchor="middle" fontSize="8" fill="#94a3b8" letterSpacing="1">
          {quorum ? `QUORUM ${quorum}` : "NODES"}
        </text>
      </g>

      {/* nodes */}
      {nodes.map((n, i) => (
        <g key={n.name}>
          {n.isLatestProposer && n.online && (
            <circle cx={pos[i].x} cy={pos[i].y} r="30" fill="none" stroke="#fbbf24" strokeWidth="2" className="proposer-pulse" />
          )}
          <circle cx={pos[i].x} cy={pos[i].y} r="26" fill={n.online ? "url(#nodeOn)" : "url(#nodeOff)"} stroke={n.online ? "#7dd3fc" : "#fda4af"} strokeOpacity="0.6" />
          <text x={pos[i].x} y={pos[i].y + 4} textAnchor="middle" fontSize="11" fontWeight="800" fill="#f8fafc">
            {n.online ? n.proposed : "✕"}
          </text>
          <text x={pos[i].x} y={pos[i].y + (pos[i].y > cy ? 46 : -50)} textAnchor="middle" fontSize="12" fontWeight="700" fill="#e2e8f0">
            {SHORT[n.name] || n.name}
          </text>
          <text x={pos[i].x} y={pos[i].y + (pos[i].y > cy ? 60 : -36)} textAnchor="middle" fontSize="9" fill="#64748b" fontFamily="monospace">
            {n.address ? `${n.address.slice(0, 8)}…` : ""}
            {n.online && n.peers !== null ? ` · ${n.peers} peers` : n.online ? "" : " · OFFLINE"}
          </text>
        </g>
      ))}
    </svg>
  );
};

/** Horizontal strip of the latest blocks, newest on the right, linked by parent hashes. */
export const BlockStrip = ({ blocks = [], onSelect }) => {
  const ordered = [...blocks].reverse();
  return (
    <div className="flex items-stretch gap-0 overflow-x-auto pb-2">
      {ordered.map((b, i) => (
        <React.Fragment key={b.hash}>
          {i > 0 && (
            <div className="flex flex-col justify-center shrink-0">
              <div className={`h-0.5 w-4 ${b.parentHash === ordered[i - 1].hash ? "bg-emerald-500/60" : "bg-rose-500"}`} />
            </div>
          )}
          <button
            onClick={() => onSelect && onSelect(b.number)}
            className={`flex-1 min-w-[84px] rounded-xl border p-2.5 text-left transition hover:-translate-y-0.5 ${
              b.txCount ? "border-amber-500/40 bg-amber-500/10" : "border-slate-800 bg-slate-900/70"
            } ${i === ordered.length - 1 ? "ring-1 ring-sky-400/60 block-new" : ""}`}
          >
            <p className="text-[11px] font-extrabold text-sky-300 font-mono">#{b.number}</p>
            <p className="text-[9px] font-mono text-slate-500 truncate">{shortHash(b.hash, 4)}</p>
            <div className="flex items-center justify-between mt-1.5">
              <span className={`text-[9px] font-bold ${b.txCount ? "text-amber-300" : "text-slate-600"}`}>{b.txCount} tx</span>
              <Boxes className={`h-3 w-3 ${b.txCount ? "text-amber-300" : "text-slate-700"}`} />
            </div>
          </button>
        </React.Fragment>
      ))}
    </div>
  );
};

/** Navbar pill with live block height, validator health and block time. */
export const NetworkStatusBar = () => {
  const [o, setO] = useState(null);
  const [down, setDown] = useState(false);
  const [flash, setFlash] = useState(false);
  const last = useRef(null);

  useEffect(() => {
    let alive = true;
    const tick = async () => {
      try {
        const r = await axios.get("/api/chain/overview");
        if (!alive) return;
        const d = r.data.data;
        if (last.current !== null && d.latestBlock > last.current) {
          setFlash(true);
          setTimeout(() => setFlash(false), 600);
        }
        last.current = d.latestBlock;
        setO(d);
        setDown(false);
      } catch {
        if (alive) setDown(true);
      }
    };
    tick();
    const t = setInterval(tick, 3000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  if (down) {
    return (
      <Link to="/explorer" className="hidden lg:flex items-center gap-2 px-3 py-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-400 text-[11px] font-semibold">
        <span className="h-2 w-2 rounded-full bg-rose-500" /> Node unreachable
      </Link>
    );
  }
  if (!o) return null;
  const vals = o.validators.length;
  return (
    <Link
      to="/explorer"
      className="hidden lg:flex items-center gap-3 px-3 py-1.5 rounded-xl border border-slate-800 bg-slate-900/60 hover:border-sky-500/40 text-[11px] transition"
      title="Open the ledger explorer"
    >
      <span className="flex items-center gap-1.5 text-emerald-400 font-semibold">
        <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
        {o.chainId === 2026 ? "QBFT" : "Dev"} · chain {o.chainId}
      </span>
      <span className="text-slate-600">|</span>
      <span className={`font-mono font-bold transition-colors ${flash ? "text-amber-300" : "text-slate-200"}`}>#{o.latestBlock.toLocaleString()}</span>
      {vals > 0 && (
        <>
          <span className="text-slate-600">|</span>
          <span className="text-slate-400">
            {vals} validators · f={o.faultTolerance}
          </span>
        </>
      )}
      {o.avgBlockTimeSec && (
        <>
          <span className="text-slate-600">|</span>
          <span className="text-slate-400">{o.avgBlockTimeSec.toFixed(1)}s</span>
        </>
      )}
    </Link>
  );
};
