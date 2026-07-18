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
  const venvPython = platform === "win32" ? path.join(serviceDir, ".venv", "Scripts", "python.exe") : path.join(serviceDir, ".venv", "bin", "python");

  // Development must go through uv so an existing but stale .venv is
  // synchronized with uv.lock before the service starts. Packaged builds may
  // ship a prepared runtime, which remains the preferred production path.
  if (isPackaged && pathExists(venvPython)) {
    return { command: venvPython, args: ["main.py"] };
  }

  return { command: "uv", args: ["run", "--frozen", "python", "main.py"] };
}
