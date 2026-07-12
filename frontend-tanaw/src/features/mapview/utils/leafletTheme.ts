import L from "leaflet";
import { CARTO_TILE_SUBDOMAIN_SEQUENCE } from "../../../../map-tiles.config";

export type LeafletMapTheme = "light" | "dark";

type TileLayerDefinition = {
  url: string;
  attribution: string;
};

const CARTO_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';

const tileLayers: Record<LeafletMapTheme, TileLayerDefinition> = {
  light: {
    url: "https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png",
    attribution: CARTO_ATTRIBUTION,
  },
  dark: {
    url: "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
    attribution: CARTO_ATTRIBUTION,
  },
};

export function getCurrentLeafletMapTheme(): LeafletMapTheme {
  if (typeof document === "undefined") return "light";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function mountLeafletThemeLayer(map: L.Map, onThemeChange?: (theme: LeafletMapTheme) => void) {
  const container = map.getContainer();
  let currentTheme: LeafletMapTheme | null = null;
  let tileLayer: L.TileLayer | null = null;

  const applyTheme = () => {
    const nextTheme = getCurrentLeafletMapTheme();
    if (currentTheme === nextTheme && tileLayer) return;

    tileLayer?.remove();
    currentTheme = nextTheme;
    container.classList.add("tanaw-leaflet-map");
    container.classList.toggle("tanaw-leaflet-map--dark", nextTheme === "dark");
    container.dataset.mapTheme = nextTheme;

    const definition = tileLayers[nextTheme];
    tileLayer = L.tileLayer(definition.url, {
      maxZoom: 19,
      subdomains: CARTO_TILE_SUBDOMAIN_SEQUENCE,
      attribution: definition.attribution,
    }).addTo(map);
    onThemeChange?.(nextTheme);
  };

  applyTheme();

  const observer = new MutationObserver(applyTheme);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

  return () => {
    observer.disconnect();
    tileLayer?.remove();
    container.classList.remove("tanaw-leaflet-map", "tanaw-leaflet-map--dark");
    delete container.dataset.mapTheme;
  };
}
