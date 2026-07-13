import { describe, expect, it } from "vitest";
import { decimalToChartNumber, formatDecimal, sumDecimals } from "./decimal";

describe("report decimal presentation", () => {
  it("preserves recorded scale and groups digits without binary conversion", () => {
    expect(formatDecimal("99999999999999.999999")).toBe("99,999,999,999,999.999999");
    expect(formatDecimal("0.100000")).toBe("0.100000");
    expect(formatDecimal(null)).toBe("Not recorded");
  });

  it("sums decimal strings exactly with BigInt scaling", () => {
    expect(sumDecimals(["0.100000", "0.200000"])).toBe("0.300000");
    expect(sumDecimals(["99999999999999.999999", "0.000001"])).toBe("100000000000000.000000");
    expect(sumDecimals(["1", null])).toBeNull();
  });

  it("uses numeric conversion only as an explicitly lossy chart projection", () => {
    expect(decimalToChartNumber("0.100000")).toBe(0.1);
    expect(decimalToChartNumber("invalid")).toBeNull();
  });
});
