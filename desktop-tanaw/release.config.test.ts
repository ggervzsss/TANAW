import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertWindowsReleaseHost,
  assertWindowsSigningCredentials,
  DESKTOP_RELEASE_ARCH,
  DESKTOP_RELEASE_PLATFORM,
  inspectMlReleaseResources,
  releaseBuilderArguments,
  REQUIRED_MODEL_ASSETS,
  writeReleaseChecksums,
} from "./release.config";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { force: true, recursive: true })));
});

describe("desktop release configuration", () => {
  it("supports Windows x64 releases only", () => {
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

  it("rejects development artifacts and unlisted models", async () => {
    const root = await createReleaseFixture();
    await mkdir(path.join(root, "runtime", "_internal", "torch", "test"), { recursive: true });
    await writeFile(path.join(root, "runtime", "_internal", "torch", "test", "helper.py"), "test");

    await expect(inspectMlReleaseResources(path.join(root, "runtime"), path.join(root, "models"))).rejects.toThrow(/Development\/test artifacts/);

    await rm(path.join(root, "runtime", "_internal", "torch", "test"), { recursive: true });
    await writeFile(path.join(root, "models", "download.tmp"), "temporary");
    await expect(inspectMlReleaseResources(path.join(root, "runtime"), path.join(root, "models"))).rejects.toThrow(/Unexpected files/);
  });

  it("writes SHA-256 checksums only for distributable Windows artifacts", async () => {
    const root = await temporaryDirectory();
    await mkdir(path.join(root, "win-unpacked"), { recursive: true });
    await writeFile(path.join(root, "TANAW-Setup.exe"), "installer");
    await writeFile(path.join(root, "win-unpacked", "TANAW.exe"), "application");

    const lines = await writeReleaseChecksums(root);

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatch(/^[a-f0-9]{64} {2}TANAW-Setup\.exe$/);
  });
});

async function createReleaseFixture(): Promise<string> {
  const root = await temporaryDirectory();
  await mkdir(path.join(root, "runtime", "_internal"), { recursive: true });
  await mkdir(path.join(root, "models"), { recursive: true });
  await writeFile(path.join(root, "runtime", "tanaw-ml-service.exe"), "runtime");
  await writeFile(path.join(root, "runtime", "_internal", "python.dll"), "dependency");
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
