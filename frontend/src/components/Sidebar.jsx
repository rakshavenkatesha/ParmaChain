import React, { useContext } from "react";
import { NavLink } from "react-router-dom";
import { AuthContext } from "../context/AuthContext";
import {
  LayoutDashboard,
  PlusCircle,
  Search,
  ShieldAlert,
  Users,
  PackageOpen
} from "lucide-react";

const Sidebar = () => {
  const { user } = useContext(AuthContext);

  if (!user) return null;

  const getLinks = () => {
    switch (user.role) {
      case "Manufacturer":
        return [
          { to: "/dashboard", name: "Dashboard", icon: LayoutDashboard },
          { to: "/batches/new", name: "Register Batch", icon: PlusCircle },
          { to: "/batches", name: "Drug Inventory", icon: PackageOpen },
          { to: "/verify", name: "QR Verifier", icon: Search }
        ];
      case "Distributor":
      case "Pharmacy":
        return [
          { to: "/dashboard", name: "Dashboard", icon: LayoutDashboard },
          { to: "/batches", name: "Batch Inventory", icon: PackageOpen },
          { to: "/verify", name: "QR Verifier", icon: Search }
        ];
      case "Admin":
        return [
          { to: "/dashboard", name: "Admin Stats", icon: LayoutDashboard },
          { to: "/admin/approvals", name: "Account Approvals", icon: Users },
          { to: "/admin/anomalies", name: "Anomaly Reports", icon: ShieldAlert },
          { to: "/verify", name: "QR Verifier", icon: Search }
        ];
      default:
        return [{ to: "/verify", name: "QR Verifier", icon: Search }];
    }
  };

  const links = getLinks();

  return (
    <aside className="w-64 border-r border-slate-900 bg-slate-950 flex flex-col h-[calc(100vh-4rem)] p-4 shrink-0">
      <div className="flex-1 space-y-1">
        {links.map((link) => {
          const Icon = link.icon;
          return (
            <NavLink
              key={link.to}
              to={link.to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-4 py-3 text-xs uppercase tracking-wider font-semibold rounded-xl transition ${
                  isActive
                    ? "bg-sky-500/10 text-sky-400 border-l-2 border-sky-500"
                    : "text-slate-400 hover:bg-slate-900 hover:text-slate-200"
                }`
              }
            >
              <Icon className="h-4 w-4" />
              {link.name}
            </NavLink>
          );
        })}
      </div>
      <div className="p-4 bg-slate-900/40 rounded-2xl border border-slate-900 text-center">
        <p className="text-[10px] text-slate-500 uppercase tracking-widest font-bold">
          Network Node
        </p>
        <div className="mt-2 flex items-center justify-center gap-2">
          <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></span>
          <span className="text-xs text-slate-300 font-semibold font-mono">
            Hardhat RPC
          </span>
        </div>
      </div>
    </aside>
  );
};

export default Sidebar;
