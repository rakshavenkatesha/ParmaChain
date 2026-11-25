import React, { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import axios from "axios";
import { Bar } from "react-chartjs-2";
import { Blocks, ShieldCheck, Server, Link2, Search, X, Hash, Sprout, ArrowDown, ShieldAlert, Network, Activity, Cpu, Hexagon, Globe, Anchor, Landmark } from "lucide-react";
import { shortHash, errorMessage } from "../utils/chain";
import { Panel, StatCard, Pill as Tag } from "../components/ui";
import { NetworkTopology, BlockStrip } from "../components/networkViz";
import "../components/charts";

const Explorer = () => {
  const [params, setParams] = useSearchParams();
  const [overview, setOverview] = useState(null);
  const [blocks, setBlocks] = useState([]);
  const [validators, setValidators] = useState(null);
  const [stats, setStats] = useState(null);
  const [checkpoints, setCheckpoints] = useState(null);
  const [selected, setSelected] = useState(null);
  const [tx, setTx] = useState(null);
  const [integrity, setIntegrity] = useState(null);
  const [checking, setChecking] = useState(false);
  const [query, setQuery] = useState("");
  const [error, setError] = useState("");

  const load = async () => {
    try {
      const [o, b, v, s, cp] = await Promise.all([
        axios.get("/api/chain/overview"),
        axios.get("/api/chain/blocks?limit=10"),
        axios.get("/api/chain/validators?window=60"),
        axios.get("/api/chain/stats?blocks=40"),
        axios.get("/api/checkpoints").catch(() => null)
      ]);
      setOverview(o.data.data);
      setBlocks(b.data.data);
      setValidators(v.data.data);
      setStats(s.data.data);
      setCheckpoints(cp ? cp.data.data : null);
      setError("");
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  useEffect(() => {
    load();
    const t = setInterval(load, 3000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    const h = params.get("tx");
    if (h) openTx(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const openBlock = async (n) => {
    setTx(null);
    try {
      setSelected((await axios.get(`/api/chain/blocks/${n}`)).data.data);
      window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const openTx = async (h) => {
    setSelected(null);
    try {
      setTx((await axios.get(`/api/chain/tx/${h}`)).data.data);
    } catch (e) {
      setError(errorMessage(e));
    }
  };

  const search = (e) => {
    e.preventDefault();
    const q = query.trim();
    if (/^\d+$/.test(q)) openBlock(Number(q));
    else if (/^0x[0-9a-fA-F]{64}$/.test(q)) setParams({ tx: q });
  };

  const runIntegrity = async () => {
    setChecking(true);
    try {
      setIntegrity((await axios.get(`/api/chain/integrity?from=0`)).data.data);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setChecking(false);
    }
  };

  const g = overview?.genesis;
  const series = stats?.series || [];
  const totalProposed = validators ? validators.nodes.reduce((s, n) => s + n.proposed, 0) || 1 : 1;

  return (
    <div className="min-h-screen text-slate-100 py-8 px-4 bg-grid">
      <div className="max-w-7xl mx-auto space-y-6">
        {/* header */}
        <div className="flex flex-wrap justify-between items-end gap-4">
          <div>
            <Link to="/dashboard" className="flex items-center gap-2 text-xs text-sky-400 hover:underline">
              <Hexagon className="h-3.5 w-3.5" /> PharmaChain
            </Link>
            <h1 className="text-3xl font-extrabold font-sans mt-1 flex items-center gap-3">
              <span className="h-10 w-10 rounded-2xl bg-gradient-to-br from-sky-500/30 to-violet-500/20 border border-sky-500/30 flex items-center justify-center">
                <Blocks className="h-5 w-5 text-sky-300" />
              </span>
              Ledger Explorer
            </h1>
            <p className="text-slate-400 text-xs mt-1.5">{overview ? `${overview.consensus} · ${overview.rpcUrl}` : "Connecting to node…"}</p>
          </div>
          <form onSubmit={search} className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Block number or tx hash"
              className="pl-9 pr-3 py-2.5 w-80 bg-slate-900/80 border border-slate-800 rounded-xl text-xs font-mono focus:outline-none focus:border-sky-500"
            />
          </form>
        </div>

        {error && <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-xs">{error}</div>}

        {overview && (
          <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3">
            <StatCard label="Chain ID" value={overview.chainId} sub={overview.network} accent="sky" />
            <StatCard label="Block height" value={`#${overview.latestBlock.toLocaleString()}`} sub={overview.avgBlockTimeSec ? `~${overview.avgBlockTimeSec.toFixed(1)} s / block` : ""} accent="violet" />
            <StatCard label="Validators" value={overview.validators.length || 1} sub={overview.validators.length ? `tolerates f = ${overview.faultTolerance}` : "dev automine"} accent="emerald" />
            <StatCard label="Peers" value={overview.peerCount} sub="of the regulator node" accent="sky" />
            <StatCard label="Indexed to" value={overview.indexer.lastBlock ?? "-"} sub={overview.indexer.lastError || "cache in sync"} accent="amber" />
            <StatCard label="Events indexed" value={(stats?.eventCounts || []).reduce((s, e) => s + e.count, 0)} sub={`${(stats?.eventCounts || []).length} event types`} accent="rose" />
          </div>
        )}

        {/* chain strip */}
        <Panel title="Blockchain (live)" icon={Link2} right={<span className="text-[10px] text-slate-500">newest → right · green links = parentHash verified</span>}>
          <BlockStrip blocks={blocks} onSelect={openBlock} />
        </Panel>

        <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">
          <Panel title="QBFT validator mesh" icon={Network} right={<span className="text-[10px] text-slate-500">pulsing = latest proposer</span>}>
            {validators && <NetworkTopology nodes={validators.nodes} quorum={validators.nodes.length > 1 ? validators.quorum : undefined} height={300} />}
          </Panel>

          <Panel title="Validator set" icon={Server} className="xl:col-span-2" bodyClass="p-0">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] uppercase tracking-widest text-slate-500 border-b border-slate-800 bg-slate-900/40">
                  <th className="p-3 text-left">Node</th>
                  <th className="p-3 text-left">Validator address</th>
                  <th className="p-3">Status</th>
                  <th className="p-3">Height</th>
                  <th className="p-3">Peers</th>
                  <th className="p-3 text-left w-48">Proposer share (last {validators?.window || 0})</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60">
                {(validators?.nodes || []).map((n) => (
                  <tr key={n.name}>
                    <td className="p-3">
                      <p className="font-bold text-slate-200 flex items-center gap-1.5">
                        <Cpu className="h-3.5 w-3.5 text-sky-400" /> {n.label}
                      </p>
                      {n.rpc && <p className="text-[10px] text-slate-600 font-mono">{n.rpc}</p>}
                    </td>
                    <td className="p-3 font-mono text-[11px] text-slate-400">{n.address}</td>
                    <td className="p-3 text-center">{n.online ? <Tag accent="emerald">online</Tag> : <Tag accent="rose">offline</Tag>}</td>
                    <td className="p-3 text-center font-mono">{n.height ?? "-"}</td>
                    <td className="p-3 text-center font-mono">{n.peers ?? "-"}</td>
                    <td className="p-3">
                      <div className="flex items-center gap-2">
                        <div className="h-1.5 flex-1 rounded-full bg-slate-800 overflow-hidden">
                          <div className="h-full bg-gradient-to-r from-sky-500 to-violet-500" style={{ width: `${(n.proposed / totalProposed) * 100}%` }} />
                        </div>
                        <span className="font-mono text-[10px] text-slate-400 w-14 text-right">
                          {n.proposed} blk{n.isLatestProposer ? " ★" : ""}
                        </span>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-[10px] text-slate-500 px-3 py-2.5 border-t border-slate-800">
              QBFT rotates the proposer round-robin; a block is final once 2f+1 = {validators?.quorum || 3} validators add commit seals. Quorum survives one failed node.
            </p>
          </Panel>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Genesis */}
          <Panel title="Genesis block #0" icon={Sprout} className="border-emerald-500/20">
            {g ? (
              <div className="space-y-3">
                <div className="text-xs space-y-1.5">
                  <p className="text-slate-500">
                    Hash <span className="font-mono text-slate-200 break-all block">{g.hash}</span>
                  </p>
                  <p className="text-slate-500">
                    Created <span className="text-slate-200">{new Date(g.timestamp).toLocaleString()}</span>
                  </p>
                  <p className="text-slate-500">
                    Gas limit <span className="text-slate-200">{Number(g.gasLimit).toLocaleString()}</span>
                  </p>
                  {g.qbft?.vanityText && (
                    <p className="text-slate-500">
                      Vanity <span className="font-mono text-emerald-300">"{g.qbft.vanityText}"</span>
                    </p>
                  )}
                </div>
                {overview.validatorContract ? (
                  <div className="space-y-1.5">
                    <p className="text-[10px] uppercase font-bold tracking-wider text-slate-500">Validator selection: contract</p>
                    <p className="text-[11px] text-slate-400">
                      QBFT reads the validator set from <span className="font-mono text-emerald-300">{overview.validatorContract.address}</span>, a
                      ValidatorSet contract placed in the genesis alloc (the extraData validator list is empty by design).
                    </p>
                    <p className="text-[11px] text-slate-400 flex items-center gap-1.5">
                      <Landmark className="h-3 w-3 text-amber-400" />
                      {overview.validatorContract.governedByMultisig ? (
                        <>
                          controlled by the Governance multisig <span className="font-mono text-slate-300">{shortHash(overview.validatorContract.controller, 6)}</span>
                        </>
                      ) : (
                        "still under the bootstrap key (hand-over pending)"
                      )}
                    </p>
                    <p className="text-[10px] uppercase font-bold tracking-wider text-slate-500 pt-1">Live validators ({overview.contractValidators.length})</p>
                    {overview.contractValidators.map((v) => (
                      <p key={v} className="font-mono text-[11px] text-slate-300 flex items-center gap-1.5">
                        <Server className="h-3 w-3 text-emerald-500" /> {v}
                      </p>
                    ))}
                  </div>
                ) : g.qbft && g.qbft.validators.length ? (
                  <div>
                    <p className="text-[10px] uppercase font-bold tracking-wider text-slate-500 mb-1">Initial validator set (decoded from extraData RLP)</p>
                    {g.qbft.validators.map((v) => (
                      <p key={v} className="font-mono text-[11px] text-slate-300 flex items-center gap-1.5">
                        <Server className="h-3 w-3 text-emerald-500" /> {v}
                      </p>
                    ))}
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-500">Development chain - no BFT validator set in genesis.</p>
                )}
                <button
                  onClick={runIntegrity}
                  disabled={checking}
                  className="w-full py-2.5 bg-emerald-500 hover:bg-emerald-600 disabled:bg-emerald-500/40 text-slate-950 font-bold rounded-xl text-xs uppercase tracking-wider"
                >
                  {checking ? "Re-hashing chain…" : "Verify hash chain from genesis"}
                </button>
                {integrity && (
                  <div className={`p-3 rounded-xl text-xs flex gap-2 ${integrity.intact ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"}`}>
                    {integrity.intact ? <ShieldCheck className="h-4 w-4 shrink-0" /> : <ShieldAlert className="h-4 w-4 shrink-0" />}
                    {integrity.intact
                      ? `All ${integrity.blocksChecked} blocks (#${integrity.from}–#${integrity.to}) link to their parent hash. ${integrity.ms} ms.`
                      : `${integrity.broken.length} broken link(s) detected!`}
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-slate-500">Loading…</p>
            )}
          </Panel>

          <Panel title="Throughput (last 40 blocks)" icon={Activity}>
            <div className="h-64">
              <Bar
                data={{
                  labels: series.map((s) => `#${s.number}`),
                  datasets: [
                    { type: "line", label: "gas used (k)", data: series.map((s) => Math.round(s.gasUsed / 1000)), borderColor: "#38bdf8", backgroundColor: "rgba(56,189,248,0.12)", fill: true, borderWidth: 2, tension: 0.3, pointRadius: 0, yAxisID: "y1", order: 1 },
                    { type: "bar", label: "transactions", data: series.map((s) => s.txCount), backgroundColor: "#fbbf24", borderRadius: 3, yAxisID: "y", order: 2 }
                  ]
                }}
                options={{
                  maintainAspectRatio: false,
                  interaction: { intersect: false, mode: "index" },
                  plugins: { legend: { position: "bottom" } },
                  scales: {
                    x: { ticks: { maxTicksLimit: 6 }, grid: { display: false } },
                    y: { position: "left", ticks: { precision: 0 }, title: { display: true, text: "tx" } },
                    y1: { position: "right", grid: { display: false }, title: { display: true, text: "kgas" } }
                  }
                }}
              />
            </div>
          </Panel>

          {/* Latest blocks list */}
          <Panel title="Latest blocks" icon={Blocks} bodyClass="p-3">
            <div className="space-y-0.5">
              {blocks.slice(0, 7).map((b, i) => (
                <div key={b.hash}>
                  <button
                    onClick={() => openBlock(b.number)}
                    className={`w-full text-left p-2.5 rounded-xl border transition text-[11px] grid grid-cols-12 gap-2 items-center ${
                      b.txCount ? "border-sky-500/30 bg-sky-500/5 hover:bg-sky-500/10" : "border-slate-800 bg-slate-900/40 hover:bg-slate-900"
                    }`}
                  >
                    <span className="col-span-3 font-mono font-bold text-sky-400">#{b.number}</span>
                    <span className="col-span-5 font-mono text-slate-400 truncate" title={b.hash}>
                      <Hash className="h-3 w-3 inline mr-0.5 text-slate-600" />
                      {shortHash(b.hash, 6)}
                    </span>
                    <span className={`col-span-2 text-right font-bold ${b.txCount ? "text-amber-400" : "text-slate-600"}`}>{b.txCount} tx</span>
                    <span className="col-span-2 text-right text-slate-500">{new Date(b.timestamp).toLocaleTimeString([], { minute: "2-digit", second: "2-digit" })}</span>
                  </button>
                  {i < 6 && blocks[i + 1] && (
                    <div className="flex items-center gap-1.5 pl-5 text-[9px] font-mono text-slate-600 py-0.5">
                      <ArrowDown className="h-3 w-3" /> parent {shortHash(b.parentHash, 4)} {b.parentHash === blocks[i + 1].hash ? <span className="text-emerald-600">✓</span> : <span className="text-rose-500">✗</span>}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Panel>
        </div>

        {/* Public checkpoints: private consortium, publicly auditable */}
        <Panel
          title="Public checkpoints"
          icon={Anchor}
          right={
            checkpoints?.configured ? (
              <span className="text-[10px] text-slate-500">
                anchored on {checkpoints.publicNetwork} - every {checkpoints.interval} blocks
              </span>
            ) : null
          }
        >
          {!checkpoints || !checkpoints.configured ? (
            <p className="text-xs text-slate-500">
              No public anchor deployed. Run <span className="font-mono text-slate-300">scripts/checkpoint/deploy-anchor.js</span> and the publisher to
              anchor the consortium block hashes on a public chain.
            </p>
          ) : !checkpoints.publicReachable ? (
            <div className="p-3 rounded-xl text-xs bg-amber-500/10 text-amber-300 flex gap-2">
              <Globe className="h-4 w-4 shrink-0" /> {checkpoints.error || "Public chain unreachable - verification pending."}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800">
                  <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Public network</p>
                  <p className="text-slate-200 font-semibold mt-1">{checkpoints.publicNetwork}</p>
                  <p className="text-[10px] text-slate-500 font-mono">chain {checkpoints.publicChainId}</p>
                </div>
                <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800">
                  <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Anchor contract</p>
                  <p className="text-slate-200 font-mono mt-1">{shortHash(checkpoints.address, 8)}</p>
                </div>
                <div className="p-3 rounded-xl bg-slate-900/60 border border-slate-800">
                  <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Anchored</p>
                  <p className="text-slate-200 font-semibold mt-1">{checkpoints.total} checkpoints</p>
                  <p className="text-[10px] text-slate-500">next due at #{checkpoints.nextDue}</p>
                </div>
                <div className={`p-3 rounded-xl border ${checkpoints.equivocations.length ? "bg-rose-500/10 border-rose-500/30" : "bg-emerald-500/10 border-emerald-500/20"}`}>
                  <p className="text-[10px] uppercase tracking-wider text-slate-500 font-bold">Equivocations</p>
                  <p className={`font-extrabold mt-1 ${checkpoints.equivocations.length ? "text-rose-300" : "text-emerald-300"}`}>{checkpoints.equivocations.length}</p>
                  <p className="text-[10px] text-slate-500">conflicting hashes for an anchored height</p>
                </div>
              </div>
              {checkpoints.checkpoints.length === 0 ? (
                <p className="text-xs text-slate-500">Anchor deployed - waiting for the publisher to post the first checkpoint.</p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-[10px] uppercase tracking-widest text-slate-500 border-b border-slate-800">
                        <th className="p-2 text-left">Height</th>
                        <th className="p-2 text-left">Anchored block hash</th>
                        <th className="p-2 text-left">State root</th>
                        <th className="p-2 text-left">Anchored at</th>
                        <th className="p-2 text-center">Consortium today</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {checkpoints.checkpoints.map((c) => (
                        <tr key={c.blockNumber}>
                          <td className="p-2">
                            <button className="font-mono font-bold text-sky-400 hover:underline" onClick={() => openBlock(c.blockNumber)}>
                              #{c.blockNumber}
                            </button>
                          </td>
                          <td className="p-2 font-mono text-slate-300">{shortHash(c.blockHash, 12)}</td>
                          <td className="p-2 font-mono text-slate-500">{shortHash(c.stateRoot, 8)}</td>
                          <td className="p-2 text-slate-400">{new Date(c.anchoredAt).toLocaleTimeString()}</td>
                          <td className="p-2 text-center">
                            {c.status === "match" ? (
                              <Tag accent="emerald">hash matches</Tag>
                            ) : c.status === "mismatch" ? (
                              <Tag accent="rose">history rewritten</Tag>
                            ) : (
                              <Tag accent="amber">pending</Tag>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
              {checkpoints.equivocations.map((e, i) => (
                <div key={i} className="p-3 rounded-xl border border-rose-500/40 bg-rose-500/10 text-xs text-rose-200 flex gap-2">
                  <ShieldAlert className="h-4 w-4 shrink-0" />
                  Equivocation at #{e.blockNumber}: anchored {shortHash(e.anchoredHash, 8)} but {shortHash(e.publisher, 4)} later submitted{" "}
                  {shortHash(e.conflictingHash, 8)}.
                </div>
              ))}
              <p className="text-[10px] text-slate-500">
                Anyone can audit the private consortium without joining it: compare these public anchors with the consortium blocks
                (<span className="font-mono">node scripts/checkpoint/audit.js</span>).
              </p>
            </div>
          )}
        </Panel>

        {(selected || tx) && (
          <div className="glass-panel rounded-3xl p-6 border border-sky-500/30 relative">
            <button onClick={() => { setSelected(null); setTx(null); setParams({}); }} className="absolute top-4 right-4 text-slate-500 hover:text-slate-200">
              <X className="h-5 w-5" />
            </button>
            {selected && (
              <>
                <h3 className="font-bold text-lg mb-3 flex items-center gap-2">
                  <Blocks className="h-5 w-5 text-sky-400" /> Block #{selected.number}
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs font-mono mb-4">
                  <p className="text-slate-500">hash <span className="text-slate-200 break-all">{selected.hash}</span></p>
                  <p className="text-slate-500">parent <span className="text-slate-200 break-all">{selected.parentHash}</span></p>
                  <p className="text-slate-500">stateRoot <span className="text-slate-200 break-all">{selected.stateRoot}</span></p>
                  <p className="text-slate-500">proposer <span className="text-slate-200">{selected.proposer}</span></p>
                  {selected.qbft && (
                    <p className="text-slate-500">
                      QBFT round {selected.qbft.round} · <span className="text-emerald-400">{selected.qbft.commitSeals} commit seals</span>
                    </p>
                  )}
                  <p className="text-slate-500">gas used {Number(selected.gasUsed).toLocaleString()}</p>
                </div>
                {selected.transactions.length === 0 ? (
                  <p className="text-xs text-slate-500">Empty block (QBFT keeps sealing blocks to keep finality moving).</p>
                ) : (
                  selected.transactions.map((t) => (
                    <button key={t.hash} onClick={() => setParams({ tx: t.hash })} className="block w-full text-left p-3 rounded-xl bg-slate-900/60 hover:bg-slate-900 border border-slate-800 mb-2 text-xs">
                      <span className="font-bold text-sky-400">
                        {t.contract}.{t.method || "?"}
                      </span>
                      <span className="text-slate-500 font-mono ml-2">{shortHash(t.hash, 10)}</span>
                      <span className={`ml-2 ${t.status === 1 ? "text-emerald-400" : "text-rose-400"}`}>{t.status === 1 ? "success" : "reverted"}</span>
                    </button>
                  ))
                )}
              </>
            )}
            {tx && (
              <>
                <h3 className="font-bold text-lg mb-1">
                  {tx.contract}.{tx.method}
                </h3>
                <p className="text-xs font-mono text-slate-400 break-all">{tx.hash}</p>
                <p className="text-xs text-slate-400 mt-1">
                  block{" "}
                  <button className="text-sky-400 hover:underline" onClick={() => openBlock(tx.blockNumber)}>
                    #{tx.blockNumber}
                  </button>{" "}
                  · from <span className="font-mono">{tx.from}</span> · gas {Number(tx.gasUsed).toLocaleString()} ·{" "}
                  <span className={tx.status === 1 ? "text-emerald-400" : "text-rose-400"}>{tx.status === 1 ? "success" : "reverted"}</span>
                </p>
                <div className="grid lg:grid-cols-2 gap-4 mt-3">
                  {tx.args && (
                    <div>
                      <p className="text-[10px] uppercase font-bold tracking-wider text-slate-500 mb-1">Decoded call arguments</p>
                      <pre className="p-3 bg-slate-950 rounded-xl text-[11px] text-slate-300 overflow-x-auto">{JSON.stringify(tx.args, null, 2)}</pre>
                    </div>
                  )}
                  {tx.events?.length > 0 && (
                    <div className="space-y-2">
                      <p className="text-[10px] uppercase font-bold tracking-wider text-slate-500">Emitted events</p>
                      {tx.events.map((e, i) => (
                        <div key={i} className={`p-3 rounded-xl text-xs border ${/Clone|Counterfeit|Diversion|Breach/.test(e.event) ? "border-rose-500/40 bg-rose-500/10" : "border-slate-800 bg-slate-900/50"}`}>
                          <span className={`font-bold ${/Clone|Counterfeit|Diversion|Breach/.test(e.event) ? "text-rose-300" : "text-slate-200"}`}>{e.event}</span>
                          <pre className="mt-1 text-[10px] text-slate-400 overflow-x-auto">{JSON.stringify(e.args, null, 2)}</pre>
                        </div>
                      ))}
                    </div>
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

export default Explorer;
