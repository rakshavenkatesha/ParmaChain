import React, { useContext } from "react";
import { NavLink } from "react-router-dom";
import { AuthContext } from "../context/AuthContext";
import { Web3Context } from "../context/Web3Context";
import { LayoutDashboard, PlusCircle, ScanLine, ShieldAlert, Users, PackageOpen, Blocks, Fingerprint, Server, Landmark, Undo2 } from "lucide-react";

const SECTIONS = {
  Manufacturer: [
    { title: "Operations", links: [
      { to: "/dashboard", name: "Dashboard", icon: LayoutDashboard },
      { to: "/batches/new", name: "Register Lot", icon: PlusCircle },
      { to: "/batches", name: "Inventory", icon: PackageOpen }
    ] }
  ],
  Distributor: [
    { title: "Operations", links: [
      { to: "/dashboard", name: "Dashboard", icon: LayoutDashboard },
      { to: "/batches", name: "Shipments", icon: PackageOpen }
    ] }
  ],
  Pharmacy: [
    { title: "Operations", links: [
      { to: "/dashboard", name: "Dashboard", icon: LayoutDashboard },
      { to: "/batches", name: "Shelf Stock", icon: PackageOpen }
    ] }
  ],
  Admin: [
    { title: "Regulator", links: [
      { to: "/dashboard", name: "Network Overview", icon: LayoutDashboard },
      { to: "/admin/approvals", name: "Admissions", icon: Users },
      { to: "/admin/anomalies", name: "Evidence Feed", icon: ShieldAlert },
      { to: "/admin/governance", name: "Governance", icon: Landmark },
      { to: "/admin/returns", name: "Returns", icon: Undo2 }
    ] }
  ]
};

const COMMON = {
  title: "Ledger",
  links: [
    { to: "/explorer", name: "Ledger Explorer", icon: Blocks },
    { to: "/verify", name: "Verify a Pack", icon: ScanLine }
  ]
};

const Sidebar = () => {
  const { user } = useContext(AuthContext);
  const { networkName, chainId, details, account } = useContext(Web3Context);
  if (!user) return null;

  const sections = [...(SECTIONS[user.role] || []), COMMON];

  return (
    <aside className="w-64 border-r border-slate-800/80 bg-slate-950/70 flex flex-col h-[calc(100vh-4rem)] p-4 shrink-0 backdrop-blur">
      <div className="flex-1 space-y-6 overflow-y-auto">
        {sections.map((sec) => (
          <div key={sec.title}>
            <p className="px-4 mb-2 text-[9px] uppercase tracking-[0.2em] font-bold text-slate-600">{sec.title}</p>
            <div className="space-y-1">
              {sec.links.map((link) => {
                const Icon = link.icon;
                return (
                  <NavLink
                    key={link.to}
                    to={link.to}
                    end
                    className={({ isActive }) =>
                      `flex items-center gap-3 px-4 py-2.5 text-xs font-semibold rounded-xl transition ${
                        isActive
                          ? "bg-gradient-to-r from-sky-500/15 to-transparent text-sky-300 border-l-2 border-sky-400"
                          : "text-slate-400 hover:bg-slate-900 hover:text-slate-200 border-l-2 border-transparent"
                      }`
                    }
                  >
                    <Icon className="h-4 w-4" />
                    {link.name}
                  </NavLink>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="space-y-3">
        <div className="p-3.5 bg-slate-900/60 rounded-2xl border border-slate-800">
          <p className="text-[9px] text-slate-500 uppercase tracking-[0.2em] font-bold flex items-center gap-1.5">
            <Fingerprint className="h-3 w-3" /> On-chain identity
          </p>
          <p className="text-[10px] font-mono text-slate-300 mt-1.5 break-all">{user.ethAddress || "no wallet"}</p>
          {account && user.ethAddress && account.toLowerCase() !== user.ethAddress.toLowerCase() && (
            <p className="text-[10px] text-rose-400 mt-1">MetaMask is on a different account</p>
          )}
        </div>
        <div className="p-3.5 bg-slate-900/60 rounded-2xl border border-slate-800">
          <p className="text-[9px] text-slate-500 uppercase tracking-[0.2em] font-bold flex items-center gap-1.5">
            <Server className="h-3 w-3" /> Network
          </p>
          <div className="mt-1.5 flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs text-slate-200 font-semibold">{networkName}</span>
          </div>
          <p className="text-[10px] text-slate-500 font-mono mt-1">chainId {chainId}</p>
          {details && <p className="text-[10px] text-slate-600 font-mono truncate">contract {details.pharmaChain.address.slice(0, 12)}…</p>}
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
