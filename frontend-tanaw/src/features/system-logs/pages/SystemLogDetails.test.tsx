import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { SystemLog } from "@/shared/types";
import { AdminLogDetailFields } from "./AdminSystemLogsPage";
import { ActivityDetailFields } from "./ITSystemLogsPage";

const logWithMetadata: SystemLog = {
  id: "log-1",
  timestamp: "2026-07-18T10:00:00Z",
  category: "IT Activity",
  severity: "Success",
  actor: "Very Long Actor Name",
  actorRole: "IT Personnel",
  action: "Update Profile",
  target: "account@example.test",
  summary: "The profile was updated.",
  sourceId: "source-1",
  metadata: { internalOnlyToken: "must-not-render" },
};

describe("system log detail presentation", () => {
  it.each([
    ["Log Details", <AdminLogDetailFields log={logWithMetadata} />],
    ["Activity Details", <ActivityDetailFields activity={logWithMetadata} />],
  ])("keeps API metadata out of %s while retaining legitimate fields", (_name, content) => {
    const markup = renderToStaticMarkup(content);
    expect(markup).toContain("Very Long Actor Name");
    expect(markup).toContain("The profile was updated.");
    expect(markup).not.toContain("Metadata");
    expect(markup).not.toContain("internalOnlyToken");
    expect(markup).not.toContain("must-not-render");
  });
});
