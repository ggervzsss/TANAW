import type { ResolvedTheme } from "../../utils/theme";

export function getPortalTopbarThemeClasses(resolvedTheme: ResolvedTheme) {
  const isDark = resolvedTheme === "dark";
  return {
    frame: isDark
      ? "bg-linear-to-r from-[#02090d] via-[#061714] to-[#0b2520] shadow-[0_16px_44px_rgba(0,0,0,0.58)] ring-1 ring-white/6"
      : "bg-linear-to-r from-[#043817] via-[#075526] to-[#0c6a32] shadow-[0_16px_40px_rgba(2,20,8,0.34)] ring-1 ring-white/10",
    image: isDark ? "opacity-[0.24] brightness-55 saturate-65" : "opacity-[0.38] brightness-95 saturate-90",
    overlay: isDark
      ? "bg-[linear-gradient(90deg,rgba(1,8,11,0.99)_0%,rgba(4,24,20,0.96)_48%,rgba(8,38,30,0.82)_100%)]"
      : "bg-[linear-gradient(90deg,rgba(4,45,17,0.98)_0%,rgba(5,81,37,0.88)_44%,rgba(6,93,42,0.48)_100%)]",
  };
}
