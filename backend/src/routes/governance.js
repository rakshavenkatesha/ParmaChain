/**
 * Read API for the Governance multisig: proposals with decoded calldata and per-officer approvals.
 * Proposing / approving / executing are signed by the officers' wallets in the dApp.
 */
const express = require("express");
const { ethers } = require("ethers");
const { getChain } = require("../config/chain");
const User = require("../models/User");

const router = express.Router();

function governanceContract(chain) {
  const g = chain.details.governance;
  if (!g) return null;
  return new ethers.Contract(g.address, g.abi, chain.provider);
}

function decode(chain, target, data) {
  const known = [
    ["PharmaChain", chain.details.pharmaChain],
    ["AccessRegistry", chain.details.registry],
    ["ValidatorSet", chain.details.validatorSet],
    ["Governance", chain.details.governance]
  ];
  for (const [name, d] of known) {
    if (!d || d.address.toLowerCase() !== target.toLowerCase()) continue;
    try {
      const iface = new ethers.Interface(d.abi);
      const p = iface.parseTransaction({ data });
      const args = {};
      p.fragment.inputs.forEach((inp, i) => (args[inp.name] = typeof p.args[i] === "bigint" ? p.args[i].toString() : p.args[i]));
      return { contract: name, method: p.name, args };
    } catch {
      return { contract: name, method: "unknown", args: {} };
    }
  }
  return { contract: null, method: null, args: {} };
}

// @route GET /api/governance/proposals
router.get("/proposals", async (req, res) => {
  const chain = getChain();
  if (!chain) return res.status(503).json({ success: false, message: "Contracts not deployed" });
  const gov = governanceContract(chain);
  if (!gov) return res.json({ success: true, data: { signers: [], threshold: 0, proposals: [] } });
  try {
    const [signers, threshold, count] = await Promise.all([gov.getSigners(), gov.threshold(), gov.proposalCount()]);
    const officers = await User.find({ ethAddress: { $in: signers.map((s) => s.toLowerCase()) } }).select("name companyName ethAddress");
    const nameOf = (a) => officers.find((o) => o.ethAddress === a.toLowerCase())?.name || null;
    const proposals = [];
    for (let id = Number(count) - 1; id >= 0 && proposals.length < 50; id--) {
      const p = await gov.getProposal(id);
      const approvals = [];
      for (const s of signers) if (await gov.approvedBy(id, s)) approvals.push({ address: s.toLowerCase(), name: nameOf(s) });
      proposals.push({
        id,
        target: p.target,
        description: p.description,
        proposer: { address: p.proposer.toLowerCase(), name: nameOf(p.proposer) },
        createdAt: new Date(Number(p.createdAt) * 1000),
        approvals,
        executed: p.executed,
        cancelled: p.cancelled,
        call: decode(chain, p.target, p.data)
      });
    }
    res.json({
      success: true,
      data: {
        address: chain.details.governance.address,
        threshold: Number(threshold),
        signers: signers.map((s) => ({ address: s.toLowerCase(), name: nameOf(s) })),
        proposals
      }
    });
  } catch (error) {
    res.status(502).json({ success: false, message: error.shortMessage || error.message });
  }
});

module.exports = router;
