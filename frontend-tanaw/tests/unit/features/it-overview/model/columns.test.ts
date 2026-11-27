import { describe, expect, it } from "vitest";
import { COLUMN_STICKINESS, FIT_SNAP, planColumns } from "../../../../../src/features/it-overview/model/columns";

// Heights in pixels, each with the air below the list.
const busy = { requests: 490, connections: 400, accounts: 410, emails: 260 };
// Connection problems: heading and air, then eight rows that scroll.
const longList = { chrome: 100, min: 256, max: 900 };

describe("planColumns", () => {
  it("puts accounts under requests and stretches the connection problems list to level the columns", () => {
    const plan = planColumns(busy, longList);
    expect(plan.lower).toBe("accounts");
    // Left: requests and accounts (900). Right: the list's heading, the list, and emails.
    expect(plan.fit).toBe(900 - 260 - 100);
    expect(plan.gap).toBe(0);
  });

  it("prefers the shorter page when two layouts both end level", () => {
    const plan = planColumns({ ...busy, requests: 750 }, longList);
    // Emails under requests (1010) and accounts under requests (1160) can both be levelled.
    expect(plan.lower).toBe("emails");
    expect(plan.fit).toBe(1010 - 410 - 100);
  });

  it("never shrinks the list below its floor, and shows a short list in full", () => {
    const tall = planColumns({ requests: 100, connections: 400, accounts: 50, emails: 50 }, longList);
    expect(tall.fit).toBe(256);
    const short = planColumns(busy, { chrome: 100, min: 180, max: 180 });
    expect(short.fit).toBe(180);
  });

  it("shows the whole list rather than hiding less than half a row", () => {
    const plan = planColumns({ requests: 490, connections: 400, accounts: 150, emails: 150 }, { chrome: 100, min: 256, max: 256 + FIT_SNAP - 10 });
    expect(plan.fit).toBe(256 + FIT_SNAP - 10);
  });

  it("balances fixed heights when the connection problems section shows no list", () => {
    const plan = planColumns({ requests: 490, connections: 150, accounts: 410, emails: 260 }, null);
    expect(plan.lower).toBe("emails");
    expect(plan.fit).toBeNull();
    expect(plan.gap).toBe(Math.abs(490 + 260 - (150 + 410)));
  });

  it("levels the columns when every list is empty", () => {
    const plan = planColumns({ requests: 150, connections: 150, accounts: 150, emails: 150 }, null);
    expect(plan.lower).toBe("accounts");
    expect(plan.gap).toBe(0);
  });

  it("keeps the current layout unless another is clearly better", () => {
    const heights = { requests: 490, connections: 150, accounts: 400, emails: 400 };
    // Accounts or emails under requests leave the same gap; the one in use stays.
    expect(planColumns(heights, null, "emails").lower).toBe("emails");
    expect(planColumns(heights, null, "accounts").lower).toBe("accounts");
    // A layout that leaves the columns far apart gives way.
    expect(planColumns(heights, null, "both").lower).not.toBe("both");
    expect(COLUMN_STICKINESS).toBeGreaterThan(0);
  });
});
