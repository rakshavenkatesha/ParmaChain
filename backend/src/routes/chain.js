/**
 * Block explorer API - exposes the raw ledger (blocks, hash links, validators, decoded
 * transactions) so the chain itself can be inspected from the dApp.
 */
const express = require("express");
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const { getChain } = require("../config/chain");
const ChainEvent = require("../models/ChainEvent");
const indexer = require("../services/chainIndexer");

const router = express.Router();

function requireChain(res) {
  const chain = getChain();
  if (!chain) {
    res.status(503).json({ success: false, message: "Contracts not deployed - run the deploy script first" });
    return null;
  }
  return chain;
}

async function rpc(chain, method, params = []) {
  try {
    return await chain.provider.send(method, params);
  } catch {
    return null;
  }
}

/** Decodes the QBFT extraData of a block: RLP([vanity, validators[], vote, round, seals[]]). */
function decodeQbftExtra(extraData) {
  try {
    const d = ethers.decodeRlp(extraData);
    if (!Array.isArray(d) || d.length < 5) return null;
    let vanityText = null;
    try {
      vanityText = ethers.decodeBytes32String(d[0]);
    } catch {
      /* not text */
    }
    return {
      vanity: d[0],
      vanityText,
      validators: d[1],
      round: d[3] === "0x" ? 0 : Number(d[3]),
      commitSeals: Array.isArray(d[4]) ? d[4].length : 0
    };
  } catch {
    return null;
  }
}

function summariseBlock(b) {
  return {
    number: b.number,
    hash: b.hash,
    parentHash: b.parentHash,
    timestamp: new Date(Number(b.timestamp) * 1000),
    proposer: b.miner,
    gasUsed: b.gasUsed.toString(),
    gasLimit: b.gasLimit.toString(),
    txCount: b.transactions.length,
    stateRoot: b.stateRoot,
    extraData: b.extraData
  };
}

const VALIDATOR_CONTRACT = "0x0000000000000000000000000000000000009999";

/** Every contract of the system that the explorer can decode. */
function knownContracts(chain) {
  return [
    { name: "PharmaChain", c: chain.pharma },
    { name: "AccessRegistry", c: chain.registry },
    { name: "ColdChainMonitor", c: chain.monitor },
    { name: "Governance", c: chain.governance },
    { name: "ValidatorSet", c: chain.validatorSet },
    { name: "PrivateDispenser", c: chain.privateDispenser }
  ].filter((t) => t.c);
}

function decodeTx(chain, tx) {
  const to = (tx.to || "").toLowerCase();
  const targets = knownContracts(chain);
  for (const t of targets) {
    if (t.c.target.toLowerCase() === to) {
      try {
        const p = t.c.interface.parseTransaction({ data: tx.data, value: tx.value });
        const args = {};
        p.fragment.inputs.forEach((inp, i) => {
          const v = p.args[i];
          args[inp.name] = JSON.parse(JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x)));
        });
        return { contract: t.name, method: p.name, args };
      } catch {
        return { contract: t.name, method: "unknown" };
      }
    }
  }
  return { contract: tx.to ? null : "(contract creation)", method: null };
}

// @route GET /api/chain/overview
router.get("/overview", async (req, res) => {
  const chain = requireChain(res);
  if (!chain) return;
  try {
    const [network, head, genesis, peers, validators] = await Promise.all([
      chain.provider.getNetwork(),
      chain.provider.getBlockNumber(),
      chain.provider.getBlock(0),
      rpc(chain, "net_peerCount"),
      rpc(chain, "qbft_getValidatorsByBlockNumber", ["latest"])
    ]);
    const latest = await chain.provider.getBlock(head);
    const prev = head > 10 ? await chain.provider.getBlock(head - 10) : genesis;
    const avgBlockTime = head > 0 ? (Number(latest.timestamp) - Number(prev.timestamp)) / Math.max(1, head - prev.number) : null;
    const qbft = Array.isArray(validators);
    // v3: QBFT reads validators from the ValidatorSet contract placed in the genesis alloc
    let validatorContract = null;
    let contractValidators = [];
    try {
      if ((await chain.provider.getCode(VALIDATOR_CONTRACT)) !== "0x") {
        const vs = new ethers.Contract(VALIDATOR_CONTRACT, ["function getValidators() view returns (address[])", "function controller() view returns (address)"], chain.provider);
        const [list, controller] = await Promise.all([vs.getValidators(), vs.controller().catch(() => null)]);
        contractValidators = list.map((a) => a.toLowerCase());
        validatorContract = { address: VALIDATOR_CONTRACT, controller, governedByMultisig: !!controller && controller !== ethers.ZeroAddress };
      }
    } catch {
      /* dev chain */
    }
    res.json({
      success: true,
      data: {
        chainId: Number(network.chainId),
        network: chain.details.network,
        rpcUrl: chain.rpcUrl,
        consensus: qbft ? "QBFT (Byzantine fault-tolerant Proof-of-Authority)" : "Hardhat automine (development)",
        validators: qbft ? validators : [],
        validatorSelection: validatorContract ? "contract" : qbft ? "block-header votes" : "none",
        validatorContract,
        contractValidators,
        faultTolerance: qbft ? Math.floor((validators.length - 1) / 3) : 0,
        peerCount: peers ? Number(peers) : 0,
        latestBlock: head,
        avgBlockTimeSec: avgBlockTime,
        genesis: { ...summariseBlock(genesis), qbft: decodeQbftExtra(genesis.extraData) },
        contracts: {
          pharmaChain: chain.details.pharmaChain.address,
          registry: chain.details.registry.address,
          deployBlock: chain.details.deployBlock
        },
        indexer: { ...indexer.state }
      }
    });
  } catch (error) {
    res.status(502).json({ success: false, message: `Blockchain node unreachable: ${error.shortMessage || error.message}` });
  }
});

