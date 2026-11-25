const mongoose = require("mongoose");

/** One consumer/pharmacist scan of a pack's visible label, with coarse location. */
const scanEventSchema = new mongoose.Schema(
  {
    batchId: { type: String, required: true },
    originBatchId: { type: String },
    originKey: { type: String, lowercase: true },
    unitIndex: { type: Number, required: true },
    authentic: { type: Boolean, required: true },
    dispensed: { type: Boolean, default: false },
    city: { type: String, trim: true },
    lat: { type: Number },
    lon: { type: Number },
    accuracyKm: { type: Number },
    flags: [{ type: String }],
    ipHash: { type: String }
  },
  { timestamps: true }
);

scanEventSchema.index({ originKey: 1, unitIndex: 1, createdAt: -1 });

module.exports = mongoose.model("ScanEvent", scanEventSchema);
