const express = require("express");
const cors = require("cors");
const dotenv = require("dotenv");
const connectDB = require("./config/db");

dotenv.config();

const authRoutes = require("./routes/auth");
const batchRoutes = require("./routes/batches");
const adminRoutes = require("./routes/admin");
const chainRoutes = require("./routes/chain");
const governanceRoutes = require("./routes/governance");
const zkRoutes = require("./routes/zk");
const checkpointRoutes = require("./routes/checkpoints");
const scanRoutes = require("./routes/scans");
const chainIndexer = require("./services/chainIndexer");
const checkpointPublisher = require("./services/checkpointPublisher");

const app = express();

app.use(cors());
app.use(express.json({ limit: "10mb" })); // unit leaf uploads: 100k leaves ~ 6.7 MB

app.use("/api/auth", authRoutes);
app.use("/api/batches", batchRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/chain", chainRoutes);
app.use("/api/governance", governanceRoutes);
app.use("/api/zk", zkRoutes);
app.use("/api/checkpoints", checkpointRoutes);
app.use("/api/scans", scanRoutes);

app.get("/", (req, res) => {
  res.json({ message: "PharmaChain API is running", indexer: chainIndexer.state });
});

const PORT = process.env.PORT || 5000;

connectDB().then(() => {
  chainIndexer.start();
  checkpointPublisher.start();
  app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
});
