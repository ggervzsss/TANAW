/*
 * GENERATED FILE. Do not edit; change design-system/src/patterns/TopbarGlassIndicator.tsx instead.
 * Update with: node design-system/scripts/sync.mjs
 * Source SHA-256: 0c351db4bf4171b73b6f84cc764ae233ac969f86362de24ecdd234ec51033880
 */
import { motion, useSpring, useTransform, useVelocity } from "motion/react";
import { useCallback, useLayoutEffect, useRef, useSyncExternalStore } from "react";
import type { ComponentPropsWithoutRef, PointerEvent as ReactPointerEvent } from "react";
import "./TopbarGlassIndicator.css";

type Bounds = { x: number; y: number; width: number; height: number };
type NavigationProps = ComponentPropsWithoutRef<"nav"> & {
  activeId: string | null;
  isDark: boolean;
};

const itemSelector = "[data-topbar-navigation]";
const travelSpring = { stiffness: 255, damping: 27, mass: 0.74 };
const edgeSpring = { stiffness: 310, damping: 26, mass: 0.68 };
const feedbackSpring = { stiffness: 430, damping: 29, mass: 0.42 };
const reducedMotionQuery = "(prefers-reduced-motion: reduce)";

function subscribeToMotionPreference(onChange: () => void) {
  const preference = window.matchMedia(reducedMotionQuery);
  preference.addEventListener("change", onChange);
  return () => preference.removeEventListener("change", onChange);
}

const prefersReducedMotion = () => window.matchMedia(reducedMotionQuery).matches;
const defaultReducedMotion = () => false;

function getBounds(navigation: HTMLElement, rect: DOMRect, bleed: number): Bounds {
  const container = navigation.getBoundingClientRect();
  // Bounds are in viewport pixels. Convert back to local pixels when app zoom is set.
  const zoom = container.width / navigation.offsetWidth || 1;
  return {
    x: (rect.left - container.left) / zoom - bleed,
    y: (rect.top - container.top) / zoom,
    width: rect.width / zoom + 2 * bleed,
    height: rect.height / zoom,
  };
}

function useGlassPill(reducedMotion: boolean, active: boolean) {
  const travel = active ? travelSpring : feedbackSpring;
  const x = useSpring(0, travel);
  const y = useSpring(0, travel);
  const width = useSpring(0, active ? edgeSpring : travel);
  const height = useSpring(0, travel);
  const pressure = useSpring(0, feedbackSpring);
  const velocity = useVelocity(x);
  const stretch = useTransform(velocity, (speed) => (reducedMotion || !active ? 0 : Math.min(11, Math.abs(speed) * 0.009)));
  const left = useTransform(() => x.get() - stretch.get() * 0.65);
  const shapeWidth = useTransform(() => width.get() + stretch.get());
  const scaleY = useTransform(pressure, (amount) => (reducedMotion ? 1 : 1 - amount * 0.065));

  const place = useCallback((bounds: Bounds, immediate: boolean) => {
    const values = [
      [x, bounds.x],
      [y, bounds.y],
      [width, bounds.width],
      [height, bounds.height],
    ] as const;
    for (const [value, next] of values) {
      if (immediate || reducedMotion) value.jump(next);
      else value.set(next);
    }
  }, [height, reducedMotion, width, x, y]);

  return { place, pressure, stretch, width, height, style: { x: left, y, width: shapeWidth, height, scaleY } };
}

