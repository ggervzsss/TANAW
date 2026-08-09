import path from "node:path";

import { PACKAGED_RENDERER_ENTRY_URL, PACKAGED_RENDERER_ORIGIN } from "../deployment.config";

const packagedRendererUrl = new URL(PACKAGED_RENDERER_ORIGIN);

export { PACKAGED_RENDERER_ENTRY_URL };

export function resolvePackagedRendererAsset(requestUrl: string, rendererDirectory: string): string | null {
  let url: URL;
  try {
    url = new URL(requestUrl);
  } catch {
    return null;
  }
  if (url.protocol !== packagedRendererUrl.protocol || url.hostname !== packagedRendererUrl.hostname) {
    return null;
  }

  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(url.pathname);
  } catch {
    return null;
  }
  if (decodedPath.includes("\\")) {
    return null;
  }

  const relativePath = decodedPath.replace(/^\/+/, "") || "index.html";
  const rendererRoot = path.resolve(rendererDirectory);
  const candidate = path.resolve(rendererRoot, relativePath);
  const relativeCandidate = path.relative(rendererRoot, candidate);
  if (relativeCandidate.startsWith("..") || path.isAbsolute(relativeCandidate)) {
    return null;
  }
  return candidate;
}
