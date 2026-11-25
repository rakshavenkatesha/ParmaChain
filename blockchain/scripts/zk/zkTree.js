/**
 * Poseidon Merkle tree for private (ZK) lots - CommonJS.
 * KEEP IN SYNC WITH frontend/src/utils/zkLot.js and backend/src/routes/zk.js (same constants).
 *
 *   lotTag   = uint256(originKey) mod BN254 field
 *   leaf_i   = Poseidon(lotTag, i, hiddenField_i)      hiddenField = uint80 scratch code
 *   nullifier= Poseidon(lotTag, hiddenField, 1)
 *   tree     : fixed depth DEPTH, positional (index bits = path), empty leaves = 0
 */
const { poseidon2, poseidon3 } = require("poseidon-lite");

const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
const DEPTH = 12;

const ZEROS = [0n];
for (let l = 0; l < DEPTH; l++) ZEROS.push(poseidon2([ZEROS[l], ZEROS[l]]));

const lotTagOf = (originKey) => BigInt(originKey) % FIELD;
const hiddenField = (hiddenCode) => BigInt(hiddenCode);
const zkLeaf = (lotTag, index, hidden) => poseidon3([lotTag, BigInt(index), hidden]);
const nullifierOf = (lotTag, hidden) => poseidon3([lotTag, hidden, 1n]);
const toBytes32 = (x) => "0x" + BigInt(x).toString(16).padStart(64, "0");

/** Sparse layers: layers[l][i] (missing => ZEROS[l]). */
function buildTree(leaves) {
  if (leaves.length > 2 ** DEPTH) throw new Error(`Private lots hold at most ${2 ** DEPTH} units`);
  const layers = [leaves.map(BigInt)];
  for (let l = 0; l < DEPTH; l++) {
    const prev = layers[l];
    const next = [];
    for (let i = 0; i < Math.ceil(prev.length / 2); i++) {
      const left = prev[2 * i] ?? ZEROS[l];
      const right = prev[2 * i + 1] ?? ZEROS[l];
      next.push(poseidon2([left, right]));
    }
    layers.push(next);
  }
  const root = layers[DEPTH].length ? layers[DEPTH][0] : ZEROS[DEPTH];
  return { layers, root };
}

function pathOf(layers, index) {
  const path = [];
  let idx = index;
  for (let l = 0; l < DEPTH; l++) {
    const sib = idx ^ 1;
    path.push(layers[l][sib] ?? ZEROS[l]);
    idx >>= 1;
  }
  return path;
}

/** Build the private tree of a lot from its scratch codes (lib v2 labels). */
function buildZkLot(originKey, hiddenCodes) {
  const lotTag = lotTagOf(originKey);
  const leaves = hiddenCodes.map((h, i) => zkLeaf(lotTag, i, hiddenField(h)));
  const { layers, root } = buildTree(leaves);
  return { lotTag, leaves, layers, root, zkRoot: toBytes32(root) };
}

/** Circuit input for dispensing unit `index` from a shipment holding [rangeStart, rangeEnd). */
function proofInput({ root, lotTag, index, hiddenCode, path, rangeStart, rangeEnd }) {
  const hidden = hiddenField(hiddenCode);
  return {
    root: root.toString(),
    nullifierHash: nullifierOf(lotTag, hidden).toString(),
    rangeStart: String(rangeStart),
    rangeEnd: String(rangeEnd),
    lotTag: lotTag.toString(),
    index: String(index),
    hidden: hidden.toString(),
    pathElements: path.map(String)
  };
}

/** snarkjs proof -> Solidity calldata (note the swapped G2 coordinates). */
function solidityProof(proof) {
  return {
    a: [proof.pi_a[0], proof.pi_a[1]],
    b: [
      [proof.pi_b[0][1], proof.pi_b[0][0]],
      [proof.pi_b[1][1], proof.pi_b[1][0]]
    ],
    c: [proof.pi_c[0], proof.pi_c[1]]
  };
}

module.exports = { FIELD, DEPTH, ZEROS, lotTagOf, hiddenField, zkLeaf, nullifierOf, toBytes32, buildTree, pathOf, buildZkLot, proofInput, solidityProof };
