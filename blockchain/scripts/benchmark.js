/**
 * PharmaChain v3 evaluation harness (in-process Hardhat EVM).
 *
 *   npx hardhat run scripts/benchmark.js
 *   QUICK=1 npx hardhat run scripts/benchmark.js      (skips the 100,000-unit lot)
 *
 *   E1  lot registration gas vs N : ours (one hierarchical root) | naive per-serial | ERC-721 per pack | batch-level
 *   E2  dispense gas              : single decommissionUnit | carton multiproof (k = 1..32) | NFT burn | naive
 *   E2c receipt                   : acceptShipment | acceptWithAggregation (case / carton scans)
 *   E3  clone attack              : two-part labels | one-part ("leaked hidden code") | ERC-721 | batch-level | scan heuristic
 *   E6  cold chain                : 2-of-3 signed sensors + MKT  vs  single-sensor single-reading rule
 *
 * Writes benchmark-results/results.json and results.md
 */
const { ethers, network } = require("hardhat");
const fs = require("fs");
const path = require("path");
const M = require("../lib/unitMerkle");

const DAY = 86400;
const Role = { Manufacturer: 1, Distributor: 2, Pharmacy: 3, Oracle: 5 };
const TX_GAS_CAP = 16_000_000; // stay under the 2^24 per-tx cap (EIP-7825)
const NAIVE_CHUNK = 500;
const NFT_CHUNK = 250;
const MEASURE_MAX = 10_000; // larger sizes are extrapolated linearly for the O(N) baselines
const QUICK = !!process.env.QUICK;
const fmt = (x) => (x === null || x === undefined ? "-" : Number(x).toLocaleString("en-US"));
const pct = (a, b) => `${(((b - a) / b) * 100).toFixed(1)}%`;

// deterministic PRNG (LCG) so every run shuffles identically
function prng(seed) {
  let s = seed >>> 0;
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32);
}
function shuffle(arr, rnd) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function gasOf(p) {
  const rc = await (await p).wait();
  return Number(rc.gasUsed);
}

async function setup() {
  const s = await ethers.getSigners();
  const [mfr, dist, pharm, regulator, , , dist2, pharm2, officer2, officer3] = s;
  const registry = await ethers.deployContract("AccessRegistry", [regulator.address]);
  const governance = await ethers.deployContract("Governance", [[regulator.address, officer2.address, officer3.address], 2]);
  const chain = await ethers.deployContract("PharmaChain", [await registry.getAddress(), await governance.getAddress()]);
  const monitor = await ethers.deployContract("ColdChainMonitor", [await registry.getAddress(), await chain.getAddress()]);
  const naive = await ethers.deployContract("NaiveSerialRegistry");
  const nft = await ethers.deployContract("NftPackRegistry");
  const batchLevel = await ethers.deployContract("BatchLevelBaseline");
  const r = registry.connect(regulator);
  await r.registerParticipant(mfr.address, Role.Manufacturer, "M", ethers.ZeroHash);
  await r.registerParticipant(dist.address, Role.Distributor, "D", ethers.ZeroHash);
  await r.registerParticipant(pharm.address, Role.Pharmacy, "P", ethers.ZeroHash);
  await r.registerParticipant(pharm2.address, Role.Pharmacy, "P2", ethers.ZeroHash);
  await r.registerParticipant(await monitor.getAddress(), Role.Oracle, "Monitor", ethers.ZeroHash);
  return { chain, monitor, naive, nft, batchLevel, registry, mfr, dist, pharm, regulator, dist2, pharm2 };
}

async function now() {
  return (await ethers.provider.getBlock("latest")).timestamp;
}

async function registerOurs(ctx, batchId, lot, ppc, cpc, quantity) {
  const t = await now();
  return gasOf(
    ctx.chain.connect(ctx.mfr).registerBatch({
      batchId,
      drugName: "Benchmark Drug",
      productCode: "PC-BENCH",
      quantity,
      productionDate: t - DAY,
      expiryDate: t + 365 * DAY,
      minTempDeci: 20,
      maxTempDeci: 80,
      unitRoot: lot.root,
      packsPerCarton: ppc,
      cartonsPerCase: cpc,
      zkRoot: ethers.ZeroHash
    })
  );
}

