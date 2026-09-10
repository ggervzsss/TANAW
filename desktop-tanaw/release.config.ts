import { createHash } from "node:crypto";
import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";

export const DESKTOP_RELEASE_PLATFORM = "win32" as const;
export const DESKTOP_RELEASE_ARCH = "x64" as const;
export const DESKTOP_RELEASE_TARGET = "nsis" as const;
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

export async function inspectMlReleaseResources(runtimeDirectory: string, modelsDirectory: string): Promise<{ modelBytes: number; runtimeBytes: number }> {
  const runtimeFiles = await listRelativeFiles(runtimeDirectory);
  const modelFiles = await listRelativeFiles(modelsDirectory);

  if (!runtimeFiles.includes(DESKTOP_RELEASE_EXECUTABLE)) {
    throw new Error(`The packaged ML runtime is missing ${DESKTOP_RELEASE_EXECUTABLE}.`);
  }
  if (!runtimeFiles.some((file) => file.startsWith("_internal/"))) {
    throw new Error("The packaged ML runtime is missing its _internal dependency directory.");
  }
  if (!runtimeFiles.some((file) => /^_internal\/lap\/_lapjv.*\.pyd$/.test(file))) {
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
  const files = (await listRelativeFiles(releaseDirectory)).filter((file) => file.endsWith(".exe") && !file.includes("-unpacked/"));
  if (files.length === 0) {
    throw new Error(`No Windows release artifacts were found under ${releaseDirectory}.`);
  }

  const lines: string[] = [];
  for (const file of files.sort()) {
    const contents = await readFile(path.join(releaseDirectory, file));
    lines.push(`${createHash("sha256").update(contents).digest("hex")}  ${file}`);
  }
  await writeFile(path.join(releaseDirectory, "SHA256SUMS.txt"), `${lines.join("\n")}\n`, "utf8");
  return lines;
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
