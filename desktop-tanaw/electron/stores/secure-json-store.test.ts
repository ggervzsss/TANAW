import { mkdtempSync, readdirSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

const { decryptString, encryptString, getSelectedStorageBackend, isEncryptionAvailable } = vi.hoisted(() => ({
  decryptString: vi.fn((value: Buffer) => value.toString().replace(/^encrypted:/, "")),
  encryptString: vi.fn((value: string) => Buffer.from(`encrypted:${value}`)),
  getSelectedStorageBackend: vi.fn(() => "kwallet6"),
  isEncryptionAvailable: vi.fn(() => true),
}));

vi.mock("electron", () => ({
  safeStorage: {
    decryptString,
    encryptString,
    getSelectedStorageBackend,
    isEncryptionAvailable,
  },
}));

import { assertSecureStorageAvailable, readSecureJson, writeSecureJson } from "./secure-json-store";

describe("secure JSON persistence", () => {
  afterEach(() => vi.clearAllMocks());

  it("atomically replaces encrypted data without leaving temporary files", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "tanaw-secure-store-"));
    const target = path.join(directory, "session.json");

    writeSecureJson(target, { token: "secret" });

    expect(readSecureJson(target)).toEqual({ token: "secret" });
    expect(readdirSync(directory)).toEqual(["session.json"]);
    expect(readFileSync(target, "utf8")).not.toContain('"token":"secret"');
  });

  it("reports corruption instead of silently treating it as logged-out data", () => {
    const directory = mkdtempSync(path.join(os.tmpdir(), "tanaw-secure-store-"));
    const target = path.join(directory, "session.json");
    writeSecureJson(target, { token: "secret" });
    decryptString.mockImplementationOnce(() => {
      throw new Error("corrupt");
    });

    expect(() => readSecureJson(target)).toThrow(/could not be read/i);
  });

  it("rejects Electron's plaintext Linux fallback", () => {
    if (process.platform !== "linux") return;
    getSelectedStorageBackend.mockReturnValueOnce("basic_text");

    expect(() => assertSecureStorageAvailable()).toThrow(/keyring/i);
  });
});
