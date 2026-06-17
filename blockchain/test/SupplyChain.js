const { expect } = require("chai");
const { ethers } = require("hardhat");

describe("SupplyChain Contract", function () {
  let SupplyChain;
  let supplyChain;
  let owner;
  let manufacturer;
  let distributor;
  let pharmacy;
  let unregistered;

  beforeEach(async function () {
    [owner, manufacturer, distributor, pharmacy, unregistered] = await ethers.getSigners();
    SupplyChain = await ethers.getContractFactory("SupplyChain");
    supplyChain = await SupplyChain.deploy();
  });

  describe("Batch Registration", function () {
    it("should allow a manufacturer to register a batch", async function () {
      const batchId = "BATCH-001";
      const drugName = "Paracetamol";
      const productCode = "PC-12345";
      const quantity = 1000;
      const productionDate = Math.floor(Date.now() / 1000) - 3600; // 1 hour ago
      const expiryDate = Math.floor(Date.now() / 1000) + 3600 * 24 * 365; // 1 year from now

      await expect(
        supplyChain.connect(manufacturer).registerBatch(
          batchId,
          drugName,
          productCode,
          quantity,
          productionDate,
          expiryDate
        )
      )
        .to.emit(supplyChain, "BatchRegistered");

      const batch = await supplyChain.getBatch(batchId);
      expect(batch.batchId).to.equal(batchId);
      expect(batch.drugName).to.equal(drugName);
      expect(batch.manufacturer).to.equal(manufacturer.address);
      expect(batch.currentOwner).to.equal(manufacturer.address);
      expect(batch.status).to.equal("Manufactured");
    });

    it("should revert if batch ID is already registered", async function () {
      const batchId = "BATCH-001";
      const productionDate = Math.floor(Date.now() / 1000);
      const expiryDate = productionDate + 10000;

      await supplyChain.connect(manufacturer).registerBatch(batchId, "A", "B", 10, productionDate, expiryDate);

      await expect(
        supplyChain.connect(manufacturer).registerBatch(batchId, "A", "B", 10, productionDate, expiryDate)
      ).to.be.revertedWith("Batch ID already exists");
    });
  });

  describe("Ownership Transfer and Acceptance", function () {
    const batchId = "BATCH-002";

    beforeEach(async function () {
      const productionDate = Math.floor(Date.now() / 1000);
      const expiryDate = productionDate + 10000;
      await supplyChain.connect(manufacturer).registerBatch(batchId, "A", "B", 10, productionDate, expiryDate);
    });

    it("should allow owner to initiate a transfer", async function () {
      await expect(supplyChain.connect(manufacturer).transferOwnership(batchId, distributor.address))
        .to.emit(supplyChain, "TransferInitiated");

      const batch = await supplyChain.getBatch(batchId);
      expect(batch.currentOwner).to.equal(distributor.address);
      expect(batch.status).to.equal("In Transit");
    });

    it("should revert if a non-owner tries to transfer", async function () {
      await expect(
        supplyChain.connect(distributor).transferOwnership(batchId, pharmacy.address)
      ).to.be.revertedWith("Caller is not the current owner");
    });

    it("should allow the new owner to accept the shipment", async function () {
      await supplyChain.connect(manufacturer).transferOwnership(batchId, distributor.address);

      await expect(supplyChain.connect(distributor).acceptShipment(batchId))
        .to.emit(supplyChain, "ShipmentAccepted");

      const batch = await supplyChain.getBatch(batchId);
      expect(batch.status).to.equal("Received");
      
      const history = await supplyChain.getBatchHistory(batchId);
      expect(history.custodyList[0]).to.equal(manufacturer.address);
      expect(history.custodyList[1]).to.equal(distributor.address);
    });

    it("should revert if shipment is accepted when not in transit", async function () {
      await expect(
        supplyChain.connect(manufacturer).acceptShipment(batchId)
      ).to.be.revertedWith("Batch is not in transit");
    });
  });

  describe("Batch Recall", function () {
    const batchId = "BATCH-003";

    beforeEach(async function () {
      const productionDate = Math.floor(Date.now() / 1000);
      const expiryDate = productionDate + 10000;
      await supplyChain.connect(manufacturer).registerBatch(batchId, "A", "B", 10, productionDate, expiryDate);
    });

    it("should allow manufacturer to recall their batch", async function () {
      await expect(supplyChain.connect(manufacturer).recallBatch(batchId))
        .to.emit(supplyChain, "BatchRecalled");

      const batch = await supplyChain.getBatch(batchId);
      expect(batch.status).to.equal("Recalled");
    });

    it("should revert if a non-manufacturer tries to recall", async function () {
      await expect(
        supplyChain.connect(distributor).recallBatch(batchId)
      ).to.be.revertedWith("Caller is not the manufacturer");
    });
  });
});
