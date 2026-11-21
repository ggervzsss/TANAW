#!/usr/bin/env node
/**
 * Disposable-stack scenario: real ML service -> desktop sync -> PostgreSQL -> Staff portal.
 *
 *   node scripts/e2e-stack/run.mjs                 provisions everything, runs the scenario, tears down
 *   node scripts/e2e-stack/run.mjs --skip-build    reuse the previous renderer and portal builds
 *
 * Provisions a throwaway PostgreSQL (a Docker container, or TANAW_STACK_DATABASE_URL pointing at an
 * empty database such as a CI service), applies the current Alembic schema, seeds synthetic
 * accounts with a random password, and starts the backend, the ML service (with a temporary data
 * folder) and the desktop-renderer and portal previews. Then it runs
 * desktop-tanaw/tests/e2e/stack/report-flow.spec.ts. Service logs, the Playwright HTML report and
 * traces land in desktop-tanaw/test-results/stack and desktop-tanaw/playwright-report/stack.
 *
 * Prerequisites: Node 24, uv, npm dependencies installed in desktop-tanaw and frontend-tanaw,
 * Playwright Chromium, and Docker unless TANAW_STACK_DATABASE_URL is set. The script stops with a
 * clear message when one is missing.
 */
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createWriteStream, existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const backendDir = path.join(root, "backend-tanaw");
const mlDir = path.join(root, "desktop-tanaw/ml-service");
const desktopDir = path.join(root, "desktop-tanaw");
const portalDir = path.join(root, "frontend-tanaw");
const logDir = path.join(desktopDir, "test-results/stack/logs");
const skipBuild = process.argv.includes("--skip-build");
const ports = {
  api: Number(process.env.TANAW_STACK_API_PORT ?? 8021),
  ml: Number(process.env.TANAW_STACK_ML_PORT ?? 8775),
  desktop: Number(process.env.TANAW_STACK_DESKTOP_PORT ?? 5185),
  portal: Number(process.env.TANAW_STACK_PORTAL_PORT ?? 5186),
};
const children = [];
const cleanups = [];

const secret = (bytes = 24) => randomBytes(bytes).toString("base64url");
const step = (message) => console.log(`\n▶ ${message}`);
function fail(message) {
  console.error(`\n✖ ${message}`);
  process.exitCode = 1;
  throw new Error(message);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { stdio: options.capture ? "pipe" : "inherit", encoding: "utf8", shell: process.platform === "win32", ...options });
  if (result.error) fail(`${command} could not start: ${result.error.message}`);
  if (result.status !== 0) fail(`${command} ${args.join(" ")} failed with exit code ${result.status}.${result.stderr ? `\n${result.stderr}` : ""}`);
  return result.stdout ?? "";
}

function start(name, command, args, options) {
  mkdirSync(logDir, { recursive: true });
  const log = createWriteStream(path.join(logDir, `${name}.log`));
  const child = spawn(command, args, { ...options, stdio: ["ignore", "pipe", "pipe"], shell: process.platform === "win32", detached: process.platform !== "win32" });
  child.stdout.pipe(log);
  child.stderr.pipe(log);
  child.on("exit", (code) => {
    if (code !== null && code !== 0 && !child.stopping) console.error(`  ${name} exited with code ${code}; see ${path.join(logDir, `${name}.log`)}`);
  });
  children.push({ name, child });
  return child;
}