// @route GET /api/chain/blocks?limit=15&before=<number>
router.get("/blocks", async (req, res) => {
  const chain = requireChain(res);
  if (!chain) return;
  try {
    const limit = Math.min(Number(req.query.limit) || 15, 50);
    const head = await chain.provider.getBlockNumber();
    const top = req.query.before !== undefined ? Math.min(Number(req.query.before) - 1, head) : head;
    const nums = [];
    for (let n = top; n >= 0 && nums.length < limit; n--) nums.push(n);
    const blocks = await Promise.all(nums.map((n) => chain.provider.getBlock(n)));
    res.json({ success: true, head, data: blocks.map(summariseBlock) });
  } catch (error) {
    res.status(502).json({ success: false, message: error.shortMessage || error.message });
  }
});

// @route GET /api/chain/blocks/:number
router.get("/blocks/:number", async (req, res) => {
  const chain = requireChain(res);
  if (!chain) return;
  try {
    const b = await chain.provider.getBlock(Number(req.params.number), true);
    if (!b) return res.status(404).json({ success: false, message: "Block not found" });
    const txs = [];
    for (const tx of b.prefetchedTransactions) {
      const receipt = await chain.provider.getTransactionReceipt(tx.hash);
      txs.push({
        hash: tx.hash,
        from: tx.from,
        to: tx.to,
        nonce: tx.nonce,
        gasUsed: receipt ? receipt.gasUsed.toString() : null,
        status: receipt ? receipt.status : null,
        ...decodeTx(chain, tx)
      });
    }
    res.json({
      success: true,
      data: { ...summariseBlock(b), qbft: decodeQbftExtra(b.extraData), transactions: txs }
    });
  } catch (error) {
    res.status(502).json({ success: false, message: error.shortMessage || error.message });
  }
});

// @route GET /api/chain/tx/:hash
router.get("/tx/:hash", async (req, res) => {
  const chain = requireChain(res);
  if (!chain) return;
  try {
    const tx = await chain.provider.getTransaction(req.params.hash);
    if (!tx) return res.status(404).json({ success: false, message: "Transaction not found" });
    const receipt = await chain.provider.getTransactionReceipt(req.params.hash);
    const logs = [];
    for (const log of receipt.logs) {
      for (const c of knownContracts(chain).map((t) => t.c)) {
        if (c.target.toLowerCase() !== log.address.toLowerCase()) continue;
        const p = c.interface.parseLog(log);
        if (p) {
          const args = {};
          p.fragment.inputs.forEach((inp, i) => (args[inp.name] = typeof p.args[i] === "bigint" ? p.args[i].toString() : p.args[i]));
          logs.push({ event: p.name, args });
        }
      }
    }
    res.json({
      success: true,
      data: {
        hash: tx.hash,
        blockNumber: tx.blockNumber,
        from: tx.from,
        to: tx.to,
        status: receipt.status,
        gasUsed: receipt.gasUsed.toString(),
        ...decodeTx(chain, tx),
        events: logs
      }
    });
  } catch (error) {
    res.status(502).json({ success: false, message: error.shortMessage || error.message });
  }
});

