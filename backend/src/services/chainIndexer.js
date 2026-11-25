/**
 * Chain indexer - the ONLY writer of batch state in MongoDB.
 *
 * Polls PharmaChain + AccessRegistry logs block-range by block-range, stores each log once in
 * ChainEvent (idempotent on txHash+logIndex) and re-reads the affected batches from contract
 * storage. Because state is always re-read from the chain, the cache cannot drift from the
 * ledger, and the whole database can be rebuilt by replaying from the deploy block.
 *
 * Attack signals emitted by the contract (CloneDetected, CounterfeitDetected, DiversionDetected,
 * ColdChainBreach) are turned into Anomaly records with source = "on-chain".
 */
const { ethers } = require("ethers");
const { getChain, viewToPlain } = require("../config/chain");
const Batch = require("../models/Batch");
const User = require("../models/User");
const Anomaly = require("../models/Anomaly");
const ChainEvent = require("../models/ChainEvent");
const SyncState = require("../models/SyncState");
const UnitCommitment = require("../models/UnitCommitment");

const POLL_MS = Number(process.env.INDEXER_POLL_MS || 2000);
const RANGE = 2000;

const state = { running: false, lastBlock: null, head: null, lastError: null, chainId: null };
const blockTimeCache = new Map();

async function blockTime(provider, blockNumber) {
  if (!blockTimeCache.has(blockNumber)) {
    const b = await provider.getBlock(blockNumber);
    blockTimeCache.set(blockNumber, new Date(Number(b.timestamp) * 1000));
    if (blockTimeCache.size > 5000) blockTimeCache.delete(blockTimeCache.keys().next().value);
  }
  return blockTimeCache.get(blockNumber);
}

async function userIdFor(address) {
  if (!address) return null;
  const u = await User.findOne({ ethAddress: address.toLowerCase() }).select("_id");
  return u ? u._id : null;
}

/** Re-reads one batch from contract storage and upserts the cache document. */
async function refreshBatch(chain, key, extra = {}) {
  const v = viewToPlain(await chain.pharma.getBatchByKey(key));
  let originBatchId = v.batchId;
  if (v.originKey.toLowerCase() !== key.toLowerCase()) {
    const origin = await chain.pharma.getBatchByKey(v.originKey);
    originBatchId = origin.batch.batchId;
  }
  let parentBatchId = null;
  if (v.parentKey !== ethers.ZeroHash) {
    const parent = await chain.pharma.getBatchByKey(v.parentKey);
    parentBatchId = parent.batch.batchId;
  }
  const [custody] = await chain.pharma.getBatchHistory(v.batchId);

  const update = {
    batchId: v.batchId,
    batchKey: key.toLowerCase(),
    originBatchId,
    originKey: v.originKey.toLowerCase(),
    parentBatchId,
    drugName: v.drugName,
    productCode: v.productCode,
    manufacturer: await userIdFor(v.manufacturer),
    manufacturerEthAddress: v.manufacturer,
    currentOwner: await userIdFor(v.currentOwner),
    currentOwnerEthAddress: v.currentOwner,
    pendingOwnerEthAddress: v.pendingOwner,
    custody: custody.map((a) => a.toLowerCase()),
    quantity: v.quantity,
    lotSize: v.lotSize,
    packsPerCarton: v.packsPerCarton,
    cartonsPerCase: v.cartonsPerCase,
    privateLot: v.privateLot,
    unitStart: v.unitStart,
    unitEnd: v.unitEnd,
    dispensedCount: v.dispensed,
    unitRoot: v.unitRoot.toLowerCase(),
    productionDate: v.productionDate,
    expiryDate: v.expiryDate,
    minTempC: v.minTempC,
    maxTempC: v.maxTempC,
    status: v.status,
    quarantined: v.quarantined,
    recalled: v.recalled,
    ...extra
  };
  return Batch.findOneAndUpdate({ batchKey: key.toLowerCase() }, { $set: update }, { upsert: true, new: true });
}

async function pushHistory(key, entry) {
  await Batch.updateOne({ batchKey: key.toLowerCase() }, { $push: { history: entry } });
}

async function raiseAnomaly(chain, ev, type, severity, describe) {
  const holding = await chain.pharma.getBatchByKey(ev.args.holdingKey);
  const origin = await chain.pharma.getBatchByKey(ev.args.originKey);
  const unitIndex = Number(ev.args.unitIndex);
  const reporterUser = await User.findOne({ ethAddress: ev.args.reporter.toLowerCase() }).select("companyName name");
  const where = reporterUser ? reporterUser.companyName || reporterUser.name : ev.args.reporter;
  await Anomaly.create({
    batchId: holding.batch.batchId,
    originBatchId: origin.batch.batchId,
    type,
    severity,
    description: describe({ unitIndex, where, lot: origin.batch.batchId, shipment: holding.batch.batchId }),
    source: "on-chain",
    unitIndex,
    reporter: ev.args.reporter.toLowerCase(),
    txHash: ev.txHash,
    blockNumber: ev.blockNumber,
    detectedBy: "PharmaChain smart contract"
  });
}

