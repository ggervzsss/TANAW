import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./app/App.tsx";
import { applyThemePreference, getStoredThemePreference } from "./shared/utils/theme.ts";

applyThemePreference(getStoredThemePreference());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
