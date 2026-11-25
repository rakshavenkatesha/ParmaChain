const mongoose = require("mongoose");

/**
 * Poseidon leaves of a PRIVATE lot (zero-knowledge dispensing). Leaves are public hashes;
 * the scratch codes they commit to are never sent to the server. The server serves Merkle
 * paths for proving; a wrong path simply yields a proof that fails on-chain.
 */
const zkLotSchema = new mongoose.Schema(
  {
    batchId: { type: String, required: true, unique: true },
    originKey: { type: String, required: true, lowercase: true, index: true },
    zkRoot: { type: String, required: true, lowercase: true },
    lotTag: { type: String, required: true },
    leaves: { type: [String], required: true } // decimal field elements
  },
  { timestamps: true }
);

module.exports = mongoose.model("ZkLot", zkLotSchema);
