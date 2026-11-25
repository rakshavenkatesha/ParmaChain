const mongoose = require("mongoose");

/**
 * Public commitment data of a production lot (v3, two-part labels + packaging hierarchy).
 *
 *  leaves[i]      = pack leaf i  (keccak of lot, index, publicTag, commitment)
 *  commitments[i] = keccak(lot, index, hiddenCode)  - needed for consumer verification
 *
 * Neither the visible publicTags nor the hidden scratch codes are ever stored here, so a full
 * database leak lets nobody print labels that pass verification or dispensing. The backend is an
 * untrusted proof server: every proof it serves is re-checked against the on-chain root.
 */
const unitCommitmentSchema = new mongoose.Schema(
  {
    batchId: { type: String, required: true, unique: true },
    originKey: { type: String, required: true, lowercase: true },
    root: { type: String, required: true, lowercase: true },
    lotSize: { type: Number, required: true },
    packsPerCarton: { type: Number, required: true },
    cartonsPerCase: { type: Number, required: true },
    leaves: { type: [String], required: true },
    commitments: { type: [String], required: true }
  },
  { timestamps: true }
);

module.exports = mongoose.model("UnitCommitment", unitCommitmentSchema);
