const express = require("express");
const Batch = require("../models/Batch");
const User = require("../models/User");
const { protect } = require("../middleware/auth");

const router = express.Router();

// @desc    Initiate ownership transfer off-chain (called after MetaMask tx completes)
// @route   POST /api/transfers/initiate
// @access  Private
router.post("/initiate", protect, async (req, res) => {
  try {
    const { batchId, toEthAddress, txHash } = req.body;

    const batch = await Batch.findOne({ batchId });
    if (!batch) {
      return res.status(404).json({ success: false, message: "Batch not found" });
    }

    // Verify ownership
    const myEth = req.user.ethAddress ? req.user.ethAddress.toLowerCase() : "";
    if (batch.currentOwnerEthAddress !== myEth) {
      return res.status(403).json({
        success: false,
        message: "You are not the current owner of this batch"
      });
    }

    // Find the recipient in database
    const recipient = await User.findOne({
      ethAddress: toEthAddress.toLowerCase()
    });

    batch.currentOwnerEthAddress = toEthAddress.toLowerCase();
    if (recipient) {
      batch.currentOwner = recipient._id;
    } else {
      batch.currentOwner = null; // Not registered in DB yet, but saved on-chain
    }

    batch.status = "In Transit";
    batch.history.push({
      from: myEth,
      to: toEthAddress.toLowerCase(),
      action: "Transfer Initiated",
      txHash,
      timestamp: new Date()
    });

    await batch.save();

    res.json({ success: true, data: batch });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Confirm shipment receipt off-chain (called after MetaMask tx completes)
// @route   POST /api/transfers/accept
// @access  Private
router.post("/accept", protect, async (req, res) => {
  try {
    const { batchId, txHash } = req.body;

    const batch = await Batch.findOne({ batchId });
    if (!batch) {
      return res.status(404).json({ success: false, message: "Batch not found" });
    }

    const myEth = req.user.ethAddress ? req.user.ethAddress.toLowerCase() : "";
    if (batch.currentOwnerEthAddress !== myEth) {
      return res.status(403).json({
        success: false,
        message: "You are not the recipient of this shipment"
      });
    }

    if (batch.status !== "In Transit") {
      return res
        .status(400)
        .json({ success: false, message: "This batch is not in transit" });
    }

    batch.status = "Received";
    batch.currentOwner = req.user._id; // Link to the user profile
    batch.history.push({
      from: "system",
      to: myEth,
      action: "Shipment Accepted",
      txHash,
      timestamp: new Date()
    });

    await batch.save();

    res.json({ success: true, data: batch });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Recall batch off-chain (called after MetaMask tx completes)
// @route   POST /api/transfers/recall
// @access  Private
router.post("/recall", protect, async (req, res) => {
  try {
    const { batchId, txHash } = req.body;

    const batch = await Batch.findOne({ batchId });
    if (!batch) {
      return res.status(404).json({ success: false, message: "Batch not found" });
    }

    const myEth = req.user.ethAddress ? req.user.ethAddress.toLowerCase() : "";
    if (batch.manufacturerEthAddress !== myEth) {
      return res.status(403).json({
        success: false,
        message: "Only the original manufacturer can recall this batch"
      });
    }

    batch.status = "Recalled";
    batch.history.push({
      from: myEth,
      to: myEth,
      action: "Recalled",
      txHash,
      timestamp: new Date()
    });

    await batch.save();

    res.json({ success: true, data: batch });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
