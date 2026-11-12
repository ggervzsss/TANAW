import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export const DESKTOP_RELEASE_PLATFORM = "win32" as const;
export const DESKTOP_RELEASE_ARCH = "x64" as const;
export const DESKTOP_RELEASE_TARGET = "nsis-web" as const;
export const DESKTOP_RELEASE_EXECUTABLE = "tanaw-ml-service.exe";
export const DESKTOP_RELEASE_LOCALES = ["en-US", "fil"] as const;

export const REQUIRED_MODEL_ASSETS = [
  "person_reid.onnx",
  "person_reid_cpu.onnx",
  "yolo11m.pt",
  "yolo11m_640_openvino_model/metadata.yaml",
  "yolo11m_640_openvino_model/yolo11m.bin",
  "yolo11m_640_openvino_model/yolo11m.xml",
  "yolo11n.pt",
  "yolo11n_480_openvino_model/metadata.yaml",
  "yolo11n_480_openvino_model/yolo11n.bin",
  "yolo11n_480_openvino_model/yolo11n.xml",
  "yolo11n_640_openvino_model/metadata.yaml",
  "yolo11n_640_openvino_model/yolo11n.bin",
  "yolo11n_640_openvino_model/yolo11n.xml",
  "yolo11s.pt",
  "yolo11s_640_openvino_model/metadata.yaml",
  "yolo11s_640_openvino_model/yolo11s.bin",
  "yolo11s_640_openvino_model/yolo11s.xml",
] as const;

export const PROHIBITED_RELEASE_PATH_SEGMENTS = ["__pycache__", ".mypy_cache", ".pytest_cache", ".ruff_cache", "mypy"] as const;

export const PROHIBITED_RELEASE_PATH_PREFIXES = ["runtime/_internal/torch/test/"] as const;

type SigningEnvironment = Record<string, string | undefined>;

export function assertWindowsReleaseHost(platform = process.platform, architecture = process.arch): void {
  if (platform !== DESKTOP_RELEASE_PLATFORM || architecture !== DESKTOP_RELEASE_ARCH) {
    throw new Error(`TANAW desktop releases require Windows x64; received ${platform} ${architecture}. ` + "Build on a Windows 10 or 11 x64 host so PyInstaller native libraries match the installer.");
  }
}

export function assertWindowsSigningCredentials(environment: SigningEnvironment): void {
  const certificate = environment.WIN_CSC_LINK?.trim();
  const password = environment.WIN_CSC_KEY_PASSWORD?.trim();
  if (!certificate || !password) {
    throw new Error("Signed TANAW releases require WIN_CSC_LINK and WIN_CSC_KEY_PASSWORD from the CI secret store.");
  }
}

export function releaseBuilderArguments(requireSigning: boolean): string[] {
  return requireSigning ? ["--config.forceCodeSigning=true"] : [];
}

export async function inspectMlReleaseResources(runtimeDirectory: string, modelsDirectory: string, platform: "win32" | "linux" = "win32"): Promise<{ modelBytes: number; runtimeBytes: number }> {
  const runtimeFiles = await listRelativeFiles(runtimeDirectory);
  const modelFiles = await listRelativeFiles(modelsDirectory);

  const executable = platform === "linux" ? "tanaw-ml-service" : DESKTOP_RELEASE_EXECUTABLE;
  if (!runtimeFiles.includes(executable)) {
    throw new Error(`The packaged ML runtime is missing ${executable}.`);
  }
  if (!runtimeFiles.some((file) => file.startsWith("_internal/"))) {
    throw new Error("The packaged ML runtime is missing its _internal dependency directory.");
  }
  const trackerExtension = platform === "linux" ? /^_internal\/lap\/_lapjv.*\.so$/ : /^_internal\/lap\/_lapjv.*\.pyd$/;
  if (!runtimeFiles.some((file) => trackerExtension.test(file))) {
    throw new Error("The packaged ML runtime is missing the native lap tracker dependency.");
  }

  const expectedModels = new Set<string>(REQUIRED_MODEL_ASSETS);
  const missingModels = REQUIRED_MODEL_ASSETS.filter((file) => !modelFiles.includes(file));
  const unexpectedModels = modelFiles.filter((file) => !expectedModels.has(file));
  if (missingModels.length > 0) {
    throw new Error(`Required ML model assets are missing: ${missingModels.join(", ")}.`);
  }
  if (unexpectedModels.length > 0) {
    throw new Error(`Unexpected files would be packaged from ml-service/models: ${unexpectedModels.join(", ")}.`);
  }

  const packagedPaths = [...runtimeFiles.map((file) => `runtime/${file}`), ...modelFiles.map((file) => `models/${file}`)];
  const prohibited = packagedPaths.filter(isProhibitedReleasePath);
  if (prohibited.length > 0) {
    throw new Error(`Development/test artifacts would be packaged: ${prohibited.join(", ")}.`);
  }

  return {
    modelBytes: await directorySize(modelsDirectory),
    runtimeBytes: await directorySize(runtimeDirectory),
  };
}

