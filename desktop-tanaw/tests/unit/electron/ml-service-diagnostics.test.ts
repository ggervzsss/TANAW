import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createMlDiagnosticLog, createMlDiagnosticOutput, redactMlDiagnostic } from "../../../electron/ml-service-diagnostics";

describe("ML diagnostic logs", () => {
  it("redacts complete quoted passwords containing spaces", () => {
    expect(redactMlDiagnostic('{"password": "synthetic password with spaces"}')).not.toContain("synthetic");
  });
  it("redacts camera credentials split across native output chunks", () => {
    const lines: string[] = [];
    const output = createMlDiagnosticOutput((line) => lines.push(line));
    output.push(Buffer.from("Unable to open rtsp://camera-user:sec"));
    output.push(Buffer.from("ret@192.0.2.1/stream1\nTraceback: native import failed\n"));
    expect(lines).toEqual(["Unable to open rtsp://[redacted]@192.0.2.1/stream1", "Traceback: native import failed"]);
  });

  it("does not leak the tail of an oversized credential-bearing line", () => {
    const lines: string[] = [];
    const output = createMlDiagnosticOutput((line) => lines.push(line));
    output.push(Buffer.from(`rtsp://user:${"s".repeat(70_000)}`));
    output.push(Buffer.from("secret@192.0.2.1/stream\nnext message\n"));
    output.flush();
    expect(lines).toEqual(["next message"]);
  });

  it("saves native failures and redacts service tokens without changing the process output", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "tanaw-diagnostic-test-"));
    try {
      const log = createMlDiagnosticLog(directory);
      log.write("DLL load failed; X-TANAW-ML-Token=synthetic-token");
      const saved = await readFile(log.file, "utf8");
      expect(saved).toContain("DLL load failed");
      expect(saved).not.toContain("synthetic-token");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
