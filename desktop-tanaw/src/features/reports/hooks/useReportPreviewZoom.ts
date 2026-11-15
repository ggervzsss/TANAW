import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

export const REPORT_PAPER_WIDTH = 1288;
const MIN_ZOOM = 0.5,
  MAX_ZOOM = 2,
  ZOOM_STEP = 0.1;
const clamp = (value: number) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, value));

export function useReportPreviewZoom(reduceMotion: boolean) {
  const canvas = useRef<HTMLDivElement | null>(null);
  const paper = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [height, setHeight] = useState(1300);
  const [fit, setFit] = useState(false);
  const currentZoom = useRef(1);
  const targetZoom = useRef(1);
  const frame = useRef(0);
  const lastFrame = useRef(0);
  const anchor = useRef<{ x: number; y: number; pageX: number; pageY: number } | null>(null);
  const attachCanvas = useCallback((element: HTMLDivElement | null) => {
    canvas.current = element;
    setReady(Boolean(element));
  }, []);

  useLayoutEffect(() => {
    const area = canvas.current,
      point = anchor.current,
      rect = paper.current?.getBoundingClientRect();
    if (!area || !point || !rect) return;
    area.scrollLeft += rect.left + point.pageX * zoom - point.x;
    area.scrollTop += rect.top + point.pageY * zoom - point.y;
  }, [zoom]);

  const moveTo = useCallback(
    (value: number, pointer?: { x: number; y: number }, immediate = false, anchored = true) => {
      const area = canvas.current,
        rect = paper.current?.getBoundingClientRect();
      if (!area || !rect) return;
      const bounds = area.getBoundingClientRect();
      const x = pointer?.x ?? bounds.left + area.clientWidth / 2;
      const y = pointer?.y ?? bounds.top + area.clientHeight / 2;
      anchor.current = anchored ? { x, y, pageX: (x - rect.left) / currentZoom.current, pageY: (y - rect.top) / currentZoom.current } : null;
      targetZoom.current = clamp(value);
      if (immediate || reduceMotion) {
        cancelAnimationFrame(frame.current);
        frame.current = 0;
        currentZoom.current = targetZoom.current;
        setZoom(targetZoom.current);
        return;
      }
      // Follow one target continuously instead of restarting easing for every input.
      if (frame.current) return;
      lastFrame.current = performance.now();
      const animate = (now: number) => {
        const elapsed = Math.max(1, Math.min(32, now - lastFrame.current));
        lastFrame.current = now;
        const remaining = targetZoom.current - currentZoom.current;
        const distance = Math.min(Math.abs(remaining) * (1 - Math.exp(-elapsed / 38)), elapsed * 0.0015);
        const next = Math.abs(remaining) < 0.0005 ? targetZoom.current : currentZoom.current + Math.sign(remaining) * distance;
        currentZoom.current = clamp(next);
        setZoom(currentZoom.current);
        frame.current = next === targetZoom.current ? 0 : requestAnimationFrame(animate);
      };
      frame.current = requestAnimationFrame(animate);
    },
    [reduceMotion],
  );

  const changeZoom = useCallback(
    (amount: number, pointer?: { x: number; y: number }) => {
      setFit(false);
      moveTo(Math.round((targetZoom.current + amount) * 100) / 100, pointer);
    },
    [moveTo],
  );
  const pageZoom = useCallback(() => {
    const area = canvas.current;
    return area ? clamp(Math.min(1, (area.clientWidth - 28) / REPORT_PAPER_WIDTH, (area.clientHeight - 44) / (paper.current?.offsetHeight ?? 1300))) : 1;
  }, []);
  const fitToPage = () => {
    setFit(true);
    moveTo(pageZoom(), undefined, false, false);
    canvas.current?.scrollTo({ top: 0, left: 0 });
  };
  const actualSize = () => {
    setFit(false);
    moveTo(1, undefined, true);
  };

  useEffect(() => {
    if (!ready || !canvas.current) return;
    const area = canvas.current;
    let accumulated = 0,
      lastInput = -Infinity,
      lastStep = -Infinity,
      direction = 0;
    const wheel = (event: WheelEvent) => {
      if (!event.ctrlKey) return;
      event.preventDefault();
      event.stopPropagation();
      const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? area.clientHeight : 1);
      if (!delta) return;
      const now = performance.now(),
        nextDirection = Math.sign(delta);
      if (nextDirection !== direction || now - lastInput > 180) {
        accumulated = 0;
        lastStep = -Infinity;
      }
      direction = nextDirection;
      lastInput = now;
      accumulated = Math.max(-120, Math.min(120, accumulated + delta));
      // Normalize wheel/trackpad bursts into 10-point steps, at most ten per second.
      if (Math.abs(accumulated) < 40 || now - lastStep < 100) return;
      changeZoom(-nextDirection * ZOOM_STEP, { x: event.clientX, y: event.clientY });
      accumulated = 0;
      lastStep = now;
    };
    area.addEventListener("wheel", wheel, { passive: false, capture: true });
    return () => area.removeEventListener("wheel", wheel, true);
  }, [ready, changeZoom]);
  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  useLayoutEffect(() => {
    if (!ready) return;
    const update = () => {
      setHeight(paper.current?.offsetHeight ?? 1300);
      if (fit && Math.abs(pageZoom() - targetZoom.current) > 0.0001) moveTo(pageZoom(), undefined, true, false);
    };
    const observer = new ResizeObserver(update);
    if (canvas.current) observer.observe(canvas.current);
    if (paper.current) observer.observe(paper.current);
    update();
    return () => observer.disconnect();
  }, [ready, fit, moveTo, pageZoom]);
  return { canvas, paper, ready, attachCanvas, zoom, height, changeZoom, fitToPage, actualSize, minZoom: MIN_ZOOM, maxZoom: MAX_ZOOM };
}
