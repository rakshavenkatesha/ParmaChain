/**
 * PharmaChain label & Merkle library v2 (ES module build).
 *
 * KEEP IN SYNC WITH:  backend/src/utils/unitMerkle.js (copy)  and  frontend/src/utils/unitMerkle.js (ESM copy)
 *
 * Two-part labels
 *   visible QR  : (lot, index, publicTag)                      - anyone can check the pack
 *   scratch-off : hiddenCode (10 random bytes = 16 base32 chars) - needed to dispense
 *   commitment  = keccak256(abi.encode(originKey, index, bytes10 hiddenCode))        (public)
 *   pack leaf   = keccak256(keccak256(abi.encode(originKey, index, publicTag, commitment)))
 *
 * Packaging hierarchy (matches PharmaChain.sol)
 *   carton tree : full binary tree over packsPerCarton pack leaves (power of two, zero padded)
 *   carton leaf = keccak256(keccak256(abi.encode(originKey, uint8 1, cartonIndex, cartonRoot)))
 *   case tree   : Merkle tree over cartonsPerCase carton leaves
 *   case leaf   = keccak256(keccak256(abi.encode(originKey, uint8 2, caseIndex, caseRoot)))
 *   lot root    : Merkle tree over case leaves
 * Internal nodes use sorted-pair hashing (OpenZeppelin MerkleProof); an odd node is promoted.
 */
import { keccak256, toUtf8Bytes, AbiCoder, concat, hexlify, randomBytes, dataSlice, getBytes, ZeroHash } from "ethers";

const coder = AbiCoder.defaultAbiCoder();
export const LEVEL_CARTON = 1;
export const LEVEL_CASE = 2;
const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function batchKey(batchId) {
  return keccak256(toUtf8Bytes(batchId));
}

export function hiddenCommitment(originKey, index, hiddenCode) {
  return keccak256(coder.encode(["bytes32", "uint256", "bytes10"], [originKey, index, hiddenCode]));
}

export function packLeaf(originKey, index, publicTag, commitment) {
  return keccak256(keccak256(coder.encode(["bytes32", "uint256", "bytes32", "bytes32"], [originKey, index, publicTag, commitment])));
}

export function aggregateLeaf(originKey, level, index, root) {
  return keccak256(keccak256(coder.encode(["bytes32", "uint8", "uint256", "bytes32"], [originKey, level, index, root])));
}

export function hashPair(a, b) {
  return BigInt(a) < BigInt(b) ? keccak256(concat([a, b])) : keccak256(concat([b, a]));
}

/** layers[0] = leaves ... layers[last] = [root]; odd last node promoted. */
export function buildLayers(leaves) {
  if (leaves.length === 0) throw new Error("Cannot build a Merkle tree with zero leaves");
  const layers = [leaves.slice()];
  while (layers[layers.length - 1].length > 1) {
    const prev = layers[layers.length - 1];
    const next = [];
    for (let i = 0; i < prev.length; i += 2) next.push(i + 1 < prev.length ? hashPair(prev[i], prev[i + 1]) : prev[i]);
    layers.push(next);
  }
  return layers;
}

export const rootOf = (layers) => layers[layers.length - 1][0];

export function getProof(layers, index) {
  if (index < 0 || index >= layers[0].length) throw new Error("Leaf index out of range");
  const proof = [];
  let idx = index;
  for (let l = 0; l < layers.length - 1; l++) {
    const sib = idx ^ 1;
    if (sib < layers[l].length) proof.push(layers[l][sib]);
    idx >>= 1;
  }
  return proof;
}

export function processProof(proof, leaf) {
  let h = leaf;
  for (const p of proof) h = hashPair(h, p);
  return h;
}

export const verifyProof = (proof, root, leaf) => processProof(proof, leaf).toLowerCase() === root.toLowerCase();

/**
 * Multiproof for a FULL binary tree (carton trees), compatible with OpenZeppelin
 * MerkleProof.processMultiProof. `localIndices` must be sorted ascending and unique;
 * the contract must receive the leaves in the same order.
 */
