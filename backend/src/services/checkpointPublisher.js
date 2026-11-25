/**
 * Runs the checkpoint publisher (blockchain/scripts/checkpoint/publisher.js) as a supervised
 * child process of the backend, so public checkpoints are anchored whenever the API is up.
 *
 * Starts only when backend/src/config/checkpointDetails.json exists (anchor deployed).
 * Restarts the publisher with a back-off if the public chain is temporarily unreachable.
 * Disable with DISABLE_CHECKPOINT_PUBLISHER=1.
 */
const fs = require("fs");
const path = require("path");
const { fork } = require("child_process");

const DETAILS = path.join(__dirname, "../config/checkpointDetails.json");
const SCRIPT = path.resolve(__dirname, "../../../blockchain/scripts/checkpoint/publisher.js");

let child = null;
let stopping = false;
let backoffMs = 5000;

function launch() {
  if (stopping) return;
  if (!fs.existsSync(DETAILS) || !fs.existsSync(SCRIPT)) {
    setTimeout(launch, 30000); // anchor not deployed yet - check again later
    return;
  }
  child = fork(SCRIPT, [], { cwd: path.dirname(SCRIPT), stdio: ["ignore", "pipe", "pipe", "ipc"] });
  const log = (buf) =>
    String(buf)
      .split("\n")
      .filter((l) => l.trim())
      .forEach((l) => console.log(`[checkpoints] ${l.trim()}`));
  child.stdout.on("data", (b) => {
    backoffMs = 5000; // healthy output resets the back-off
    log(b);
  });
  child.stderr.on("data", log);
  child.on("exit", (code) => {
    child = null;
    if (stopping) return;
    console.log(`[checkpoints] publisher exited (${code}); retrying in ${backoffMs / 1000}s`);
    setTimeout(launch, backoffMs);
    backoffMs = Math.min(backoffMs * 2, 60000);
  });
}

function stop() {
  stopping = true;
  if (child) child.kill();
}

function start() {
  if (process.env.DISABLE_CHECKPOINT_PUBLISHER === "1") return;
  for (const sig of ["SIGINT", "SIGTERM", "SIGUSR2", "exit"]) process.once(sig, () => {
    stop();
    if (sig !== "exit") process.kill(process.pid, sig);
  });
  launch();
  console.log("[checkpoints] publisher supervisor started");
}

module.exports = { start, stop };
