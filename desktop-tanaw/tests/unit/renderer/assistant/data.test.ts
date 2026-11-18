import { describe, expect, it, vi } from "vitest";
import { dataNeeds, loadAssistantData, type AssistantDataSource } from "../../../../src/features/dashboard/assistant/data";
import { periodRange, previousRange } from "../../../../src/features/dashboard/assistant/periods";
import { hourly, live, NOW, plan, summary } from "./fixtures";

function source(overrides: Partial<AssistantDataSource> = {}): AssistantDataSource {
  return {
    baseUrl: vi.fn(async () => "http://127.0.0.1:8765"),
    summary: vi.fn(async () => summary()),
    hourly: vi.fn(async () => hourly({})),
    live: vi.fn(async () => live()),
    enterpriseId: "park",
    report: null,
    ...overrides,
  };
}

describe("assistant data", () => {
  it("asks only for what each kind of question needs", () => {
    const today = periodRange("today", NOW);
    expect(dataNeeds(plan("busiest"), NOW)).toMatchObject({ summary: today, previous: null, hourly: today, live: false, required: ["summary"] });
    expect(dataNeeds(plan("compare"), NOW)).toMatchObject({ summary: today, previous: previousRange(today), live: true, required: ["summary", "previous"] });
    expect(dataNeeds(plan("visitors", "yesterday"), NOW)).toMatchObject({ summary: periodRange("yesterday", NOW), live: false });
    expect(dataNeeds(plan("occupancy_now", "month"), NOW)).toMatchObject({ summary: today, live: true, required: ["live"] });
    expect(dataNeeds(plan("report"), NOW)).toMatchObject({ summary: null, report: true });
    for (const intent of ["help", "greeting", "unknown"] as const) expect(dataNeeds(plan(intent), NOW)).toMatchObject({ summary: null, hourly: null, live: false, report: false });
  });

  it("requests nothing from the service for report questions", async () => {
    const report = { id: "R", date: "2026-07-29", status: "Submitted", entries: null, unique: 1 };
    const fetches = source({ report });
    const result = await loadAssistantData(dataNeeds(plan("report"), NOW), fetches);
    expect(result).toMatchObject({ report, failed: false });
    expect(fetches.baseUrl).not.toHaveBeenCalled();
  });

  it("loads the requested ranges in parallel", async () => {
    const fetches = source();
    const needs = dataNeeds(plan("summary", "week"), NOW);
    const result = await loadAssistantData(needs, fetches);
    expect(fetches.summary).toHaveBeenCalledWith("http://127.0.0.1:8765", needs.summary);
    expect(fetches.summary).toHaveBeenCalledWith("http://127.0.0.1:8765", needs.previous);
    expect(fetches.hourly).toHaveBeenCalledWith("http://127.0.0.1:8765", needs.hourly);
    expect(fetches.live).toHaveBeenCalledTimes(1);
    expect(result.failed).toBe(false);
    expect(result.summary?.unique_count).toBe(132);
  });

  it("falls back without hourly activity, such as from an older counting service", async () => {
    const result = await loadAssistantData(dataNeeds(plan("busiest"), NOW), source({ hourly: vi.fn(async () => Promise.reject(new Error("Not Found"))) }));
    expect(result).toMatchObject({ hourly: null, failed: false });
    expect(result.summary).not.toBeNull();
  });

  it("fails the reply when a required request fails or the service is unreachable", async () => {
    expect((await loadAssistantData(dataNeeds(plan("visitors"), NOW), source({ summary: vi.fn(async () => Promise.reject(new Error("down"))) }))).failed).toBe(true);
    expect(
      (
        await loadAssistantData(
          dataNeeds(plan("compare"), NOW),
          source({ summary: vi.fn(async (_url, range) => (range.start === periodRange("today", NOW).start ? summary() : Promise.reject(new Error("down")))) }),
        )
      ).failed,
    ).toBe(true);
    expect((await loadAssistantData(dataNeeds(plan("visitors"), NOW), source({ baseUrl: vi.fn(async () => Promise.reject(new Error("no service"))) }))).failed).toBe(true);
    expect((await loadAssistantData(dataNeeds(plan("occupancy_now"), NOW), source({ live: vi.fn(async () => Promise.reject(new Error("down"))) }))).failed).toBe(true);
  });

  it("rejects counts that belong to another establishment", async () => {
    const result = await loadAssistantData(dataNeeds(plan("visitors"), NOW), source({ summary: vi.fn(async () => summary({ enterprise_id: "someone-else" })) }));
    expect(result).toMatchObject({ summary: null, failed: true });
  });
});
