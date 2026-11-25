import React, { useEffect, useState } from "react";
import axios from "axios";
import { MapPin, LocateFixed, ShieldAlert, Plane, Route as RouteIcon } from "lucide-react";
import { Panel, Pill } from "./ui";
import { CITIES, findCity, nearestCity } from "../utils/cities";

const FLAG_ICON = { "Impossible Travel": Plane, "Out-of-Region Sale": RouteIcon };

/**
 * Public verify page: "Where did you buy / scan this pack?"
 * Sends a COARSE location (city centre; browser geolocation is snapped to the nearest listed city)
 * to /api/scans, which re-verifies the label on-chain and runs the impossible-travel and
 * out-of-region detectors.
 */
const ScanLocation = ({ batchId, index, publicTag, authentic }) => {
  const [city, setCity] = useState("");
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(null);
  const [history, setHistory] = useState([]);

  const enabled = batchId && Number.isInteger(index) && /^0x[0-9a-fA-F]{64}$/.test(publicTag || "");

  useEffect(() => {
    if (!enabled) return;
    axios
      .get(`/api/scans/${encodeURIComponent(batchId)}/${index}`)
      .then((r) => setHistory(r.data.data.history))
      .catch(() => {});
  }, [batchId, index, enabled]);

  if (!enabled || authentic === false) return null;

  const locate = () => {
    setError("");
    if (!navigator.geolocation) return setError("Location is not available in this browser - pick your city instead.");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const c = nearestCity(pos.coords.latitude, pos.coords.longitude);
        if (c) setCity(c.city);
      },
      () => setError("Location permission denied - pick your city instead."),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 }
    );
  };

  const submit = async () => {
    const c = findCity(city);
    if (!c) return setError("Pick the city where you bought or scanned the pack.");
    setBusy(true);
    setError("");
    try {
      const r = await axios.post("/api/scans", { batchId, index, publicTag, city: c.city, lat: c.lat, lon: c.lon, accuracyKm: 25 });
      setSubmitted(r.data);
      setHistory(r.data.history);
    } catch (e) {
      setError(e.response?.data?.message || e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="Where did you buy or scan this pack?" icon={MapPin} right={<span className="text-[10px] text-slate-500">optional · city-level only</span>}>
      <div className="space-y-4">
        {!submitted && (
          <>
            <div className="flex flex-col sm:flex-row gap-2">
              <select
                value={city}
                onChange={(e) => setCity(e.target.value)}
                className="flex-1 px-4 py-3 bg-slate-900 border border-slate-800 rounded-xl text-sm text-slate-200 focus:outline-none focus:border-sky-500"
              >
                <option value="">Select city…</option>
                {CITIES.map((c) => (
                  <option key={c.city} value={c.city}>
                    {c.city}
                  </option>
                ))}
              </select>
              <button onClick={locate} type="button" className="flex items-center justify-center gap-2 px-4 py-3 bg-slate-900 border border-slate-800 hover:border-sky-500/40 rounded-xl text-xs font-semibold text-slate-300">
                <LocateFixed className="h-4 w-4 text-sky-400" /> Use my location
              </button>
            </div>
            <label className="flex items-start gap-2 text-[11px] text-slate-400">
              <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5" />
              I agree to share the city of this scan. Only the city is stored (never your exact position or identity). It helps the
              regulator spot copied labels that appear in two places at once, and packs sold far from where they were dispensed.
            </label>
            <button
              onClick={submit}
              disabled={busy || !consent || !city}
              className="w-full py-3 bg-sky-500 hover:bg-sky-600 disabled:bg-sky-500/30 text-slate-950 font-bold rounded-xl text-xs uppercase tracking-wider"
            >
              {busy ? "Checking…" : "Report scan location"}
            </button>
          </>
        )}

        {error && <p className="text-xs text-rose-400">{error}</p>}

        {submitted && (
          submitted.flags.length === 0 ? (
            <div className="p-3 rounded-xl border border-emerald-500/30 bg-emerald-500/10 text-xs text-emerald-300">
              Thanks - your scan in <b>{city}</b> is consistent with this pack's history.
            </div>
          ) : (
            <div className="space-y-2">
              {submitted.flags.map((f, i) => {
                const Icon = FLAG_ICON[f.type] || ShieldAlert;
                return (
                  <div key={i} className="p-3 rounded-xl border border-rose-500/40 bg-rose-500/10 text-xs">
                    <div className="flex items-center gap-2 text-rose-300 font-bold">
                      <Icon className="h-4 w-4" /> {f.type}
                      <Pill accent={f.severity === "High" ? "rose" : "amber"}>{f.severity}</Pill>
                    </div>
                    <p className="text-slate-300 mt-1">{f.description}</p>
                    <p className="text-slate-500 mt-1">The regulator has been alerted. Do not use this pack until it is checked.</p>
                  </div>
                );
              })}
            </div>
          )
        )}

        {history.length > 0 && (
          <div>
            <p className="text-[10px] uppercase tracking-widest font-bold text-slate-500 mb-2">Scan history of this pack</p>
            <ol className="space-y-1.5">
              {history.map((h, i) => (
                <li key={i} className="flex items-center justify-between text-xs p-2 rounded-lg bg-slate-900/60 border border-slate-800">
                  <span className="flex items-center gap-2 text-slate-300">
                    <MapPin className="h-3.5 w-3.5 text-sky-400" /> {h.city || "Unknown city"}
                  </span>
                  <span className="flex items-center gap-2">
                    {h.flags?.map((f) => (
                      <Pill key={f} accent="rose">
                        {f}
                      </Pill>
                    ))}
                    {!h.authentic && <Pill accent="rose">invalid label</Pill>}
                    <span className="text-slate-500">{new Date(h.at).toLocaleString()}</span>
                  </span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </Panel>
  );
};

export default ScanLocation;
