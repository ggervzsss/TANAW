import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import "./design.css";
import "./features/camera/camera-setup.css";
import "./features/reports/reports.css";
import "./theme-tokens.css";
import "./theme-utilities.css";
import "./theme.css";
import { preloadLoginBackgroundImages } from "./features/login/utils/login-background-assets.ts";
import { applyThemePreference, getInitialThemePreference } from "./features/security/utils/theme.ts";

applyThemePreference(getInitialThemePreference());
void preloadLoginBackgroundImages();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
