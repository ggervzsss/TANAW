import { spawn } from "node:child_process";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { loadEnv } from "vite";
import { resolveDesktopApiBaseUrl } from "../deployment.config.ts";

const projectDirectory = process.cwd();
const environment = { ...process.env, TANAW_DESKTOP_DISTRIBUTION: "true" };
environment.UV_FROZEN = "true";
// FPM delegates Debian payload compression to xz. Use its bounded automatic
// threading rather than spending minutes compressing ML libraries on one core.
environment.XZ_DEFAULTS = process.env.XZ_DEFAULTS ?? "-T0";
if (process.arch !== "x64" || !["win32", "linux"].includes(process.platform)) {
  throw new Error("Linux Debian packages require an x64 Linux host or Windows x64 with Docker's Linux engine.");
}
if (process.platform === "linux") {
  // The ML service must be frozen on Linux, never copied from a Windows build.
  for (const script of ["deployment:validate", "build", "renderer:verify", "ml:bundle"]) {
    await npm(script);
  }
  await npm("release:verify:linux", ["inputs"]);
  await npm("builder:linux");
  await npm("release:verify:linux", ["packaged"]);
} else {
  await buildInLinuxContainer();
}

async function buildInLinuxContainer() {
  const { version } = JSON.parse(await readFile("package.json", "utf8"));
  if (!/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(version)) throw new Error("Invalid package version.");
  const env = loadEnv("production", projectDirectory, "");
  const api = resolveDesktopApiBaseUrl(process.env.VITE_API_BASE_URL ?? env.VITE_API_BASE_URL, { distributionBuild: true });
  await run("docker", ["info", "--format", "{{.OSType}}"]);
  await run("docker", ["build", "-t", "tanaw-desktop-linux-builder", "-"], await readFile("build/linux/Dockerfile"));
  const container = `tanaw-desktop-linux-build-${process.pid}`;
  const command = [
    "set -euo pipefail",
    "mkdir -p /workspace/project",
    // Source mounts are read-only. Dependencies, native binaries and output
    // live on a Linux filesystem, isolated from the Windows build products.
    "rsync -a --chmod=D755,F644 --delete --exclude=node_modules --exclude=.git --exclude=release --exclude=dist --exclude=dist-electron --exclude=.venv --exclude=.uv-cache --exclude=__pycache__ --exclude=.pytest_cache --exclude=.mypy_cache --exclude=.ruff_cache --exclude=evaluation --exclude=test-results --exclude=playwright-report --exclude='*.log' --exclude='.env*' --exclude=ml-service/build --exclude=ml-service/dist /source/ /workspace/project/",
    "cd /workspace/project",
    "printf 'VITE_API_BASE_URL=%s\\n' \"$VITE_API_BASE_URL\" > .env.production.local",
    "npm ci --no-audit --no-fund",
    "npm run dist:linux",
  ].join("\n");
  await run("docker", [
    "create",
    "--name",
    container,
    "--mount",
    `type=bind,source=${projectDirectory},target=/source,readonly`,
    "--mount",
    "type=volume,source=tanaw-desktop-linux-build,target=/workspace",
    "--env",
    `VITE_API_BASE_URL=${api}`,
    "--env",
    "npm_config_cache=/workspace/.cache/npm",
    "--env",
    "ELECTRON_CACHE=/workspace/.cache/electron",
    "--env",
    "ELECTRON_BUILDER_CACHE=/workspace/.cache/electron-builder",
    "--env",
    "UV_PYTHON_INSTALL_DIR=/workspace/.cache/uv-python",
    "tanaw-desktop-linux-builder",
    "flock",
    "/workspace/build.lock",
    "bash",
    "-c",
    command,
  ]);
  await run("docker", ["start", "--attach", container]);
  const output = path.join(projectDirectory, "release", version, "linux-deb");
  await mkdir(output, { recursive: true });
  // Copy only distribution artifacts. Linux unpacked runtimes contain native
  // symlinks and executable modes that must stay on the Linux filesystem.
  for (const file of [`TANAW-Enterprise-Desktop-${version}-linux-amd64.deb`, "SHA256SUMS.txt"]) {
    await run("docker", ["cp", `${container}:/workspace/project/release/${version}/linux-deb/${file}`, path.join(output, file)]);
  }
  await run("docker", ["rm", container]);
  console.log(`Linux Debian package: ${output}`);
}

function npm(script, args = []) {
  return run("npm", ["run", script, ...(args.length ? ["--", ...args] : [])]);
}

function run(command, args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { env: environment, stdio: [input ? "pipe" : "ignore", "inherit", "inherit"], windowsHide: true });
    if (input) child.stdin.end(input);
    child.once("error", reject);
    child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${command} failed with exit code ${code}.`))));
  });
}
