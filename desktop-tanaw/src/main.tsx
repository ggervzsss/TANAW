import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { preloadLoginBackgroundImages } from "./features/login/utils/login-background-assets.ts";
import { applyThemePreference, getInitialThemePreference } from "./features/security/utils/theme.ts";

applyThemePreference(getInitialThemePreference());
void preloadLoginBackgroundImages();

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
