import { describe, expect, it } from "vitest";
import { recordedActor, recordedText } from "./reportPresentation";

describe("truthful report fallbacks", () => {
  it("keeps absent values and known placeholder actors explicitly unrecorded", () => {
    expect(recordedText(" ")).toBe("Not recorded");
    expect(recordedActor(undefined)).toBe("Not recorded");
    expect(recordedActor("LGU Staff")).toBe("Not recorded");
    expect(recordedActor("System Pipeline")).toBe("Not recorded");
  });

  it("preserves recorded values", () => {
    expect(recordedText("  June 2026 ")).toBe("June 2026");
    expect(recordedActor("  Maria Santos ")).toBe("Maria Santos");
  });
});
