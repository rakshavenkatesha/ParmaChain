/**
 * PharmaChain consortium network generator.
 *
 *   node scripts/network/generate-genesis.js            (from the blockchain/ folder)
 *
 * Produces ../network/ :
 *   genesis.json               - the genesis block (block 0) of chainId 2026
 *   permissions_config.toml    - node allow-list (only consortium nodes may peer)
 *   nodes/<name>/key           - secp256k1 node key of each validator (NEVER commit for prod)
 *   nodes/<name>/key.pub, address
 *   network.json               - summary (validators, enodes, RPC ports)
 *   .env                       - values consumed by docker-compose.yml
 *
 * How the QBFT genesis block encodes the initial validator set
 * ------------------------------------------------------------
 *   extraData = RLP([ vanity(32 bytes), [validator addresses], vote(empty list), round(0), seals(empty list) ])
 * Validators are the addresses derived from each node's key. Besu reads this list from block 0,
 * after which validators can only be added/removed by on-chain votes (qbft_proposeValidatorVote).
 *
 * Fault tolerance: QBFT tolerates f Byzantine validators when n >= 3f + 1  ->  n = 4 gives f = 1.
 *
 * Validator selection: CONTRACT mode (v3). The ValidatorSet contract is placed in the genesis
 * alloc at VALIDATOR_CONTRACT with its storage pre-filled (owner + the 4 founding validators).
 * Besu reads getValidators() from it every block; changes go through the Governance multisig.
 * Existing node keys are reused, so regenerating does not change node identities.
 */
const fs = require("fs");
const path = require("path");
const { Wallet, HDNodeWallet, encodeRlp, encodeBytes32String, parseEther, toBeHex, SigningKey, keccak256, zeroPadValue, AbiCoder } = require("ethers");

const OUT = path.resolve(__dirname, "../../../network");
const CHAIN_ID = 2026;
const DEV_MNEMONIC = "test test test test test test test test test test test junk";
const SUBNET_PREFIX = "172.16.239.";

// One validator per consortium stakeholder group.
const VALIDATORS = [
  { name: "regulator", label: "Regulator node (CDSCO)", ip: SUBNET_PREFIX + "11", rpcPort: 8545 },
  { name: "manufacturer", label: "Manufacturers' association node", ip: SUBNET_PREFIX + "12", rpcPort: 8546 },
  { name: "distributor", label: "Distributors' association node", ip: SUBNET_PREFIX + "13", rpcPort: 8547 },
  { name: "pharmacy", label: "Pharmacy council node", ip: SUBNET_PREFIX + "14", rpcPort: 8548 }
];

const ACCOUNT_ROLES = [
  "Manufacturer",
  "Distributor",
  "Pharmacy",
  "Regulator / Admin (governance signer 1)",
  "Cold-chain relayer / oracle",
  "Spare (new organisations)",
  "Regulator officer (governance signer 2)",
  "Regulator officer (governance signer 3)"
];
const VALIDATOR_CONTRACT = "0x0000000000000000000000000000000000009999";
const VALIDATOR_ARTIFACT = path.resolve(__dirname, "../../artifacts/contracts/ValidatorSet.sol/ValidatorSet.json");

const slot = (n) => zeroPadValue(toBeHex(n), 32).slice(2);
const word = (hex) => zeroPadValue(hex, 32).slice(2);

