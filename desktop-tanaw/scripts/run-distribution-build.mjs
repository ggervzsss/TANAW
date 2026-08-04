import { spawn } from "node:child_process";

const environment = {
  ...process.env,
  TANAW_DESKTOP_DISTRIBUTION: "true",
};

try {
  for (const script of ["deployment:validate", "build", "renderer:verify", "ml:bundle", "builder"]) {
    await runNpmScript(script);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : "The desktop distribution build failed.");
  process.exitCode = 1;
}

function runNpmScript(script) {
  const command = process.platform === "win32" ? "npm.cmd" : "npm";
  const child = spawn(command, ["run", script], {
    env: environment,
    shell: process.platform === "win32",
    stdio: "inherit",
  });

  return new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) {
        reject(new Error(`npm run ${script} stopped with signal ${signal}.`));
        return;
      }
      if (code !== 0) {
        reject(new Error(`npm run ${script} failed with exit code ${code ?? "unknown"}.`));
        return;
      }
      resolve();
    });
  });
}
