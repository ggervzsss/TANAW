const OFFICIAL_REPORT_PRINT_STYLES = `
  :root {
    color-scheme: light !important;
  }

  html,
  body {
    margin: 0 !important;
    min-height: 100% !important;
    background: #ffffff !important;
    color: #111827 !important;
  }

  body {
    print-color-adjust: exact;
    -webkit-print-color-adjust: exact;
  }

  .print-hide {
    display: none !important;
  }

  .tanaw-report-export-light {
    box-sizing: border-box !important;
    display: flex !important;
    min-height: calc(210mm - 10mm) !important;
    width: 100% !important;
    overflow: visible !important;
    background: #ffffff !important;
    color: #111827 !important;
    color-scheme: light !important;
    print-color-adjust: exact;
    -webkit-print-color-adjust: exact;
  }

  .tanaw-report-export-light,
  .tanaw-report-export-light :where(*) {
    border-color: #334155 !important;
  }

  .tanaw-report-export-light :where(h1, h2, h3, h4, p, span, li, th, td) {
    color: #111827 !important;
  }

  .tanaw-report-export-light :where(.text-gray-500, .text-gray-600, .text-slate-500, .text-slate-600) {
    color: #475569 !important;
  }

  .tanaw-report-export-light :where(.bg-white) {
    background: #ffffff !important;
  }

  .tanaw-report-export-light :where(.bg-gray-50, .bg-slate-50) {
    background: #f8fafc !important;
  }

  .tanaw-report-export-light :where(.bg-gray-100, .bg-slate-100) {
    background: #f1f5f9 !important;
  }

  .tanaw-report-export-light .tanaw-official-report-table :where(th, td) {
    background: transparent !important;
    border-color: #334155 !important;
  }

  .tanaw-report-export-light .tanaw-official-report-table thead :where(th) {
    background: #e9eef3 !important;
  }

  .tanaw-report-export-light .tanaw-official-report-table .tanaw-report-total-cell {
    background: #e8edf3 !important;
  }

  .tanaw-report-export-light .tanaw-official-report-table .tanaw-report-final-total-cell {
    background: #d4dde8 !important;
  }

  .tanaw-report-export-light .tanaw-official-report-table .tanaw-report-consolidated-row > * {
    background: #dfe6ee !important;
  }

  .tanaw-report-export-light .tanaw-official-report-table .tanaw-report-consolidated-row > .tanaw-report-final-total-cell {
    background: #c4d0dd !important;
  }

  @media print {
    .tanaw-report-export-light {
      min-height: 0 !important;
      padding: 0 !important;
    }

    @page {
      size: A4 landscape;
      margin: 5mm;
    }
  }
`;

export function buildOfficialReportPrintDocument({
  baseUrl = typeof document === "undefined" ? "http://localhost/" : document.baseURI,
  markup,
  stylesheetTags = "",
  title,
}: {
  baseUrl?: string;
  markup: string;
  stylesheetTags?: string;
  title: string;
}) {
  return `<!doctype html>
<html lang="en" data-report-theme="light">
  <head>
    <meta charset="utf-8" />
    <meta name="color-scheme" content="light" />
    <base href="${escapeHtml(baseUrl)}" />
    <title>${escapeHtml(title)}</title>
    ${stylesheetTags}
    <style>${OFFICIAL_REPORT_PRINT_STYLES}</style>
  </head>
  <body>
    ${markup}
  </body>
</html>`;
}

export function printOfficialReport(reportRoot: HTMLElement, title: string) {
  const printableRoot = reportRoot.cloneNode(true) as HTMLElement;
  printableRoot.classList.add("tanaw-report-export-light");
  printableRoot.setAttribute("data-report-theme", "light");
  const stylesheetTags = Array.from(document.head.querySelectorAll('style, link[rel="stylesheet"]'))
    .map((element) => element.outerHTML)
    .join("\n");

  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.setAttribute("title", "Official report print document");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.style.opacity = "0";

  let cleanupTimer = 0;
  const cleanup = () => {
    window.clearTimeout(cleanupTimer);
    iframe.remove();
  };

  iframe.addEventListener(
    "load",
    () => {
      const printWindow = iframe.contentWindow;
      if (!printWindow) {
        cleanup();
        return;
      }

      printWindow.addEventListener("afterprint", cleanup, { once: true });
      printWindow.requestAnimationFrame(() => {
        printWindow.requestAnimationFrame(() => {
          printWindow.focus();
          printWindow.print();
        });
      });
      cleanupTimer = window.setTimeout(cleanup, 120_000);
    },
    { once: true },
  );

  iframe.srcdoc = buildOfficialReportPrintDocument({
    markup: printableRoot.outerHTML,
    stylesheetTags,
    title,
  });
  document.body.appendChild(iframe);
}

function escapeHtml(value: string) {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}
