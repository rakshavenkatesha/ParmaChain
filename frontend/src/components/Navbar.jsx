import React, { useContext } from "react";
import { Link } from "react-router-dom";
import { AuthContext } from "../context/AuthContext";
import { Web3Context } from "../context/Web3Context";
import { LogOut, Wallet, User as UserIcon } from "lucide-react";

const Navbar = () => {
  const { user, logout } = useContext(AuthContext);
  const { account, connectWallet, isConnected } = useContext(Web3Context);

  return (
    <header className="sticky top-0 z-40 flex h-16 w-full items-center justify-between border-b border-slate-850 bg-slate-950/80 px-6 backdrop-blur-md">
      <div className="flex items-center gap-2">
        <Link
          to="/dashboard"
          className="text-xl font-extrabold tracking-wider text-sky-400 font-sans"
        >
          PHARMA<span className="text-slate-100">CHAIN</span>
        </Link>
      </div>

      <div className="flex items-center gap-4">
        {/* MetaMask integration indicator */}
        {user && user.role !== "Admin" && (
          <button
            onClick={connectWallet}
            className={`flex items-center gap-2 px-4 py-2 text-xs font-semibold rounded-xl transition border ${
              isConnected
                ? "bg-emerald-500/10 hover:bg-emerald-500/20 text-emerald-400 border-emerald-500/20"
                : "bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border-amber-500/20"
            }`}
          >
            <Wallet className="h-3.5 w-3.5" />
            {isConnected
              ? `${account.slice(0, 6)}...${account.slice(-4)}`
              : "Connect MetaMask"}
          </button>
        )}

        {/* Profile menu logout toggle */}
        {user && (
          <div className="flex items-center gap-3 pl-4 border-l border-slate-800">
            <div className="hidden text-right md:block">
              <p className="text-sm font-semibold text-slate-200">{user.name}</p>
              <p className="text-xs text-sky-400 font-medium">{user.role}</p>
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-slate-900 border border-slate-800 text-slate-400">
              <UserIcon className="h-4 w-4" />
            </div>
            <button
              onClick={logout}
              title="Logout"
              className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 hover:bg-red-500/10 hover:text-red-400 transition"
            >
              <LogOut className="h-4.5 w-4.5" />
            </button>
          </div>
        )}
      </div>
    </header>
  );
};

export default Navbar;
