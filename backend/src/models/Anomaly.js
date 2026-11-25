const mongoose = require("mongoose");

const anomalySchema = new mongoose.Schema(
  {
    batchId: { type: String, required: true, trim: true },
    originBatchId: { type: String, trim: true },
    type: {
      type: String,
      required: true,
      enum: [
        // deterministic, emitted by PharmaChain.decommissionUnit / recordTemperature
        "Cloned Unit Label",
        "Forged Unit Label",
        "Unit Diversion",
        "Cold Chain Breach",
        "Sensor Outlier",
        "Sensor Disagreement",
        // off-chain consumer-scan analytics (geo module)
        "Impossible Travel",
        "Out-of-Region Sale",
        // off-chain heuristics / reports
        "Expired Product Active",
        "Cache Divergence",
        "Duplicate QR Code Scan",
        "Suspicious Transaction Frequency"
      ]
    },
    severity: {
      type: String,
      required: true,
      enum: ["Low", "Medium", "High", "Critical"],
      default: "Medium"
    },
    description: { type: String, required: true },
    source: { type: String, enum: ["on-chain", "off-chain"], default: "off-chain" },
    unitIndex: { type: Number },
    reporter: { type: String, lowercase: true },
    txHash: { type: String },
    blockNumber: { type: Number },
    detectedBy: { type: String, default: "System Anomaly Detector" },
    isResolved: { type: Boolean, default: false },
    resolvedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    resolvedAt: { type: Date }
  },
  { timestamps: true }
);

module.exports = mongoose.model("Anomaly", anomalySchema);
