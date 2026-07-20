import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { applyThemePreference, getInitialThemePreference, persistThemePreference, resolveThemePreference, type ResolvedTheme } from "../../security/utils/theme";
import type { ThemePreference } from "../../../types/enterprise";

export function AuthThemeToggle() {
  const [theme, setTheme] = useState<ThemePreference>(getInitialThemePreference);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolveThemePreference(getInitialThemePreference()));
  const isDark = resolvedTheme === "dark";
  const label = isDark ? "Switch to light mode" : "Switch to dark mode";

  useEffect(() => {
    const applyTheme = () => {
      setResolvedTheme(applyThemePreference(theme));
    };

    applyTheme();

    if (theme !== "system") return undefined;

    const mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    mediaQuery.addEventListener("change", applyTheme);
    return () => mediaQuery.removeEventListener("change", applyTheme);
  }, [theme]);

  const toggleTheme = () => {
    setTheme((currentTheme) => {
      const nextTheme = resolveThemePreference(currentTheme) === "dark" ? "light" : "dark";
      persistThemePreference(nextTheme);
      return nextTheme;
    });
  };

  return (
    <button type="button" className="tanaw-auth-theme-toggle" aria-label={label} title={label} onClick={toggleTheme}>
      <span className="tanaw-auth-theme-toggle__icon" aria-hidden="true">
        {isDark ? <Sun size={18} strokeWidth={2.2} /> : <Moon size={18} strokeWidth={2.2} />}
      </span>
    </button>
  );
}
