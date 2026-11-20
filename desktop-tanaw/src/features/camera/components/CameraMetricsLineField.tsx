import { useEffect, useRef } from "react";
import { subscribeToTheme } from "../../security/utils/theme";
import { advanceMetricsField, createMetricsField, type MetricsFieldLine, type MetricsFieldPoint } from "../model/camera-metrics-field";

type AmbienceTone = "calm" | "moderate" | "high" | "attention" | "muted";

export function CameraMetricsLineField({ tone }: { tone: AmbienceTone }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const panel = panelRef.current;
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!panel || !canvas || !context) return;

    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
    let width = 0;
    let height = 0;
    let lines: MetricsFieldLine[] = [];
    let pointer: MetricsFieldPoint | null = null;
    let intersects = false;
    let frame: number | null = null;
    let previousFrame: number | null = null;
    let color = getComputedStyle(canvas).color;

    const isVisible = () => {
      const fullscreen = document.fullscreenElement;
      return intersects && !document.hidden && (!fullscreen || fullscreen.contains(panel)) && width > 0 && height > 0;
    };
    const schedule = () => {
      if (frame === null && isVisible() && !reducedMotion.matches) frame = window.requestAnimationFrame(draw);
    };
    const cancelFrame = () => {
      if (frame !== null) window.cancelAnimationFrame(frame);
      frame = null;
      previousFrame = null;
    };
    const paint = () => {
      context.clearRect(0, 0, width, height);
      context.strokeStyle = color;
      context.beginPath();
      for (const line of lines) {
        const x = line.x + line.offsetX;
        const y = line.y + line.offsetY;
        const dx = 2 * Math.sin(line.angle);
        const dy = 2 * Math.cos(line.angle);
        context.moveTo(x - dx, y - dy);
        context.lineTo(x + dx, y + dy);
      }
      context.stroke();
    };
    const draw = (time: number) => {
      frame = null;
      if (!isVisible() || reducedMotion.matches) return;
      const elapsed = previousFrame === null ? 1000 / 60 : Math.min(50, time - previousFrame);
      const bounds = pointer ? panel.getBoundingClientRect() : null;
      const target = pointer && bounds ? { x: pointer.x - bounds.left, y: pointer.y - bounds.top } : null;
      const moving = advanceMetricsField(lines, target, elapsed);
      paint();
      previousFrame = moving ? time : null;
      if (moving) schedule();
    };

    const syncVisibility = () => {
      const visible = isVisible();
      const active = visible && !reducedMotion.matches;
      const wasActive = panel.hasAttribute("data-ambient-active");
      panel.toggleAttribute("data-ambient-active", active);
      if (!active) {
        cancelFrame();
        pointer = null;
        if (wasActive) lines = createMetricsField(width, height);
      }
      if (visible) paint();
    };

    const move = (event: PointerEvent) => {
      if (!isVisible() || reducedMotion.matches || event.pointerType === "touch") return;
      pointer = { x: event.clientX, y: event.clientY };
      schedule();
    };
    const leave = () => {
      pointer = null;
      schedule();
    };
    const resize = new ResizeObserver(([entry]) => {
      if (!entry) return;
      ({ width, height } = entry.contentRect);
      const scale = Math.min(window.devicePixelRatio, 2);
      canvas.width = Math.max(1, Math.ceil(width * scale));
      canvas.height = Math.max(1, Math.ceil(height * scale));
      context.setTransform(scale, 0, 0, scale, 0, 0);
      context.lineWidth = 1;
      context.lineCap = "round";
      lines = createMetricsField(width, height);
      syncVisibility();
      if (pointer) schedule();
    });
    const visibility = new IntersectionObserver(([entry]) => {
      intersects = Boolean(entry?.isIntersecting);
      syncVisibility();
    });
    const unsubscribeFromTheme = subscribeToTheme(() => {
      color = getComputedStyle(canvas).color;
      if (isVisible()) paint();
    });

    resize.observe(panel);
    visibility.observe(panel);
    panel.addEventListener("pointermove", move);
    panel.addEventListener("pointerleave", leave);
    panel.addEventListener("pointercancel", leave);
    document.addEventListener("fullscreenchange", syncVisibility);
    document.addEventListener("visibilitychange", syncVisibility);
    reducedMotion.addEventListener("change", syncVisibility);
    return () => {
      cancelFrame();
      resize.disconnect();
      visibility.disconnect();
      unsubscribeFromTheme();
      panel.removeEventListener("pointermove", move);
      panel.removeEventListener("pointerleave", leave);
      panel.removeEventListener("pointercancel", leave);
      document.removeEventListener("fullscreenchange", syncVisibility);
      document.removeEventListener("visibilitychange", syncVisibility);
      reducedMotion.removeEventListener("change", syncVisibility);
      panel.removeAttribute("data-ambient-active");
    };
  }, []);

  return (
    <div ref={panelRef} className="camera-metrics-ambience" data-ambience-tone={tone} aria-hidden="true">
      <canvas ref={canvasRef} className="camera-metrics-lines" />
    </div>
  );
}
