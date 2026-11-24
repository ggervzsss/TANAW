import { describe, expect, it } from "vitest";
import { activityTag, latestActivity, latestRequests } from "../../../../../src/features/admin-dashboard/model/recent";
import type { SystemLog } from "../../../../../src/shared/types";
import { request } from "../../../fixtures/requests";

function log(id: string, timestamp: string, group: SystemLog["group"]): SystemLog {
  return { id, timestamp, group, severity: "Info", actor: "Ana Reyes", actorRole: "Admin", action: "Login", target: "", summary: "Ana Reyes signed in to TANAW." };
}

describe("Dashboard recent lists", () => {
  it("shows the three newest activity records with their group", () => {
    const logs = [log("a", "2026-11-23T01:00:00Z", "Login & Security"), log("b", "2026-11-23T04:00:00Z", "Monitoring"), log("c", "2026-11-23T03:00:00Z", "Reports"), log("d", "2026-11-23T02:00:00Z", "Accounts")];
    expect(latestActivity(logs).map((item) => item.id)).toEqual(["b", "c", "d"]);
    expect(activityTag(logs[1])).toBe("Monitoring");
  });

  it("shows the three most recently changed requests and links to each", () => {
    const requests = [
      request({ id: "old", updatedAt: "2026-11-20T01:00:00Z" }),
      request({ id: "help", group: "Sign-in help", enterpriseName: null, requesterName: "Joy Villanueva", status: "In Progress", updatedAt: "2026-11-23T04:00:00Z" }),
      request({ id: "new", updatedAt: "2026-11-23T05:00:00Z" }),
      request({ id: "mid", updatedAt: "2026-11-22T05:00:00Z" }),
    ];
    const latest = latestRequests(requests);
    expect(latest.map((item) => item.key)).toEqual(["new", "help", "mid"]);
    expect(latest[1]).toMatchObject({ place: "Joy Villanueva", progress: "In progress", search: "?request=help" });
  });
});
