const express = require("express");
const User = require("../models/User");
const Batch = require("../models/Batch");
const Anomaly = require("../models/Anomaly");
const { protect, authorize } = require("../middleware/auth");

const router = express.Router();

// Apply admin-only protection
router.use(protect);
router.use(authorize("Admin"));

// @desc    Get all users for review
// @route   GET /api/admin/users
// @access  Private (Admin)
router.get("/users", async (req, res) => {
  try {
    const users = await User.find({}).sort({ createdAt: -1 });
    res.json({ success: true, count: users.length, data: users });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Approve/verify organization registration
// @route   PUT /api/admin/users/:userId/approve
// @access  Private (Admin)
router.put("/users/:userId/approve", async (req, res) => {
  try {
    const user = await User.findById(req.params.userId);
    if (!user) {
      return res.status(404).json({ success: false, message: "User not found" });
    }

    user.isApproved = true;
    await user.save();

    res.json({
      success: true,
      message: `Successfully approved registration for: ${
        user.companyName || user.name
      }`
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Get all registered supply chain anomalies
// @route   GET /api/admin/anomalies
// @access  Private (Admin)
router.get("/anomalies", async (req, res) => {
  try {
    const anomalies = await Anomaly.find({}).sort({ createdAt: -1 });
    res.json({ success: true, count: anomalies.length, data: anomalies });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Mark anomaly as resolved
// @route   PUT /api/admin/anomalies/:anomalyId/resolve
// @access  Private (Admin)
router.put("/anomalies/:anomalyId/resolve", async (req, res) => {
  try {
    const anomaly = await Anomaly.findById(req.params.anomalyId);
    if (!anomaly) {
      return res
        .status(404)
        .json({ success: false, message: "Anomaly log not found" });
    }

    anomaly.isResolved = true;
    anomaly.resolvedBy = req.user._id;
    anomaly.resolvedAt = new Date();
    await anomaly.save();

    res.json({
      success: true,
      message: "Anomaly marked as resolved successfully"
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Get system analytics and metrics
// @route   GET /api/admin/stats
// @access  Private (Admin)
router.get("/stats", async (req, res) => {
  try {
    const totalUsers = await User.countDocuments();
    const manufacturers = await User.countDocuments({ role: "Manufacturer" });
    const distributors = await User.countDocuments({ role: "Distributor" });
    const pharmacies = await User.countDocuments({ role: "Pharmacy" });
    const pendingApprovals = await User.countDocuments({
      isApproved: false,
      role: { $ne: "Admin" }
    });

    const totalBatches = await Batch.countDocuments();
    const activeBatches = await Batch.countDocuments({
      status: { $ne: "Recalled" }
    });
    const recalledBatches = await Batch.countDocuments({ status: "Recalled" });

    const activeAnomalies = await Anomaly.countDocuments({ isResolved: false });
    const criticalAnomalies = await Anomaly.countDocuments({
      isResolved: false,
      severity: "Critical"
    });

    // Grouping by status
    const statuses = await Batch.aggregate([
      { $group: { _id: "$status", count: { $sum: 1 } } }
    ]);

    // Average risk score
    const avgRisk = await Batch.aggregate([
      { $group: { _id: null, avgRisk: { $avg: "$riskScore" } } }
    ]);

    res.json({
      success: true,
      data: {
        users: {
          total: totalUsers,
          manufacturers,
          distributors,
          pharmacies,
          pending: pendingApprovals
        },
        batches: {
          total: totalBatches,
          active: activeBatches,
          recalled: recalledBatches,
          statusDistribution: statuses
        },
        anomalies: {
          active: activeAnomalies,
          critical: criticalAnomalies
        },
        avgRiskScore: avgRisk.length > 0 ? Math.round(avgRisk[0].avgRisk) : 0
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