async function waitFor(name, url, headers = {}, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const exited = children.find((entry) => entry.name === name && entry.child.exitCode !== null);
    if (exited) fail(`${name} stopped while starting; see ${path.join(logDir, `${name}.log`)}`);
    try {
      const response = await fetch(url, { headers, signal: AbortSignal.timeout(2_000) });
      if (response.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  fail(`${name} did not answer ${url} within ${timeoutMs / 1000} s; see ${path.join(logDir, `${name}.log`)}`);
}

function portFree(port) {
  return new Promise((resolve) => {
    const server = createServer().once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });
}

function has(command, args = ["--version"]) {
  const result = spawnSync(command, args, { stdio: "ignore", shell: process.platform === "win32" });
  return !result.error && result.status === 0;
}

async function checkPrerequisites() {
  step("Checking prerequisites");
  const problems = [];
  if (Number(process.versions.node.split(".")[0]) < 24) problems.push(`Node 24 or newer is required (found ${process.version}).`);
  if (!has("uv")) problems.push("uv is not installed (https://docs.astral.sh/uv/).");
  if (!process.env.TANAW_STACK_DATABASE_URL && !has("docker", ["info"])) problems.push("Docker is not running. Start it, or set TANAW_STACK_DATABASE_URL to an empty disposable PostgreSQL database.");
  for (const dir of [desktopDir, portalDir]) {
    if (!existsSync(path.join(dir, "node_modules/@playwright/test"))) problems.push(`Run npm ci in ${path.relative(root, dir)}.`);
  }
  for (const [name, port] of Object.entries(ports)) {
    if (!(await portFree(port))) problems.push(`Port ${port} (${name}) is in use; free it or set TANAW_STACK_${name.toUpperCase()}_PORT.`);
  }
  if (problems.length > 0) fail(`Missing prerequisites:\n  - ${problems.join("\n  - ")}`);
}

async function provisionDatabase() {
  if (process.env.TANAW_STACK_DATABASE_URL) {
    step("Using TANAW_STACK_DATABASE_URL (it must be an empty, disposable database)");
    return process.env.TANAW_STACK_DATABASE_URL;
  }
  step("Starting a disposable PostgreSQL 17 container");
  const name = `tanaw-stack-${secret(6).toLowerCase().replace(/[^a-z0-9]/g, "")}`;
  const password = secret();
  run("docker", ["run", "--detach", "--rm", "--name", name, "--env", "POSTGRES_USER=tanaw", "--env", `POSTGRES_PASSWORD=${password}`, "--env", "POSTGRES_DB=tanaw_stack", "--publish", "127.0.0.1::5432", "postgres:17-alpine"], { capture: true });
  cleanups.push(() => spawnSync("docker", ["rm", "--force", name], { stdio: "ignore" }));
  const port = run("docker", ["port", name, "5432/tcp"], { capture: true }).trim().split(":").pop();
  const deadline = Date.now() + 60_000;
  while (spawnSync("docker", ["exec", name, "pg_isready", "-U", "tanaw", "-d", "tanaw_stack"], { stdio: "ignore" }).status !== 0) {
    if (Date.now() > deadline) fail("PostgreSQL did not become ready within 60 s.");
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return `postgresql+asyncpg://tanaw:${password}@127.0.0.1:${port}/tanaw_stack`;
}

function lastMonthPeriod() {
  const now = new Date();
  const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  return new Intl.DateTimeFormat("en-US", { month: "long", year: "numeric", timeZone: "UTC" }).format(lastMonth);
}

async function main() {
  await checkPrerequisites();
  rmSync(path.join(desktopDir, "test-results/stack"), { recursive: true, force: true });
  const databaseUrl = await provisionDatabase();
  const password = `Stack-${secret(18)}-9a`;
  const accounts = { admin: "stack-admin@example.test", staff: "stack-staff@example.test", it: "stack-it@example.test" };
  const urls = {
    api: `http://127.0.0.1:${ports.api}`,
    ml: `http://127.0.0.1:${ports.ml}`,
    desktop: `http://127.0.0.1:${ports.desktop}`,
    portal: `http://127.0.0.1:${ports.portal}`,
  };
  const backendEnv = {
    ...process.env,
    TANAW_ENV: "development",
    DATABASE_URL: databaseUrl,
    JWT_SECRET_KEY: secret(36),
    CORS_ORIGINS: `${urls.desktop},${urls.portal}`,
    FRONTEND_PUBLIC_URL: urls.portal,
    EMAIL_DELIVERY_MODE: "log",
    BOOTSTRAP_IT_USERNAME: accounts.it,
    BOOTSTRAP_IT_PASSWORD: password,
    TANAW_SEED_DEVELOPMENT_ACCOUNTS: "true",
    DEVELOPMENT_ADMIN_USERNAME: accounts.admin,
    DEVELOPMENT_ADMIN_PASSWORD: password,
    DEVELOPMENT_STAFF_USERNAME: accounts.staff,
    DEVELOPMENT_STAFF_PASSWORD: password,
    DEVELOPMENT_IT_USERNAME: accounts.it,
    DEVELOPMENT_IT_PASSWORD: password,
  };

  step("Applying the current schema (alembic upgrade head)");
  run("uv", ["run", "alembic", "upgrade", "head"], { cwd: backendDir, env: backendEnv });

  step("Seeding the synthetic Enterprise account");
  const seeded = JSON.parse(
    run("uv", ["run", "python", "-m", "tests.support.stack_seed"], { cwd: backendDir, env: { ...backendEnv, TANAW_STACK_DISPOSABLE_DATABASE: "true", TANAW_STACK_PASSWORD: password }, capture: true })
      .trim()
      .split("\n")
      .pop(),
  );

  step(`Starting the backend on ${urls.api}`);
  start("backend", "uv", ["run", "uvicorn", "main:app", "--host", "127.0.0.1", "--port", String(ports.api)], { cwd: backendDir, env: backendEnv });
  await waitFor("backend", `${urls.api}/health`);

  step(`Starting the ML service on ${urls.ml}`);
  const mlData = mkdtempSync(path.join(tmpdir(), "tanaw-stack-ml-"));
  cleanups.push(() => rmSync(mlData, { recursive: true, force: true }));
  const mlToken = secret(32);
  start("ml-service", "uv", ["run", "python", "main.py"], { cwd: mlDir, env: { ...process.env, TANAW_APP_DATA_DIR: mlData, TANAW_ML_SERVICE_TOKEN: mlToken, TANAW_ML_SERVICE_PORT: String(ports.ml), CUDA_VISIBLE_DEVICES: "-1" } });
  await waitFor("ml-service", `${urls.ml}/health`, { "X-TANAW-ML-Token": mlToken });

  if (!skipBuild) {
    step("Building the desktop renderer and the portal against the stack backend");
    run("npm", ["run", "build"], { cwd: desktopDir, env: { ...process.env, TANAW_RENDERER_ONLY: "true", VITE_API_BASE_URL: urls.api } });
    run("npm", ["run", "build"], { cwd: portalDir, env: { ...process.env, VITE_API_BASE_URL: urls.api } });
  }
  step("Starting the desktop-renderer and portal previews");
  start("desktop-preview", "npx", ["vite", "preview", "--host", "127.0.0.1", "--port", String(ports.desktop), "--strictPort"], { cwd: desktopDir, env: { ...process.env, TANAW_RENDERER_ONLY: "true" } });
  start("portal-preview", "npx", ["vite", "preview", "--host", "127.0.0.1", "--port", String(ports.portal), "--strictPort"], { cwd: portalDir, env: process.env });
  await waitFor("desktop-preview", urls.desktop);
  await waitFor("portal-preview", urls.portal);

  step("Running the report scenario");
  const scenario = spawnSync("npx", ["playwright", "test", "--config", "playwright.stack.config.ts"], {
    cwd: desktopDir,
    stdio: "inherit",
    shell: process.platform === "win32",
    env: {
      ...process.env,
      TANAW_STACK_API_URL: urls.api,
      TANAW_STACK_DESKTOP_URL: urls.desktop,
      TANAW_STACK_PORTAL_URL: urls.portal,
      TANAW_STACK_ML_URL: urls.ml,
      TANAW_STACK_ML_TOKEN: mlToken,
      TANAW_STACK_PASSWORD: password,
      TANAW_STACK_ENTERPRISE_EMAIL: seeded.enterpriseEmail,
      TANAW_STACK_ENTERPRISE_ID: seeded.enterpriseId,
      TANAW_STACK_ENTERPRISE_NAME: seeded.enterpriseName,
      TANAW_STACK_STAFF_EMAIL: accounts.staff,
      TANAW_STACK_PERIOD: lastMonthPeriod(),
    },
  });
  if (scenario.status !== 0) fail(`The scenario failed. Report: desktop-tanaw/playwright-report/stack; logs: ${path.relative(root, logDir)}`);
  console.log("\n✔ Disposable-stack scenario passed.");
}

async function teardown() {
  for (const { child } of children.reverse()) {
    if (child.exitCode !== null) continue;
    child.stopping = true;
    try {
      if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore" });
      else process.kill(-child.pid, "SIGTERM");
    } catch {
      /* already gone */
    }
  }
  for (const cleanup of cleanups.reverse()) cleanup();
}

process.on("SIGINT", () => teardown().then(() => process.exit(130)));
try {
  await main();
} catch (error) {
  if (!process.exitCode) {
    console.error(error);
    process.exitCode = 1;
  }
} finally {
  await teardown();
}
