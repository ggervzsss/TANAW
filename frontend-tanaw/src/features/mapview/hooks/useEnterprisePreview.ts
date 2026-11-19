import L from "leaflet";
import { useEffect, useLayoutEffect, useRef, type RefObject } from "react";
import type { MapEnterprise } from "@/shared/types";
import { createPopupHtml } from "../utils";
import { type MapMotionController } from "../utils/mapCamera";

type Options = {
  enterprise: MapEnterprise | null;
  mapRef: RefObject<L.Map | null>;
  motionRef: RefObject<MapMotionController | null>;
  onDismiss: (enterpriseId: string) => void;
  onViewDetails: (enterpriseId: string) => void;
};

export function useEnterprisePreview({ enterprise, mapRef, motionRef, onDismiss, onViewDetails }: Options) {
  const current = useRef({ enterprise, onDismiss, onViewDetails });
  const refresh = useRef<(() => void) | null>(null);
  const enterpriseId = enterprise?.id;

  useLayoutEffect(() => {
    current.current = { enterprise, onDismiss, onViewDetails };
    refresh.current?.();
  }, [enterprise, onDismiss, onViewDetails]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !enterpriseId) return;

    const content = document.createElement("div");
    content.setAttribute("role", "region");
    content.setAttribute("aria-label", "Enterprise preview");
    const popup = L.popup({ className: "tanaw-enterprise-popup", autoPan: false, closeOnClick: false, minWidth: 0, maxWidth: 245, offset: [0, -57] });
    popup.setContent(content);
    let previousHtml = "";
    let frame = 0;
    let pendingOpen = true;

    const position = () => {
      const box = popup.getElement();
      const location = popup.getLatLng();
      if (!box || !location || !popup.isOpen()) return;
      const size = map.getSize();
      const anchor = map.latLngToContainerPoint(location);
      if (anchor.x < 0 || anchor.x > size.x || anchor.y < 0 || anchor.y > size.y) {
        box.style.visibility = "hidden";
        return;
      }
      const leftEdge = 12;
      const rightEdge = size.x - 12;
      const availableWidth = rightEdge - leftEdge;
      popup.options.maxWidth = Math.min(245, Math.max(140, availableWidth - 24));
      popup.options.maxHeight = Math.max(100, Math.max(anchor.y - 68, size.y - anchor.y - 29) - 24);
      popup.update();
      const halfWidth = box.offsetWidth / 2;
      const minX = leftEdge + halfWidth;
      const maxX = rightEdge - halfWidth;
      const centerX = minX <= maxX ? Math.min(Math.max(anchor.x, minX), maxX) : (leftEdge + rightEdge) / 2;
      const below = anchor.y < box.offsetHeight + 68 && size.y - anchor.y > anchor.y;
      const offsetX = Math.round(centerX - anchor.x);
      box.dataset.placement = below ? "below" : "above";
      box.style.setProperty("--tanaw-popup-shift", `${offsetX}px`);
      popup.options.offset = [offsetX, below ? box.offsetHeight + 19 : -57];
      popup.update();
      box.style.visibility = "";
    };

    const update = () => {
      const item = current.current.enterprise;
      if (item?.id !== enterpriseId) return;
      const html = createPopupHtml(item);
      if (previousHtml !== html) {
        const hadDetailsFocus = content.contains(document.activeElement);
        content.innerHTML = html;
        previousHtml = html;
        if (hadDetailsFocus) content.querySelector("button")?.focus({ preventScroll: true });
      }
      const old = popup.getLatLng();
      if (old?.lat !== item.lat || old?.lng !== item.lng) popup.setLatLng([item.lat, item.lng]);
      position();
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
        popup.getElement()?.querySelector(".leaflet-popup-close-button")?.setAttribute("aria-label", "Close enterprise preview");
        position();
        if (popup.getElement()?.style.visibility !== "hidden") content.querySelector("button")?.focus({ preventScroll: true });
      });
    };
    const handleMoveEnd = () => {
      if (pendingOpen) scheduleOpen();
      else position();
    };
    const dismiss = () => current.current.onDismiss(enterpriseId);
    const viewDetails = (event: MouseEvent) => {
      if (event.target instanceof Element && event.target.closest(".tanaw-enterprise-popup__details")) {
        current.current.onViewDetails(enterpriseId);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.stopPropagation();
        popup.remove();
      }
    };

    refresh.current = update;
    content.addEventListener("click", viewDetails);
    content.addEventListener("keydown", handleEscape);
    map.on("moveend resize", handleMoveEnd);
    popup.on("remove", dismiss);
    scheduleOpen();
    return () => {
      refresh.current = null;
      cancelAnimationFrame(frame);
      content.removeEventListener("click", viewDetails);
      content.removeEventListener("keydown", handleEscape);
      map.off("moveend resize", handleMoveEnd);
      popup.off("remove", dismiss);
      popup.remove();
    };
  }, [enterpriseId, mapRef, motionRef]);
}