function main() {
  const force = process.argv.includes("--force");
  if (fs.existsSync(path.join(OUT, "genesis.json")) && !force) {
    console.log(`network/genesis.json already exists. Re-run with --force to regenerate`);
    console.log(`(regenerating creates NEW validator keys - you must 'docker compose down -v' afterwards).`);
    return;
  }

  fs.mkdirSync(path.join(OUT, "nodes"), { recursive: true });

  // 1. Validator node keys
  if (!fs.existsSync(VALIDATOR_ARTIFACT)) throw new Error("Compile first: npx hardhat compile (ValidatorSet artifact missing)");
  const validatorRuntime = JSON.parse(fs.readFileSync(VALIDATOR_ARTIFACT, "utf8")).deployedBytecode;

  const nodes = VALIDATORS.map((v) => {
    const keyFile = path.join(OUT, "nodes", v.name, "key");
    const w = fs.existsSync(keyFile) ? new Wallet(fs.readFileSync(keyFile, "utf8").trim()) : Wallet.createRandom();
    const pub = SigningKey.computePublicKey(w.privateKey, false).slice(4); // strip 0x04
    const dir = path.join(OUT, "nodes", v.name);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "key"), w.privateKey);
    fs.writeFileSync(path.join(dir, "key.pub"), "0x" + pub);
    fs.writeFileSync(path.join(dir, "address"), w.address.toLowerCase());
    return { ...v, address: w.address.toLowerCase(), enode: `enode://${pub}@${v.ip}:30303` };
  });

  // 2. QBFT extraData. In contract mode the validator list lives in the ValidatorSet contract,
  //    so the extraData validator list is empty.
  const validatorAddrs = nodes.map((n) => n.address).sort();
  const vanity = encodeBytes32String("PharmaChain Genesis :: 2026"); // 32-byte free-form field
  const extraData = encodeRlp([vanity, [], [], "0x", []]);

  // 3. Pre-funded accounts = the Hardhat dev mnemonic accounts used by the dApp & MetaMask
  const alloc = {};
  const accounts = [];
  for (let i = 0; i < ACCOUNT_ROLES.length; i++) {
    const w = HDNodeWallet.fromPhrase(DEV_MNEMONIC, undefined, `m/44'/60'/0'/0/${i}`);
    alloc[w.address.toLowerCase().slice(2)] = { balance: toBeHex(parseEther("1000000")) };
    accounts.push({ index: i, role: ACCOUNT_ROLES[i], address: w.address });
  }

  // 3b. ValidatorSet contract pre-deployed in genesis. Storage layout (see ValidatorSet.sol):
  //     slot 0 owner (bootstrap = regulator account #3), slot 1 controller (unset),
  //     slot 2 validators.length, keccak256(slot 2) + i -> validators[i]
  const regulator = accounts[3].address;
  const base = BigInt(keccak256(slot(2).padStart(64, "0").replace(/^/, "0x")));
  const storage = { [slot(0)]: word(regulator), [slot(2)]: word(toBeHex(validatorAddrs.length)) };
  validatorAddrs.forEach((a, i) => {
    storage[slot(base + BigInt(i))] = word(a);
  });
  alloc[VALIDATOR_CONTRACT.slice(2)] = { balance: "0x0", code: validatorRuntime, storage };

  const genesis = {
    config: {
      chainId: CHAIN_ID,
      berlinBlock: 0,
      londonBlock: 0,
      shanghaiTime: 0,
      cancunTime: 0,
      // Permissioned consortium: no fee market, gas is metered but free (min-gas-price=0 on nodes).
      zeroBaseFee: true,
      qbft: {
        blockperiodseconds: 2,
        epochlength: 30000,
        requesttimeoutseconds: 4,
        validatorcontractaddress: VALIDATOR_CONTRACT
      }
    },
    nonce: "0x0",
    timestamp: toBeHex(Math.floor(Date.now() / 1000)),
    gasLimit: "0x1C9C380", // 30,000,000
    difficulty: "0x1",
    // Fixed mixHash that identifies a BFT (IBFT2/QBFT) chain to Besu
    mixHash: "0x63746963616c2062797a616e74696e65206661756c7420746f6c6572616e6365",
    coinbase: "0x0000000000000000000000000000000000000000",
    baseFeePerGas: "0x0",
    alloc,
    extraData
  };
  fs.writeFileSync(path.join(OUT, "genesis.json"), JSON.stringify(genesis, null, 2));

  // 4. Node permissioning: only these enodes may connect
  const toml = `# Generated by generate-genesis.js - consortium node allow-list\nnodes-allowlist=[\n${nodes
    .map((n) => `  "${n.enode}"`)
    .join(",\n")}\n]\n`;
  fs.writeFileSync(path.join(OUT, "permissions_config.toml"), toml);

  // 5. Summary + compose env
  const summary = {
    chainId: CHAIN_ID,
    consensus: "QBFT (Byzantine fault tolerant Proof-of-Authority)",
    faultTolerance: `n=${nodes.length} validators tolerate f=${Math.floor((nodes.length - 1) / 3)} faulty node(s)`,
    blockPeriodSeconds: genesis.config.qbft.blockperiodseconds,
    validatorSelection: `contract ${VALIDATOR_CONTRACT} (ValidatorSet, governed by the multisig)`,
    genesisVanity: "PharmaChain Genesis :: 2026",
    validators: nodes.map(({ name, label, address, enode, rpcPort }) => ({ name, label, address, enode, rpc: `http://127.0.0.1:${rpcPort}` })),
    prefundedAccounts: accounts
  };
  fs.writeFileSync(path.join(OUT, "network.json"), JSON.stringify(summary, null, 2));
  fs.writeFileSync(path.join(OUT, ".env"), `BOOTNODE=${nodes[0].enode}\n`);

  console.log(`Genesis written to ${OUT}`);
  console.log(`  chainId          ${CHAIN_ID}`);
  console.log(`  extraData        ${extraData.slice(0, 42)}... (${(extraData.length - 2) / 2} bytes)`);
  for (const n of nodes) console.log(`  validator        ${n.address}  ${n.label}`);
  for (const a of accounts) console.log(`  funded account   ${a.address}  ${a.role}`);
}

main();
