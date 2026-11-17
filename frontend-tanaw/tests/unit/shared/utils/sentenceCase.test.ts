import { describe, expect, it } from "vitest";
import { toSentenceCase } from "../../../../src/shared/utils/sentenceCase";

describe("toSentenceCase", () => {
  it("lowercases every word after the first", () => {
    expect(toSentenceCase("In Review")).toBe("In review");
    expect(toSentenceCase("Returned for Revision")).toBe("Returned for revision");
    expect(toSentenceCase("People in Area: 3")).toBe("People in area: 3");
  });

  it("capitalizes machine values and turns underscores into spaces", () => {
    expect(toSentenceCase("running")).toBe("Running");
    expect(toSentenceCase("retry_scheduled")).toBe("Retry scheduled");
  });

  it("keeps acronyms and mixed-case words", () => {
    expect(toSentenceCase("ML Service Running")).toBe("ML service running");
    expect(toSentenceCase("Fix in TANAW")).toBe("Fix in TANAW");
    expect(toSentenceCase("LGU Staff Account")).toBe("LGU staff account");
  });

  it("keeps hyphenated words and spacing", () => {
    expect(toSentenceCase("Staff Follow-up")).toBe("Staff follow-up");
    expect(toSentenceCase("  Not Configured ")).toBe("Not configured");
  });
});
