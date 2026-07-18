export function getEnterpriseTopbarControlClasses(resolvedTheme: "light" | "dark") {
  const isDark = resolvedTheme === "dark";
  return {
    account: isDark
      ? "border-emerald-100/14 bg-black/18 hover:border-emerald-100/24 hover:bg-emerald-200/9"
      : "border-emerald-100/28 bg-white/8 hover:border-emerald-100/40 hover:bg-white/[0.14]",
    icon: isDark
      ? "border-emerald-100/14 bg-black/18 text-white/88 hover:border-emerald-100/24 hover:bg-emerald-200/9"
      : "border-emerald-100/28 bg-white/8 text-white hover:bg-white/[0.14]",
  };
}
