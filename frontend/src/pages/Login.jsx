import React, { useState, useContext, useEffect } from "react";
import { Link, useNavigate } from "react-router-dom";
import axios from "axios";
import { AuthContext } from "../context/AuthContext";
import { KeyRound, Mail, Hexagon, Fingerprint, Copy, Network, ScanLine, Blocks, Factory, Truck, Store, Landmark } from "lucide-react";

const DEMO = [
  { label: "Manufacturer", email: "manufacturer@pharma.com", password: "manufacturer123", icon: Factory, color: "text-sky-400" },
  { label: "Distributor", email: "distributor@pharma.com", password: "distributor123", icon: Truck, color: "text-violet-400" },
  { label: "Pharmacy", email: "pharmacy@pharma.com", password: "pharmacy123", icon: Store, color: "text-emerald-400" },
  { label: "Regulator", email: "admin@pharma.com", password: "admin123", icon: Landmark, color: "text-amber-400" }
];

const FEATURES = [
  { icon: Fingerprint, title: "Unit-level serialisation", text: "Every pack carries a one-time secret committed in a Merkle root on-chain." },
  { icon: Copy, title: "Deterministic clone detection", text: "A copied label is caught the second time it is dispensed - recorded as on-chain evidence." },
  { icon: Network, title: "QBFT consortium network", text: "Four Besu validators, custom genesis block, tolerates one faulty node." },
  { icon: ScanLine, title: "Wallet-free verification", text: "Patients scan a pack and the smart contract answers - free, no login." }
];

const Login = () => {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [net, setNet] = useState(null);

  const { login } = useContext(AuthContext);
  const navigate = useNavigate();

  useEffect(() => {
    axios
      .get("/api/chain/overview")
      .then((r) => setNet(r.data.data))
      .catch(() => {});
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!email || !password) return setError("Please fill in all fields.");
    setLoading(true);
    setError("");
    const res = await login(email, password);
    setLoading(false);
    if (res.success) navigate("/dashboard");
    else setError(res.message);
  };

  return (
    <div className="min-h-screen grid lg:grid-cols-2 text-slate-200">
      {/* Hero */}
      <div className="relative hidden lg:flex flex-col justify-between p-12 overflow-hidden border-r border-slate-800 bg-grid">
        <div className="absolute -top-32 -left-32 h-96 w-96 rounded-full bg-sky-500/20 blur-3xl" />
        <div className="absolute -bottom-40 right-0 h-96 w-96 rounded-full bg-violet-600/20 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <span className="h-11 w-11 rounded-2xl bg-gradient-to-br from-sky-500 to-violet-600 flex items-center justify-center shadow-lg shadow-sky-500/30">
            <Hexagon className="h-6 w-6 text-white" strokeWidth={2.5} />
          </span>
          <span className="text-2xl font-extrabold tracking-wider text-sky-400">
            PHARMA<span className="text-slate-100">CHAIN</span>
          </span>
        </div>

        <div className="relative space-y-8">
          <div>
            <h1 className="text-4xl font-extrabold leading-tight">
              Clone-resistant <span className="text-gradient">medicine traceability</span> on a permissioned blockchain
            </h1>
            <p className="text-slate-400 mt-4 max-w-lg">
              Track every individual pack from factory to patient. Counterfeit, cloned and diverted packs are detected by smart contracts - not by guesswork.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-4 max-w-xl">
            {FEATURES.map((f) => (
              <div key={f.title} className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 backdrop-blur">
                <f.icon className="h-5 w-5 text-sky-400" />
                <p className="text-sm font-bold mt-2">{f.title}</p>
                <p className="text-xs text-slate-500 mt-1">{f.text}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="relative flex flex-wrap items-center gap-6 text-xs">
          {net ? (
            <>
              <span className="flex items-center gap-2 text-emerald-400 font-semibold">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" /> Network live
              </span>
              <span className="text-slate-400">
                chain <b className="text-slate-200">{net.chainId}</b>
              </span>
              <span className="text-slate-400">
                block <b className="text-slate-200 font-mono">#{net.latestBlock.toLocaleString()}</b>
              </span>
              <span className="text-slate-400">
                <b className="text-slate-200">{net.validators.length || 1}</b> validator{net.validators.length === 1 ? "" : "s"}
              </span>
              <Link to="/explorer" className="flex items-center gap-1 text-sky-400 hover:underline">
                <Blocks className="h-3.5 w-3.5" /> Explorer
              </Link>
            </>
          ) : (
            <span className="text-slate-500">Connecting to the network…</span>
          )}
        </div>
      </div>

      {/* Form */}
      <div className="flex flex-col justify-center px-6 py-12 sm:px-16">
        <div className="w-full max-w-md mx-auto">
          <h2 className="text-3xl font-extrabold">Sign in</h2>
          <p className="text-sm text-slate-400 mt-1.5">
            Consortium members only.{" "}
            <Link to="/verify" className="text-sky-400 hover:underline">
              Verifying a pack? No login needed →
            </Link>
          </p>

          <form className="mt-8 space-y-5" onSubmit={handleSubmit}>
            {error && <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 rounded-xl text-xs font-semibold">{error}</div>}
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Email</label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 h-4 w-4" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full pl-11 pr-4 py-3 bg-slate-900 border border-slate-800 rounded-xl text-sm focus:outline-none focus:border-sky-500"
                  placeholder="you@company.com"
                />
              </div>
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Password</label>
              <div className="relative">
                <KeyRound className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-500 h-4 w-4" />
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full pl-11 pr-4 py-3 bg-slate-900 border border-slate-800 rounded-xl text-sm focus:outline-none focus:border-sky-500"
                  placeholder="••••••••"
                />
              </div>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="w-full py-3.5 bg-gradient-to-r from-sky-500 to-violet-500 hover:opacity-90 disabled:opacity-50 text-slate-950 font-bold rounded-xl shadow-lg shadow-sky-500/20 transition"
            >
              {loading ? "Signing in..." : "Sign in"}
            </button>
          </form>

          <div className="mt-8">
            <p className="text-[10px] uppercase tracking-[0.2em] font-bold text-slate-600 mb-3">Demo consortium members</p>
            <div className="grid grid-cols-2 gap-2">
              {DEMO.map((d) => (
                <button
                  key={d.email}
                  type="button"
                  onClick={() => {
                    setEmail(d.email);
                    setPassword(d.password);
                  }}
                  className="flex items-center gap-2 p-3 rounded-xl bg-slate-900/60 border border-slate-800 hover:border-sky-500/40 text-left transition"
                >
                  <d.icon className={`h-4 w-4 ${d.color}`} />
                  <span>
                    <span className="block text-xs font-bold">{d.label}</span>
                    <span className="block text-[10px] text-slate-500 truncate">{d.email}</span>
                  </span>
                </button>
              ))}
            </div>
          </div>

          <p className="text-xs text-slate-500 mt-8 text-center">
            New organisation?{" "}
            <Link to="/register" className="text-sky-400 hover:underline">
              Apply for admission
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
};

export default Login;
