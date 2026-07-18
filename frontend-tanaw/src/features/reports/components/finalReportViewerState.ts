export function getFinalReportViewerLayout(isFullscreen: boolean) {
  return {
    backdrop: isFullscreen ? "p-0" : "p-4",
    panel: isFullscreen ? "h-dvh max-h-dvh max-w-none rounded-none border-0" : "max-h-[95vh] max-w-4xl rounded-[30px] border",
  };
}

export function getFinalReportViewerEscapeAction(isFullscreen: boolean, hasNestedDialog: boolean) {
  if (hasNestedDialog) return "ignore" as const;
  return isFullscreen ? ("exit-fullscreen" as const) : ("close-viewer" as const);
}
