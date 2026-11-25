/**
 * Builds the private-dispensing circuit end to end (free tooling only):
 *   circom2 (WASM compiler) -> r1cs + wasm
 *   snarkjs powers of tau (generated LOCALLY - demo only, NOT a real multi-party ceremony)
 *   snarkjs Groth16 setup -> zkey, verification key
 *   Solidity verifier -> contracts/zk/Groth16Verifier.sol
 *   prover artefacts  -> frontend/public/zk/
 *
 *   node scripts/zk/build.js            (from blockchain/)
 */
const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.resolve(__dirname, "../..");
const BUILD = path.join(ROOT, "circuits", "build");
const PTAU_POWER = 13;
const NAME = "private_dispense";
const FRONT = path.resolve(ROOT, "../frontend/public/zk");

const run = (cmd) => {
  console.log("> " + cmd);
  execSync(cmd, { cwd: ROOT, stdio: "inherit" });
};
const snark = (args) => run(`node node_modules/snarkjs/build/cli.cjs ${args}`);
const rnd = () => crypto.randomBytes(32).toString("hex");

fs.mkdirSync(BUILD, { recursive: true });
fs.mkdirSync(FRONT, { recursive: true });

const t0 = Date.now();
// circom2 runs under WASI: compile from inside circuits/ so paths have no Windows separators
console.log("> circom2 " + NAME + ".circom");
execSync(`node ../node_modules/circom2/cli.js ${NAME}.circom --r1cs --wasm --sym -l ../node_modules -o build`, { cwd: path.join(ROOT, "circuits"), stdio: "inherit" });
snark(`r1cs info circuits/build/${NAME}.r1cs`);

const ptau = `circuits/build/pot${PTAU_POWER}_final.ptau`;
if (!fs.existsSync(path.join(ROOT, ptau))) {
  snark(`powersoftau new bn128 ${PTAU_POWER} circuits/build/pot_0000.ptau`);
  snark(`powersoftau contribute circuits/build/pot_0000.ptau circuits/build/pot_0001.ptau --name="PharmaChain demo" -e="${rnd()}"`);
  snark(`powersoftau prepare phase2 circuits/build/pot_0001.ptau ${ptau}`);
}
snark(`groth16 setup circuits/build/${NAME}.r1cs ${ptau} circuits/build/${NAME}_0000.zkey`);
snark(`zkey contribute circuits/build/${NAME}_0000.zkey circuits/build/${NAME}.zkey --name="PharmaChain demo phase 2" -e="${rnd()}"`);
snark(`zkey export verificationkey circuits/build/${NAME}.zkey circuits/build/verification_key.json`);
snark(`zkey export solidityverifier circuits/build/${NAME}.zkey contracts/zk/Groth16Verifier.sol`);

// prover artefacts for Node scripts / tests and for the browser
fs.copyFileSync(path.join(BUILD, `${NAME}_js`, `${NAME}.wasm`), path.join(BUILD, `${NAME}.wasm`));
fs.copyFileSync(path.join(BUILD, `${NAME}.wasm`), path.join(FRONT, `${NAME}.wasm`));
fs.copyFileSync(path.join(BUILD, `${NAME}.zkey`), path.join(FRONT, `${NAME}.zkey`));
fs.copyFileSync(path.join(BUILD, "verification_key.json"), path.join(FRONT, "verification_key.json"));
console.log(`\nZK build complete in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
console.log("NOTE: the powers of tau were generated locally by one party - fine for a demo, NOT a trusted setup.");
