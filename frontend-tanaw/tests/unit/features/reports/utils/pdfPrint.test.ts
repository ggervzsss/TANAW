import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FinalReport } from "@/shared/types";
import { buildVar3 } from "@/features/reports/model/varForms";
import { createAnnualReportPdf, createFinalReportPdf, printAnnualReportPdf, printFinalReportPdf } from "@/features/reports/utils/pdf";
import { PRINT_CLEANUP_MS, PRINT_FRAME_TITLE, printPdfDocument } from "@/features/reports/utils/pdfDocument";

type FakeFrame = {
  title: string;
  tabIndex: number;
  src: string;
  style: { cssText: string };
  attributes: Record<string, string>;
  contentWindow: { focus: () => void; print: () => void } | null;
  setAttribute: (name: string, value: string) => void;
  addEventListener: (type: string, listener: () => void) => void;
  remove: () => void;
  load: () => void;
  removed: boolean;
};

let frames: FakeFrame[];
let attached: FakeFrame[];
let blobs: Blob[];
let revoked: string[];
let opened: unknown[][];
let downloads: { href: string; download: string }[];
let print: ReturnType<typeof vi.fn<() => void>>;

function fakeFrame(): FakeFrame {
  const listeners: Record<string, () => void> = {};
  const frame: FakeFrame = {
    title: "",
    tabIndex: 0,
    src: "",
    style: { cssText: "" },
    attributes: {},
    contentWindow: { focus: vi.fn(), print: () => print() },
    setAttribute: (name, value) => {
      frame.attributes[name] = value;
    },
    addEventListener: (type, listener) => {
      listeners[type] = listener;
    },
    remove: () => {
      frame.removed = true;
      attached = attached.filter((item) => item !== frame);
    },
    load: () => listeners.load?.(),
    removed: false,
  };
  return frame;
}

beforeEach(() => {
  vi.useFakeTimers();
  frames = [];
  attached = [];
  blobs = [];
  revoked = [];
  opened = [];
  downloads = [];
  print = vi.fn<() => void>();
  vi.stubGlobal("document", {
    createElement: (tag: string) => {
      if (tag === "a") {
        const anchor = { href: "", download: "", click: () => downloads.push({ href: anchor.href, download: anchor.download }), remove: vi.fn() };
        return anchor;
      }
      expect(tag).toBe("iframe");
      const frame = fakeFrame();
      frames.push(frame);
      return frame;
    },
    body: { appendChild: (node: FakeFrame | { download: string }) => "load" in node && attached.push(node) },
  });
  vi.stubGlobal("window", { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout, open: (...args: unknown[]) => opened.push(args) });
  vi.spyOn(URL, "createObjectURL").mockImplementation((blob) => {
    blobs.push(blob as Blob);
    return `blob:report-${blobs.length}`;
  });
  vi.spyOn(URL, "revokeObjectURL").mockImplementation((url) => {
    revoked.push(url);
  });
});

afterEach(() => {
  vi.advanceTimersByTime(PRINT_CLEANUP_MS);
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("printing a report PDF", () => {
  it("loads the PDF into a hidden frame and opens the print dialog once it has loaded", () => {
    printPdfDocument("%PDF-1.4 sample", "REPORT-1.pdf");
    const [frame] = frames;
    expect(attached).toEqual([frame]);
    expect(frame).toMatchObject({ title: PRINT_FRAME_TITLE, tabIndex: -1, src: "blob:report-1" });
    expect(frame.attributes["aria-hidden"]).toBe("true");
    expect(blobs[0].type).toBe("application/pdf");
    expect(print).not.toHaveBeenCalled();

    frame.load();
    expect(print).toHaveBeenCalledTimes(1);
    expect(opened).toEqual([]);
  });

  it("removes the frame and frees the PDF afterwards, or when the next print starts", () => {
    printPdfDocument("%PDF-1.4 first", "REPORT-1.pdf");
    frames[0].load();
    printPdfDocument("%PDF-1.4 second", "REPORT-2.pdf");
    expect(frames[0].removed).toBe(true);
    expect(revoked).toEqual(["blob:report-1"]);
    expect(attached).toEqual([frames[1]]);

    vi.advanceTimersByTime(PRINT_CLEANUP_MS);
    expect(frames[1].removed).toBe(true);
    expect(revoked).toEqual(["blob:report-1", "blob:report-2"]);
    expect(attached).toEqual([]);
  });

  it("downloads the PDF and tells the caller when the browser does not allow printing from the frame", async () => {
    print.mockImplementation(() => {
      throw new Error("Blocked");
    });
    const onDownloaded = vi.fn();
    printPdfDocument("%PDF-1.4 sample", "REPORT 1.pdf", onDownloaded);
    frames[0].load();
    expect(frames[0].removed).toBe(true);
    expect(attached).toEqual([]);
    expect(opened).toEqual([]);
    expect(downloads).toEqual([{ href: "blob:report-2", download: "REPORT_1.pdf" }]);
    expect(await blobs[1].text()).toBe("%PDF-1.4 sample");
    expect(onDownloaded).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(0);
    expect(revoked).toEqual(["blob:report-1", "blob:report-2"]);
  });

  it("prints the same official sheets that Download PDF saves", async () => {
    const report: FinalReport = {
      id: "CON-OCT-2026-0001",
      title: "Citywide Tourism Aggregation",
      period: "October 2026",
      generatedOn: "Nov 12, 2026",
      preparedBy: "LGU Staff",
      preparedRole: "Staff Processing Division",
      status: "Finalized",
      totalEntry: null,
      totalExit: null,
      totalUnique: 120,
      enterpriseCount: 1,
      enterpriseTotal: 1,
      generatedAt: "2026-10-09T08:00:00+08:00",
      updatedAt: "2026-10-09T08:00:00+08:00",
      sources: [{ id: "a", enterprise: "Plaza", enterpriseProfileId: "plaza", attractionCode: "411", code: "REP-1", unique: 120, entry: null, exit: null }],
    };
    printFinalReportPdf(report);
    printAnnualReportPdf([report], 2026);
    expect(await blobs[0].text()).toBe(createFinalReportPdf(report));
    expect(await blobs[1].text()).toBe(createAnnualReportPdf(buildVar3([report], 2026)));
  });
});
