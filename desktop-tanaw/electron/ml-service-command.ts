import { existsSync } from "node:fs";
import path from "node:path";

export type MlServiceCommand = {
  args: string[];
  command: string;
};

type MlServiceCommandOptions = {
  isPackaged: boolean;
  platform?: NodeJS.Platform;
  serviceDir: string;
  pathExists?: (candidate: string) => boolean;
};

export function getMlServiceCommand({ isPackaged, platform = process.platform, serviceDir, pathExists = existsSync }: MlServiceCommandOptions): MlServiceCommand {
  const packagedExecutable = path.join(
    serviceDir,
    "runtime",
    platform === "win32" ? "tanaw-ml-service.exe" : "tanaw-ml-service",
  );

  if (isPackaged) {
    if (!pathExists(packagedExecutable)) {
      throw new Error(
        `The bundled ML runtime is missing at ${packagedExecutable}. Rebuild the installer with npm run dist.`,
      );
    }
    return { command: packagedExecutable, args: [] };
  }

  // Development uses the lockfile-managed environment. Production never
  // reaches this external-tool path.
  return { command: "uv", args: ["run", "--frozen", "python", "main.py"] };
}