async function handle(chain, ev) {
  const a = ev.args;
  const meta = { txHash: ev.txHash, blockNumber: ev.blockNumber, timestamp: ev.timestamp };
  switch (ev.name) {
    case "BatchRegistered":
      await refreshBatch(chain, a.key, { lotSize: Number(a.quantity), txHash: ev.txHash, blockNumber: ev.blockNumber });
      await pushHistory(a.key, { ...meta, action: "Created", from: "system", to: a.manufacturer });
      break;
    case "TransferInitiated":
      await refreshBatch(chain, a.key);
      await pushHistory(a.key, { ...meta, action: "Transfer Initiated", from: a.from, to: a.to });
      break;
    case "TransferCancelled":
      await refreshBatch(chain, a.key);
      await pushHistory(a.key, { ...meta, action: "Transfer Cancelled", from: a.by, to: a.by });
      break;
    case "ShipmentAccepted":
      await refreshBatch(chain, a.key);
      await pushHistory(a.key, { ...meta, action: "Shipment Accepted", from: "system", to: a.owner });
      break;
    case "BatchSplit": {
      const parent = await refreshBatch(chain, a.parentKey);
      await refreshBatch(chain, a.childKey, { txHash: ev.txHash, blockNumber: ev.blockNumber });
      const note = `units [${a.unitStart}, ${a.unitEnd}) moved from ${a.parentId} to ${a.childId}`;
      await pushHistory(a.parentKey, { ...meta, action: "Split", from: parent.currentOwnerEthAddress, to: parent.currentOwnerEthAddress, note });
      // child inherits the parent's history so its audit trail starts at manufacture
      const child = await Batch.findOne({ batchKey: a.childKey.toLowerCase() });
      if (child && child.history.length === 0) {
        child.history = parent.history.map((h) => h.toObject());
        await child.save();
      }
      break;
    }
    case "UnitDispensed":
      await refreshBatch(chain, a.holdingKey);
      break;
    case "CloneDetected":
      await raiseAnomaly(chain, ev, "Cloned Unit Label", "Critical", (x) =>
        `Unit #${x.unitIndex} of lot ${x.lot} was presented for dispensing at ${x.where} although it had ALREADY been dispensed. The physical label has been copied.`
      );
      break;
    case "CounterfeitDetected":
      await raiseAnomaly(chain, ev, "Forged Unit Label", "Critical", (x) =>
        `A label claiming to be unit #${x.unitIndex} of lot ${x.lot} failed Merkle-proof verification at ${x.where}. The label was not issued by the manufacturer.`
      );
      break;
    case "DiversionDetected":
      await raiseAnomaly(chain, ev, "Unit Diversion", "High", (x) =>
        `Genuine unit #${x.unitIndex} of lot ${x.lot} turned up at ${x.where} (shipment ${x.shipment}), which never received that unit's range. Possible grey-market diversion.`
      );
      break;
    case "BatchRecalled": {
      const docs = await Batch.find({ originKey: a.originKey.toLowerCase() }).select("batchKey");
      for (const d of docs) await refreshBatch(chain, d.batchKey);
      await pushHistory(ethers.id(a.batchId), { ...meta, action: "Recalled", from: a.by, to: a.by, note: a.reason });
      break;
    }
    case "BatchQuarantined":
      await refreshBatch(chain, a.key);
      await pushHistory(a.key, { ...meta, action: "Quarantined", from: a.by, to: a.by, note: a.reason });
      break;
    case "QuarantineReleased":
      await refreshBatch(chain, a.key);
      await pushHistory(a.key, { ...meta, action: "Quarantine Released", from: a.by, to: a.by });
      break;
    case "AggregationVerified":
      await pushHistory(a.key, {
        ...meta,
        action: "Aggregated Receipt",
        from: "system",
        to: "system",
        note: `${a.scans} case/carton label(s) proven to cover units ${a.unitStart}-${Number(a.unitEnd) - 1}`
      });
      break;
    case "CartonDispensed":
    case "PrivateUnitDispensed":
      await refreshBatch(chain, a.holdingKey);
      break;
    case "ReturnRequested":
      await pushHistory(a.holdingKey, { ...meta, action: "Return Requested", from: a.pharmacy, to: a.pharmacy, note: `unit #${a.unitIndex}: ${a.reason}` });
      break;
    case "UnitReturned":
      await refreshBatch(chain, a.holdingKey);
      await pushHistory(a.holdingKey, { ...meta, action: "Unit Returned", from: a.approvedBy, to: a.approvedBy, note: `unit #${a.unitIndex} restocked after regulator approval` });
      break;

    // ---------------- ColdChainMonitor
    case "SensorsAssigned":
      await pushHistory(a.key, { ...meta, action: "Sensors Assigned", from: "system", to: "system", note: `3 signed sensors: ${a.sensors.map((x) => x.slice(0, 8)).join(", ")}` });
      break;
    case "ReadingAccepted":
      await Batch.updateOne(
        { batchKey: a.key.toLowerCase() },
        { $set: { mktC: Number(a.mktDeci) / 10, lastTempC: Number(a.agreedDeci) / 10 }, $inc: { sensorReadings: 1 } }
      );
      break;
    case "SensorOutlier":
    case "SensorDisagreement": {
      const b = await Batch.findOne({ batchKey: a.key.toLowerCase() }).select("batchId originBatchId");
      await Anomaly.create({
        batchId: b ? b.batchId : a.key,
        originBatchId: b ? b.originBatchId : undefined,
        type: ev.name === "SensorOutlier" ? "Sensor Outlier" : "Sensor Disagreement",
        severity: "Medium",
        description:
          ev.name === "SensorOutlier"
            ? `Sensor ${a.sensor} reported ${Number(a.tempDeci) / 10} degC in window #${a.seq}, disagreeing with the other two. Reading out-voted (2-of-3); check the device.`
            : `In window #${a.seq} no two of the ${a.validSignatures} signed sensor readings agreed within 1.0 degC. Window ignored; possible tampering or failing loggers.`,
        source: "on-chain",
        txHash: ev.txHash,
        blockNumber: ev.blockNumber,
        detectedBy: "ColdChainMonitor (2-of-3 sensors)"
      });
      break;
    }
    case "ColdChainBreach":
      await Anomaly.create({
        batchId: a.batchId,
        type: "Cold Chain Breach",
        severity: "High",
        description: `${a.reason}: last agreed reading ${Number(a.agreedDeci) / 10} degC, Mean Kinetic Temperature ${Number(a.mktDeci) / 10} degC. Confirmed by at least 2 of 3 signed sensors; shipment auto-quarantined on-chain.`,
        source: "on-chain",
        txHash: ev.txHash,
        blockNumber: ev.blockNumber,
        detectedBy: "ColdChainMonitor (MKT)"
      });
      break;
    default:
      // zero-knowledge module: a re-used nullifier is a clone of a private pack
      if (/Clone/.test(ev.name) && ev.contract === "PrivateDispenser") {
        await Anomaly.create({
          batchId: a.batchId || a.holdingBatchId || "private lot",
          type: "Cloned Unit Label",
          severity: "Critical",
          description: `A private (zero-knowledge) pack was presented again: nullifier ${String(a.nullifier || "").slice(0, 18)}... already spent. The pack itself stays anonymous.`,
          source: "on-chain",
          txHash: ev.txHash,
          blockNumber: ev.blockNumber,
          detectedBy: "PrivateDispenser (nullifier)"
        });
      }
      break; // registry / governance / validator events: kept in ChainEvent only
  }
}