async function toShelf(ctx, id) {
  await (await ctx.chain.connect(ctx.mfr).transferOwnership(id, ctx.dist.address)).wait();
  await (await ctx.chain.connect(ctx.dist).acceptShipment(id)).wait();
  await (await ctx.chain.connect(ctx.dist).transferOwnership(id, ctx.pharm.address)).wait();
  await (await ctx.chain.connect(ctx.pharm).acceptShipment(id)).wait();
}

const claimOf = (lot, i, over = {}) => ({ index: i, publicTag: lot.labels[i].publicTag, hiddenCode: lot.labels[i].hiddenCode, ...over });

// =============================================================================================
async function e1(ctx) {
  const sizes = QUICK ? [10, 100, 1000, 10000] : [10, 100, 1000, 10000, 100000];
  const rows = [];
  for (const n of sizes) {
    const ppc = n >= 1000 ? 32 : 8;
    const cpc = n >= 1000 ? 16 : 4;
    const id = `E1-${n}`;
    const t0 = Date.now();
    const lot = M.generateLot(id, n, ethers.hexlify(ethers.randomBytes(32)), ppc, cpc);
    const labelMs = Date.now() - t0;
    const ours = await registerOurs(ctx, id, lot, ppc, cpc, n);

    const row = { n, ours, labelGenerationMs: labelMs, packaging: `${ppc} packs/carton, ${cpc} cartons/case` };
    if (n <= MEASURE_MAX) {
      let g = 0, txs = 0;
      for (let i = 0; i < n; i += NAIVE_CHUNK) {
        g += await gasOf(ctx.naive.connect(ctx.mfr).registerLot(lot.originKey, lot.leaves.slice(i, i + NAIVE_CHUNK)));
        txs++;
      }
      row.naive = g; row.naiveTxs = txs;
      g = 0; txs = 0;
      for (let i = 0; i < n; i += NFT_CHUNK) {
        g += await gasOf(ctx.nft.connect(ctx.mfr).mintLot(lot.originKey, i, Math.min(NFT_CHUNK, n - i)));
        txs++;
      }
      row.nft = g; row.nftTxs = txs;
    } else {
      const ref = rows.filter((r) => !r.extrapolated).pop();
      row.naive = Math.round((ref.naive / ref.n) * n);
      row.naiveTxs = Math.ceil(n / NAIVE_CHUNK);
      row.nft = Math.round((ref.nft / ref.n) * n);
      row.nftTxs = Math.ceil(n / NFT_CHUNK);
      row.extrapolated = true;
    }
    row.batchLevel = await gasOf(ctx.batchLevel.connect(ctx.mfr).registerLot(ethers.id(id), Math.min(n, 2 ** 32 - 1)));
    rows.push(row);
    console.log(`E1 N=${n}: ours=${ours} naive=${row.naive} nft=${row.nft} batch=${row.batchLevel}${row.extrapolated ? " (extrapolated)" : ""}`);
  }
  return rows;
}

// =============================================================================================
async function e2(ctx) {
  // 4,096 packs, 32 per carton -> 8 cartons share one 256-bit bitmap word. Each measurement uses a
  // fresh word (cartons 16*i and 16*i+8) so single and batch start from the same "cold" state.
  const N = 4096, ppc = 32, cpc = 8, id = "E2";
  const lot = M.generateLot(id, N, ethers.hexlify(ethers.randomBytes(32)), ppc, cpc);
  await registerOurs(ctx, id, lot, ppc, cpc, N);
  await toShelf(ctx, id);
  const ks = [1, 2, 4, 8, 16, 32];
  const rows = [];
  for (const [i, k] of ks.entries()) {
    const singleCarton = 16 * i;
    const batchCarton = 16 * i + 8;
    let single = 0;
    for (let j = 0; j < k; j++) {
      const idx = singleCarton * ppc + j;
      single += await gasOf(ctx.chain.connect(ctx.pharm).decommissionUnit(id, claimOf(lot, idx), M.unitProof(lot.hierarchy, idx)));
    }
    const indices = Array.from({ length: k }, (_, j) => batchCarton * ppc + j);
    const mp = M.cartonMultiProof(lot.hierarchy, batchCarton, indices);
    const batch = await gasOf(
      ctx.chain
        .connect(ctx.pharm)
        .decommissionCarton(id, batchCarton, mp.indices.map((x) => claimOf(lot, x)), mp.multiProof, mp.proofFlags, mp.cartonProof, mp.caseProof)
    );
    rows.push({ k, singleTotal: single, singlePerPack: Math.round(single / k), batchTotal: batch, batchPerPack: Math.round(batch / k), saving: pct(batch / k, single / k) });
    console.log(`E2 k=${k}: single/pack=${Math.round(single / k)} batch/pack=${Math.round(batch / k)}`);
  }

  // baselines: NFT burn and naive mapping dispense (warm, steady state)
  const nftLot = ethers.id("E2-NFT");
  await (await ctx.nft.connect(ctx.pharm).mintLot(nftLot, 0, 4)).wait();
  const nftBurn = await gasOf(ctx.nft.connect(ctx.pharm).dispense(await ctx.nft.tokenIdOf(nftLot, 1)));
  const naiveLeaves = lot.leaves.slice(0, 4);
  await (await ctx.naive.registerLot(lot.originKey, naiveLeaves)).wait();
  const naiveDispense = await gasOf(ctx.naive.dispense(lot.originKey, naiveLeaves[1]));
  return { lot: { N, ppc, cpc }, rows, nftBurn, naiveDispense };
}

