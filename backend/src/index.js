const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const connectDB = require("./config/db");

// Import Routes
const authRoutes = require("./routes/auth");
const batchRoutes = require("./routes/batches");
const transferRoutes = require("./routes/transfers");
const adminRoutes = require("./routes/admin");

// Load Environment variables
dotenv.config();

// Connect to MongoDB Database
connectDB();

const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Routes Integration
app.use("/api/auth", authRoutes);
app.use("/api/batches", batchRoutes);
app.use("/api/transfers", transferRoutes);
app.use("/api/admin", adminRoutes);

// Health Check / Root endpoint
app.get("/", (req, res) => {
  res.json({
    message:
      "Blockchain-Based Pharmaceutical Supply Chain System API is running..."
  });
});

// Port configuration
const PORT = process.env.PORT || 5000;

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
