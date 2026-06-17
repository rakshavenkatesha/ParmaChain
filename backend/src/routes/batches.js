const express = require("express");
const Batch = require("../models/Batch");
const User = require("../models/User");
const { protect, authorize } = require("../middleware/auth");
const { analyzeBatch } = require("../utils/anomalyDetector");

const router = express.Router();

// @desc    Register a new drug batch
// @route   POST /api/batches
// @access  Private (Manufacturer)
router.post("/", protect, authorize("Manufacturer"), async (req, res) => {
  try {
    const {
      batchId,
      drugName,
      productCode,
      quantity,
      productionDate,
      expiryDate,
      txHash
    } = req.body;

    const existingBatch = await Batch.findOne({ batchId });
    if (existingBatch) {
      return res
        .status(400)
        .json({ success: false, message: "Batch ID already registered" });
    }

    const manufacturerEthAddress = req.user.ethAddress;
    if (!manufacturerEthAddress) {
      return res.status(400).json({
        success: false,
        message:
          "Please configure an Ethereum address in your user profile to write to the blockchain."
      });
    }

    const batch = await Batch.create({
      batchId,
      drugName,
      productCode,
      manufacturer: req.user._id,
      manufacturerEthAddress: manufacturerEthAddress.toLowerCase(),
      currentOwner: req.user._id,
      currentOwnerEthAddress: manufacturerEthAddress.toLowerCase(),
      quantity,
      productionDate: new Date(productionDate),
      expiryDate: new Date(expiryDate),
      status: "Manufactured",
      txHash,
      history: [
        {
          from: "system",
          to: manufacturerEthAddress.toLowerCase(),
          action: "Created",
          txHash,
          timestamp: new Date()
        }
      ]
    });

    res.status(201).json({ success: true, data: batch });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Get all drug batches
// @route   GET /api/batches
// @access  Private (All Roles)
router.get("/", protect, async (req, res) => {
  try {
    let query = {};

    // Search query filter
    if (req.query.search) {
      query.$or = [
        { batchId: { $regex: req.query.search, $options: "i" } },
        { drugName: { $regex: req.query.search, $options: "i" } }
      ];
    }

    // Role-specific viewing constraints
    if (req.user.role === "Manufacturer") {
      query.manufacturer = req.user._id;
    } else if (req.user.role === "Distributor" || req.user.role === "Pharmacy") {
      const ethAddr = req.user.ethAddress ? req.user.ethAddress.toLowerCase() : "";
      query.$or = [{ currentOwnerEthAddress: ethAddr }, { "history.to": ethAddr }];
    }

    const batches = await Batch.find(query)
      .populate("manufacturer", "name companyName")
      .populate("currentOwner", "name companyName")
      .sort({ createdAt: -1 });

    res.json({ success: true, count: batches.length, data: batches });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Get batch details and execute counterfeit scans
// @route   GET /api/batches/:batchId
// @access  Private
router.get("/:batchId", protect, async (req, res) => {
  try {
    const batch = await Batch.findOne({ batchId: req.params.batchId })
      .populate("manufacturer", "name companyName role")
      .populate("currentOwner", "name companyName role");

    if (!batch) {
      return res.status(404).json({ success: false, message: "Batch not found" });
    }

    // Resolve details for each step of chain of custody
    const custodyUsers = [];
    for (const histItem of batch.history) {
      if (histItem.to && histItem.to !== "system") {
        const user = await User.findOne({
          ethAddress: histItem.to.toLowerCase()
        });
        custodyUsers.push(user);
      }
    }

    // Run off-chain anomaly scans
    const { riskScore, anomalies } = await analyzeBatch(batch, custodyUsers);

    // Update calculated score in database
    batch.riskScore = riskScore;
    await batch.save();

    res.json({
      success: true,
      data: batch,
      riskScore,
      anomalies
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Public verification portal for consumer QR scan
// @route   POST /api/batches/:batchId/verify
// @access  Public
router.post("/:batchId/verify", async (req, res) => {
  try {
    const batch = await Batch.findOne({ batchId: req.params.batchId })
      .populate("manufacturer", "name companyName email")
      .populate("currentOwner", "name companyName email");

    if (!batch) {
      return res.status(404).json({
        success: false,
        authenticityStatus: "Invalid",
        message:
          "This Batch ID was not registered in our secure blockchain database. Warning: Product is likely counterfeit."
      });
    }

    // Register verify event scan count
    batch.verificationCount += 1;

    // Compile list of custody owners
    const custodyUsers = [];
    for (const histItem of batch.history) {
      if (histItem.to && histItem.to !== "system") {
        const user = await User.findOne({
          ethAddress: histItem.to.toLowerCase()
        });
        custodyUsers.push(user);
      }
    }

    // Calculate risk
    const { riskScore, anomalies } = await analyzeBatch(batch, custodyUsers);
    batch.riskScore = riskScore;
    await batch.save();

    let authenticityStatus = "Genuine";
    // Check if expired
    const now = new Date();
    if (batch.expiryDate < now) {
      authenticityStatus = "Expired";
    } else if (riskScore >= 70) {
      authenticityStatus = "Critical Alert";
    } else if (riskScore > 30) {
      authenticityStatus = "Suspicious";
    }

    res.json({
      success: true,
      authenticityStatus,
      riskScore,
      data: batch,
      anomalies
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Report suspicious batch activity (public)
// @route   POST /api/batches/:batchId/report
// @access  Public
router.post("/:batchId/report", async (req, res) => {
  try {
    const { description } = req.body;
    const batchId = req.params.batchId;

    const Anomaly = require("../models/Anomaly");

    const anomaly = await Anomaly.create({
      batchId,
      type: "Suspicious Transaction Frequency",
      severity: "High",
      description: `Consumer Alert: ${description}`,
      detectedBy: "Consumer Feedback Portal"
    });

    res.status(201).json({
      success: true,
      message: "Safety report logged successfully. Regulatory teams notified."
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