// =============================================================================================
async function e2c(ctx) {
  // 1,152 packs = 3 cases of 12 cartons x 32 packs
  const N = 1152, ppc = 32, cpc = 12;
  const out = [];
  for (const mode of ["plain", "aggregation"]) {
    const id = `E2C-${mode}`;
    const lot = M.generateLot(id, N, ethers.hexlify(ethers.randomBytes(32)), ppc, cpc);
    await registerOurs(ctx, id, lot, ppc, cpc, N);
    await (await ctx.chain.connect(ctx.mfr).transferOwnership(id, ctx.dist.address)).wait();
    if (mode === "plain") {
      const g = await gasOf(ctx.chain.connect(ctx.dist).acceptShipment(id));
      // what verifying every pack on receipt would cost (eth_estimateGas of the view, x N)
      const one = Number(await ctx.chain.verifyUnit.estimateGas(id, 0, lot.labels[0].publicTag, lot.commitments[0], M.unitProof(lot.hierarchy, 0)));
      out.push({ method: "acceptShipment (no physical check)", scans: 0, gas: g, packsCovered: N });
      out.push({ method: "verify every pack on receipt (estimate)", scans: N, gas: one * N, packsCovered: N, estimate: true });
    } else {
      const scans = M.aggregationScans(lot.hierarchy, 0, N);
      const g = await gasOf(ctx.chain.connect(ctx.dist).acceptWithAggregation(id, scans));
      out.push({ method: "acceptWithAggregation (case labels)", scans: scans.length, gas: g, packsCovered: N });
      // split 96 packs (3 cartons) and accept them at the pharmacy by carton scans
      await (await ctx.chain.connect(ctx.dist).splitBatch(id, `${id}-RX`, 96)).wait();
      await (await ctx.chain.connect(ctx.dist).transferOwnership(`${id}-RX`, ctx.pharm.address)).wait();
      const cs = M.aggregationScans(lot.hierarchy, N - 96, N);
      const g2 = await gasOf(ctx.chain.connect(ctx.pharm).acceptWithAggregation(`${id}-RX`, cs));
      out.push({ method: "acceptWithAggregation (carton labels, split shipment)", scans: cs.length, gas: g2, packsCovered: 96 });
    }
  }
  out.forEach((r) => console.log(`E2c ${r.method}: scans=${r.scans} gas=${r.gas}`));
  return out;
}

