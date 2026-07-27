import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  PersistentIssueNotice,
  PersistentIssueViewport,
} from "./PersistentIssueProvider";
import { getUserFacingIssueMessage } from "../services/persistent-issue";

describe("PersistentIssueProvider", () => {
  it("renders persistent issues without a dismiss control", () => {
    const markup = renderToStaticMarkup(
      <PersistentIssueViewport
        issues={[
          {
            id: "ml-runtime",
            message: "The camera service is not ready.",
            title: "Visitor counts unavailable",
            tone: "error",
          },
          {
            id: "realtime",
            message: "TANAW is reconnecting automatically.",
            title: "Live updates paused",
            tone: "warning",
          },
        ]}
      />,
    );

    expect(markup).toContain("Current system issues");
    expect(markup).toContain("Visitor counts unavailable");
    expect(markup).toContain("Live updates paused");
    expect(markup).not.toContain("<button");
  });

  it("announces errors assertively and warnings politely", () => {
    const errorMarkup = renderToStaticMarkup(
      <PersistentIssueNotice
        issue={{
          id: "error",
          message: "Camera unavailable.",
          title: "Camera issue",
          tone: "error",
        }}
      />,
    );
    const warningMarkup = renderToStaticMarkup(
      <PersistentIssueNotice
        issue={{
          id: "warning",
          message: "Reconnecting.",
          title: "Connection warning",
          tone: "warning",
        }}
      />,
    );

    expect(errorMarkup).toContain('role="alert"');
    expect(errorMarkup).toContain('aria-live="assertive"');
    expect(warningMarkup).toContain('role="status"');
    expect(warningMarkup).toContain('aria-live="polite"');
  });

  it("replaces technical ML startup details with a user-facing recovery message", () => {
    expect(
      getUserFacingIssueMessage(
        "The local ML service started but did not expose the required camera runtime API.",
      ),
    ).toBe(
      "The local camera service is not ready yet. TANAW will keep checking automatically.",
    );
  });
});
