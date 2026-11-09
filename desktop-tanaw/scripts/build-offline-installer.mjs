import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createReadStream } from "node:fs";
import { copyFile, mkdir, open, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { getPath7za } from "app-builder-lib/out/toolsets/7zip.js";
import { editWindowsResources } from "app-builder-lib/out/util/resEdit.js";
import { NtExecutable, NtExecutableResource } from "resedit";

// Official, public-domain installer module. Downloaded only on the build host.
const sdkUrl = "https://github.com/ip7z/7zip/releases/download/26.06/lzma2606.7z";
const sdkSha256 = "1d9da340870b12712e9068be178a4436fbad785486b62aed6e2aa88ea1e3bb65";

export default async function buildOfflineInstaller(event) {
  if (event.target?.name !== "nsis-web" || !event.file.endsWith(".exe")) return;
  const projectDirectory = event.packager.projectDir;
  const version = event.packager.appInfo.version;
  const releaseDirectory = path.join(projectDirectory, "release", version);
  const toolsDirectory = path.join(projectDirectory, "release", "tooling");
  const sdkDirectory = path.join(toolsDirectory, "lzma2606");
  const sdkArchive = path.join(toolsDirectory, "lzma2606.7z");
  await mkdir(toolsDirectory, { recursive: true });
  try {
    await stat(sdkArchive);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    const response = await fetch(sdkUrl);
    if (!response.ok) throw new Error(`LZMA SDK download failed: HTTP ${response.status}.`);
    await writeFile(sdkArchive, Buffer.from(await response.arrayBuffer()));
  }
  if ((await sha256(sdkArchive)) !== sdkSha256) throw new Error("LZMA SDK checksum mismatch.");
  const sevenZip = await getPath7za();
  await run(sevenZip, ["x", sdkArchive, `-o${sdkDirectory}`, "-y"]);

  const workDirectory = path.join(releaseDirectory, "offline-work");
  const outputDirectory = path.join(releaseDirectory, "offline");
  await mkdir(workDirectory, { recursive: true });
  await mkdir(outputDirectory, { recursive: true });
  const sourceDirectory = path.dirname(event.file);
  const payloads = (await readdir(sourceDirectory)).filter((name) => name.endsWith("-x64.nsis.7z"));
  if (payloads.length !== 1) throw new Error("Expected exactly one x64 NSIS payload.");
  const payload = payloads[0];
  const output = path.join(outputDirectory, `TANAW Enterprise Desktop-Windows-${version}-Offline-Setup.exe`);
  const stagedOutput = `${output}.building.exe`;
  const modulePath = path.join(workDirectory, "installer-module.exe");
  const archivePath = path.join(workDirectory, "offline.7z");
  const configPath = path.join(workDirectory, "config.txt");

  await copyFile(path.join(sdkDirectory, "bin", "7zSD.sfx"), modulePath);
  // The upstream SFX has no manifest. Without an explicit execution level,
  // Windows' legacy installer detection requests elevation for Setup.exe.
  // Extraction and per-user NSIS installation need only the current user.
  const moduleExecutable = NtExecutable.from(await readFile(modulePath));
  const moduleResources = NtExecutableResource.from(moduleExecutable);
  const manifest = Buffer.from(
    '<?xml version="1.0" encoding="UTF-8"?><assembly xmlns="urn:schemas-microsoft-com:asm.v1" manifestVersion="1.0"><trustInfo xmlns="urn:schemas-microsoft-com:asm.v3"><security><requestedPrivileges><requestedExecutionLevel level="asInvoker" uiAccess="false"/></requestedPrivileges></security></trustInfo></assembly>',
  );
  moduleResources.entries.push({ type: 24, id: 1, lang: 1033, codepage: 65001, bin: manifest.buffer.slice(manifest.byteOffset, manifest.byteOffset + manifest.byteLength) });
  moduleResources.outputResource(moduleExecutable);
  await writeFile(modulePath, Buffer.from(moduleExecutable.generate()));
  await editWindowsResources({
    file: modulePath,
    fileVersion: version,
    productVersion: version,
    versionStrings: {
      FileDescription: "TANAW Enterprise Desktop Offline Installer",
      ProductName: event.packager.appInfo.productName,
      CompanyName: event.packager.appInfo.companyName ?? "City Government of San Pedro",
    },
    iconPath: await event.packager.getIconPath(),
    requestedExecutionLevel: "asInvoker",
  });
  await writeFile(
    configPath,
    [
      ";!@Install@!UTF-8!",
      'Title="TANAW Enterprise Desktop — preparing offline installation"',
      'Progress="yes"',
      'Directory=""',
      `RunProgram="\\\"%%T\\\\${path.basename(event.file)}\\\""`,
      ";!@InstallEnd@!",
      "",
    ].join("\n"),
  );
  await rm(archivePath, { force: true });
  // The payload is already compressed. Store it without a second compression
  // pass, and stream concatenation so the 2+ GiB installer never lives in RAM.
  await run(sevenZip, ["a", "-t7z", "-mx=0", "-ms=off", archivePath, path.basename(event.file), payload], sourceDirectory);
  const combinedBytes = (await Promise.all([modulePath, configPath, archivePath].map((file) => stat(file)))).reduce((sum, file) => sum + file.size, 0);
  if (combinedBytes >= 4 * 1024 ** 3 - 1024 ** 2) throw new Error("Offline installer exceeds the supported 4 GiB executable size; do not distribute it.");
  const destination = await open(stagedOutput, "w");
  try {
    for (const file of [modulePath, configPath, archivePath]) {
      for await (const chunk of createReadStream(file)) await destination.writeFile(chunk);
    }
  } finally {
    await destination.close();
  }
  await run(sevenZip, ["t", stagedOutput]);
  // Use the same signing manager as the inner NSIS installer. Signed release
  // mode must cover the outer executable too, after all bytes are appended.
  await event.packager.signIf(stagedOutput);
  await rename(stagedOutput, output);
  await writeFile(path.join(outputDirectory, "SHA256SUMS.txt"), `${await sha256(output)}  ${path.basename(output)}\n`);
  await writeFile(
    path.join(outputDirectory, "installer-manifest.json"),
    `${JSON.stringify(
      {
        version,
        installer: path.basename(output),
        bytes: (await stat(output)).size,
        sha256: await sha256(output),
        offline: true,
        payload,
        payloadSha256: await sha256(path.join(sourceDirectory, payload)),
        bootstrapper: path.basename(event.file),
        bootstrapperSha256: await sha256(event.file),
        sdkSha256,
      },
      null,
      2,
    )}\n`,
  );
  console.log(`Complete offline installer: ${output}`);
}

async function sha256(file) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: "inherit", windowsHide: true });
    child.once("error", reject);
    child.once("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${path.basename(command)} failed: ${code}.`))));
  });
}
