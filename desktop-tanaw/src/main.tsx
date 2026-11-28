import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import "./styles/workspace.css";
import "./features/camera/camera-setup.css";
import "./features/reports/reports.css";
import "./styles/theme-tokens.css";
import "./styles/theme-utilities.css";
import "./styles/theme.css";
// The page skeletons shown while a page's code loads use these pages' own classes, so their
// stylesheets load up front; they stay last, after the theme, as they were when loaded on demand.
import "./features/dashboard/dashboard.css";
import "./features/help/help-center.css";
import "./ui-kit/patterns/GeneralSettings.css";
import { preloadLoginBackgroundImages } from "./features/login/utils/login-background-assets.ts";
import { applyThemePreference, getInitialThemePreference } from "./features/security/utils/theme.ts";
import { syncSkeletonSweep } from "./ui-kit/lib/skeleton.ts";

applyThemePreference(getInitialThemePreference());
void preloadLoginBackgroundImages();
// Every loading skeleton shimmers with the same passing band of light, whenever it appears.
syncSkeletonSweep();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