export function getMultiProof(layers, localIndices) {
  let known = [...localIndices];
  const proof = [];
  const flags = [];
  for (let l = 0; l < layers.length - 1; l++) {
    const next = [];
    for (let j = 0; j < known.length; j++) {
      const idx = known[j];
      const sib = idx ^ 1;
      if (j + 1 < known.length && known[j + 1] === sib) {
        flags.push(true);
        j++;
      } else {
        flags.push(false);
        proof.push(layers[l][sib]);
      }
      next.push(idx >> 1);
    }
    known = next;
  }
  return { proof, flags };
}

export function processMultiProof(proof, flags, leaves) {
  const hashes = [];
  let lp = 0, hp = 0, pp = 0;
  const next = () => (lp < leaves.length ? leaves[lp++] : hashes[hp++]);
  for (let i = 0; i < flags.length; i++) {
    const a = next();
    const b = flags[i] ? next() : proof[pp++];
    hashes.push(hashPair(a, b));
  }
  if (flags.length === 0) return leaves.length ? leaves[0] : proof[0];
  return hashes[hashes.length - 1];
}

// ------------------------------------------------------------------ labels

/** 10 bytes -> "XXXX-XXXX-XXXX-XXXX" (Crockford base32, 80 bits). */
export function encodeCode(bytes10hex) {
  let bits = BigInt(bytes10hex);
  let out = "";
  for (let i = 0; i < 16; i++) {
    out = CROCKFORD[Number(bits & 31n)] + out;
    bits >>= 5n;
  }
  return out.match(/.{4}/g).join("-");
}

