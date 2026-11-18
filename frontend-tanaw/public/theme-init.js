(() => {
  let preference = "system";
  try {
    const stored = localStorage.getItem("tanaw-web-theme");
    if (stored === "light" || stored === "dark") preference = stored;
  } catch {
    // The system theme remains available when the browser blocks storage.
  }
  const theme = preference === "system" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : preference;
  document.documentElement.classList.add(theme);
  document.documentElement.dataset.themePreference = preference;
})();