function serialiseArgs(fragment, args) {
  const out = {};
  fragment.inputs.forEach((input, i) => {
    const v = args[i];
    out[input.name] = typeof v === "bigint" ? v.toString() : v;
  });
  return out;
}

async function resetIfChainChanged(chain) {
  const genesis = await chain.provider.getBlock(0);
  const head = await chain.provider.getBlockNumber();
  const chainId = Number((await chain.provider.getNetwork()).chainId);
  const addr = chain.details.pharmaChain.address.toLowerCase();
  let s = await SyncState.findById("indexer");

  const changed = !s || s.genesisHash !== genesis.hash || s.pharmaAddress !== addr || s.lastBlock > head;
  if (changed) {
    if (s) {
      console.log("[indexer] chain or contract changed (new genesis / redeploy) - rebuilding cache from the ledger");
    }
    // Never throw data away: snapshot the old ledger's cache into archive_<timestamp>_<collection>
    // collections, then clear the live collections for the new ledger.
    const stamp = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
    for (const model of [Batch, ChainEvent, UnitCommitment, Anomaly]) {
      const name = model.collection.collectionName;
      if ((await model.estimatedDocumentCount()) > 0) {
        await model.aggregate([{ $match: {} }, { $out: `archive_${stamp}_${name}` }]);
        console.log(`[indexer] archived ${name} -> archive_${stamp}_${name}`);
      }
    }
    await Promise.all([Batch.deleteMany({}), ChainEvent.deleteMany({}), UnitCommitment.deleteMany({}), Anomaly.deleteMany({})]);
    await reconcileApprovals(chain);
    s = await SyncState.findOneAndUpdate(
      { _id: "indexer" },
      { chainId, genesisHash: genesis.hash, pharmaAddress: addr, lastBlock: (chain.details.deployBlock || 1) - 1 },
      { upsert: true, new: true }
    );
  }
  state.chainId = chainId;
  return s;
}

