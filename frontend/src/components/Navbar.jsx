import React, { useContext } from "react";
import { Link } from "react-router-dom";
import { AuthContext } from "../context/AuthContext";
import { Web3Context } from "../context/Web3Context";
import { LogOut, Wallet, Hexagon } from "lucide-react";
import { NetworkStatusBar } from "./networkViz";

const ROLE_COLOR = {
  Manufacturer: "text-sky-400 bg-sky-500/10 border-sky-500/20",
  Distributor: "text-violet-400 bg-violet-500/10 border-violet-500/20",
  Pharmacy: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
  Admin: "text-amber-400 bg-amber-500/10 border-amber-500/20"
};

const Navbar = () => {
  const { user, logout } = useContext(AuthContext);
  const { account, connectWallet, isConnected, wrongNetwork } = useContext(Web3Context);
  const mismatch = user && isConnected && user.ethAddress && account && user.ethAddress.toLowerCase() !== account.toLowerCase();

  return (
    <header className="sticky top-0 z-40 flex h-16 w-full items-center justify-between border-b border-slate-800/80 bg-slate-950/80 px-6 backdrop-blur-md">
      <div className="flex items-center gap-6">
        <Link to="/dashboard" className="flex items-center gap-2">
          <span className="h-8 w-8 rounded-xl bg-gradient-to-br from-sky-500 to-violet-600 flex items-center justify-center shadow-lg shadow-sky-500/20">
            <Hexagon className="h-4.5 w-4.5 text-white" strokeWidth={2.5} />
          </span>
          <span className="text-lg font-extrabold tracking-wider text-sky-400 font-sans">
            PHARMA<span className="text-slate-100">CHAIN</span>
          </span>
        </Link>
        <NetworkStatusBar />
      </div>

      <div className="flex items-center gap-3">
        {user && (
          <button
            onClick={connectWallet}
            title={mismatch ? "Connected wallet differs from the wallet registered to this login" : "Wallet"}
            className={`flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-xl transition border ${
              mismatch || wrongNetwork
                ? "bg-rose-500/10 text-rose-400 border-rose-500/30"
                : isConnected
                ? "bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border-emerald-500/20"
                : "bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border-amber-500/20"
            }`}
          >
            <Wallet className="h-3.5 w-3.5" />
            {isConnected ? `${account.slice(0, 6)}…${account.slice(-4)}${mismatch ? " (wrong account)" : wrongNetwork ? " (wrong network)" : ""}` : "Connect MetaMask"}
          </button>
        )}

        {user && (
          <div className="flex items-center gap-3 pl-3 border-l border-slate-800">
            <div className="hidden text-right md:block">
              <p className="text-sm font-semibold text-slate-200 leading-tight">{user.companyName || user.name}</p>
              <span className={`inline-block mt-0.5 px-1.5 py-px rounded border text-[9px] font-bold uppercase tracking-wider ${ROLE_COLOR[user.role]}`}>
                {user.role === "Admin" ? "Regulator" : user.role}
              </span>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-slate-800 to-slate-900 border border-slate-700 text-slate-300 font-bold text-sm">
              {(user.companyName || user.name || "?").slice(0, 1)}
            </div>
            <button
              onClick={logout}
              title="Logout"
              className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 hover:bg-red-500/10 hover:text-red-400 transition"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </header>
  );
};

export default Navbar;
