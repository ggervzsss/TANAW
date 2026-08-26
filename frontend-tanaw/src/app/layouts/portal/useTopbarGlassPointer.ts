import { useCallback, useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import type { TopbarGlassSignal, TopbarGlassTarget } from "./TopbarGlassIndicator";

type NavigationItemGeometry = {
  element: HTMLElement;
  rect: DOMRect;
};

type NavigationGeometry = {
  items: NavigationItemGeometry[];
  navigationRect: DOMRect;
};

type PointerSample = {
  time: number;
  velocity: number;
  x: number;
};

type PendingPointer = {
  allowPull: boolean;
  continuous: boolean;
  time: number;
  x: number;
  y: number;
};

const ITEM_OVERHANG = 4;
const MAX_PULL_EXTENSION = 30;
const PULL_BREAK_DISTANCE = 80;

const clamp = (value: number, minimum: number, maximum: number) => Math.min(maximum, Math.max(minimum, value));
const interpolate = (from: number, to: number, progress: number) => from + (to - from) * progress;

function measureNavigation(navigation: HTMLElement): NavigationGeometry {
  return {
    navigationRect: navigation.getBoundingClientRect(),
    items: Array.from(navigation.querySelectorAll<HTMLElement>("[data-topbar-navigation]"))
      .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      .sort((first, second) => first.rect.left - second.rect.left),
  };
}

function getItemTarget(navigationRect: DOMRect, item: NavigationItemGeometry, velocity: number): TopbarGlassTarget {
  return {
    deformation: 0,
    height: item.rect.height,
    id: item.element.dataset.topbarNavigation ?? "navigation-item",
    left: item.rect.left - navigationRect.left - ITEM_OVERHANG,
    mode: "item",
    pull: 0,
    top: item.rect.top - navigationRect.top,
    velocity,
    width: item.rect.width + ITEM_OVERHANG * 2,
  };
}

function resolveContinuousDrag(geometry: NavigationGeometry, clientX: number, velocity: number): TopbarGlassTarget | null {
  const { items, navigationRect } = geometry;
  for (let index = 0; index < items.length - 1; index += 1) {
    const leading = items[index];
    const trailing = items[index + 1];
    const leadingCenter = leading.rect.left + leading.rect.width / 2;
    const trailingCenter = trailing.rect.left + trailing.rect.width / 2;
    if (clientX < leadingCenter || clientX > trailingCenter) continue;
    const progress = (clientX - leadingCenter) / (trailingCenter - leadingCenter);
    const leadingId = leading.element.dataset.topbarNavigation ?? "leading";
    const trailingId = trailing.element.dataset.topbarNavigation ?? "trailing";
    const height = interpolate(leading.rect.height, trailing.rect.height, progress);
    const width = interpolate(leading.rect.width, trailing.rect.width, progress) + ITEM_OVERHANG * 2;
    const centerY = interpolate(leading.rect.top + leading.rect.height / 2, trailing.rect.top + trailing.rect.height / 2, progress);
    return {
      deformation: Math.sin(Math.PI * progress) * 0.35,
      height,
      id: `drag:${leadingId}:${trailingId}`,
      left: clientX - navigationRect.left - width / 2,
      mode: "drag",
      pull: 0,
      top: centerY - navigationRect.top - height / 2,
      velocity,
      width,
    };
  }
  return null;
}

function resolveTopbarPointerTarget(geometry: NavigationGeometry, clientX: number, velocity: number, allowPull: boolean, continuous: boolean, forceRecoil: boolean): TopbarGlassTarget | null {
  const { items, navigationRect } = geometry;
  if (items.length === 0) return null;
  const first = items[0];
  const last = items[items.length - 1];
  const side = clientX < first.rect.left ? "left" : clientX > last.rect.right ? "right" : null;

  if (side && allowPull) {
    const endpoint = side === "left" ? first : last;
    const overshoot = side === "left" ? first.rect.left - clientX : clientX - last.rect.right;
    const baseTarget = getItemTarget(navigationRect, endpoint, velocity);
    const endpointId = endpoint.element.dataset.topbarNavigation ?? "endpoint";
    if (forceRecoil || overshoot >= PULL_BREAK_DISTANCE) {
      return {
        ...baseTarget,
        id: `recoil:${endpointId}:${side}`,
        mode: "recoil",
      };
    }
    const deformation = clamp(overshoot / PULL_BREAK_DISTANCE, 0, 1);
    const extension = Math.sin((deformation * Math.PI) / 2) * MAX_PULL_EXTENSION;
    const heightReduction = deformation * 3;
    return {
      ...baseTarget,
      deformation,
      height: baseTarget.height - heightReduction,
      id: `pull:${endpointId}:${side}`,
      left: baseTarget.left - (side === "left" ? extension : 0),
      mode: "pull",
      pull: side === "left" ? -deformation : deformation,
      top: baseTarget.top + heightReduction / 2,
      width: baseTarget.width + extension,
    };
  }

  if (continuous) {
    const continuousTarget = resolveContinuousDrag(geometry, clientX, velocity);
    if (continuousTarget) return continuousTarget;
  }

  const hoveredItem = items.find(({ rect }) => clientX >= rect.left && clientX <= rect.right);
  if (hoveredItem) return getItemTarget(navigationRect, hoveredItem, velocity);

  for (let index = 0; index < items.length - 1; index += 1) {
    const leading = items[index];
    const trailing = items[index + 1];
    const gapWidth = trailing.rect.left - leading.rect.right;
    if (gapWidth <= 0 || clientX <= leading.rect.right || clientX >= trailing.rect.left) continue;
    const progress = (clientX - leading.rect.right) / gapWidth;
    const easedProgress = progress * progress * (3 - 2 * progress);
    const deformation = Math.sin(Math.PI * progress);
    const centerX = interpolate(leading.rect.left + leading.rect.width / 2, trailing.rect.left + trailing.rect.width / 2, easedProgress);
    const centerY = interpolate(leading.rect.top + leading.rect.height / 2, trailing.rect.top + trailing.rect.height / 2, easedProgress);
    const height = interpolate(leading.rect.height, trailing.rect.height, easedProgress) - deformation * 0.8;
    const width = interpolate(leading.rect.width, trailing.rect.width, easedProgress) + ITEM_OVERHANG * 2 + deformation * Math.min(5, gapWidth * 0.34);
    const leadingId = leading.element.dataset.topbarNavigation ?? "leading";
    const trailingId = trailing.element.dataset.topbarNavigation ?? "trailing";
    return {
      deformation,
      height,
      id: `gap:${leadingId}:${trailingId}`,
      left: centerX - width / 2 - navigationRect.left,
      mode: "gap",
      pull: 0,
      top: centerY - height / 2 - navigationRect.top,
      velocity,
      width,
    };
  }
  return null;
}

export function getTopbarPointerTarget(navigation: HTMLElement, clientX: number, velocity: number, allowPull: boolean, continuous = false, forceRecoil = false): TopbarGlassTarget | null {
  return resolveTopbarPointerTarget(measureNavigation(navigation), clientX, velocity, allowPull, continuous, forceRecoil);
}

function getClosestItemTarget(geometry: NavigationGeometry, clientX: number): TopbarGlassTarget | null {
  if (geometry.items.length === 0) return null;
  const closestItem = geometry.items.reduce((closest, item) => {
    const closestCenter = closest.rect.left + closest.rect.width / 2;
    const itemCenter = item.rect.left + item.rect.width / 2;
    return Math.abs(clientX - itemCenter) < Math.abs(clientX - closestCenter) ? item : closest;
  });
  return getItemTarget(geometry.navigationRect, closestItem, 0);
}

export function useTopbarGlassPointer(targetSignal: TopbarGlassSignal): {
  setNavigationElement: (element: HTMLElement | null) => void;
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerLeave: (event: ReactPointerEvent<HTMLElement>) => void;
  onPointerMove: (event: ReactPointerEvent<HTMLElement>) => void;
} {
  const navigationRef = useRef<HTMLElement | null>(null);
  const geometryRef = useRef<NavigationGeometry | null>(null);
  const draggingPointer = useRef<number | null>(null);
  const pointerSample = useRef<PointerSample | null>(null);
  const pendingPointer = useRef<PendingPointer | null>(null);
  const updateFrame = useRef<number | null>(null);
  const pullReleased = useRef(false);
  const releaseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearReleaseTimer = useCallback(() => {
    if (releaseTimer.current === null) return;
    clearTimeout(releaseTimer.current);
    releaseTimer.current = null;
  }, []);

  const measure = useCallback(() => {
    const navigation = navigationRef.current;
    if (!navigation) return null;
    const geometry = measureNavigation(navigation);
    geometryRef.current = geometry;
    return geometry;
  }, []);

  const consumePointer = useCallback(() => {
    updateFrame.current = null;
    const pending = pendingPointer.current;
    const geometry = geometryRef.current ?? measure();
    if (!pending || !geometry) return;
    pendingPointer.current = null;
    if (!pending.continuous && (pending.y < geometry.navigationRect.top || pending.y > geometry.navigationRect.bottom)) return;
    const previous = pointerSample.current;
    const elapsed = previous ? Math.max(8, pending.time - previous.time) : 16;
    const rawVelocity = previous ? ((pending.x - previous.x) / elapsed) * 1000 : 0;
    const velocity = clamp((previous?.velocity ?? 0) * 0.38 + rawVelocity * 0.62, -2200, 2200);
    pointerSample.current = { time: pending.time, velocity, x: pending.x };
    const first = geometry.items[0];
    const last = geometry.items[geometry.items.length - 1];
    const insideItemRange = first && last && pending.x >= first.rect.left && pending.x <= last.rect.right;
    if (insideItemRange) pullReleased.current = false;
    const nextTarget = resolveTopbarPointerTarget(geometry, pending.x, pending.continuous ? velocity : 0, pending.allowPull, pending.continuous, pullReleased.current);
    if (nextTarget?.mode === "recoil") pullReleased.current = true;
    if (nextTarget) targetSignal.set(nextTarget);
  }, [measure, targetSignal]);

  const queuePointer = useCallback(
    (x: number, y: number, time: number, allowPull: boolean, continuous: boolean) => {
      pendingPointer.current = { allowPull, continuous, time, x, y };
      if (updateFrame.current === null) updateFrame.current = requestAnimationFrame(consumePointer);
    },
    [consumePointer],
  );

  const setNavigationElement = useCallback((element: HTMLElement | null) => {
    navigationRef.current = element;
    geometryRef.current = element ? measureNavigation(element) : null;
  }, []);

  useEffect(() => {
    const navigation = navigationRef.current;
    if (!navigation) return undefined;
    const invalidateGeometry = () => {
      geometryRef.current = null;
    };
    const resizeObserver = new ResizeObserver(invalidateGeometry);
    resizeObserver.observe(navigation);
    window.addEventListener("resize", invalidateGeometry, { passive: true });

    const handlePointerMove = (event: PointerEvent) => {
      if (draggingPointer.current !== event.pointerId) return;
      const coalesced = event.getCoalescedEvents?.();
      const latest = coalesced && coalesced.length > 0 ? coalesced[coalesced.length - 1] : event;
      queuePointer(latest.clientX, latest.clientY, latest.timeStamp, true, true);
    };
    const finishDrag = (event: PointerEvent) => {
      if (draggingPointer.current !== event.pointerId) return;
      draggingPointer.current = null;
      pointerSample.current = null;
      pendingPointer.current = null;
      pullReleased.current = false;
      if (updateFrame.current !== null) {
        cancelAnimationFrame(updateFrame.current);
        updateFrame.current = null;
      }
      const geometry = geometryRef.current ?? measure();
      const currentNavigation = navigationRef.current;
      if (!geometry || !currentNavigation) return;
      const navigationRect = geometry.navigationRect;
      const releasedInside = event.clientX >= navigationRect.left && event.clientX <= navigationRect.right && event.clientY >= navigationRect.top && event.clientY <= navigationRect.bottom;
      if (releasedInside) {
        const nextTarget = resolveTopbarPointerTarget(geometry, event.clientX, 0, false, false, false);
        if (nextTarget) targetSignal.set(nextTarget);
        return;
      }
      targetSignal.set(getClosestItemTarget(geometry, event.clientX));
      clearReleaseTimer();
      releaseTimer.current = setTimeout(() => {
        if (!currentNavigation.matches(":hover") && !currentNavigation.contains(document.activeElement)) targetSignal.set(null);
      }, 360);
    };
    const cancelDrag = (event: PointerEvent) => {
      if (draggingPointer.current !== event.pointerId) return;
      draggingPointer.current = null;
      pointerSample.current = null;
      pendingPointer.current = null;
      pullReleased.current = false;
      targetSignal.set(null);
    };

    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    window.addEventListener("pointerup", finishDrag, { passive: true });
    window.addEventListener("pointercancel", cancelDrag, { passive: true });
    return () => {
      resizeObserver.disconnect();
      window.removeEventListener("resize", invalidateGeometry);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", finishDrag);
      window.removeEventListener("pointercancel", cancelDrag);
      if (updateFrame.current !== null) cancelAnimationFrame(updateFrame.current);
      clearReleaseTimer();
    };
  }, [clearReleaseTimer, measure, queuePointer, targetSignal]);

  return {
    setNavigationElement,
    onPointerDown: (event) => {
      if (!event.isPrimary || (event.pointerType === "mouse" && event.button !== 0)) return;
      const navigationItem = event.target instanceof Element ? event.target.closest<HTMLElement>("[data-topbar-navigation]") : null;
      const startsInNavigationGap = event.target === event.currentTarget;
      const startsInOwnedItem = navigationItem !== null && event.currentTarget.contains(navigationItem);
      if (!startsInNavigationGap && !startsInOwnedItem) return;
      clearReleaseTimer();
      const geometry = measure();
      if (!geometry || event.clientY < geometry.navigationRect.top || event.clientY > geometry.navigationRect.bottom) return;
      draggingPointer.current = event.pointerId;
      pullReleased.current = false;
      pointerSample.current = { time: event.timeStamp, velocity: 0, x: event.clientX };
      queuePointer(event.clientX, event.clientY, event.timeStamp, true, true);
    },
    onPointerLeave: (event) => {
      if (draggingPointer.current !== null) return;
      pointerSample.current = null;
      pendingPointer.current = null;
      if (!event.currentTarget.contains(document.activeElement)) targetSignal.set(null);
    },
    onPointerMove: (event) => {
      if (draggingPointer.current !== null) return;
      const geometry = geometryRef.current;
      if (geometry && (event.clientY < geometry.navigationRect.top || event.clientY > geometry.navigationRect.bottom)) return;
      clearReleaseTimer();
      queuePointer(event.clientX, event.clientY, event.timeStamp, false, false);
    },
  };
}
