import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./app/App.tsx";
import { preloadLoginBackgroundImages } from "./features/login/utils/loginAssets.ts";
import { applyThemePreference, getStoredThemePreference } from "./shared/utils/theme.ts";

applyThemePreference(getStoredThemePreference());
void preloadLoginBackgroundImages();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
