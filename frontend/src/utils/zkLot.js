/**
 * Private (zero-knowledge) lots - manufacturer side.
 * Mirrors blockchain/scripts/zk/zkTree.js (same constants and hashing; keep in sync).
 *
 *   lotTag = uint256(keccak256(batchId)) mod BN254 field
 *   leaf_i = Poseidon(lotTag, i, uint80 scratchCode_i)
 *   tree   = fixed depth 12 (4096 packs), positional, empty leaves = 0
 */
import axios from "axios";
import { keccak256, toUtf8Bytes } from "ethers";
import { poseidon2, poseidon3 } from "poseidon-lite";

export const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
export const DEPTH = 12;
export const MAX_PRIVATE_UNITS = 2 ** DEPTH;

const ZEROS = [0n];
for (let l = 0; l < DEPTH; l++) ZEROS.push(poseidon2([ZEROS[l], ZEROS[l]]));

export const lotTagOf = (batchId) => BigInt(keccak256(toUtf8Bytes(batchId))) % FIELD;
export const toBytes32 = (x) => "0x" + BigInt(x).toString(16).padStart(64, "0");
export const nullifierOf = (lotTag, hiddenCode) => poseidon3([BigInt(lotTag), BigInt(hiddenCode), 1n]);

function rootOf(leaves) {
  let layer = leaves;
  for (let l = 0; l < DEPTH; l++) {
    const next = [];
    for (let i = 0; i < Math.ceil(layer.length / 2); i++) next.push(poseidon2([layer[2 * i] ?? ZEROS[l], layer[2 * i + 1] ?? ZEROS[l]]));
    layer = next;
  }
  return layer.length ? layer[0] : ZEROS[DEPTH];
}

/**
 * @param batchId  production lot id
 * @param labels   lib v2 labels [{ hiddenCode, ... }] (index = position)
 * @param lotSize  number of packs
 * @returns {{ zkRoot: string, root: string, lotTag: string, leaves: string[] }}
 */
export async function buildZkLot(batchId, labels, lotSize = labels.length) {
  if (lotSize > MAX_PRIVATE_UNITS) throw new Error(`Private lots hold at most ${MAX_PRIVATE_UNITS} packs`);
  const lotTag = lotTagOf(batchId);
  const leaves = [];
  for (let i = 0; i < lotSize; i++) {
    leaves.push(poseidon3([lotTag, BigInt(i), BigInt(labels[i].hiddenCode)]));
    if (i % 512 === 511) await new Promise((r) => setTimeout(r, 0)); // keep the UI responsive
  }
  const root = rootOf(leaves);
  return { zkRoot: toBytes32(root), root: root.toString(), lotTag: lotTag.toString(), leaves: leaves.map(String) };
}

/** Uploads the (public) Poseidon leaves so pharmacies can obtain Merkle paths for proving. */
export async function publishZkLot(batchId, zkLot) {
  const r = await axios.post(`/api/zk/${encodeURIComponent(batchId)}/leaves`, { leaves: zkLot.leaves });
  return r.data;
}
