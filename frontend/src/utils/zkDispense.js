/**
 * Private (zero-knowledge) dispensing - pharmacy side, proven in the browser with snarkjs.
 *
 * The proof shows "I hold the scratch code of SOME pack of this lot inside my shipment's unit
 * range" without revealing which pack. Only the nullifier Poseidon(lotTag, code, 1) goes on-chain.
 * Prover artefacts are served from /zk/ (frontend/public/zk, produced by blockchain/scripts/zk/build.js).
 */
import axios from "axios";
import { ethers } from "ethers";
import * as snarkjs from "snarkjs";
import { nullifierOf, toBytes32, lotTagOf } from "./zkLot";

export const zkAvailable = true;
const WASM = "/zk/private_dispense.wasm";
const ZKEY = "/zk/private_dispense.zkey";

export const privateDispenserConfigured = (details) => !!(details && details.privateDispenser && details.privateDispenser.address);

/**
 * @param {{ signer, details, holdingBatchId, lotBatchId, index, hiddenCode }} args
 *   hiddenCode: bytes10 hex of the scratch code (lib v2 decodeCode)
 * @returns {{ outcome: "Dispensed"|"Clone", txHash, blockNumber, nullifier, provingMs }}
 */
export async function privateDispense({ signer, details, holdingBatchId, index, hiddenCode }) {
  if (!privateDispenserConfigured(details)) throw new Error("The private dispensing module is not deployed on this network");

  // 1. Merkle path from the (untrusted) proof server; a wrong path just produces a failing proof
  const { data } = await axios.get(`/api/zk/${encodeURIComponent(holdingBatchId)}/path/${index}`);
  const p = data.data;
  const hidden = BigInt(hiddenCode);
  const input = {
    root: p.root,
    nullifierHash: nullifierOf(p.lotTag, hidden).toString(),
    rangeStart: String(p.shipment.unitStart),
    rangeEnd: String(p.shipment.unitEnd),
    lotTag: p.lotTag,
    index: String(index),
    hidden: hidden.toString(),
    pathElements: p.pathElements
  };

  // 2. Groth16 proof in the browser (the scratch code never leaves the device)
  const t0 = performance.now();
  let proof;
  try {
    ({ proof } = await snarkjs.groth16.fullProve(input, WASM, ZKEY));
  } catch {
    throw new Error("Could not build a proof: the scratch code is not part of this lot, or the pack is not in your shipment's range.");
  }
  const provingMs = Math.round(performance.now() - t0);
  const a = [proof.pi_a[0], proof.pi_a[1]];
  const b = [
    [proof.pi_b[0][1], proof.pi_b[0][0]],
    [proof.pi_b[1][1], proof.pi_b[1][0]]
  ];
  const c = [proof.pi_c[0], proof.pi_c[1]];
  const nullifier = toBytes32(input.nullifierHash);

  // 3. submit; a spent nullifier is recorded as clone evidence (returns false, no revert)
  const dispenser = new ethers.Contract(details.privateDispenser.address, details.privateDispenser.abi, signer);
  const fresh = await dispenser.dispense.staticCall(holdingBatchId, a, b, c, nullifier);
  const tx = await dispenser.dispense(holdingBatchId, a, b, c, nullifier);
  const receipt = await tx.wait();
  return { outcome: fresh ? "Dispensed" : "Clone", txHash: receipt.hash, blockNumber: receipt.blockNumber, nullifier, provingMs };
}

/** Consumer/pharmacist check after scratching: has this pack's one-time tag been spent? */
export async function isPackSpent(lotBatchId, hiddenCode) {
  const n = toBytes32(nullifierOf(lotTagOf(lotBatchId), BigInt(hiddenCode)));
  const r = await axios.get(`/api/zk/nullifier/${n}`);
  return r.data.data.spent;
}
