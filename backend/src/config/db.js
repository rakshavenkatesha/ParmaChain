const mongoose = require("mongoose");

const connectDB = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/pharma-supply-chain");
    console.log(`MongoDB Connected: ${conn.connection.host}`);
    
    // Automatically seed database with default test accounts
    const seedUsers = require("../utils/seeder");
    await seedUsers();
  } catch (error) {
    console.error(`Error connecting to MongoDB: ${error.message}`);
    process.exit(1);
  }
};

module.exports = connectDB;
