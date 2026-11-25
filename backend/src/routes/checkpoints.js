/**
 * Public checkpoint anchoring status (mounted at /api/checkpoints).
 *
 * Reads the CheckpointAnchor on the public chain (Polygon Amoy or the local stand-in) and checks
 * every anchored block hash against the live consortium chain:
 *   match    - consortium still has exactly that block at that height
 *   mismatch - history was rewritten (or the node serves a different chain)
 *   pending  - consortium node unreachable, cannot verify right now
 */
const express = require("express");
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const { getChain } = require("../config/chain");

const router = express.Router();
const DETAILS = path.join(__dirname, "../config/checkpointDetails.json");

let cache = null;
function anchorFor(cfg) {
  if (!cache || cache.address !== cfg.address || cache.rpcUrl !== cfg.rpcUrl) {
    const url = process.env.PUBLIC_RPC_URL || cfg.rpcUrl;
    const provider = new ethers.JsonRpcProvider(url, cfg.publicChainId, { staticNetwork: true });
    cache = { address: cfg.address, rpcUrl: cfg.rpcUrl, provider, anchor: new ethers.Contract(cfg.address, cfg.abi, provider) };
  }
  return cache.anchor;
}

// @route GET /api/checkpoints?limit=10
router.get("/", async (req, res) => {
  if (!fs.existsSync(DETAILS)) {
    return res.json({ success: true, data: { configured: false, message: "No checkpoint anchor deployed (run scripts/checkpoint/deploy-anchor.js)" } });
  }
  const cfg = JSON.parse(fs.readFileSync(DETAILS, "utf8"));
  const config = {
    configured: true,
    publicNetwork: cfg.publicNetwork,
    publicChainId: cfg.publicChainId,
    rpcUrl: cfg.rpcUrl,
    address: cfg.address,
    interval: cfg.interval,
    explorerTx: cfg.explorerTx || null
  };
  const chain = getChain();
  if (!chain) return res.json({ success: true, data: { ...config, publicReachable: false, checkpoints: [], equivocations: [] } });

  const limit = Math.min(Number(req.query.limit) || 10, 50);
  const consortiumChainId = chain.details.chainId;
  const anchor = anchorFor(cfg);

  let raw;
  let total;
  let equivocations = [];
  try {
    [raw, total] = await Promise.all([anchor.recentCheckpoints(consortiumChainId, limit), anchor.checkpointCount(consortiumChainId)]);
    const eqCount = Number(await anchor.equivocationCount());
    for (let i = 0; i < eqCount; i++) {
      const e = await anchor.getEquivocation(i);
      if (Number(e.consortiumChainId) !== Number(consortiumChainId)) continue;
      equivocations.push({
        blockNumber: Number(e.blockNumber),
        anchoredHash: e.anchoredHash,
        conflictingHash: e.conflictingHash,
        publisher: e.publisher,
        reportedAt: new Date(Number(e.reportedAt) * 1000)
      });
    }
  } catch (error) {
    return res.json({
      success: true,
      data: { ...config, publicReachable: false, error: `Public chain unreachable: ${error.shortMessage || error.message}`, checkpoints: [], equivocations: [] }
    });
  }

  let head = null;
  try {
    head = await chain.provider.getBlockNumber();
  } catch {
    /* consortium down */
  }

  const checkpoints = [];
  for (const c of raw) {
    const blockNumber = Number(c.blockNumber);
    let status = "pending";
    let consortiumHash = null;
    if (head !== null) {
      try {
        const b = await chain.provider.getBlock(blockNumber);
        consortiumHash = b ? b.hash : null;
        status = b && b.hash === c.blockHash && b.stateRoot === c.stateRoot ? "match" : "mismatch";
      } catch {
        status = "pending";
      }
    }
    checkpoints.push({
      blockNumber,
      blockHash: c.blockHash,
      stateRoot: c.stateRoot,
      validatorSetHash: c.validatorSetHash,
      publisher: c.publisher,
      anchoredAt: new Date(Number(c.anchoredAt) * 1000),
      consortiumHash,
      status
    });
  }
  const latest = checkpoints[0] ? checkpoints[0].blockNumber : 0;
  res.json({
    success: true,
    data: {
      ...config,
      publicReachable: true,
      total: Number(total),
      consortiumHead: head,
      nextDue: latest + cfg.interval,
      lagBlocks: head !== null ? head - latest : null,
      checkpoints,
      equivocations
    }
  });
});

module.exports = router;
