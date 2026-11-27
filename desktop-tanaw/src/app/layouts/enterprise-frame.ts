import { matchPath } from "react-router-dom";
import type { EnterpriseView } from "../../types/enterprise";
import { routePaths } from "../router/routePaths";

/**
 * The page frame classes, shared by the workspace and its loading fallback so a skeleton sits in
 * exactly the room its page will take. Settings fills the frame edge to edge; Camera Setup keeps a
 * fixed-height workspace; every other page scrolls inside padded content.
 */
export function enterpriseFrameClassNames(view: EnterpriseView) {
  return {
    main: view === "settings" ? "tanaw-settings-page overflow-auto" : "flex min-h-0 flex-1 flex-col overflow-hidden",
    content: `enterprise-content flex-1 transition-colors duration-300 dark:bg-(--enterprise-app-bg) ${view === "cameras" ? "overflow-hidden p-4 max-xl:p-3" : "overflow-auto p-8 max-xl:p-6 max-sm:p-4"}`,
    page: `mx-auto max-w-470 ${view === "cameras" ? "h-full min-h-0" : ""}`,
  };
}

/** The workspace page a path opens, so the loading fallback can show that page's shape. */
export function enterpriseViewForPath(pathname: string): EnterpriseView {
  if (matchPath(`${routePaths.enterpriseSettings}/*`, pathname)) return "settings";
  if (matchPath(routePaths.enterpriseCameras, pathname)) return "cameras";
  if (matchPath(routePaths.enterpriseReports, pathname)) return "reports";
  if (matchPath(routePaths.enterpriseNotifications, pathname)) return "notifications";
  if (matchPath(routePaths.enterpriseHelp, pathname)) return "help";
  return "dashboard";
}
