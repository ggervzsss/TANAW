import type { ComponentProps } from "react";
import { useThemePreference } from "../../features/security/hooks/useThemePreference";
import { EnterpriseTopbar } from "./EnterpriseTopbar";

/** Theme updates repaint CSS and this small header, without rerendering page charts or camera previews. */
export function ThemedEnterpriseTopbar(props: Omit<ComponentProps<typeof EnterpriseTopbar>, "resolvedTheme" | "onToggleTheme">) {
  const { resolvedTheme, toggleTheme } = useThemePreference();
  return <EnterpriseTopbar {...props} resolvedTheme={resolvedTheme} onToggleTheme={toggleTheme} />;
}
