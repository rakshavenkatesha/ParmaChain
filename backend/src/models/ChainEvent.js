const mongoose = require("mongoose");

/** Every contract log the indexer has processed. (txHash, logIndex) makes replays idempotent. */
const chainEventSchema = new mongoose.Schema(
  {
    contract: { type: String, enum: ["PharmaChain", "AccessRegistry", "ColdChainMonitor", "Governance", "ValidatorSet", "PrivateDispenser"], required: true },
    name: { type: String, required: true, index: true },
    txHash: { type: String, required: true, lowercase: true },
    logIndex: { type: Number, required: true },
    blockNumber: { type: Number, required: true, index: true },
    blockHash: { type: String, lowercase: true },
    timestamp: { type: Date },
    batchKey: { type: String, lowercase: true, index: true },
    originKey: { type: String, lowercase: true, index: true },
    batchId: { type: String },
    unitIndex: { type: Number },
    actor: { type: String, lowercase: true },
    args: { type: mongoose.Schema.Types.Mixed }
  },
  { timestamps: true }
);

chainEventSchema.index({ txHash: 1, logIndex: 1 }, { unique: true });
chainEventSchema.index({ originKey: 1, unitIndex: 1 });

module.exports = mongoose.model("ChainEvent", chainEventSchema);
