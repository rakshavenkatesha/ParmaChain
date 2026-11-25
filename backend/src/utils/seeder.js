const User = require("../models/User");

const PLACEHOLDER_LICENSE_URL = "https://res.cloudinary.com/demo/image/upload/sample.pdf";

/**
 * Default consortium members. Wallets are the Hardhat dev-mnemonic accounts that are also
 * pre-funded in the Besu genesis and onboarded on-chain by blockchain/scripts/deploy.js.
 * The three Admin accounts are the signers of the 2-of-3 Governance multisig.
 */
const users = [
  {
    name: "Admin System Manager",
    email: "admin@pharma.com",
    password: "admin123",
    role: "Admin",
    companyName: "PharmaChain Registry",
    licenseNumber: "LIC-ADM-000",
    isApproved: true,
    ethAddress: "0x90F79bf6EB2c4f870365E785982E1f101E93b906", // dev account #3 (governance signer 1)
    location: { city: "New Delhi", lat: 28.6139, lon: 77.209 }
  },
  {
    name: "Regulator Officer Two",
    email: "officer2@pharma.com",
    password: "officer123",
    role: "Admin",
    companyName: "PharmaChain Registry",
    licenseNumber: "LIC-ADM-002",
    isApproved: true,
    ethAddress: "0x976EA74026E726554dB657fA54763abd0C3a0aa9", // dev account #6 (governance signer 2)
    location: { city: "New Delhi", lat: 28.6139, lon: 77.209 }
  },
  {
    name: "Regulator Officer Three",
    email: "officer3@pharma.com",
    password: "officer123",
    role: "Admin",
    companyName: "PharmaChain Registry",
    licenseNumber: "LIC-ADM-003",
    isApproved: true,
    ethAddress: "0x14dC79964da2C08b23698B3D3cc7Ca32193d9955", // dev account #7 (governance signer 3)
    location: { city: "Mumbai", lat: 19.076, lon: 72.8777 }
  },
  {
    name: "Alice Manufacturer",
    email: "manufacturer@pharma.com",
    password: "manufacturer123",
    role: "Manufacturer",
    companyName: "PharmaMfg Corp",
    licenseNumber: "LIC-MFR-001",
    isApproved: true,
    ethAddress: "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266", // dev account #0
    location: { city: "Hyderabad", lat: 17.385, lon: 78.4867 }
  },
  {
    name: "Bob Distributor",
    email: "distributor@pharma.com",
    password: "distributor123",
    role: "Distributor",
    companyName: "PharmaDist Logistics",
    licenseNumber: "LIC-DST-001",
    isApproved: true,
    ethAddress: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8", // dev account #1
    location: { city: "Bengaluru", lat: 12.9716, lon: 77.5946 }
  },
  {
    name: "Charlie Pharmacy",
    email: "pharmacy@pharma.com",
    password: "pharmacy123",
    role: "Pharmacy",
    companyName: "CareRx Pharmacy",
    licenseNumber: "LIC-RX-001",
    isApproved: true,
    ethAddress: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC", // dev account #2
    location: { city: "Coimbatore", lat: 11.0168, lon: 76.9558 }
  }
];

const seedUsers = async () => {
  try {
    console.log("Seeding / updating default consortium members...");
    for (const u of users) {
      const data = { ...u, ethAddress: u.ethAddress.toLowerCase(), licenseDocumentUrl: PLACEHOLDER_LICENSE_URL };
      const user = await User.findOne({ email: data.email });
      if (user) {
        // update in place (never touches the password)
        user.ethAddress = data.ethAddress;
        if (!user.location || user.location.lat === undefined) user.location = data.location;
        await user.save();
      } else {
        await User.create(data);
        console.log(`Seeded user: ${data.email} (${data.role})`);
      }
    }
    console.log("Seeding complete!");
  } catch (error) {
    console.error("Seeding error:", error.message);
  }
};

module.exports = seedUsers;
