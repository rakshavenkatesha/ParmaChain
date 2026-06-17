const mongoose = require("mongoose");

const anomalySchema = new mongoose.Schema(
  {
    batchId: {
      type: String,
      required: true,
      trim: true
    },
    type: {
      type: String,
      required: true,
      enum: [
        "Duplicate Batch ID",
        "Duplicate QR Code Scan",
        "Missing Transfer Stage",
        "Unauthorized Transfer",
        "Expired Product Active",
        "Suspicious Transaction Frequency"
      ]
    },
    severity: {
      type: String,
      required: true,
      enum: ["Low", "Medium", "High", "Critical"],
      default: "Medium"
    },
    description: {
      type: String,
      required: true
    },
    detectedBy: {
      type: String,
      default: "System Anomaly Detector"
    },
    isResolved: {
      type: Boolean,
      default: false
    },
    resolvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    },
    resolvedAt: {
      type: Date
    }
  },
  {
    timestamps: true
  }
);

module.exports = mongoose.model("Anomaly", anomalySchema);