export async function writeReleaseChecksums(releaseDirectory: string): Promise<string[]> {
  const artifactDirectory = path.join(releaseDirectory, "offline");
  const files = (await listRelativeFiles(artifactDirectory)).filter((file) => file.endsWith("-Offline-Setup.exe"));
  if (files.length === 0) {
    throw new Error(`No Windows release artifacts were found under ${artifactDirectory}.`);
  }

  const lines: string[] = [];
  for (const file of files.sort()) {
    const relativeArtifactPath = path.posix.join("offline", file);
    lines.push(`${await sha256File(path.join(artifactDirectory, file))}  ${relativeArtifactPath}`);
  }
  await writeFile(path.join(releaseDirectory, "SHA256SUMS.txt"), `${lines.join("\n")}\n`, "utf8");
  return lines;
}

export async function inspectOfflineInstaller(releaseDirectory: string, version: string): Promise<number> {
  const directory = path.join(releaseDirectory, "offline");
  const manifest = JSON.parse(await readFile(path.join(directory, "installer-manifest.json"), "utf8")) as {
    version: string;
    installer: string;
    bytes: number;
    sha256: string;
    offline: boolean;
    payload: string;
    payloadSha256: string;
    bootstrapper: string;
    bootstrapperSha256: string;
  };
  const expectedInstaller = `TANAW Enterprise Desktop-Windows-${version}-Offline-Setup.exe`;
  if (
    manifest.version !== version ||
    manifest.installer !== expectedInstaller ||
    manifest.offline !== true ||
    manifest.payload !== `desktop-tanaw-${version}-x64.nsis.7z` ||
    manifest.bootstrapper !== `TANAW Enterprise Desktop-Windows-${version}-Setup.exe`
  ) {
    throw new Error("The complete offline installer manifest does not match this release.");
  }
  const installer = path.join(directory, expectedInstaller);
  const bytes = (await stat(installer)).size;
  if (bytes !== manifest.bytes || bytes >= 4 * 1024 ** 3 || (await sha256File(installer)) !== manifest.sha256) {
    throw new Error("The complete offline installer size or SHA-256 does not match its manifest.");
  }
  for (const [file, hash] of [
    [manifest.payload, manifest.payloadSha256],
    [manifest.bootstrapper, manifest.bootstrapperSha256],
  ] as const) {
    if ((await sha256File(path.join(releaseDirectory, DESKTOP_RELEASE_TARGET, file))) !== hash) {
      throw new Error("The offline installer references a stale NSIS payload or bootstrapper.");
    }
  }
  return bytes;
}

async function sha256File(file: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

function isProhibitedReleasePath(file: string): boolean {
  const normalized = file.replaceAll("\\", "/");
  const segments = normalized.split("/");
  return (
    PROHIBITED_RELEASE_PATH_SEGMENTS.some((segment) => segments.includes(segment)) ||
    PROHIBITED_RELEASE_PATH_PREFIXES.some((prefix) => normalized.startsWith(prefix)) ||
    normalized.endsWith(".pyc") ||
    normalized.endsWith(".pyo")
  );
}

async function listRelativeFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        return (await listRelativeFiles(entryPath)).map((file) => path.posix.join(entry.name, file));
      }
      return [entry.name];
    }),
  );
  return files.flat().sort();
}

async function directorySize(directory: string): Promise<number> {
  const files = await listRelativeFiles(directory);
  const sizes = await Promise.all(files.map((file) => stat(path.join(directory, file))));
  return sizes.reduce((total, file) => total + file.size, 0);
}
