const express = require("express");
const jwt = require("jsonwebtoken");
const User = require("../models/User");
const { protect } = require("../middleware/auth");

const router = express.Router();

// Helper to generate JWT
const generateToken = (id) => {
  return jwt.sign(
    { id },
    process.env.JWT_SECRET || "YOUR_SUPER_SECRET_JWT_KEY_CHANGE_THIS",
    {
      expiresIn: "30d"
    }
  );
};

// @desc    Register a new user
// @route   POST /api/auth/register
// @access  Public
router.post("/register", async (req, res) => {
  try {
    const {
      name,
      email,
      password,
      role,
      companyName,
      licenseNumber,
      ethAddress,
      licenseDocumentUrl
    } = req.body;

    const userExists = await User.findOne({ email });

    if (userExists) {
      return res
        .status(400)
        .json({ success: false, message: "User already exists with this email" });
    }

    // Admins are approved by default. Other roles need approval.
    const isApproved = role === "Admin";

    const user = await User.create({
      name,
      email,
      password,
      role,
      companyName,
      licenseNumber,
      licenseDocumentUrl,
      isApproved,
      ethAddress
    });

    if (user) {
      res.status(201).json({
        success: true,
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        isApproved: user.isApproved,
        ethAddress: user.ethAddress,
        token: generateToken(user._id)
      });
    } else {
      res.status(400).json({ success: false, message: "Invalid user data" });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Auth user & get token
// @route   POST /api/auth/login
// @access  Public
router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    // Find user and select password explicitly (since select: false is on in Schema)
    const user = await User.findOne({ email }).select("+password");

    if (user && (await user.matchPassword(password))) {
      res.json({
        success: true,
        _id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        isApproved: user.isApproved,
        ethAddress: user.ethAddress,
        token: generateToken(user._id)
      });
    } else {
      res.status(401).json({ success: false, message: "Invalid email or password" });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Get current user profile
// @route   GET /api/auth/me
// @access  Private
router.get("/me", protect, async (req, res) => {
  res.json({
    success: true,
    user: req.user
  });
});

// @desc    Update user profile
// @route   PUT /api/auth/profile
// @access  Private
router.put("/profile", protect, async (req, res) => {
  try {
    const user = await User.findById(req.user._id);

    if (user) {
      user.name = req.body.name || user.name;
      user.companyName = req.body.companyName || user.companyName;
      user.licenseNumber = req.body.licenseNumber || user.licenseNumber;
      user.ethAddress = req.body.ethAddress || user.ethAddress;

      if (req.body.password) {
        user.password = req.body.password;
      }

      const updatedUser = await user.save();

      res.json({
        success: true,
        _id: updatedUser._id,
        name: updatedUser.name,
        email: updatedUser.email,
        role: updatedUser.role,
        isApproved: updatedUser.isApproved,
        ethAddress: updatedUser.ethAddress,
        token: generateToken(updatedUser._id)
      });
    } else {
      res.status(404).json({ success: false, message: "User not found" });
    }
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

// @desc    Get verified downstream partners by role
// @route   GET /api/auth/partners
// @access  Private
router.get("/partners", protect, async (req, res) => {
  try {
    const { role } = req.query;
    const query = { isApproved: true };
    if (role) {
      query.role = role;
    }
    const partners = await User.find(query).select("name companyName role ethAddress");
    res.json({ success: true, count: partners.length, data: partners });
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
});

module.exports = router;
