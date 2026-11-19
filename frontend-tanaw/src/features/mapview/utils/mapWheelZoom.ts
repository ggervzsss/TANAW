import { DomEvent, type Map, type Point } from "leaflet";
import type { MapMotionController } from "./mapCamera";

export function bindMapWheelZoom(map: Map, motion: MapMotionController) {
  const container = map.getContainer();
  const snap = map.options.zoomSnap || 0.25;
  const pixelsPerZoom = map.options.wheelPxPerZoomLevel || 120;
  const stepThreshold = pixelsPerZoom * snap;
  let frame = 0;
  let delta = 0;
  let anchor: Point;
  let lastWheel = -Infinity;

  const flush = () => {
    frame = 0;
    if (Math.abs(delta) < stepThreshold || motion.isMoving()) return;
    const steps = Math.trunc(delta / stepThreshold);
    const zoom = map.getZoom();
    const next = Math.min(map.getMaxZoom(), Math.max(map.getMinZoom(), zoom + steps * snap));
    delta -= steps * stepThreshold;
    if (zoom !== next) map.setZoomAround(anchor, next, { animate: false });
  };

  const schedule = () => {
    if (!frame && Math.abs(delta) >= stepThreshold) frame = requestAnimationFrame(flush);
  };

  const onWheel = (event: WheelEvent) => {
    if (event.target instanceof Element && event.target.closest(".leaflet-popup, .leaflet-control")) return;
    const wheelDelta = DomEvent.getWheelDelta(event);
    if (!wheelDelta || !container.clientWidth) return;
    event.preventDefault();
    if (event.timeStamp - lastWheel > 160 && Math.abs(delta) < stepThreshold) delta = 0;
    lastWheel = event.timeStamp;
    delta += wheelDelta;
    anchor = map.mouseEventToContainerPoint(event);
    schedule();
  };

  container.addEventListener("wheel", onWheel, { passive: false });
  map.on("moveend", schedule);
  return () => {
    cancelAnimationFrame(frame);
    map.off("moveend", schedule);
    container.removeEventListener("wheel", onWheel);
  };
}
