import React from "react";
import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";

/** Shared presentational primitives used across pages. */

export const ACCENTS = {
  sky: { text: "text-sky-400", bg: "bg-sky-500/10", border: "border-sky-500/20", ring: "from-sky-500/20" },
  emerald: { text: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20", ring: "from-emerald-500/20" },
  amber: { text: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/20", ring: "from-amber-500/20" },
  rose: { text: "text-rose-400", bg: "bg-rose-500/10", border: "border-rose-500/20", ring: "from-rose-500/20" },
  violet: { text: "text-violet-400", bg: "bg-violet-500/10", border: "border-violet-500/20", ring: "from-violet-500/20" },
  slate: { text: "text-slate-300", bg: "bg-slate-500/10", border: "border-slate-500/20", ring: "from-slate-500/20" }
};

export const PageHeader = ({ crumbs = [], title, subtitle, icon: Icon, actions }) => (
  <div className="flex flex-wrap items-end justify-between gap-4">
    <div>
      {crumbs.length > 0 && (
        <nav className="flex items-center gap-1 text-[10px] uppercase tracking-widest text-slate-500 font-bold mb-2">
          {crumbs.map((c, i) => (
            <React.Fragment key={i}>
              {i > 0 && <ChevronRight className="h-3 w-3" />}
              {c.to ? (
                <Link to={c.to} className="hover:text-sky-400">
                  {c.label}
                </Link>
              ) : (
                <span className="text-slate-400">{c.label}</span>
              )}
            </React.Fragment>
          ))}
        </nav>
      )}
      <h1 className="text-2xl font-extrabold font-sans flex items-center gap-2.5">
        {Icon && (
          <span className="h-9 w-9 rounded-xl bg-gradient-to-br from-sky-500/30 to-violet-500/20 border border-sky-500/30 flex items-center justify-center">
            <Icon className="h-5 w-5 text-sky-300" />
          </span>
        )}
        {title}
      </h1>
      {subtitle && <p className="text-slate-400 text-xs mt-1.5 max-w-3xl">{subtitle}</p>}
    </div>
    {actions && <div className="flex items-center gap-2">{actions}</div>}
  </div>
);

export const Panel = ({ title, icon: Icon, right, children, className = "", bodyClass = "p-5" }) => (
  <section className={`glass-panel rounded-3xl border border-slate-900 overflow-hidden ${className}`}>
    {title && (
      <header className="flex items-center justify-between gap-4 px-5 py-3.5 border-b border-slate-800/60 bg-slate-900/30">
        <h3 className="text-sm font-bold text-slate-200 flex items-center gap-2 shrink-0">
          {Icon && <Icon className="h-4 w-4 text-sky-400" />}
          {title}
        </h3>
        {right && <div className="min-w-0 truncate text-right">{right}</div>}
      </header>
    )}
    <div className={bodyClass}>{children}</div>
  </section>
);

export const StatCard = ({ label, value, sub, icon: Icon, accent = "sky", children }) => {
  const a = ACCENTS[accent] || ACCENTS.sky;
  return (
    <div className={`relative overflow-hidden glass-panel rounded-2xl border ${a.border} p-5`}>
      <div className={`absolute -top-10 -right-10 h-28 w-28 rounded-full bg-gradient-to-br ${a.ring} to-transparent blur-2xl`} />
      <div className="flex items-start justify-between relative">
        <div>
          <p className="text-[10px] uppercase font-bold tracking-widest text-slate-500">{label}</p>
          <p className={`text-3xl font-extrabold mt-1.5 ${a.text}`}>{value}</p>
          {sub && <p className="text-[10px] text-slate-500 mt-1">{sub}</p>}
        </div>
        {Icon && (
          <div className={`h-10 w-10 rounded-xl ${a.bg} border ${a.border} flex items-center justify-center`}>
            <Icon className={`h-5 w-5 ${a.text}`} />
          </div>
        )}
      </div>
      {children && <div className="relative mt-3">{children}</div>}
    </div>
  );
};

export const Pill = ({ children, accent = "slate", className = "" }) => {
  const a = ACCENTS[accent] || ACCENTS.slate;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider border ${a.bg} ${a.text} ${a.border} ${className}`}>
      {children}
    </span>
  );
};

export const Spinner = () => (
  <div className="flex justify-center py-12">
    <div className="h-8 w-8 animate-spin rounded-full border-2 border-sky-500 border-t-transparent" />
  </div>
);

export const EmptyState = ({ icon: Icon, title, text }) => (
  <div className="text-center py-10">
    {Icon && <Icon className="h-10 w-10 text-slate-700 mx-auto" />}
    <p className="text-sm font-semibold text-slate-400 mt-3">{title}</p>
    {text && <p className="text-xs text-slate-600 mt-1">{text}</p>}
  </div>
);

/** Colour palette for shipments within one lot lineage. */
export const SHIPMENT_COLORS = ["#38bdf8", "#a78bfa", "#34d399", "#fbbf24", "#f472b6", "#22d3ee", "#a3e635", "#fb923c"];
