import L from "leaflet";
import { registerThemePreparation } from "@/shared/utils/themeTransition";
import { addCartoBasemapApiKey, CARTO_TILE_SUBDOMAIN_SEQUENCE } from "../../../../map-tiles.config";

export type LeafletMapTheme = "light" | "dark";

const ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';
const API_KEY = import.meta.env.VITE_CARTO_BASEMAP_API_KEY ?? "";
const TILE_STYLES = {
  light: ["rastertiles/voyager_nolabels", "rastertiles/voyager_only_labels"],
  dark: ["dark_nolabels", "dark_only_labels"],
} as const;

type TilePair = { theme: LeafletMapTheme; base: L.TileLayer; labels: L.TileLayer };

class AdminTileLayer extends L.TileLayer {
  override getEvents(): Record<string, L.LeafletEventHandlerFn> {
    const events = super.getEvents?.() ?? {};
    const animateZoom = events.zoomanim;
    // Keep the displayed tile level moving with the SVG and markers until Leaflet commits the zoom.
    if (animateZoom) events.zoomanim = (event) => animateZoom.call(this, Object.assign({}, event, { noUpdate: true }));
    return events;
  }
}

export function getCurrentLeafletMapTheme(): LeafletMapTheme {
  return typeof document !== "undefined" && document.documentElement.classList.contains("dark") ? "dark" : "light";
}

export function mountLeafletThemeLayer(map: L.Map, onThemeChange?: (theme: LeafletMapTheme) => void) {
  const container = map.getContainer();
  const layer = L.tileLayer("", { maxZoom: 19, subdomains: CARTO_TILE_SUBDOMAIN_SEQUENCE, attribution: ATTRIBUTION });
  let current: LeafletMapTheme | undefined;
  const apply = () => {
    const theme = getCurrentLeafletMapTheme();
    if (theme === current) return;
    current = theme;
    container.classList.add("tanaw-leaflet-map");
    container.classList.toggle("tanaw-leaflet-map--dark", theme === "dark");
    container.dataset.mapTheme = theme;
    const style = theme === "dark" ? "dark_all" : "rastertiles/voyager";
    layer.setUrl(addCartoBasemapApiKey(`https://{s}.basemaps.cartocdn.com/${style}/{z}/{x}/{y}{r}.png`, API_KEY));
    onThemeChange?.(theme);
  };
  apply();
  layer.addTo(map);
  const observer = new MutationObserver(apply);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
  return () => {
    observer.disconnect();
    layer.remove();
    container.classList.remove("tanaw-leaflet-map", "tanaw-leaflet-map--dark");
    delete container.dataset.mapTheme;
  };
}

