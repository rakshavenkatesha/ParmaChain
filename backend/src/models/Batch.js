const mongoose = require("mongoose");

/**
 * Batch documents are a READ CACHE of on-chain state, written only by the chain indexer
 * (src/services/chainIndexer.js). The blockchain is the source of truth; anything here can be
 * rebuilt by replaying contract events from the deploy block.
 */
const historySchema = new mongoose.Schema({
  from: { type: String, trim: true, lowercase: true },
  to: { type: String, trim: true, lowercase: true },
  action: {
    type: String,
    enum: [
      "Created",
      "Transfer Initiated",
      "Transfer Cancelled",
      "Shipment Accepted",
      "Split",
      "Recalled",
      "Quarantined",
      "Quarantine Released",
      "Aggregated Receipt",
      "Return Requested",
      "Unit Returned",
      "Sensors Assigned"
    ],
    required: true
  },
  note: { type: String },
  txHash: { type: String, trim: true },
  blockNumber: { type: Number },
  timestamp: { type: Date, default: Date.now }
});

const batchSchema = new mongoose.Schema(
  {
    batchId: { type: String, required: true, unique: true, trim: true },
    batchKey: { type: String, required: true, unique: true, lowercase: true },
    originBatchId: { type: String, trim: true },
    originKey: { type: String, lowercase: true, index: true },
    parentBatchId: { type: String, trim: true },
    drugName: { type: String, required: true, trim: true },
    productCode: { type: String, required: true, trim: true },

    manufacturer: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    manufacturerEthAddress: { type: String, required: true, lowercase: true },
    currentOwner: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    currentOwnerEthAddress: { type: String, required: true, lowercase: true },
    pendingOwnerEthAddress: { type: String, lowercase: true, default: null },
    custody: [{ type: String, lowercase: true }],

    // Unit-level serialisation
    lotSize: { type: Number }, // units in the production lot
    packsPerCarton: { type: Number },
    cartonsPerCase: { type: Number },
    privateLot: { type: Boolean, default: false }, // zero-knowledge dispensing only
    quantity: { type: Number, required: true, min: 0 }, // units currently in this shipment
    unitStart: { type: Number },
    unitEnd: { type: Number },
    dispensedCount: { type: Number, default: 0 },
    unitRoot: { type: String, lowercase: true },

    productionDate: { type: Date, required: true },
    expiryDate: { type: Date, required: true },
    minTempC: { type: Number },
    maxTempC: { type: Number },
    mktC: { type: Number, default: null }, // Mean Kinetic Temperature from ColdChainMonitor
    lastTempC: { type: Number, default: null },
    sensorReadings: { type: Number, default: 0 },

    status: {
      type: String,
      enum: ["Manufactured", "In Transit", "Received", "Depleted", "Quarantined", "Recalled"],
      default: "Manufactured"
    },
    quarantined: { type: Boolean, default: false },
    recalled: { type: Boolean, default: false },

    txHash: { type: String, trim: true }, // registration / split tx
    blockNumber: { type: Number },
    riskScore: { type: Number, default: 0, min: 0, max: 100 },
    verificationCount: { type: Number, default: 0 },
    history: [historySchema]
  },
  { timestamps: true }
);

batchSchema.virtual("isExpired").get(function () {
  return this.expiryDate < new Date();
});

module.exports = mongoose.model("Batch", batchSchema);
