import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { loadEnv } from "vite";
import { buildDesktopRendererContentSecurityPolicy, LOCAL_DESKTOP_API_BASE_URL, PACKAGED_RENDERER_ENTRY_URL, PACKAGED_RENDERER_ORIGIN, resolveDesktopApiBaseUrl } from "../deployment.config.ts";

const env = loadEnv("production", process.cwd(), "");
const apiBaseUrl = resolveDesktopApiBaseUrl(process.env.VITE_API_BASE_URL ?? env.VITE_API_BASE_URL, {
  distributionBuild: true,
});
const rendererFiles = await listFiles(path.resolve("dist"));
const rendererIndex = await readFile(path.resolve("dist", "index.html"), "utf8");
const rendererJavaScript = await readFiles(rendererFiles.filter((file) => file.endsWith(".js")));
const electronMain = await readFile(path.resolve("dist-electron", "main.js"), "utf8");
const expectedCsp = buildDesktopRendererContentSecurityPolicy(apiBaseUrl, { development: false });
const expectedHtmlCsp = expectedCsp.replaceAll("'", "&#39;");

if (!rendererJavaScript.includes(apiBaseUrl)) {
  throw new Error(`The desktop renderer does not contain the configured API URL ${apiBaseUrl}.`);
}
if (apiBaseUrl !== LOCAL_DESKTOP_API_BASE_URL && rendererJavaScript.includes(LOCAL_DESKTOP_API_BASE_URL)) {
  throw new Error("The desktop distribution renderer still contains the localhost backend fallback.");
}
if (!electronMain.includes(PACKAGED_RENDERER_ORIGIN)) {
  throw new Error(`The Electron main bundle does not contain the packaged renderer origin ${PACKAGED_RENDERER_ORIGIN}.`);
}
if (!rendererIndex.includes(expectedHtmlCsp)) {
  throw new Error("The desktop distribution renderer does not contain the backend-specific content security policy.");
}
if (/connect-src[^;]*(?:\bhttps:|\bwss:)(?:\s|;)/.test(rendererIndex)) {
  throw new Error("The desktop distribution renderer CSP contains an unrestricted HTTPS or WSS source.");
}

console.log("Desktop renderer build: deployment configuration verified.");
console.log(`Desktop renderer API: ${apiBaseUrl}`);
console.log(`Packaged renderer entry: ${PACKAGED_RENDERER_ENTRY_URL}`);

async function listFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = await Promise.all(
    entries.map((entry) => {
      const entryPath = path.join(directory, entry.name);
      return entry.isDirectory() ? listFiles(entryPath) : [entryPath];
    }),
  );
  return files.flat();
}

async function readFiles(files) {
  return (await Promise.all(files.map((file) => readFile(file, "utf8")))).join("\n");
}
