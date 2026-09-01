import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm, stat } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";

const executable = path.resolve("ml-service", "dist", "tanaw-ml-service", process.platform === "win32" ? "tanaw-ml-service.exe" : "tanaw-ml-service");
const port = await availableLoopbackPort();
const token = randomBytes(32).toString("hex");
const appDataDirectory = await mkdtemp(path.join(tmpdir(), "tanaw-ml-runtime-smoke-"));
const bundleDirectory = path.dirname(executable);
const bundleBytes = await directorySize(bundleDirectory);
const maximumBundleBytes = (process.platform === "win32" ? 6 : 2) * 1024 ** 3;
if (bundleBytes > maximumBundleBytes) {
  throw new Error(`The bundled ML runtime is ${(bundleBytes / 1024 ** 3).toFixed(2)} GiB; ` + `the ${process.platform} limit is ${(maximumBundleBytes / 1024 ** 3).toFixed(0)} GiB.`);
}
const child = spawn(executable, [], {
  env: {
    ...process.env,
    TANAW_APP_DATA_DIR: appDataDirectory,
    TANAW_ML_MODEL_DIR: path.resolve("ml-service", "models"),
    TANAW_ML_SERVICE_HOST: "127.0.0.1",
    TANAW_ML_SERVICE_PORT: String(port),
    TANAW_ML_SERVICE_TOKEN: token,
  },
  stdio: "inherit",
  windowsHide: true,
});
const childExit = new Promise((resolve) => child.once("exit", resolve));

const deadline = Date.now() + 90_000;
let verified = false;
let lastProbeError = null;
try {
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`, {
        headers: { "X-TANAW-ML-Token": token },
      });
      if (response.ok) {
        const payload = await response.json();
        if (payload.api_contract_version !== 1) {
          throw new Error("The bundled ML runtime exposes an incompatible API contract.");
        }
        const capabilities = payload.runtime_capabilities;
        if (!capabilities || typeof capabilities.torch_version !== "string" || capabilities.openvino_available !== true || capabilities.onnxruntime_available !== true) {
          throw new Error("The bundled ML runtime is missing a required inference engine.");
        }
        verified = true;
        break;
      }
      lastProbeError = new Error(`Health endpoint returned HTTP ${response.status}.`);
    } catch (error) {
      // The standalone runtime may still be importing native ML libraries.
      lastProbeError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
} finally {
  child.kill("SIGTERM");
  const stopped = await Promise.race([childExit.then(() => true), new Promise((resolve) => setTimeout(() => resolve(false), 5000))]);
  if (!stopped) {
    child.kill("SIGKILL");
    await childExit;
  }
  await rm(appDataDirectory, { force: true, recursive: true });
}

if (!verified) {
  const reason = lastProbeError instanceof Error ? ` Last probe: ${lastProbeError.message}` : "";
  throw new Error(`The bundled ML runtime did not pass its offline health check.${reason}`);
}

console.log("Bundled ML runtime: health check passed.");
console.log(`Bundled ML runtime: ${(bundleBytes / 1024 ** 2).toFixed(0)} MiB.`);

async function directorySize(directory) {
  let total = 0;
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    total += entry.isDirectory() ? await directorySize(entryPath) : (await stat(entryPath)).size;
  }
  return total;
}

async function availableLoopbackPort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : null;
  await new Promise((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  if (!port) throw new Error("Unable to reserve a local port for the ML runtime smoke test.");
  return port;
}
