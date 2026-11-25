const mongoose = require("mongoose");

/** Indexer checkpoint. If the chain is reset (new genesis / new contracts) the cache is rebuilt. */
const syncStateSchema = new mongoose.Schema(
  {
    _id: { type: String, default: "indexer" },
    chainId: Number,
    genesisHash: String,
    pharmaAddress: String,
    lastBlock: Number,
    lastSyncedAt: Date
  },
  { timestamps: true }
);

module.exports = mongoose.model("SyncState", syncStateSchema);