// =============================================================================================
async function e3(ctx) {
  const K = 10, C = 3, N = 200, ppc = 8, cpc = 5;
  const rnd = prng(42);
  const presentations = [];
  for (let k = 0; k < K; k++) {
    presentations.push({ unit: k, fake: false });
    for (let c = 0; c < C; c++) presentations.push({ unit: k, fake: true });
  }
  shuffle(presentations, rnd);
  const fakes = K * C;
  const results = {};

  // our scheme in two threat variants
  for (const variant of ["two-part", "one-part"]) {
    const id = `E3-${variant}`;
    const lot = M.generateLot(id, N, ethers.hexlify(ethers.randomBytes(32)), ppc, cpc);
    await registerOurs(ctx, id, lot, ppc, cpc, N);
    await toShelf(ctx, id);
    let fakeFlagged = 0, genuineFlagged = 0, genuineDispensed = 0;
    for (const p of presentations) {
      // two-part: the copier photographed only the visible QR -> guesses the scratch code
      // one-part: the copier has everything a single-secret label exposes (= v2 behaviour)
      const over = p.fake && variant === "two-part" ? { hiddenCode: ethers.hexlify(ethers.randomBytes(10)) } : {};
      const args = [id, claimOf(lot, p.unit, over), M.unitProof(lot.hierarchy, p.unit)];
      const res = Number(await ctx.chain.connect(ctx.pharm).decommissionUnit.staticCall(...args));
      await (await ctx.chain.connect(ctx.pharm).decommissionUnit(...args)).wait();
      if (res !== 0) p.fake ? fakeFlagged++ : genuineFlagged++;
      else if (!p.fake) genuineDispensed++;
    }
    results[variant] = { fakeFlagged, genuineFlagged, genuineDispensed, duplicatesFlagged: fakeFlagged + genuineFlagged };
  }

  // ERC-721 baseline: label = token id; whichever burn comes first wins
  {
    const lotKey = ethers.id("E3-NFT");
    await (await ctx.nft.connect(ctx.pharm).mintLot(lotKey, 0, K)).wait();
    let fakeFlagged = 0, genuineFlagged = 0, genuineDispensed = 0;
    for (const p of presentations) {
      const tid = await ctx.nft.tokenIdOf(lotKey, p.unit);
      const ok = await ctx.nft.connect(ctx.pharm).dispense.staticCall(tid);
      await (await ctx.nft.connect(ctx.pharm).dispense(tid)).wait();
      if (!ok) p.fake ? fakeFlagged++ : genuineFlagged++;
      else if (!p.fake) genuineDispensed++;
    }
    results.nft = { fakeFlagged, genuineFlagged, genuineDispensed, duplicatesFlagged: fakeFlagged + genuineFlagged };
  }

  // batch-level baseline: verification = "lot exists"
  {
    const lotKey = ethers.id("E3-BATCH");
    await (await ctx.batchLevel.connect(ctx.pharm).registerLot(lotKey, K)).wait();
    let flagged = 0;
    for (const p of presentations) {
      if (!(await ctx.batchLevel.verifyBox(lotKey, p.unit))) flagged++;
      await (await ctx.batchLevel.connect(ctx.pharm).sellBox(lotKey, p.unit)).wait();
    }
    results.batchLevel = { fakeFlagged: flagged, genuineFlagged: 0, genuineDispensed: K, duplicatesFlagged: flagged };
  }
  // v1 heuristic: flag the batch after > 50 scans
  results.scanHeuristic = { fakeFlagged: Math.max(0, presentations.length - 50), genuineFlagged: 0, genuineDispensed: K, duplicatesFlagged: Math.max(0, presentations.length - 50) };

  for (const r of Object.values(results)) {
    r.fakeDetectionRate = r.fakeFlagged / fakes;
    r.genuineFalseFlagRate = r.genuineFlagged / K;
  }
  console.log("E3", JSON.stringify(results));
  return { K, C, presentations: presentations.length, fakes, results };
}

