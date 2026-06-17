const mongoose = require("mongoose");

const historySchema = new mongoose.Schema({
  from: {
    type: String, // ethAddress or "System"
    trim: true,
    lowercase: true
  },
  to: {
    type: String, // ethAddress
    trim: true,
    lowercase: true
  },
  action: {
    type: String,
    enum: ["Created", "Transfer Initiated", "Shipment Accepted", "Recalled"],
    required: true
  },
  txHash: {
    type: String,
    trim: true
  },
  timestamp: {
    type: Date,
    default: Date.now
  }
});

const batchSchema = new mongoose.Schema(
  {
    batchId: {
      type: String,
      required: [true, "Please add a Batch ID"],
      unique: true,
      trim: true
    },
    drugName: {
      type: String,
      required: [true, "Please add a drug name"],
      trim: true
    },
    productCode: {
      type: String,
      required: [true, "Please add a product code"],
      trim: true
    },
    manufacturer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true
    },
    manufacturerEthAddress: {
      type: String,
      required: true,
      lowercase: true
    },
    currentOwner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User"
    },
    currentOwnerEthAddress: {
      type: String,
      required: true,
      lowercase: true
    },
    quantity: {
      type: Number,
      required: [true, "Please add quantity"],
      min: [1, "Quantity must be at least 1"]
    },
    productionDate: {
      type: Date,
      required: true
    },
    expiryDate: {
      type: Date,
      required: true
    },
    status: {
      type: String,
      enum: ["Manufactured", "In Transit", "Received", "Recalled"],
      default: "Manufactured"
    },
    txHash: {
      type: String, // Deployment tx
      trim: true
    },
    riskScore: {
      type: Number,
      default: 0,
      min: 0,
      max: 100
    },
    verificationCount: {
      type: Number,
      default: 0
    },
    history: [historySchema]
  },
  {
    timestamps: true
  }
);

// Check if expired dynamically
batchSchema.virtual("isExpired").get(function () {
  return this.expiryDate < new Date();
});

module.exports = mongoose.model("Batch", batchSchema);
