const User = require("../models/User");

const seedUsers = async () => {
  try {
    console.log("Seeding / updating database default pharmaceutical network operators...");

    const users = [
      {
        name: "Admin System Manager",
        email: "admin@pharma.com",
        password: "admin123",
        role: "Admin",
        companyName: "PharmaChain Registry",
        licenseNumber: "LIC-ADM-000",
        isApproved: true,
        ethAddress: "0x90F79bf6EB2c4f870365E785982E1f101E93b906".toLowerCase(), // Hardhat Account 3
        licenseDocumentUrl: "https://res.cloudinary.com/demo/image/upload/sample.pdf"
      },
      {
        name: "Alice Manufacturer",
        email: "manufacturer@pharma.com",
        password: "manufacturer123",
        role: "Manufacturer",
        companyName: "PharmaMfg Corp",
        licenseNumber: "LIC-MFR-001",
        isApproved: true,
        ethAddress: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266".toLowerCase(), // Hardhat Account 0
        licenseDocumentUrl: "https://res.cloudinary.com/demo/image/upload/sample.pdf"
      },
      {
        name: "Bob Distributor",
        email: "distributor@pharma.com",
        password: "distributor123",
        role: "Distributor",
        companyName: "PharmaDist Logistics",
        licenseNumber: "LIC-DST-001",
        isApproved: true,
        ethAddress: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8".toLowerCase(), // Hardhat Account 1
        licenseDocumentUrl: "https://res.cloudinary.com/demo/image/upload/sample.pdf"
      },
      {
        name: "Charlie Pharmacy",
        email: "pharmacy@pharma.com",
        password: "pharmacy123",
        role: "Pharmacy",
        companyName: "CareRx Pharmacy",
        licenseNumber: "LIC-RX-001",
        isApproved: true,
        ethAddress: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC".toLowerCase(), // Hardhat Account 2
        licenseDocumentUrl: "https://res.cloudinary.com/demo/image/upload/sample.pdf"
      }
    ];

    for (const u of users) {
      let user = await User.findOne({ email: u.email });
      if (user) {
        user.ethAddress = u.ethAddress;
        await user.save();
        console.log(`Updated user address for: ${u.email} to ${u.ethAddress}`);
      } else {
        await User.create(u);
        console.log(`Seeded user: ${u.email} (${u.role})`);
      }
    }

    console.log("Seeding complete!");
  } catch (error) {
    console.error("Seeding error:", error.message);
  }
};

module.exports = seedUsers;
