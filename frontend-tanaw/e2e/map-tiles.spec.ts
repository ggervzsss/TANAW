import { Buffer } from "node:buffer";
import { expect, test } from "@playwright/test";
import { CARTO_TILE_IMAGE_SOURCES } from "../map-tiles.config";

const transparentPng = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=", "base64");

test("allows browser image loading from every Leaflet CARTO subdomain", async ({ page }) => {
  const cspBlockedTileRequests: string[] = [];
  const cspErrors: string[] = [];

  page.on("console", (message) => {
    if (message.type() === "error" && message.text().includes("Content Security Policy")) {
      cspErrors.push(message.text());
    }
  });
  page.on("requestfailed", (request) => {
    if (request.url().includes("basemaps.cartocdn.com") && request.failure()?.errorText === "csp") {
      cspBlockedTileRequests.push(request.url());
    }
  });
  await page.route(/https:\/\/[abcd]\.basemaps\.cartocdn\.com\/.*/, (route) => route.fulfill({ status: 200, contentType: "image/png", body: transparentPng }));

  await page.goto("/login", { waitUntil: "domcontentloaded" });
  const results = await page.evaluate(async (sources) => {
    return Promise.all(
      sources.map(
        (source, index) =>
          new Promise<{ host: string; loaded: boolean }>((resolve) => {
            const image = new Image();
            image.onload = () => resolve({ host: new URL(source).host, loaded: image.naturalWidth > 0 });
            image.onerror = () => resolve({ host: new URL(source).host, loaded: false });
            image.src = `${source}/rastertiles/voyager/12/${3424 + index}/1883.png`;
            document.body.append(image);
          }),
      ),
    );
  }, CARTO_TILE_IMAGE_SOURCES);

  expect(results).toEqual(
    CARTO_TILE_IMAGE_SOURCES.map((source) => ({
      host: new URL(source).host,
      loaded: true,
    })),
  );
  expect(cspBlockedTileRequests).toEqual([]);
  expect(cspErrors).toEqual([]);
});
