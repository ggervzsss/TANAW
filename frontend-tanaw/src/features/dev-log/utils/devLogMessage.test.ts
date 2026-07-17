import { describe, expect, it } from "vitest";
import { splitDevLogMessage } from "./devLogMessage";

describe("splitDevLogMessage", () => {
  it("preserves messages without links", () => {
    expect(splitDevLogMessage("Verification code: 123456")).toEqual([{ type: "text", value: "Verification code: 123456" }]);
  });

  it("separates generated links while preserving surrounding text", () => {
    const message = ["Activate your account:", "https://portal.example.test/activate-account#token=abc123", "This link expires soon."].join("\n");

    expect(splitDevLogMessage(message)).toEqual([
      { type: "text", value: "Activate your account:\n" },
      {
        type: "link",
        value: "https://portal.example.test/activate-account#token=abc123",
      },
      { type: "text", value: "\nThis link expires soon." },
    ]);
  });

  it("extracts every link in a message", () => {
    expect(splitDevLogMessage("Open https://one.example.test or https://two.example.test/path")).toEqual([
      { type: "text", value: "Open " },
      { type: "link", value: "https://one.example.test" },
      { type: "text", value: " or " },
      { type: "link", value: "https://two.example.test/path" },
    ]);
  });
});
