import L from "leaflet";
import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import type { MapEnterprise } from "@/shared/types";
import type { MapMotionController } from "../utils/mapCamera";

type Options = {
  enterprise: MapEnterprise | null;
  /** The details page of an enterprise, used as the callout link's address. */
  detailsHref: (enterpriseId: string) => string;
  mapRef: RefObject<L.Map | null>;
  motionRef: RefObject<MapMotionController | null>;
  onDismiss: (enterpriseId: string) => void;
  onViewDetails: (enterpriseId: string) => void;
};

/**
 * The civic-green "View details: {name}" chip that floats above the selected pin. It is a Leaflet
 * popup, so it follows the pin through pans and zoom animations. Escape dismisses it.
 */
export function useEnterpriseCallout({ enterprise, detailsHref, mapRef, motionRef, onDismiss, onViewDetails }: Options) {
  const current = useRef({ enterprise, detailsHref, onDismiss, onViewDetails });
  const refresh = useRef<(() => void) | null>(null);
  const enterpriseId = enterprise?.id;

  useLayoutEffect(() => {
    current.current = { enterprise, detailsHref, onDismiss, onViewDetails };
    refresh.current?.();
  }, [detailsHref, enterprise, onDismiss, onViewDetails]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !enterpriseId) return;

    const link = document.createElement("a");
    link.className = "tanaw-enterprise-callout__link";
    const popup = L.popup({ className: "tanaw-enterprise-callout", autoPan: false, closeButton: false, closeOnClick: false, closeOnEscapeKey: false, minWidth: 0, maxWidth: 320, offset: [0, -50] });
    popup.setContent(link);
    let frame = 0;
    let pendingOpen = true;

    const update = () => {
      const item = current.current.enterprise;
      if (item?.id !== enterpriseId) return;
      link.href = current.current.detailsHref(item.id);
      link.replaceChildren("View details: ", Object.assign(document.createElement("strong"), { textContent: item.name }), Object.assign(document.createElement("span"), { textContent: " ›" }));
      link.lastElementChild?.setAttribute("aria-hidden", "true");
      const old = popup.getLatLng();
      if (old?.lat !== item.lat || old?.lng !== item.lng) popup.setLatLng([item.lat, item.lng]);
    };
    const scheduleOpen = () => {
      if (!pendingOpen) return;
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (motionRef.current?.isMoving()) return;
        update();
        if (current.current.enterprise?.id !== enterpriseId) return;
        pendingOpen = false;
        popup.openOn(map);
      });
    };
    const handleMoveEnd = () => {
      if (pendingOpen) scheduleOpen();
    };
    const handleClick = (event: MouseEvent) => {
      if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      current.current.onViewDetails(enterpriseId);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.stopPropagation();
      current.current.onDismiss(enterpriseId);
    };

    refresh.current = update;
    link.addEventListener("click", handleClick);
    link.addEventListener("keydown", handleKeyDown);
    map.on("moveend resize", handleMoveEnd);
    scheduleOpen();
    return () => {
      refresh.current = null;
      cancelAnimationFrame(frame);
      link.removeEventListener("click", handleClick);
      link.removeEventListener("keydown", handleKeyDown);
      map.off("moveend resize", handleMoveEnd);
      popup.remove();
    };
  }, [enterpriseId, mapRef, motionRef]);
}
