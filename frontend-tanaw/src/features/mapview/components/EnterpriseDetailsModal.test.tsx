import { describe, expect, it } from "vitest";
import { displayTrend } from "../utils/enterpriseDisplay";

describe("EnterpriseDetailsModal", () => {
  it("keeps an unobserved trend explicitly unavailable", () => {
    expect(displayTrend(undefined)).toBe("Not available");
    expect(displayTrend("Stable")).toBe("Stable");
  });
});
