import { safeStorage } from "electron";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

type SecureEnvelope = { encoding: "safeStorage"; payload: string; version: 1 };

export function readSecureJson(filePath: string): unknown | null {
  if (!existsSync(filePath)) return null;
  assertSecureStorageAvailable();
  try {
    const envelope = JSON.parse(readFileSync(filePath, "utf8")) as Partial<SecureEnvelope>;
    if (envelope.version !== 1 || envelope.encoding !== "safeStorage" || typeof envelope.payload !== "string") {
      throw new Error("unsupported secure-store envelope");
    }
    return JSON.parse(safeStorage.decryptString(Buffer.from(envelope.payload, "base64"))) as unknown;
  } catch {
    throw new Error(`Secure local data at ${path.basename(filePath)} could not be read.`);
  }
}

export function writeSecureJson(filePath: string, value: unknown) {
  assertSecureStorageAvailable();
  const directory = path.dirname(filePath);
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const envelope: SecureEnvelope = {
    encoding: "safeStorage",
    payload: safeStorage.encryptString(JSON.stringify(value)).toString("base64"),
    version: 1,
  };
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  let descriptor: number | null = null;
  try {
    descriptor = openSync(temporaryPath, "wx", 0o600);
    writeFileSync(descriptor, JSON.stringify(envelope), "utf8");
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = null;
    renameSync(temporaryPath, filePath);
    if (process.platform !== "win32") {
      const directoryDescriptor = openSync(directory, "r");
      try {
        fsyncSync(directoryDescriptor);
      } finally {
        closeSync(directoryDescriptor);
      }
    }
  } finally {
    if (descriptor !== null) closeSync(descriptor);
    if (existsSync(temporaryPath)) unlinkSync(temporaryPath);
  }
}

export function assertSecureStorageAvailable() {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("Operating-system protected storage is unavailable.");
  }
  if (process.platform === "linux" && safeStorage.getSelectedStorageBackend() === "basic_text") {
    throw new Error("An operating-system keyring is required to protect TANAW credentials.");
  }
}
