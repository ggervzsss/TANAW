import { readFileSync } from "node:fs";

// Reuse the canonical resource manifest without carrying Windows installer
// targets, signing settings, or its offline-SFX hook into the Linux build.
const source = readFileSync(new URL("./electron-builder.json5", import.meta.url), "utf8");
const { win, nsis, publish, artifactBuildCompleted, ...shared } = Function(`"use strict"; return (${source});`)();

export default {
  ...shared,
  directories: { output: "release/${version}/linux-deb" },
  extraMetadata: { homepage: "https://tanaw-sanpedro.vercel.app", desktopName: "tanaw-enterprise-desktop.desktop" },
  extraResources: shared.extraResources.map((resource) =>
    resource.to === "ml-service/runtime" ? { ...resource, filter: resource.filter.map((pattern) => (pattern === "tanaw-ml-service.exe" ? "tanaw-ml-service" : pattern)) } : resource,
  ),
  linux: {
    syncDesktopName: true,
    target: [{ target: "deb", arch: ["x64"] }],
    executableName: "tanaw-enterprise-desktop",
    category: "Utility",
    icon: "build/icon.png",
    maintainer: "City Government of San Pedro",
    vendor: "City Government of San Pedro",
    synopsis: "TANAW enterprise camera monitoring and reporting",
    artifactName: "TANAW-Enterprise-Desktop-${version}-linux-amd64.${ext}",
  },
  deb: {
    packageName: "tanaw-enterprise-desktop",
    depends: [
      "libc6 (>= 2.35)",
      "libstdc++6",
      "libgl1",
      "libglib2.0-0",
      "libgomp1",
      "libsm6",
      "libice6",
      "libgtk-3-0",
      "libnss3",
      "libnspr4",
      "libxss1",
      "libxtst6",
      "libatspi2.0-0",
      "libasound2",
      "libuuid1",
      "libgbm1",
      "xdg-utils",
      "libsecret-1-0",
      "gnome-keyring",
      "dbus-user-session",
      "lsof",
    ],
  },
};
