import { describe, expect, it } from "vitest";
import { getFinalReportViewerEscapeAction, getFinalReportViewerLayout } from "./finalReportViewerState";

describe("FinalReportViewer layout", () => {
  it("switches between constrained modal and viewport-filling layouts", () => {
    expect(getFinalReportViewerLayout(false)).toEqual({ backdrop: "p-4", panel: "max-h-[95vh] max-w-4xl rounded-[30px] border" });
    expect(getFinalReportViewerLayout(true)).toEqual({ backdrop: "p-0", panel: "h-dvh max-h-dvh max-w-none rounded-none border-0" });
  });

  it("uses Escape to exit fullscreen before closing the viewer", () => {
    expect(getFinalReportViewerEscapeAction(true, false)).toBe("exit-fullscreen");
    expect(getFinalReportViewerEscapeAction(false, false)).toBe("close-viewer");
    expect(getFinalReportViewerEscapeAction(true, true)).toBe("ignore");
  });
});