// =============================================================================================
async function e6(ctx) {
  // storage 2.0-8.0 degC; one reading per 30-min window
  const steady = (t, n) => Array(n).fill(t);
  const scenarios = [
    { name: "in range (5 degC)", truth: false, trace: steady(50, 36) },
    { name: "short spike (one 15 degC reading)", truth: false, trace: [...steady(50, 20), 150, ...steady(50, 15)] },
    { name: "sustained mild excursion (10.5 degC)", truth: true, trace: [...steady(50, 12), ...steady(105, 48)] },
    { name: "freezing (-1.5 degC)", truth: true, trace: [...steady(50, 10), -15, -15, ...steady(50, 4)] },
    // sensor 0 is the one a single-sensor system would rely on
    { name: "faulty sensor stuck at 30 degC (true 5 degC)", truth: false, trace: steady(50, 36), override: { 0: 300 } },
    { name: "malicious sensor reports 5 degC (true 11 degC)", truth: true, trace: [...steady(50, 10), ...steady(110, 40)], override: { 0: 50 } }
  ];

  const sensors = [0, 1, 2].map(() => ethers.Wallet.createRandom());
  for (const w of sensors) await (await ctx.monitor.connect(ctx.regulator).registerSensor(w.address, "bench")).wait();

  const rows = [];
  let gasSum = 0, gasN = 0;
  for (const [si, sc] of scenarios.entries()) {
    const id = `E6-${si}`;
    const lot = M.generateLot(id, 8, ethers.hexlify(ethers.randomBytes(32)), 8, 1);
    await registerOurs(ctx, id, lot, 8, 1, 8);
    await (await ctx.monitor.connect(ctx.mfr).assignSensors(id, sensors.map((w) => w.address))).wait();
    await (await ctx.chain.connect(ctx.mfr).transferOwnership(id, ctx.dist.address)).wait();
    const key = M.batchKey(id);

    let quarantinedAt = null;
    let singleRuleAt = null;
    for (let w = 0; w < sc.trace.length; w++) {
      const seq = w + 1;
      const ts = 1_700_000_000 + w * 1800;
      const readings = [];
      const values = [];
      for (let s = 0; s < 3; s++) {
        let t = sc.override && sc.override[s] !== undefined ? sc.override[s] : sc.trace[w];
        if (sc.override === undefined) t += [0, 1, -1][s]; // normal sensor noise (0.1 degC)
        values.push(t);
        const digest = await ctx.monitor.readingDigest(key, seq, t, ts);
        readings.push({ tempDeci: t, timestamp: ts, signature: await sensors[s].signMessage(ethers.getBytes(digest)) });
      }
      // baseline: single sensor (#0), single reading outside [2, 8] degC quarantines
      if (singleRuleAt === null && (values[0] > 80 || values[0] < 20)) singleRuleAt = w;
      if (quarantinedAt === null) {
        gasSum += await gasOf(ctx.monitor.submitReadings(id, seq, readings));
        gasN++;
        const st = Number((await ctx.chain.getBatch(id)).effectiveStatus);
        if (st === 5) quarantinedAt = w;
      }
    }
    const [, , , , mktDeci] = await ctx.monitor.getMonitor(id);
    const ours = quarantinedAt !== null;
    const single = singleRuleAt !== null;
    rows.push({
      scenario: sc.name,
      truth: sc.truth ? "breach" : "no breach",
      ours: ours ? `quarantined (window ${quarantinedAt + 1})` : "not quarantined",
      oursCorrect: ours === sc.truth,
      single: single ? `quarantined (window ${singleRuleAt + 1})` : "not quarantined",
      singleCorrect: single === sc.truth,
      finalMktC: Number(mktDeci) / 10
    });
    console.log(`E6 ${sc.name}: ours=${ours} single=${single} truth=${sc.truth} mkt=${Number(mktDeci) / 10}`);
  }
  const tally = (key, truth, wrongWhen) => rows.filter((r) => (r.truth === "breach") === truth && !r[key]).length;
  return {
    rows,
    gasPerSubmission: Math.round(gasSum / gasN),
    ours: { falseQuarantines: tally("oursCorrect", false), missedBreaches: tally("oursCorrect", true) },
    single: { falseQuarantines: tally("singleCorrect", false), missedBreaches: tally("singleCorrect", true) }
  };
}

