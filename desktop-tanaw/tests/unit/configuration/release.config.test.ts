import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertWindowsReleaseHost,
  assertWindowsSigningCredentials,
  DESKTOP_RELEASE_ARCH,
  DESKTOP_RELEASE_PLATFORM,
  inspectMlReleaseResources,
  inspectOfflineInstaller,
  releaseBuilderArguments,
  REQUIRED_MODEL_ASSETS,
  writeReleaseChecksums,
} from "../../../release.config";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe("desktop release configuration", () => {
  it("keeps the Windows release entry point restricted to Windows x64", () => {
    expect(DESKTOP_RELEASE_PLATFORM).toBe("win32");
    expect(DESKTOP_RELEASE_ARCH).toBe("x64");
    expect(() => assertWindowsReleaseHost("win32", "x64")).not.toThrow();
    expect(() => assertWindowsReleaseHost("darwin", "x64")).toThrow(/Windows x64/);
    expect(() => assertWindowsReleaseHost("win32", "arm64")).toThrow(/Windows x64/);
  });

  it("requires CI-provided credentials only for signed release mode", () => {
    expect(releaseBuilderArguments(false)).toEqual([]);
    expect(releaseBuilderArguments(true)).toEqual(["--config.forceCodeSigning=true"]);
    expect(() =>
      assertWindowsSigningCredentials({
        WIN_CSC_KEY_PASSWORD: "secret-from-ci",
        WIN_CSC_LINK: "base64-certificate-from-ci",
      }),
    ).not.toThrow();
    expect(() => assertWindowsSigningCredentials({})).toThrow(/WIN_CSC_LINK/);
    expect(() => assertWindowsSigningCredentials({ WIN_CSC_KEY_PASSWORD: " ", WIN_CSC_LINK: "certificate" })).toThrow(/WIN_CSC_KEY_PASSWORD/);
  });

  it("accepts exactly the supported runtime and model inventory", async () => {
    const root = await createReleaseFixture();
    const result = await inspectMlReleaseResources(path.join(root, "runtime"), path.join(root, "models"));

    expect(result.runtimeBytes).toBeGreaterThan(0);
    expect(result.modelBytes).toBe(REQUIRED_MODEL_ASSETS.length);
  });

  it("requires the native tracker dependency in the bundled runtime", async () => {
    const root = await createReleaseFixture();
    await rm(path.join(root, "runtime", "_internal", "lap"), { recursive: true });

    await expect(inspectMlReleaseResources(path.join(root, "runtime"), path.join(root, "models"))).rejects.toThrow(/native lap tracker dependency/);
  });

  it("requires Linux-native executable and tracker assets for Linux packages", async () => {
    const root = await createReleaseFixture();
    const runtime = path.join(root, "runtime");
    const models = path.join(root, "models");
    await expect(inspectMlReleaseResources(runtime, models, "linux")).rejects.toThrow(/missing tanaw-ml-service/);
    await writeFile(path.join(runtime, "tanaw-ml-service"), "ELF runtime");
    await expect(inspectMlReleaseResources(runtime, models, "linux")).rejects.toThrow(/native lap tracker/);
    await writeFile(path.join(runtime, "_internal", "lap", "_lapjv.cpython-312-x86_64-linux-gnu.so"), "native tracker");
    await expect(inspectMlReleaseResources(runtime, models, "linux")).resolves.toMatchObject({ modelBytes: REQUIRED_MODEL_ASSETS.length });
  });

  it("rejects development artifacts and unlisted models", async () => {
    const root = await createReleaseFixture();
    await mkdir(path.join(root, "runtime", "_internal", "torch", "test"), { recursive: true });
    await writeFile(path.join(root, "runtime", "_internal", "torch", "test", "helper.py"), "test");

    await expect(inspectMlReleaseResources(path.join(root, "runtime"), path.join(root, "models"))).rejects.toThrow(/Development\/test artifacts/);

    await rm(path.join(root, "runtime", "_internal", "torch", "test"), { recursive: true });
    await writeFile(path.join(root, "models", "download.tmp"), "temporary");
    await expect(inspectMlReleaseResources(path.join(root, "runtime"), path.join(root, "models"))).rejects.toThrow(/Unexpected files/);
  });

  it("checksums only the complete offline installer for distribution", async () => {
    const root = await temporaryDirectory();
    await mkdir(path.join(root, "nsis-web"), { recursive: true });
    await mkdir(path.join(root, "win-unpacked"), { recursive: true });
    await mkdir(path.join(root, "offline"), { recursive: true });
    await writeFile(path.join(root, "offline", "TANAW-Offline-Setup.exe"), "complete installer");
    await writeFile(path.join(root, "nsis-web", "TANAW-Setup.exe"), "installer");
    await writeFile(path.join(root, "nsis-web", "desktop-tanaw-0.1.0-x64.nsis.7z"), "payload");
    await writeFile(path.join(root, "win-unpacked", "TANAW.exe"), "application");

    const lines = await writeReleaseChecksums(root);

    expect(lines).toHaveLength(1);
    expect(lines).toEqual([expect.stringMatching(/^[a-f0-9]{64} {2}offline\/TANAW-Offline-Setup\.exe$/)]);
  });

  it("rejects a changed installer or stale payload after the offline bundle is created", async () => {
    const root = await temporaryDirectory();
    await mkdir(path.join(root, "offline"));
    await mkdir(path.join(root, "nsis-web"));
    const installer = "TANAW Enterprise Desktop-Windows-0.1.0-Offline-Setup.exe";
    const bootstrapper = "TANAW Enterprise Desktop-Windows-0.1.0-Setup.exe";
    const payload = "desktop-tanaw-0.1.0-x64.nsis.7z";
    const hash = (value: string) => createHash("sha256").update(value).digest("hex");
    await writeFile(path.join(root, "offline", installer), "installer");
    await writeFile(path.join(root, "nsis-web", bootstrapper), "bootstrapper");
    await writeFile(path.join(root, "nsis-web", payload), "payload");
    await writeFile(
      path.join(root, "offline", "installer-manifest.json"),
      JSON.stringify({
        version: "0.1.0",
        installer,
        bytes: 9,
        sha256: hash("installer"),
        offline: true,
        bootstrapper,
        bootstrapperSha256: hash("bootstrapper"),
        payload,
        payloadSha256: hash("payload"),
      }),
    );
    await expect(inspectOfflineInstaller(root, "0.1.0")).resolves.toBe(9);
    await writeFile(path.join(root, "nsis-web", payload), "different payload");
    await expect(inspectOfflineInstaller(root, "0.1.0")).rejects.toThrow(/stale NSIS/);
    await writeFile(path.join(root, "offline", installer), "damaged installer");
    await expect(inspectOfflineInstaller(root, "0.1.0")).rejects.toThrow(/size or SHA-256/);
  });
});

async function createReleaseFixture(): Promise<string> {
  const root = await temporaryDirectory();
  await mkdir(path.join(root, "runtime", "_internal"), { recursive: true });
  await mkdir(path.join(root, "runtime", "_internal", "lap"), { recursive: true });
  await mkdir(path.join(root, "models"), { recursive: true });
  await writeFile(path.join(root, "runtime", "tanaw-ml-service.exe"), "runtime");
  await writeFile(path.join(root, "runtime", "_internal", "python.dll"), "dependency");
  await writeFile(path.join(root, "runtime", "_internal", "lap", "_lapjv.cp314-win_amd64.pyd"), "dependency");
  for (const model of REQUIRED_MODEL_ASSETS) {
    const destination = path.join(root, "models", model);
    await mkdir(path.dirname(destination), { recursive: true });
    await writeFile(destination, "m");
  }
  return root;
}

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(tmpdir(), "tanaw-release-"));
  temporaryDirectories.push(directory);
  return directory;
}
