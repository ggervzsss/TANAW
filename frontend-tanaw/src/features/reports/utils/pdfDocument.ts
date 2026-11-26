const PAGE_WIDTH = 842;
const PAGE_HEIGHT = 595;
const FONT_ID = 3;
const BOLD_FONT_ID = 4;

export function downloadPdfDocument(pdf: string, fileName: string) {
  const url = URL.createObjectURL(new Blob([pdf], { type: "application/pdf" }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export const PRINT_FRAME_TITLE = "Report print document";
/**
 * Browsers print a PDF asynchronously and do not reliably say when the print dialog closes, and
 * removing the frame too early can cancel the print. The hidden frame is removed when the next
 * print starts, or after this long.
 */
export const PRINT_CLEANUP_MS = 10 * 60_000;

let endActivePrint: (() => void) | null = null;

/**
 * Prints the generated PDF at once: it loads into a hidden frame and opens the browser's print
 * dialog. If the browser does not allow printing from the frame, the PDF is downloaded as
 * `fileName` instead and `onDownloaded` runs so the caller can tell the user. A new tab is not
 * used, because the frame loads after the click and popup blockers would stop it silently.
 */
export function printPdfDocument(pdf: string, fileName: string, onDownloaded?: () => void) {
  endActivePrint?.();
  const url = URL.createObjectURL(new Blob([pdf], { type: "application/pdf" }));
  const frame = document.createElement("iframe");
  frame.title = PRINT_FRAME_TITLE;
  frame.tabIndex = -1;
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none;";

  let ended = false;
  const end = () => {
    if (ended) return;
    ended = true;
    window.clearTimeout(timer);
    if (endActivePrint === end) endActivePrint = null;
    frame.remove();
    URL.revokeObjectURL(url);
  };
  const timer = window.setTimeout(end, PRINT_CLEANUP_MS);
  endActivePrint = end;

  frame.addEventListener(
    "load",
    () => {
      try {
        const view = frame.contentWindow;
        if (!view) throw new Error("The print frame has no window.");
        view.focus();
        view.print();
      } catch {
        end();
        downloadPdfDocument(pdf, fileName);
        onDownloaded?.();
      }
    },
    { once: true },
  );
  frame.src = url;
  document.body.appendChild(frame);
}

export function buildPdfDocument(pages: string[]) {
  const objects: string[] = [];
  const pageObjectIds: number[] = [];
  objects[0] = "<< /Type /Catalog /Pages 2 0 R >>";
  objects[FONT_ID - 1] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>";
  objects[BOLD_FONT_ID - 1] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>";
  pages.forEach((content, index) => {
    const pageId = BOLD_FONT_ID + 1 + index * 2;
    const contentId = pageId + 1;
    pageObjectIds.push(pageId);
    objects[pageId - 1] =
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 ${FONT_ID} 0 R /F2 ${BOLD_FONT_ID} 0 R >> >> /Contents ${contentId} 0 R >>`;
    objects[contentId - 1] = `<< /Length ${content.length} >>\nstream\n${content}\nendstream`;
  });
  objects[1] = `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageObjectIds.length} >>`;
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`)
    .join("");
  return `${pdf}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;
}