// @desc  Re-verify the hash chain: every block's parentHash must equal the previous block's hash.
// @route GET /api/chain/integrity?from=0&to=latest
router.get("/integrity", async (req, res) => {
  const chain = requireChain(res);
  if (!chain) return;
  try {
    const head = await chain.provider.getBlockNumber();
    const to = req.query.to !== undefined ? Math.min(Number(req.query.to), head) : head;
    const from = Math.max(0, req.query.from !== undefined ? Number(req.query.from) : to - 199);
    const started = Date.now();
    let prev = from > 0 ? await chain.provider.getBlock(from - 1) : null;
    const broken = [];
    for (let n = from; n <= to; n++) {
      const b = await chain.provider.getBlock(n);
      if (prev && b.parentHash !== prev.hash) broken.push({ block: n, expectedParent: prev.hash, actualParent: b.parentHash });
      prev = b;
    }
    res.json({
      success: true,
      data: { from, to, blocksChecked: to - from + 1, intact: broken.length === 0, broken, ms: Date.now() - started }
    });
  } catch (error) {
    res.status(502).json({ success: false, message: error.shortMessage || error.message });
  }
});

// @desc  Per-validator health: height, peers, and how many of the recent blocks each one proposed.
// @route GET /api/chain/validators?window=50
router.get("/validators", async (req, res) => {
  const chain = requireChain(res);
  if (!chain) return;
  try {
    const windowSize = Math.min(Number(req.query.window) || 50, 200);
    const head = await chain.provider.getBlockNumber();
    const from = Math.max(1, head - windowSize + 1);
    const blocks = await Promise.all(
      Array.from({ length: head - from + 1 }, (_, k) => chain.provider.getBlock(from + k))
    );
    const proposed = {};
    for (const b of blocks) proposed[b.miner.toLowerCase()] = (proposed[b.miner.toLowerCase()] || 0) + 1;
    const latestProposer = blocks.length ? blocks[blocks.length - 1].miner.toLowerCase() : null;

    let nodes = [];
    const netFile = path.resolve(__dirname, "../../../network/network.json");
    const live = await rpc(chain, "qbft_getValidatorsByBlockNumber", ["latest"]);
    if (fs.existsSync(netFile) && Array.isArray(live)) {
      const net = JSON.parse(fs.readFileSync(netFile, "utf8"));
      nodes = await Promise.all(
        net.validators.map(async (v) => {
          const p = new ethers.JsonRpcProvider(v.rpc, undefined, { staticNetwork: true });
          let online = false;
          let height = null;
          let peers = null;
          try {
            [height, peers] = await Promise.all([
              p.getBlockNumber(),
              p.send("net_peerCount", []).then((x) => Number(x))
            ]);
            online = true;
          } catch {
            /* node down */
          } finally {
            p.destroy();
          }
          return {
            name: v.name,
            label: v.label,
            address: v.address,
            rpc: v.rpc,
            online,
            height,
            peers,
            isValidator: live.map((a) => a.toLowerCase()).includes(v.address),
            proposed: proposed[v.address] || 0,
            isLatestProposer: latestProposer === v.address
          };
        })
      );
    } else {
      nodes = [
        { name: "hardhat", label: "Hardhat development node", address: latestProposer, online: true, height: head, peers: 0, isValidator: true, proposed: blocks.length, isLatestProposer: true }
      ];
    }
    res.json({ success: true, data: { head, window: blocks.length, quorum: Math.floor((2 * nodes.length) / 3) + 1, nodes } });
  } catch (error) {
    res.status(502).json({ success: false, message: error.shortMessage || error.message });
  }
});

// @desc  Time series of the last N blocks (for charts)
// @route GET /api/chain/stats?blocks=40
router.get("/stats", async (req, res) => {
  const chain = requireChain(res);
  if (!chain) return;
  try {
    const n = Math.min(Number(req.query.blocks) || 40, 150);
    const head = await chain.provider.getBlockNumber();
    const from = Math.max(0, head - n + 1);
    const blocks = await Promise.all(Array.from({ length: head - from + 1 }, (_, k) => chain.provider.getBlock(from + k)));
    const series = blocks.map((b, i) => ({
      number: b.number,
      txCount: b.transactions.length,
      gasUsed: Number(b.gasUsed),
      timestamp: Number(b.timestamp),
      interval: i > 0 ? Number(b.timestamp) - Number(blocks[i - 1].timestamp) : null
    }));
    const eventCounts = await ChainEvent.aggregate([{ $group: { _id: "$name", count: { $sum: 1 } } }]);
    res.json({ success: true, data: { series, eventCounts } });
  } catch (error) {
    res.status(502).json({ success: false, message: error.shortMessage || error.message });
  }
});

// @route GET /api/chain/events?batchId=&limit=
router.get("/events", async (req, res) => {
  const q = {};
  if (req.query.batchId) q.batchId = req.query.batchId;
  if (req.query.name) q.name = req.query.name;
  const events = await ChainEvent.find(q)
    .sort({ blockNumber: -1, logIndex: -1 })
    .limit(Math.min(Number(req.query.limit) || 50, 200));
  res.json({ success: true, data: events });
});

module.exports = router;
