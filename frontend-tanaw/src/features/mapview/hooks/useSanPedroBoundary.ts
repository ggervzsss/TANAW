import { useEffect, useState } from "react";
import { normalizeGeoJson, SAN_PEDRO_BARANGAYS_URL, type GeoJsonFeatureCollection } from "../utils";

export function useSanPedroBoundary() {
  const [boundary, setBoundary] = useState<GeoJsonFeatureCollection | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isError, setIsError] = useState(false);

  useEffect(() => {
    let isMounted = true;
    fetch(SAN_PEDRO_BARANGAYS_URL)
      .then((response) => {
        if (!response.ok) throw new Error("Unable to load barangay boundary GeoJSON.");
        return response.json() as Promise<GeoJsonFeatureCollection>;
      })
      .then((payload) => {
        if (!isMounted) return;
        setBoundary(normalizeGeoJson(payload));
        setIsError(false);
      })
      .catch(() => {
        if (!isMounted) return;
        setBoundary(null);
        setIsError(true);
      })
      .finally(() => {
        if (isMounted) setIsLoading(false);
      });
    return () => {
      isMounted = false;
    };
  }, []);

  return { boundary, isError, isLoading };
}
