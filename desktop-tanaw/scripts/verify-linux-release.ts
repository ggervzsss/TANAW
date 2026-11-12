import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createReadStream } from "node:fs";
import { lstat, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { inspectMlReleaseResources } from "../release.config.ts";

if (process.platform !== "linux" || process.arch !== "x64") {
  throw new Error("Linux packages must be verified on Linux x64.");
}
const stage = process.argv[2] ?? "inputs";
const { version } = JSON.parse(await readFile("package.json", "utf8")) as { version: string };
const release = path.resolve("release", version, "linux-deb");
const resources = stage === "inputs" ? path.resolve("ml-service") : path.join(release, "linux-unpacked", "resources", "ml-service");
const runtime = stage === "inputs" ? path.join(resources, "dist", "tanaw-ml-service") : path.join(resources, "runtime");
const sizes = await inspectMlReleaseResources(runtime, path.join(resources, "models"), "linux");
await assertProtectedResources(runtime);
await assertProtectedResources(path.join(resources, "models"));
const executable = path.join(runtime, "tanaw-ml-service");
const header = await readFile(executable);
if (header.subarray(0, 4).toString("hex") !== "7f454c46" || header[4] !== 2 || header.readUInt16LE(18) !== 62) {
  throw new Error("The ML runtime is not a native Linux x86-64 ELF executable.");
}
if (((await stat(executable)).mode & 0o111) === 0) throw new Error("The Linux ML runtime is not executable.");
console.log(`Linux ML resources verified: ${((sizes.runtimeBytes + sizes.modelBytes) / 1024 ** 2).toFixed(1)} MiB.`);
if (stage === "packaged") {
  const packages = (await readdir(release)).filter((file) => file.endsWith(".deb"));
  if (packages.length !== 1) throw new Error("Expected exactly one Debian installer.");
  const lines = [];
  for (const file of packages) {
    const archive = path.join(release, file);
    for (const [field, expected] of [
      ["Package", "tanaw-enterprise-desktop"],
      ["Version", version],
      ["Architecture", "amd64"],
    ]) {
      const actual = execFileSync("dpkg-deb", ["--field", archive, field], { encoding: "utf8" }).trim();
      if (actual !== expected) throw new Error(`Unexpected Debian ${field}: ${actual}.`);
    }
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(archive)) hash.update(chunk);
    lines.push(`${hash.digest("hex")}  ${file}`);
  }
  await writeFile(path.join(release, "SHA256SUMS.txt"), `${lines.join("\n")}\n`);
  console.log(`Debian installer checksum: ${lines[0]}`);
} else if (stage !== "inputs") throw new Error(`Unknown Linux verification stage: ${stage}`);

async function assertProtectedResources(directory: string): Promise<void> {
  const metadata = await lstat(directory);
  if (metadata.isSymbolicLink()) return;
  if (metadata.mode & 0o022) throw new Error(`Linux release resources must not be group/world writable: ${directory}. Build on a Linux filesystem with standard file permissions.`);
  if (metadata.isDirectory()) {
    for (const file of await readdir(directory)) await assertProtectedResources(path.join(directory, file));
  }
}
