/**
 * Validator-set governance for the QBFT network (contract validator selection, v3).
 *
 *   node scripts/network/validator-vote.js list
 *   node scripts/network/validator-vote.js add    0xNewValidator
 *   node scripts/network/validator-vote.js remove 0xValidator
 *
 * Besu reads the validator list from the ValidatorSet contract (genesis address 0x...9999),
 * which only the Governance multisig can change. This script plays two regulator officers:
 * officer 1 (dev account #3) proposes, officer 2 (dev account #6) approves, then it executes.
 * The new set takes effect from the next block. Note: QBFT needs ceil(2n/3) validators online,
 * so adding a validator that is not running reduces the fault margin until it joins.
 */
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const DEV_MNEMONIC = "test test test test test test test test test test test junk";
const DETAILS = path.resolve(__dirname, "../../../backend/src/config/contractDetails.json");

async function main() {
  const [cmd, address] = process.argv.slice(2);
  const d = JSON.parse(fs.readFileSync(DETAILS, "utf8"));
  if (!d.validatorSet) throw new Error("No ValidatorSet on this network (Hardhat dev chain?)");
  const provider = new ethers.JsonRpcProvider(d.rpcUrl);
  const wallet = (i) => ethers.HDNodeWallet.fromPhrase(DEV_MNEMONIC, undefined, `m/44'/60'/0'/0/${i}`).connect(provider);
  const vs = new ethers.Contract(d.validatorSet.address, d.validatorSet.abi, provider);
  const gov = new ethers.Contract(d.governance.address, d.governance.abi, provider);

  const show = async () => {
    const list = await vs.getValidators();
    const qbft = await provider.send("qbft_getValidatorsByBlockNumber", ["latest"]);
    console.log(`ValidatorSet ${d.validatorSet.address} (controller ${await vs.controller()})`);
    list.forEach((a) => console.log(`  ${a}`));
    console.log(`QBFT currently uses ${qbft.length} validators.`);
  };

  if (!cmd || cmd === "list") return show();
  if (!["add", "remove"].includes(cmd) || !ethers.isAddress(address || "")) {
    console.log("usage: validator-vote.js <list|add|remove> [0xAddress]");
    process.exitCode = 1;
    return;
  }
  const data = vs.interface.encodeFunctionData(cmd === "add" ? "addValidator" : "removeValidator", [address]);
  const rc = await (await gov.connect(wallet(3)).propose(d.validatorSet.address, data, `${cmd} validator ${address}`)).wait();
  const id = gov.interface.parseLog(rc.logs.find((l) => l.address.toLowerCase() === d.governance.address.toLowerCase())).args.id;
  console.log(`  proposal #${id} created by officer 1 (block ${rc.blockNumber})`);
  console.log(`  approved by officer 2 (block ${(await (await gov.connect(wallet(6)).approve(id)).wait()).blockNumber})`);
  console.log(`  executed (block ${(await (await gov.connect(wallet(3)).execute(id)).wait()).blockNumber})`);
  await show();
}

main().catch((e) => {
  console.error(e.shortMessage || e.message);
  process.exitCode = 1;
});