/** Route selection and pointer feedback share the existing nav's bounds. Only the glass moves. */
export function TopbarGlassNavigation({ activeId, isDark, children, ...navProps }: NavigationProps) {
  const reducedMotion = useSyncExternalStore(subscribeToMotionPreference, prefersReducedMotion, defaultReducedMotion);
  const navigationRef = useRef<HTMLElement>(null);
  const currentId = useRef<string | null>(null);
  const pointer = useRef<{ item: HTMLElement; rect: DOMRect } | null>(null);
  const pressed = useRef<HTMLElement | null>(null);
  const active = useGlassPill(reducedMotion, true);
  const hover = useGlassPill(reducedMotion, false);
  const { place: placeActive, pressure: activePressure } = active;
  const { place: placeHover, pressure: hoverPressure } = hover;
  const hoverOpacity = useSpring(0, feedbackSpring);
  const activeLight = useSpring(0, feedbackSpring);
  const lightX = useSpring(0.5, feedbackSpring);
  const lightY = useSpring(0.35, feedbackSpring);
  const selectedLightPosition = useLightPosition(lightX, lightY, active.width, active.height);
  const hoverLightPosition = useLightPosition(lightX, lightY, hover.width, hover.height);
  const selectedLightOpacity = useTransform(() => Math.min(1, activeLight.get() * 0.68 + active.stretch.get() * 0.075 + active.pressure.get() * 0.3));
  const hoverLightOpacity = useTransform(hover.pressure, (amount) => 0.5 + amount * 0.5);

  const updatePointerLayers = useCallback(() => {
    const item = pointer.current?.item;
    const isCurrent = !!item && item.dataset.topbarNavigation === activeId;
    const set = (value: typeof activeLight, next: number) => (reducedMotion ? value.jump(next) : value.set(next));
    set(activeLight, isCurrent ? 1 : 0);
    set(hoverOpacity, item && !isCurrent ? 1 : 0);
    set(activePressure, isCurrent && pressed.current === item ? 1 : 0);
    set(hoverPressure, !isCurrent && pressed.current === item ? 1 : 0);
  }, [activeId, activeLight, activePressure, hoverOpacity, hoverPressure, reducedMotion]);

  useLayoutEffect(() => {
    const navigation = navigationRef.current;
    if (!navigation) return undefined;
    const selected = Array.from(navigation.querySelectorAll<HTMLElement>(itemSelector)).find((item) => item.dataset.topbarNavigation === activeId);
    const bleed = navigation.dataset.topbarGlassLayout === "stacked" ? 0 : 4;

    const place = (immediate: boolean) => {
      const hasSelection = selected && selected.offsetWidth > 0;
      if (hasSelection) {
        placeActive(getBounds(navigation, selected.getBoundingClientRect(), bleed), immediate || !navigation.hasAttribute("data-topbar-glass-ready"));
      }
      navigation.toggleAttribute("data-topbar-glass-ready", !!hasSelection);
    };
    place(currentId.current === activeId);
    currentId.current = activeId;
    updatePointerLayers();

    if (typeof ResizeObserver === "undefined") return undefined;
    const sizes = new Map<Element, { width: number; height: number }>();
    const observer = new ResizeObserver((entries) => {
      // The first delivery reports the dimensions we already measured above.
      let resized = false;
      for (const { target } of entries) {
        const item = target as HTMLElement;
        const size = { width: item.offsetWidth, height: item.offsetHeight };
        const previous = sizes.get(target);
        if (size.width !== previous?.width || size.height !== previous?.height) resized = true;
        sizes.set(target, size);
      }
      if (!resized) return;
      place(true);
      const hovered = pointer.current;
      if (hovered) {
        hovered.rect = hovered.item.getBoundingClientRect();
        placeHover(getBounds(navigation, hovered.rect, bleed), true);
      }
    });
    for (const item of [navigation, ...navigation.querySelectorAll<HTMLElement>(itemSelector)]) {
      sizes.set(item, { width: item.offsetWidth, height: item.offsetHeight });
      observer.observe(item);
    }
    return () => observer.disconnect();
  }, [activeId, placeActive, placeHover, updatePointerLayers]);

  function movePointer(event: ReactPointerEvent<HTMLElement>) {
    const item = (event.target as Element).closest<HTMLElement>(itemSelector);
    const navigation = event.currentTarget;
    if (!item || !navigation.contains(item)) {
      if (event.target !== navigation) clearPointer();
      return null;
    }

    const previous = pointer.current;
    if (previous?.item !== item) {
      const rect = item.getBoundingClientRect();
      const bleed = navigation.dataset.topbarGlassLayout === "stacked" ? 0 : 4;
      pointer.current = { item, rect };
      if (item.dataset.topbarNavigation !== activeId) {
        placeHover(getBounds(navigation, rect, bleed), !previous || previous.item.dataset.topbarNavigation === activeId);
      }
      updatePointerLayers();
    }
    const rect = pointer.current?.rect;
    if (rect && !reducedMotion) {
      lightX.set(Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)));
      lightY.set(Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)));
    }
    return item;
  }

  function clearPointer() {
    if (!pointer.current && !pressed.current) return;
    pointer.current = null;
    pressed.current = null;
    updatePointerLayers();
  }

  return (
    <nav
      {...navProps}
      ref={navigationRef}
      data-liquid-glass-navigation="true"
      data-topbar-glass-material={isDark ? "dark" : "light"}
      onPointerMove={(event) => {
        if (event.pointerType !== "touch") movePointer(event);
      }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        pressed.current = movePointer(event);
        updatePointerLayers();
      }}
      onPointerUp={(event) => {
        pressed.current = null;
        if (event.pointerType === "touch") clearPointer();
        else updatePointerLayers();
      }}
      onPointerCancel={clearPointer}
      onPointerLeave={clearPointer}
    >
      <motion.span aria-hidden="true" data-topbar-glass-indicator="true" className="tanaw-topbar-glass tanaw-topbar-glass--selected" style={active.style}>
        <motion.span className="tanaw-topbar-glass__light" style={{ ...selectedLightPosition, opacity: selectedLightOpacity }} />
      </motion.span>
      <motion.span aria-hidden="true" data-topbar-glass-hover="true" className="tanaw-topbar-glass tanaw-topbar-glass--hover" style={{ ...hover.style, opacity: hoverOpacity }}>
        <motion.span className="tanaw-topbar-glass__light" style={{ ...hoverLightPosition, opacity: hoverLightOpacity }} />
      </motion.span>
      {children}
    </nav>
  );
}

function useLightPosition(lightX: ReturnType<typeof useSpring>, lightY: ReturnType<typeof useSpring>, width: ReturnType<typeof useSpring>, height: ReturnType<typeof useSpring>) {
  return {
    x: useTransform(() => lightX.get() * width.get()),
    y: useTransform(() => lightY.get() * height.get()),
  };
}
