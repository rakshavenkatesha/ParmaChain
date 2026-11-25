import axios from "axios";
import { keccak256, AbiCoder } from "ethers";

export const STATUS_NAMES = ["None", "Manufactured", "In Transit", "Received", "Depleted", "Quarantined", "Recalled"];
export const ROLE_IDS = { Manufacturer: 1, Distributor: 2, Pharmacy: 3, Regulator: 4, Oracle: 5 };
export const DISPENSE_RESULTS = [
  { key: "Dispensed", tone: "ok", title: "Unit dispensed", text: "Genuine unit. Its bit is now set on-chain - this label can never be dispensed again." },
  { key: "InvalidProof", tone: "bad", title: "FORGED OR COPIED LABEL", text: "Either the label was never issued by the manufacturer, or the scratch code does not belong to this pack (e.g. a photocopy of the visible QR). The genuine pack can still be dispensed. Evidence recorded on-chain." },
  { key: "AlreadyDispensed", tone: "bad", title: "CLONED LABEL", text: "This genuine unit was already dispensed. The physical label has been copied. Evidence recorded on-chain." },
  { key: "Diverted", tone: "warn", title: "DIVERTED UNIT", text: "Genuine unit, but it belongs to a shipment this pharmacy never received. Evidence recorded on-chain." }
];

/** Batch IDs must be URL-safe because they appear in routes and QR URLs. */
export const BATCH_ID_PATTERN = /^[A-Za-z0-9_-]{3,40}$/;

export const statusBadge = (status) =>
  ({
    Manufactured: "bg-sky-500/10 text-sky-400 border-sky-500/20",
    "In Transit": "bg-amber-500/10 text-amber-400 border-amber-500/20",
    Received: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
    Depleted: "bg-slate-500/10 text-slate-400 border-slate-500/20",
    Quarantined: "bg-orange-500/10 text-orange-400 border-orange-500/20",
    Recalled: "bg-rose-500/10 text-rose-400 border-rose-500/20"
  })[status] || "bg-slate-500/10 text-slate-400 border-slate-500/20";

/** After tx.wait(): block until the backend indexer has mirrored that block. */
export async function waitForIndexer(receipt) {
  try {
    await axios.get(`/api/batches/sync/${receipt.blockNumber}`);
  } catch {
    /* indexer will catch up on its own */
  }
}

/**
 * Label secrets are derived from a signature only the manufacturer's wallet can produce.
 * ECDSA signatures in Ethereum wallets are deterministic (RFC 6979), so the same labels can be
 * re-printed at any time and no secret ever has to be stored anywhere.
 */
export const labelSeedMessage = (batchId) => `PharmaChain unit-label seed v1\nBatch: ${batchId}`;

export async function deriveLabelSeed(signer, batchId) {
  const sig = await signer.signMessage(labelSeedMessage(batchId));
  return keccak256(sig);
}

/**
 * Base URL printed into QR codes. When the app is opened on this laptop as "localhost", labels must
 * still point at the LAN address (e.g. http://192.168.x.x:3000) so any phone on the same Wi-Fi can
 * open them. When opened from another device, its own origin is already reachable.
 */
export function publicOrigin() {
  const local = ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);
  return local && import.meta.env.VITE_PUBLIC_ORIGIN ? import.meta.env.VITE_PUBLIC_ORIGIN : window.location.origin;
}

/** Visible QR of a two-part label: lot, unit index and the public tag (never the scratch code). */
export function labelUrl(batchId, index, publicTag) {
  return `${publicOrigin()}/verify?b=${encodeURIComponent(batchId)}&i=${index}&p=${publicTag}`;
}

/** Aggregate (case / carton) label payload used for one-scan receipt. */
export function aggregateLabel(batchId, level, index) {
  return `${publicOrigin()}/verify?b=${encodeURIComponent(batchId)}&${level === 2 ? "case" : "carton"}=${index}`;
}

/** Scratch code format: 16 Crockford base32 characters. */
export const SCRATCH_CODE_PATTERN = /^[0-9A-Za-z]{4}-?[0-9A-Za-z]{4}-?[0-9A-Za-z]{4}-?[0-9A-Za-z]{4}$/;

/** A line from a scanner / paste: "<visible label link> <SCRATCH-CODE>" */
export function parseLabelLine(line) {
  const parts = (line || "").trim().split(/\s+/);
  const code = parts.find((x) => SCRATCH_CODE_PATTERN.test(x));
  const link = parts.find((x) => x !== code);
  const label = parseLabel(link || "");
  return label ? { ...label, code: code || null } : null;
}

/** Parses a unit label (URL from the QR code, or "batch|index|secret"). */
export function parseLabel(text) {
  const t = (text || "").trim();
  try {
    const u = new URL(t);
    const b = u.searchParams.get("b");
    const i = u.searchParams.get("i");
    const p = u.searchParams.get("p") || u.searchParams.get("s");
    if (b && i !== null) return { batchId: b, index: Number(i), publicTag: p };
    if (b || u.searchParams.get("batchId")) return { batchId: b || u.searchParams.get("batchId") };
  } catch {
    /* not a URL */
  }
  const parts = t.split("|");
  if (parts.length === 3) return { batchId: parts[0], index: Number(parts[1]), publicTag: parts[2] };
  return t ? { batchId: t } : null;
}

export const isBytes32 = (s) => /^0x[0-9a-fA-F]{64}$/.test(s || "");

export const shortHash = (h, n = 6) => (h ? `${h.slice(0, n + 2)}…${h.slice(-4)}` : "");

export const toDeci = (celsius) => Math.round(Number(celsius) * 10);

export const coder = AbiCoder.defaultAbiCoder();

export function errorMessage(err) {
  // ethers wraps wallet errors it cannot parse as "could not coalesce error"; the original
  // MetaMask / node message is nested inside, so dig it out.
  const nested =
    err?.error?.data?.message ||
    err?.error?.message ||
    err?.info?.error?.data?.message ||
    err?.info?.error?.message ||
    err?.data?.message;
  const raw = err?.reason || (err?.shortMessage && !/coalesce/i.test(err.shortMessage) ? err.shortMessage : null) || nested || err?.response?.data?.message || err?.message || "Unknown error";
  if (/nonce/i.test(raw)) {
    return `${raw} - MetaMask's transaction counter is out of sync with this chain (it was reset). In MetaMask: Settings → Advanced → Clear activity tab data, then retry.`;
  }
  if (/chain ?id|network/i.test(raw) && /mismatch|wrong|invalid/i.test(raw)) {
    return `${raw} - switch MetaMask to the PharmaChain network.`;
  }
  return raw;
}