// =============================================================================================
function markdown(R) {
  const md = [];
  md.push(`# PharmaChain v3 evaluation results\n`);
  md.push(`Network: \`${network.name}\` (in-process Hardhat EVM, Cancun) - generated ${R.generatedAt}\n`);

  md.push(`## E1 - Lot registration gas\n`);
  md.push(`| Units N | Ours (1 tx, hierarchical root) | Naive per-serial (txs) | ERC-721 per pack (txs) | Batch-level | NFT / ours |`);
  md.push(`|---:|---:|---:|---:|---:|---:|`);
  for (const r of R.e1)
    md.push(
      `| ${fmt(r.n)} | ${fmt(r.ours)} | ${fmt(r.naive)} (${r.naiveTxs}) | ${fmt(r.nft)} (${r.nftTxs}) | ${fmt(r.batchLevel)} | ${(r.nft / r.ours).toFixed(0)}x |`
    );
  md.push(`\n${R.e1.some((r) => r.extrapolated) ? "Rows above 10,000 units extrapolate the O(N) baselines linearly from the 10,000-unit measurement (cost per unit is constant). " : ""}Batch-level registration is O(1) like ours but carries no per-unit information.\n`);

  md.push(`## E2 - Dispense gas per pack (lot of ${fmt(R.e2.lot.N)}, ${R.e2.lot.ppc} packs/carton)\n`);
  md.push(`| Packs k | Single decommissionUnit / pack | Carton multiproof / pack | Saving |`);
  md.push(`|---:|---:|---:|---:|`);
  for (const r of R.e2.rows) md.push(`| ${r.k} | ${fmt(r.singlePerPack)} | ${fmt(r.batchPerPack)} | ${r.saving} |`);
  md.push(`\nBaselines (steady state): ERC-721 burn ${fmt(R.e2.nftBurn)} gas/pack, naive mapping ${fmt(R.e2.naiveDispense)} gas/pack (neither has access control, hierarchy or diversion checks).\n`);

  md.push(`## E2c - Receiving a shipment\n`);
  md.push(`| Method | Physical scans | Gas | Packs covered |`);
  md.push(`|---|---:|---:|---:|`);
  for (const r of R.e2c) md.push(`| ${r.method} | ${fmt(r.scans)} | ${fmt(r.gas)}${r.estimate ? " (estimate)" : ""} | ${fmt(r.packsCovered)} |`);

  md.push(`\n## E3 - Clone attack (${R.e3.K} genuine packs, each label copied ${R.e3.C}x, ${R.e3.presentations} presentations in seeded random order)\n`);
  md.push(`| Scheme | Fake packs flagged | Detection rate | Genuine packs wrongly flagged | Genuine packs dispensed |`);
  md.push(`|---|---:|---:|---:|---:|`);
  const names = { "two-part": "Ours v3: two-part label (visible QR + scratch code)", "one-part": "Ours v2: one-part label (copy carries the full secret)", nft: "ERC-721 per pack (burn on dispense)", batchLevel: "Batch-level (lot exists?)", scanHeuristic: "v1 scan-count heuristic (> 50)" };
  for (const [k, r] of Object.entries(R.e3.results))
    md.push(`| ${names[k]} | ${r.fakeFlagged} / ${R.e3.fakes} | ${(r.fakeDetectionRate * 100).toFixed(1)}% | ${r.genuineFlagged} / ${R.e3.K} | ${r.genuineDispensed} / ${R.e3.K} |`);
  md.push(
    `\nWith one-part labels and ERC-721 tokens every duplicate is detected, but whichever copy reaches a pharmacy first wins - the genuine pack is flagged whenever its clone went first. With two-part labels the copier never sees the scratch code, so every copy fails and every genuine pack dispenses.\n`
  );

  md.push(`## E6 - Cold-chain decisions (storage 2-8 degC, 30-min windows)\n`);
  md.push(`| Scenario | Ground truth | Ours: 2-of-3 signed + MKT | Single sensor, single reading | Final MKT (degC) |`);
  md.push(`|---|---|---|---|---:|`);
  for (const r of R.e6.rows) md.push(`| ${r.scenario} | ${r.truth} | ${r.ours}${r.oursCorrect ? "" : " **(wrong)**"} | ${r.single}${r.singleCorrect ? "" : " **(wrong)**"} | ${r.finalMktC} |`);
  md.push(
    `\n| Policy | False quarantines | Missed breaches |\n|---|---:|---:|\n| Ours | ${R.e6.ours.falseQuarantines} | ${R.e6.ours.missedBreaches} |\n| Single-reading, single-sensor | ${R.e6.single.falseQuarantines} | ${R.e6.single.missedBreaches} |\n\nGas per signed 3-sensor submission (3 x ecrecover + on-chain MKT update): ${fmt(R.e6.gasPerSubmission)}.\n`
  );
  return md.join("\n") + "\n";
}

async function main() {
  console.log(`Network: ${network.name}${QUICK ? " (QUICK)" : ""}`);
  const ctx = await setup();
  const R = { network: network.name, generatedAt: new Date().toISOString() };
  R.e1 = await e1(ctx);
  R.e2 = await e2(ctx);
  R.e2c = await e2c(ctx);
  R.e3 = await e3(ctx);
  R.e6 = await e6(ctx);

  const outDir = path.join(__dirname, "..", "benchmark-results");
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, "results.json"), JSON.stringify(R, null, 2));
  fs.writeFileSync(path.join(outDir, "results.md"), markdown(R));
  console.log(`\nWrote ${path.join(outDir, "results.md")}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
