// Blocking, same-origin startup script: choose the canvas before styles or React paint.
(() => {
  let preference = "light";
  try {
    preference = localStorage.getItem("tanaw-enterprise-theme") || "light";
  } catch {
    /* Themes also work without storage. */
  }
  const dark = preference === "dark" || (preference === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.add(dark ? "dark" : "light");
  document.documentElement.style.colorScheme = dark ? "dark" : "light";
  if (dark) document.documentElement.style.backgroundColor = "#151b21";
})();