/**
 * The database approval only mirrors the on-chain role. When contracts are redeployed the new
 * AccessRegistry is empty (except the demo members onboarded by deploy.js), so organisations that
 * were admitted on the old contracts must be admitted again by the regulator.
 */
async function reconcileApprovals(chain) {
  const users = await User.find({ role: { $ne: "Admin" }, isApproved: true, ethAddress: { $exists: true, $ne: null } });
  for (const u of users) {
    try {
      const role = Number(await chain.registry.activeRoleOf(u.ethAddress));
      if (role === 0) {
        u.isApproved = false;
        await u.save();
        console.log(`[indexer] ${u.email} has no role on the current contracts - marked pending re-admission`);
      }
    } catch {
      /* node unreachable: leave unchanged */
    }
  }
}

async function syncOnce() {
  const chain = getChain();
  if (!chain) {
    state.lastError = "contractDetails.json not found - deploy the contracts first";
    return;
  }
  const s = await resetIfChainChanged(chain);
  const head = await chain.provider.getBlockNumber();
  state.head = head;
  let from = s.lastBlock + 1;

  const contracts = [
    { name: "PharmaChain", c: chain.pharma },
    { name: "AccessRegistry", c: chain.registry },
    { name: "ColdChainMonitor", c: chain.monitor },
    { name: "Governance", c: chain.governance },
    { name: "ValidatorSet", c: chain.validatorSet },
    { name: "PrivateDispenser", c: chain.privateDispenser }
  ].filter((x) => x.c);
  const byAddress = Object.fromEntries(contracts.map((x) => [x.c.target.toLowerCase(), x]));

  while (from <= head) {
    const to = Math.min(from + RANGE - 1, head);
    const logs = await chain.provider.getLogs({ address: Object.keys(byAddress), fromBlock: from, toBlock: to });
    for (const log of logs) {
      const owner = byAddress[log.address.toLowerCase()];
      const parsed = owner.c.interface.parseLog(log);
      if (!parsed) continue;
      const exists = await ChainEvent.exists({ txHash: log.transactionHash.toLowerCase(), logIndex: log.index });
      if (exists) continue;

      const ev = {
        name: parsed.name,
        args: parsed.args,
        txHash: log.transactionHash,
        blockNumber: log.blockNumber,
        timestamp: await blockTime(chain.provider, log.blockNumber),
        contract: owner.name
      };
      await handle(chain, ev);

      const args = serialiseArgs(parsed.fragment, parsed.args);
      await ChainEvent.create({
        contract: owner.name,
        name: parsed.name,
        txHash: log.transactionHash,
        logIndex: log.index,
        blockNumber: log.blockNumber,
        blockHash: log.blockHash,
        timestamp: ev.timestamp,
        batchKey: args.key || args.holdingKey || args.parentKey,
        originKey: args.originKey,
        batchId: args.batchId || args.childId,
        unitIndex: args.unitIndex !== undefined ? Number(args.unitIndex) : undefined,
        actor: args.manufacturer || args.from || args.owner || args.by || args.pharmacy || args.reporter || args.oracle || args.account || args.approvedBy || args.sensor || args.proposer || args.signer || args.executor,
        args
      });
    }
    await SyncState.updateOne({ _id: "indexer" }, { lastBlock: to, lastSyncedAt: new Date() });
    state.lastBlock = to;
    from = to + 1;
  }
  state.lastBlock = head;
  state.lastError = null;
}

/** Waits until the indexer has caught up with `blockNumber` (used after the dApp submits a tx). */
async function waitForBlock(blockNumber, timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (state.lastBlock !== null && state.lastBlock >= blockNumber) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

function start() {
  if (state.running) return;
  state.running = true;
  let warned = false;
  const loop = async () => {
    try {
      await syncOnce();
      warned = false;
    } catch (err) {
      state.lastError = err.shortMessage || err.message;
      if (!warned) console.warn(`[indexer] waiting for blockchain: ${state.lastError}`);
      warned = true;
    }
    setTimeout(loop, POLL_MS);
  };
  loop();
  console.log(`[indexer] started (poll ${POLL_MS} ms)`);
}

module.exports = { start, state, waitForBlock, refreshBatch };