export function decodeCode(code) {
  const clean = String(code || "").toUpperCase().replace(/[^0-9A-Z]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  if (clean.length !== 16) throw new Error("Scratch code must have 16 characters");
  let v = 0n;
  for (const ch of clean) {
    const d = CROCKFORD.indexOf(ch);
    if (d < 0) throw new Error(`Invalid character '${ch}' in scratch code`);
    v = (v << 5n) | BigInt(d);
  }
  return "0x" + v.toString(16).padStart(20, "0");
}

/** Deterministic per-unit label from the manufacturer's wallet-derived seed. */
export function deriveLabel(seed, index) {
  const publicTag = keccak256(coder.encode(["bytes32", "uint256", "string"], [seed, index, "public"]));
  const hiddenCode = dataSlice(keccak256(coder.encode(["bytes32", "uint256", "string"], [seed, index, "hidden"])), 0, 10);
  return { publicTag, hiddenCode, code: encodeCode(hiddenCode) };
}

// ------------------------------------------------------------------ hierarchy

export function isPowerOfTwo(n) {
  return n > 0 && (n & (n - 1)) === 0;
}

/** Builds carton / case / lot trees from pack leaves. */
export function buildHierarchy(originKey, leaves, packsPerCarton, cartonsPerCase) {
  if (!isPowerOfTwo(packsPerCarton) || packsPerCarton > 256) throw new Error("packsPerCarton must be a power of two <= 256");
  if (!(cartonsPerCase >= 1)) throw new Error("cartonsPerCase must be >= 1");
  const N = leaves.length;
  const cartonCount = Math.ceil(N / packsPerCarton);
  const cartonLayers = [];
  const cartonRoots = [];
  for (let c = 0; c < cartonCount; c++) {
    const slice = leaves.slice(c * packsPerCarton, (c + 1) * packsPerCarton);
    while (slice.length < packsPerCarton) slice.push(ZeroHash); // padding keeps the carton tree full
    const layers = buildLayers(slice);
    cartonLayers.push(layers);
    cartonRoots.push(rootOf(layers));
  }
  const cartonLeaves = cartonRoots.map((r, c) => aggregateLeaf(originKey, LEVEL_CARTON, c, r));
  const caseCount = Math.ceil(cartonCount / cartonsPerCase);
  const caseLayers = [];
  const caseRoots = [];
  for (let k = 0; k < caseCount; k++) {
    const layers = buildLayers(cartonLeaves.slice(k * cartonsPerCase, (k + 1) * cartonsPerCase));
    caseLayers.push(layers);
    caseRoots.push(rootOf(layers));
  }
  const caseLeaves = caseRoots.map((r, k) => aggregateLeaf(originKey, LEVEL_CASE, k, r));
  const lotLayers = buildLayers(caseLeaves);
  return {
    originKey,
    lotSize: N,
    packsPerCarton,
    cartonsPerCase,
    cartonLayers,
    cartonRoots,
    caseLayers,
    caseRoots,
    lotLayers,
    root: rootOf(lotLayers),
    cartonCount,
    caseCount
  };
}

export function unitProof(h, index) {
  if (index < 0 || index >= h.lotSize) throw new Error("Unit index outside the lot");
  const c = Math.floor(index / h.packsPerCarton);
  const k = Math.floor(c / h.cartonsPerCase);
  return {
    pack: getProof(h.cartonLayers[c], index - c * h.packsPerCarton),
    carton: getProof(h.caseLayers[k], c - k * h.cartonsPerCase),
    kase: getProof(h.lotLayers, k)
  };
}

export function cartonScan(h, c) {
  const k = Math.floor(c / h.cartonsPerCase);
  return { level: LEVEL_CARTON, index: c, root: h.cartonRoots[c], up1: getProof(h.caseLayers[k], c - k * h.cartonsPerCase), up2: getProof(h.lotLayers, k) };
}

export function caseScan(h, k) {
  return { level: LEVEL_CASE, index: k, root: h.caseRoots[k], up1: [], up2: getProof(h.lotLayers, k) };
}

/**
 * Minimal list of aggregate labels (whole cases where possible, else cartons) whose packs are
 * exactly [start, end). Returns null when the range is not carton-aligned.
 */
export function aggregationScans(h, start, end) {
  const ppc = h.packsPerCarton;
  const caseSize = ppc * h.cartonsPerCase;
  const alignedEnd = (x) => x % ppc === 0 || x === h.lotSize;
  if (start % ppc !== 0 || !alignedEnd(end)) return null;
  const scans = [];
  let cursor = start;
  while (cursor < end) {
    const k = Math.floor(cursor / caseSize);
    const caseEnd = Math.min((k + 1) * caseSize, h.lotSize);
    if (cursor === k * caseSize && caseEnd <= end) {
      scans.push(caseScan(h, k));
      cursor = caseEnd;
    } else {
      const c = cursor / ppc;
      scans.push(cartonScan(h, c));
      cursor = Math.min((c + 1) * ppc, h.lotSize);
    }
  }
  return cursor === end ? scans : null;
}

/** Multiproof for several packs of ONE carton (indices are global, any order). */
export function cartonMultiProof(h, cartonIndex, indices) {
  const sorted = [...new Set(indices)].sort((a, b) => a - b);
  const base = cartonIndex * h.packsPerCarton;
  for (const i of sorted) if (Math.floor(i / h.packsPerCarton) !== cartonIndex) throw new Error(`Unit ${i} is not in carton ${cartonIndex}`);
  const { proof, flags } = getMultiProof(h.cartonLayers[cartonIndex], sorted.map((i) => i - base));
  const k = Math.floor(cartonIndex / h.cartonsPerCase);
  return {
    indices: sorted,
    multiProof: proof,
    proofFlags: flags,
    cartonProof: getProof(h.caseLayers[k], cartonIndex - k * h.cartonsPerCase),
    caseProof: getProof(h.lotLayers, k)
  };
}

// ------------------------------------------------------------------ whole lot

export function deriveSecret(seed, index) {
  // kept for backwards compatibility with v2 tooling
  return keccak256(coder.encode(["bytes32", "uint256"], [seed, index]));
}

/**
 * Generates every label of a lot plus its hierarchy.
 * @returns {{ originKey, seed, labels:[{publicTag, hiddenCode, code}], commitments, leaves, hierarchy, root }}
 */
export function generateLot(batchId, quantity, seed = hexlify(randomBytes(32)), packsPerCarton = 8, cartonsPerCase = 4) {
  const originKey = batchKey(batchId);
  const labels = [];
  const commitments = [];
  const leaves = [];
  for (let i = 0; i < quantity; i++) {
    const l = deriveLabel(seed, i);
    const cm = hiddenCommitment(originKey, i, l.hiddenCode);
    labels.push(l);
    commitments.push(cm);
    leaves.push(packLeaf(originKey, i, l.publicTag, cm));
  }
  const hierarchy = buildHierarchy(originKey, leaves, packsPerCarton, cartonsPerCase);
  return { originKey, seed, labels, commitments, leaves, hierarchy, root: hierarchy.root };
}

export { getBytes };
