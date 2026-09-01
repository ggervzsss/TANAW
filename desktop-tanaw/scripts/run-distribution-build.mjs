import { spawn } from "node:child_process";
import { assertWindowsReleaseHost, assertWindowsSigningCredentials, releaseBuilderArguments } from "../release.config.ts";

const requireSigning = process.argv.includes("--require-signing");

assertWindowsReleaseHost();
if (requireSigning) {
  assertWindowsSigningCredentials(process.env);
}

const environment = {
  ...process.env,
  TANAW_DESKTOP_DISTRIBUTION: "true",
};

try {
  for (const script of ["release:verify", "deployment:validate", "build", "renderer:verify", "ml:bundle", "release:verify:inputs"]) {
    await runNpmScript(script);
  }
  await runNpmScript("builder", releaseBuilderArguments(requireSigning));
  await runNpmScript("release:verify:packaged");
  await runNpmScript("release:checksums");
} catch (error) {
  console.error(error instanceof Error ? error.message : "The desktop distribution build failed.");
  process.exitCode = 1;
}

function runNpmScript(script, forwardedArguments = []) {
  const command = process.platform === "win32" ? "npm.cmd" : "npm";
  const child = spawn(command, ["run", script, ...(forwardedArguments.length > 0 ? ["--", ...forwardedArguments] : [])], {
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
