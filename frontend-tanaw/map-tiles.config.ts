export const CARTO_TILE_SUBDOMAINS = ["a", "b", "c", "d"] as const;

export const CARTO_TILE_SUBDOMAIN_SEQUENCE = CARTO_TILE_SUBDOMAINS.join("");

export const CARTO_TILE_IMAGE_SOURCES = CARTO_TILE_SUBDOMAINS.map((subdomain) => `https://${subdomain}.basemaps.cartocdn.com`);
