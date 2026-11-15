import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Writable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMainProcessLogging } from "../../../electron/main-logging";

function memoryOutput() {
  const messages: string[] = [];
  const stream = new Writable({
    write(chunk: Buffer, _encoding, done) {
      messages.push(chunk.toString());
      done();
    },
  });
  return { stream, text: () => messages.join("") };
}

describe("main-process logging with disposable launch output", () => {
  const cleanups: (() => void)[] = [];
  afterEach(() => {
    while (cleanups.length) cleanups.pop()!();
    vi.restoreAllMocks();
  });

  function setup() {
    const directory = mkdtempSync(path.join(tmpdir(), "tanaw-main-log-test-"));
    cleanups.push(() => {
      if (path.dirname(path.resolve(directory)) !== path.resolve(tmpdir()) || !path.basename(directory).startsWith("tanaw-main-log-test-")) throw new Error("Unexpected test directory");
      rmSync(directory, { recursive: true, force: true });
    });
    const stdout = memoryOutput(),
      stderr = memoryOutput();
    const logging = createMainProcessLogging(directory, { stdout: stdout.stream, stderr: stderr.stream });
    cleanups.push(logging.dispose);
    return { directory, stdout, stderr, logging, saved: () => readFileSync(logging.file, "utf8") };
  }

  it("retains errors, stack traces and formatting, and redacts secrets in both sinks", () => {
    const { stdout, stderr, logging, saved } = setup();
    logging.console.info("camera %d: %s", 2, "ready");
    logging.console.error(new Error("Camera unavailable rtsp://user:synthetic-secret@192.0.2.1/stream"), { password: "synthetic password with spaces" });
    expect(stdout.text()).toContain("camera 2: ready");
    for (const text of [stderr.text(), saved()]) {
      expect(text).toContain("Error: Camera unavailable rtsp://[redacted]@192.0.2.1/stream");
      expect(text).toContain("main-logging.test.ts");
      expect(text).not.toContain("synthetic");
    }
  });

  it("retires only the broken stream after Electron-style synchronous EPIPE writes", () => {
    const { stdout, stderr, logging, saved } = setup();
    const write = vi.spyOn(stderr.stream, "write").mockImplementation(() => {
      throw Object.assign(new Error("broken pipe"), { code: "EPIPE" });
    });
    expect(() => logging.console.error("original IPC failure")).not.toThrow();
    expect(() => logging.console.error("later important error")).not.toThrow();
    logging.console.info("stdout remains available");
    expect(write).toHaveBeenCalledTimes(1);
    expect(stdout.text()).toContain("stdout remains available");
    expect(saved()).toContain("original IPC failure");
    expect(saved()).toContain("later important error");
    expect(saved().match(/stderr disconnected/g)).toHaveLength(1);
  });

  it("handles asynchronous EPIPE and raw stdio error events without a global exception handler", async () => {
    const { stdout, stderr, logging, saved } = setup();
    stdout.stream.emit("error", Object.assign(new Error("closed output"), { code: "EPIPE" }));
    // A native/third-party direct write also emits on the guarded stdio stream.
    stderr.stream.destroy(Object.assign(new Error("closed output"), { code: "EPIPE" }));
    await new Promise((resolve) => setImmediate(resolve));
    logging.console.info("service still responsive");
    logging.console.error("diagnostic after terminal closed");
    expect(saved()).toContain("stdout disconnected (EPIPE)");
    expect(saved()).toContain("stderr disconnected (EPIPE)");
    expect(saved()).toContain("diagnostic after terminal closed");
    expect(stdout.text()).toBe("");
  });

  it("does not swallow unrelated synchronous or asynchronous output errors", () => {
    const { stdout, stderr, logging, saved } = setup();
    const error = Object.assign(new Error("device failure"), { code: "EIO" });
    const write = vi.spyOn(stdout.stream, "write").mockImplementation(() => {
      throw error;
    });
    expect(() => logging.console.info("important error context")).toThrow(error);
    expect(() => stderr.stream.emit("error", error)).toThrow(error);
    expect(saved()).toContain("device failure");
    expect(saved()).toContain("important error context");
    write.mockRestore();
    logging.console.info("later diagnostics remain writable");
    expect(saved()).toContain("later diagnostics remain writable");
    expect(stdout.text()).toContain("later diagnostics remain writable");
  });

  it("logs fatal exceptions, including network EPIPE, without classifying them as closed stdio", () => {
    const { logging, saved } = setup();
    logging.recordException(Object.assign(new Error("network EPIPE must still be reported"), { code: "EPIPE" }), "uncaughtException");
    expect(saved()).toContain("[FATAL] uncaughtException: Error: network EPIPE");
    expect(saved()).not.toContain("disconnected");
  });

  it("rotates bounded logs and retains the preceding failure log", () => {
    const { logging, saved, directory } = setup();
    writeFileSync(logging.file, "previous failure\n".padEnd(1024 * 1024, "x"));
    logging.console.error("new failure");
    expect(readFileSync(path.join(directory, "main.previous.log"), "utf8")).toContain("previous failure");
    expect(saved()).toContain("new failure");
    expect(saved().length).toBeLessThan(1000);
  });

  it("reports unavailable file storage once while retaining terminal errors", () => {
    const { logging, stdout, stderr, directory } = setup();
    writeFileSync(logging.file, "existing diagnostic");
    // A file used as the parent directory deterministically simulates an
    // unwritable destination, including on Windows with elevated permissions.
    const failing = createMainProcessLogging(logging.file, { stdout: stdout.stream, stderr: stderr.stream });
    cleanups.push(failing.dispose);
    failing.console.error("must remain visible even without disk logging");
    failing.console.error("second error");
    expect(stderr.text()).toContain("must remain visible");
    expect(stderr.text().match(/Cannot write main-process log/g)).toHaveLength(1);
    expect(readFileSync(path.join(directory, "main.log"), "utf8")).toBe("existing diagnostic");
  });
});
