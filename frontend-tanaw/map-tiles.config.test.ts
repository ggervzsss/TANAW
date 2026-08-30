import { describe, expect, it } from "vitest";
import { addCartoBasemapApiKey } from "./map-tiles.config";

describe("CARTO tile configuration", () => {
  it("adds an encoded basemap API key to a tile template", () => {
    expect(addCartoBasemapApiKey("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png", " key+/= ")).toBe(
      "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}.png?key=key%2B%2F%3D",
    );
  });

  it("leaves local tile templates usable until a key is configured", () => {
    const template = "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}.png";
    expect(addCartoBasemapApiKey(template, " ")).toBe(template);
  });
});
