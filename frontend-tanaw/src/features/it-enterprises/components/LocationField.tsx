import { AlertTriangle, MapPin } from "lucide-react";
import { LocationPicker } from "@/features/enterprise-accounts/components/LocationPicker";
import type { LocationDraftState } from "../hooks/useLocationDraft";

/** The location search, the San Pedro map with its pin, and the pin's status. */
export function LocationField({ draft, mapId, hint, mapHeightClassName = "h-60" }: { draft: LocationDraftState; mapId: string; hint: string; mapHeightClassName?: string }) {
  const { location, detectedBarangay, error } = draft;
  return (
    <section
      data-field-name="location"
      tabIndex={-1}
      aria-labelledby={`${mapId}-label`}
      className="rounded-tanaw-md outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--tanaw-focus-ring)"
    >
      <p id={`${mapId}-label`} className="mb-1.5 text-xs font-semibold text-(--tanaw-text-secondary)">
        Address and map pin
      </p>
      <LocationPicker
        location={location}
        mapId={mapId}
        mapHeightClassName={mapHeightClassName}
        onBoundaryDetection={draft.onBoundaryDetection}
        onChange={draft.apply}
        onReject={draft.onReject}
        onSearchResultSelect={draft.onSearchResult}
      />
      <p role="status" className="mt-2 flex items-start gap-1.5 text-[13px] text-(--tanaw-text-secondary)">
        <MapPin size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-(--tanaw-accent-ink)" />
        <span>{location ? `Pin set${detectedBarangay ? ` in Brgy. ${detectedBarangay}` : ""} at ${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}.` : hint}</span>
      </p>
      {error && (
        <p role="alert" className="mt-1.5 flex items-start gap-1.5 text-[13px] font-semibold text-(--tanaw-warn-ink)">
          <AlertTriangle size={14} aria-hidden="true" className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </p>
      )}
    </section>
  );
}
