import { Moon, Sun } from "lucide-react";
import { useThemePreference } from "../../security/hooks/useThemePreference";

export function AuthThemeToggle() {
  const { resolvedTheme, toggleTheme } = useThemePreference();
  const isDark = resolvedTheme === "dark";
  const label = isDark ? "Switch to light mode" : "Switch to dark mode";
  return (
    <button type="button" className="tanaw-auth-theme-toggle" aria-label={label} title={label} onClick={toggleTheme}>
      <span key={resolvedTheme} className="tanaw-auth-theme-toggle__icon" aria-hidden="true">
        {isDark ? <Sun size={18} strokeWidth={2.2} /> : <Moon size={18} strokeWidth={2.2} />}
      </span>
    </button>
  );
}
