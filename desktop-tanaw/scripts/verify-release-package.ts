import { readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  DESKTOP_RELEASE_ARCH,
  DESKTOP_RELEASE_LOCALES,
  DESKTOP_RELEASE_PLATFORM,
  DESKTOP_RELEASE_TARGET,
  inspectMlReleaseResources,
  REQUIRED_MODEL_ASSETS,
  writeReleaseChecksums,
} from "../release.config.ts";

type BuilderConfiguration = {
  electronLanguages?: string[];
  extraResources?: Array<{ filter?: string[]; from?: string; to?: string }>;
  forceCodeSigning?: boolean;
  linux?: unknown;
  mac?: unknown;
  win?: {
    signAndEditExecutable?: boolean;
    signtoolOptions?: {
      certificateFile?: string;
      certificatePassword?: string;
      signingHashAlgorithms?: string[];
    };
    target?: Array<{ arch?: string[]; target?: string }>;
  };
};

const stage = process.argv[2] ?? "configuration";
const projectDirectory = process.cwd();
const packageVersion = JSON.parse(await readFile(path.join(projectDirectory, "package.json"), "utf8")) as {
  version: string;
};
const releaseDirectory = path.join(projectDirectory, "release", packageVersion.version);

if (stage === "configuration") {
  const configuration = await readBuilderConfiguration();
  verifyBuilderConfiguration(configuration);
  console.log(`Desktop release target: ${DESKTOP_RELEASE_PLATFORM} ${DESKTOP_RELEASE_ARCH} ${DESKTOP_RELEASE_TARGET}.`);
  console.log(`Electron locales: ${DESKTOP_RELEASE_LOCALES.join(", ")}.`);
} else if (stage === "inputs") {
  const sizes = await inspectMlReleaseResources(path.join(projectDirectory, "ml-service", "dist", "tanaw-ml-service"), path.join(projectDirectory, "ml-service", "models"));
  console.log(`ML runtime input: ${formatBytes(sizes.runtimeBytes)}.`);
  console.log(`ML model input: ${formatBytes(sizes.modelBytes)} across ${REQUIRED_MODEL_ASSETS.length} files.`);
} else if (stage === "packaged") {
  const sizes = await inspectMlReleaseResources(
    path.join(releaseDirectory, "win-unpacked", "resources", "ml-service", "runtime"),
    path.join(releaseDirectory, "win-unpacked", "resources", "ml-service", "models"),
  );
  console.log(`Packaged ML resources verified: ${formatBytes(sizes.runtimeBytes + sizes.modelBytes)}.`);
} else if (stage === "checksums") {
  const lines = await writeReleaseChecksums(releaseDirectory);
  console.log(`Wrote SHA256SUMS.txt for ${lines.length} Windows release artifact(s).`);
} else {
  throw new Error(`Unknown release verification stage: ${stage}.`);
}

async function readBuilderConfiguration(): Promise<BuilderConfiguration> {
  const source = await readFile(path.join(projectDirectory, "electron-builder.json5"), "utf8");
  // The repository-owned JSON5 file is also valid as a JavaScript object literal.
  return Function(`"use strict"; return (${source});`)() as BuilderConfiguration;
}

function verifyBuilderConfiguration(configuration: BuilderConfiguration): void {
  if (configuration.mac !== undefined || configuration.linux !== undefined) {
    throw new Error("The desktop builder must not advertise unsupported macOS or Linux targets.");
  }
  if (configuration.forceCodeSigning !== false) {
    throw new Error("Local packaging must remain available; signed release mode enables forceCodeSigning explicitly.");
  }
  if (JSON.stringify(configuration.electronLanguages) !== JSON.stringify(DESKTOP_RELEASE_LOCALES)) {
    throw new Error("Electron locale packaging does not match the supported release locale list.");
  }
  const target = configuration.win?.target;
  if (target?.length !== 1 || target[0]?.target !== DESKTOP_RELEASE_TARGET || JSON.stringify(target[0]?.arch) !== JSON.stringify([DESKTOP_RELEASE_ARCH])) {
    throw new Error("Electron Builder must target only NSIS on Windows x64.");
  }
  if (configuration.win?.signAndEditExecutable !== true) {
    throw new Error("Windows executable metadata editing and signing must remain enabled.");
  }
  if (JSON.stringify(configuration.win.signtoolOptions?.signingHashAlgorithms) !== JSON.stringify(["sha256"])) {
    throw new Error("Windows release signing must use SHA-256.");
  }
  if (configuration.win.signtoolOptions?.certificateFile !== undefined || configuration.win.signtoolOptions?.certificatePassword !== undefined) {
    throw new Error("Signing certificates and passwords must come from CI environment secrets.");
  }

  const resources = configuration.extraResources ?? [];
  const runtime = resources.find((resource) => resource.to === "ml-service/runtime");
  const models = resources.find((resource) => resource.to === "ml-service/models");
  if (!runtime?.filter?.includes("tanaw-ml-service.exe") || !runtime.filter.includes("_internal/**/*")) {
    throw new Error("The ML runtime resource manifest is incomplete.");
  }
  if (runtime.filter.includes("**/*")) {
    throw new Error("The ML runtime must not use an unrestricted resource glob.");
  }
  const positiveModelFilters = (models?.filter ?? []).filter((pattern) => !pattern.startsWith("!"));
  if (JSON.stringify(positiveModelFilters) !== JSON.stringify(REQUIRED_MODEL_ASSETS)) {
    throw new Error("Electron Builder's model resources do not match the canonical model manifest.");
  }
}

function formatBytes(bytes: number): string {
  return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
}