export function mountAdminLeafletLayers(map: L.Map, onThemeChange: (theme: LeafletMapTheme) => void) {
  const container = map.getContainer();
  const labelsPane = map.createPane("geographicLabels");
  labelsPane.style.zIndex = "420";
  labelsPane.style.pointerEvents = "none";
  let disposed = false;
  let labelsVisible = true;
  let pending: { pair: TilePair; cancel: () => void; ready: Promise<boolean> } | undefined;

  const createPair = (theme: LeafletMapTheme, opacity: number): TilePair => {
    const [baseStyle, labelsStyle] = TILE_STYLES[theme];
    const createLayer = (style: string, options: L.TileLayerOptions) =>
      new AdminTileLayer(addCartoBasemapApiKey(`https://{s}.basemaps.cartocdn.com/${style}/{z}/{x}/{y}{r}.png`, API_KEY), {
        maxZoom: 19,
        updateWhenZooming: false,
        subdomains: CARTO_TILE_SUBDOMAIN_SEQUENCE,
        ...options,
      });
    return {
      theme,
      base: createLayer(baseStyle, { opacity, attribution: ATTRIBUTION, className: `tanaw-base-tiles--${theme}` }),
      labels: createLayer(labelsStyle, { opacity: labelsVisible ? opacity : 0, pane: "geographicLabels", className: `tanaw-label-tiles--${theme}` }),
    };
  };
  let active = createPair(getCurrentLeafletMapTheme(), 1);
  active.base.addTo(map);
  active.labels.addTo(map);
  container.classList.add("tanaw-leaflet-map");

  const applyChromeTheme = (theme: LeafletMapTheme) => {
    container.classList.toggle("tanaw-leaflet-map--dark", theme === "dark");
    container.dataset.mapTheme = theme;
    onThemeChange(theme);
  };
  applyChromeTheme(active.theme);
  container.dataset.mapTiles = active.theme;

  const removePair = (pair: TilePair) => {
    pair.base.remove();
    pair.labels.remove();
  };
  const discardPending = () => {
    if (!pending) return;
    pending.cancel();
    removePair(pending.pair);
    pending = undefined;
  };

  const prepare = async (theme: LeafletMapTheme) => {
    if (disposed) return;
    if (active.theme === theme) {
      discardPending();
      return () => {
        if (!disposed) applyChromeTheme(theme);
      };
    }
    if (pending?.pair.theme !== theme) {
      discardPending();
      const pair = createPair(theme, 0);
      const load = waitForTiles([pair.base, pair.labels]);
      pending = { pair, ...load };
      pair.base.addTo(map);
      pair.labels.addTo(map);
    }
    const stage = pending;
    if (!stage) return;
    const ready = await waitForThemeBudget(stage.ready);
    return () => {
      if (disposed || pending !== stage) return;
      const reveal = (loaded: boolean) => {
        if (disposed || pending !== stage || getCurrentLeafletMapTheme() !== theme) return;
        if (!loaded || stage.pair.base.isLoading() || stage.pair.labels.isLoading()) {
          discardPending();
          return;
        }
        stage.pair.base.setOpacity(1);
        stage.pair.labels.setOpacity(labelsVisible ? 1 : 0);
        removePair(active);
        active = stage.pair;
        container.dataset.mapTiles = theme;
        pending = undefined;
      };
      applyChromeTheme(theme);
      if (ready === null) {
        // A slow response can finish in the background while the retained tiles remain visible.
        void stage.ready.then(reveal);
      } else {
        reveal(ready);
      }
    };
  };
  const unregister = registerThemePreparation(prepare);
  const observer = new MutationObserver(() => {
    const theme = getCurrentLeafletMapTheme();
    if (container.dataset.mapTheme !== theme)
      void prepare(theme).then((commit) => {
        if (getCurrentLeafletMapTheme() === theme) commit?.();
      });
  });
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });

  return {
    setLabelsVisible(visible: boolean) {
      labelsVisible = visible;
      active.labels.setOpacity(visible ? 1 : 0);
      labelsPane.style.visibility = visible ? "" : "hidden";
      container.dataset.mapLabels = visible ? "visible" : "hidden";
    },
    dispose() {
      disposed = true;
      unregister();
      observer.disconnect();
      discardPending();
      removePair(active);
      container.classList.remove("tanaw-leaflet-map", "tanaw-leaflet-map--dark");
      delete container.dataset.mapTheme;
      delete container.dataset.mapTiles;
      delete container.dataset.mapLabels;
    },
  };
}

function waitForTiles(layers: L.TileLayer[]) {
  let finish: (loaded: boolean) => void = () => undefined;
  const ready = new Promise<boolean>((resolve) => {
    const loaded = new Set<L.TileLayer>();
    const onLoad = (event: L.LeafletEvent) => {
      loaded.add(event.target as L.TileLayer);
      if (loaded.size === layers.length) finish(true);
    };
    const onError = () => finish(false);
    const timeout = window.setTimeout(() => finish(false), 12_000);
    finish = (success) => {
      window.clearTimeout(timeout);
      layers.forEach((layer) => layer.off({ load: onLoad, tileerror: onError }));
      resolve(success);
    };
    layers.forEach((layer) => layer.on({ load: onLoad, tileerror: onError }));
  });
  return { ready, cancel: () => finish(false) };
}

async function waitForThemeBudget(ready: Promise<boolean>) {
  let timeout: number | undefined;
  try {
    return await Promise.race([
      ready,
      new Promise<null>((resolve) => {
        timeout = window.setTimeout(() => resolve(null), 1800);
      }),
    ]);
  } finally {
    window.clearTimeout(timeout);
  }
}
