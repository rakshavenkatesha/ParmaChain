pragma circom 2.1.6;

/*
 * PharmaChain private (zero-knowledge) dispensing.
 *
 * The pharmacy proves, without revealing WHICH pack it is dispensing, that:
 *   1. it knows a hidden scratch code `hidden` whose leaf  Poseidon(lotTag, index, hidden)
 *      is in the lot's Poseidon Merkle tree with root `root` (depth DEPTH, position = index);
 *   2. the pack index lies in its own shipment's range  rangeStart <= index < rangeEnd;
 *   3. nullifierHash = Poseidon(lotTag, hidden, 1)  - a one-time tag that the contract stores,
 *      so the same pack can never be dispensed twice, yet cannot be linked to the index.
 *
 * Public signals (order matters for the verifier): root, nullifierHash, rangeStart, rangeEnd, lotTag
 */

include "circomlib/circuits/poseidon.circom";
include "circomlib/circuits/comparators.circom";
include "circomlib/circuits/bitify.circom";

template PrivateDispense(DEPTH) {
    // public
    signal input root;
    signal input nullifierHash;
    signal input rangeStart;
    signal input rangeEnd;
    signal input lotTag;
    // private
    signal input index;
    signal input hidden;
    signal input pathElements[DEPTH];

    // index bits ARE the path directions -> the leaf position is bound to the index
    component idxBits = Num2Bits(DEPTH);
    idxBits.in <== index;

    // the scratch code is 80 bits
    component hiddenBits = Num2Bits(80);
    hiddenBits.in <== hidden;

    component leafHash = Poseidon(3);
    leafHash.inputs[0] <== lotTag;
    leafHash.inputs[1] <== index;
    leafHash.inputs[2] <== hidden;

    signal cur[DEPTH + 1];
    signal left[DEPTH];
    signal right[DEPTH];
    component h[DEPTH];
    cur[0] <== leafHash.out;
    for (var i = 0; i < DEPTH; i++) {
        // bit = 0 -> (cur, sibling); bit = 1 -> (sibling, cur)
        left[i] <== cur[i] + idxBits.out[i] * (pathElements[i] - cur[i]);
        right[i] <== pathElements[i] + idxBits.out[i] * (cur[i] - pathElements[i]);
        h[i] = Poseidon(2);
        h[i].inputs[0] <== left[i];
        h[i].inputs[1] <== right[i];
        cur[i + 1] <== h[i].out;
    }
    root === cur[DEPTH];

    // rangeStart <= index < rangeEnd   (uint32 values)
    component ge = LessEqThan(32);
    ge.in[0] <== rangeStart;
    ge.in[1] <== index;
    ge.out === 1;
    component lt = LessThan(32);
    lt.in[0] <== index;
    lt.in[1] <== rangeEnd;
    lt.out === 1;

    component nh = Poseidon(3);
    nh.inputs[0] <== lotTag;
    nh.inputs[1] <== hidden;
    nh.inputs[2] <== 1;
    nullifierHash === nh.out;
}

component main {public [root, nullifierHash, rangeStart, rangeEnd, lotTag]} = PrivateDispense(12);
