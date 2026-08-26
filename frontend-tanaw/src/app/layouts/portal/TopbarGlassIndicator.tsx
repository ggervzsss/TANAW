import { motion, useMotionValue, useReducedMotion, useSpring, useTransform } from "motion/react";
import type { MotionValue } from "motion/react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef } from "react";
import type { CSSProperties } from "react";

export type TopbarGlassTarget = {
  deformation: number;
  height: number;
  id: string;
  left: number;
  mode: "drag" | "gap" | "item" | "pull" | "recoil";
  pull?: number;
  top: number;
  velocity?: number;
  width: number;
};

export type TopbarGlassSignal = MotionValue<TopbarGlassTarget | null>;

const endcapMask =
  "radial-gradient(ellipse 22px 94% at 0% 50%,#000 0%,#000 38%,rgba(0,0,0,0.86) 58%,rgba(0,0,0,0.34) 78%,transparent 100%),radial-gradient(ellipse 22px 94% at 100% 50%,#000 0%,#000 38%,rgba(0,0,0,0.86) 58%,rgba(0,0,0,0.34) 78%,transparent 100%)";

const edgeBackdrop: CSSProperties = {
  backdropFilter: "blur(3px) brightness(1.06) saturate(1.12)",
  background: "transparent",
  maskImage: endcapMask,
  WebkitBackdropFilter: "blur(3px) brightness(1.06) saturate(1.12)",
  WebkitMaskImage: endcapMask,
};

const clampUnit = (value: number) => Math.min(1, Math.max(0, value));

const setDatasetValue = (element: HTMLElement, key: string, value: string) => {
  if (element.dataset[key] !== value) element.dataset[key] = value;
};

const setTargetAttributes = (element: HTMLElement, target: TopbarGlassTarget | null) => {
  if (!target) {
    delete element.dataset.topbarGlassTarget;
    delete element.dataset.topbarGlassState;
    delete element.dataset.topbarGlassDeformation;
    delete element.dataset.topbarGlassPull;
    return;
  }
  setDatasetValue(element, "topbarGlassTarget", target.id);
  setDatasetValue(element, "topbarGlassState", target.mode);
  setDatasetValue(element, "topbarGlassDeformation", target.deformation.toFixed(3));
  setDatasetValue(element, "topbarGlassPull", (target.pull ?? 0).toFixed(3));
};

const stripReplicaSemantics = (element: HTMLElement) => {
  element.removeAttribute("data-topbar-refractive-source");
  element.removeAttribute("id");
  element.setAttribute("aria-hidden", "true");
  element.querySelectorAll<HTMLElement>("*").forEach((child) => {
    child.removeAttribute("id");
    child.removeAttribute("aria-current");
    child.removeAttribute("aria-expanded");
    child.removeAttribute("aria-haspopup");
    child.setAttribute("aria-hidden", "true");
    child.tabIndex = -1;
  });
};

export function TopbarLiquidGlass({ isDark, target }: { isDark: boolean; target: TopbarGlassSignal }) {
  const shouldReduceMotion = useReducedMotion();
  const materialRef = useRef<HTMLSpanElement>(null);
  const refractionTrackRef = useRef<HTMLSpanElement>(null);
  const hasGeometry = useRef(false);
  const settleTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const filterId = `tanaw-topbar-lens-${useId().replace(/:/g, "")}`;

  const targetCenter = useMotionValue(0);
  const targetTop = useMotionValue(0);
  const targetWidth = useMotionValue(0);
  const targetHeight = useMotionValue(0);
  const targetOpacity = useMotionValue(0);
  const targetPull = useMotionValue(0);
  const renderedCenter = useSpring(targetCenter, { stiffness: 610, damping: 44, mass: 0.4 });
  const renderedTop = useSpring(targetTop, { stiffness: 680, damping: 48, mass: 0.36 });
  const renderedWidth = useSpring(targetWidth, { stiffness: 640, damping: 38, mass: 0.4 });
  const renderedHeight = useSpring(targetHeight, { stiffness: 680, damping: 46, mass: 0.36 });
  const renderedOpacity = useSpring(targetOpacity, { stiffness: 560, damping: 44, mass: 0.3 });
  const renderedPull = useSpring(targetPull, { stiffness: 470, damping: 34, mass: 0.32 });
  const renderedLeft = useTransform([renderedCenter, renderedWidth], ([center, width]) => Number(center) - Number(width) / 2);
  const inverseLeft = useTransform(renderedLeft, (left) => -left);
  const inverseTop = useTransform(renderedTop, (top) => -top);
  const leftPullIntensity = useTransform(renderedPull, (pull) => clampUnit(-pull));
  const rightPullIntensity = useTransform(renderedPull, (pull) => clampUnit(pull));
  const renderedRadius = useTransform([renderedHeight, leftPullIntensity, rightPullIntensity], ([height, leftIntensity, rightIntensity]) => {
    const baseRadius = Number(height) / 2;
    const leftHorizontal = baseRadius + Number(leftIntensity) * 12;
    const rightHorizontal = baseRadius + Number(rightIntensity) * 12;
    const leftVertical = Math.max(9, baseRadius - Number(leftIntensity) * 2.5);
    const rightVertical = Math.max(9, baseRadius - Number(rightIntensity) * 2.5);
    return `${leftHorizontal}px ${rightHorizontal}px ${rightHorizontal}px ${leftHorizontal}px / ${leftVertical}px ${rightVertical}px ${rightVertical}px ${leftVertical}px`;
  });
  const lensTransformOrigin = useTransform([renderedCenter, renderedTop, renderedHeight], ([center, top, height]) => `${Number(center)}px ${Number(top) + Number(height) / 2}px`);

  const syncRefractionCopies = useCallback(() => {
    const track = refractionTrackRef.current;
    const navigation = materialRef.current?.parentElement;
    if (!track || !navigation) return;
    const navigationRect = navigation.getBoundingClientRect();
    const fragment = document.createDocumentFragment();

    navigation.querySelectorAll<HTMLElement>("[data-topbar-refractive-source='true']").forEach((source) => {
      const sourceRect = source.getBoundingClientRect();
      const sourceStyle = getComputedStyle(source);
      const copy = document.createElement("span");
      const replica = source.cloneNode(true) as HTMLElement;
      stripReplicaSemantics(replica);
      copy.dataset.topbarRefractionCopy = "true";
      copy.style.position = "absolute";
      copy.style.left = `${sourceRect.left - navigationRect.left}px`;
      copy.style.top = `${sourceRect.top - navigationRect.top}px`;
      copy.style.width = `${sourceRect.width}px`;
      copy.style.height = `${sourceRect.height}px`;
      copy.style.color = sourceStyle.color;
      copy.style.font = sourceStyle.font;
      copy.style.letterSpacing = sourceStyle.letterSpacing;
      copy.style.lineHeight = sourceStyle.lineHeight;
      copy.style.whiteSpace = "nowrap";
      copy.append(replica);
      fragment.append(copy);
    });

    track.replaceChildren(fragment);
    track.style.width = `${navigationRect.width}px`;
    track.style.height = `${navigationRect.height}px`;
  }, []);

  useLayoutEffect(() => {
    const navigation = materialRef.current?.parentElement;
    if (!navigation) return undefined;
    let animationFrame = requestAnimationFrame(syncRefractionCopies);
    const scheduleSync = () => {
      cancelAnimationFrame(animationFrame);
      animationFrame = requestAnimationFrame(syncRefractionCopies);
    };
    const resizeObserver = new ResizeObserver(scheduleSync);
    const sourceObserver = new MutationObserver(scheduleSync);
    resizeObserver.observe(navigation);
    navigation.querySelectorAll<HTMLElement>("[data-topbar-refractive-source='true']").forEach((source) => {
      resizeObserver.observe(source);
      sourceObserver.observe(source, { attributes: true, attributeFilter: ["class", "style"], childList: true, subtree: true });
    });
    navigation.querySelectorAll<HTMLElement>("[data-topbar-navigation]").forEach((item) => {
      sourceObserver.observe(item, { attributes: true, attributeFilter: ["aria-expanded", "class", "style"] });
    });
    window.addEventListener("resize", scheduleSync, { passive: true });
    return () => {
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      sourceObserver.disconnect();
      window.removeEventListener("resize", scheduleSync);
    };
  }, [isDark, syncRefractionCopies]);

  useEffect(() => {
    const jumpTo = (center: number, top: number, width: number, height: number) => {
      targetCenter.set(center);
      targetTop.set(top);
      targetWidth.set(width);
      targetHeight.set(height);
      renderedCenter.jump(center);
      renderedTop.jump(top);
      renderedWidth.jump(width);
      renderedHeight.jump(height);
    };
    const handleTarget = (nextTarget: TopbarGlassTarget | null) => {
      const material = materialRef.current;
      if (!material) return;
      setTargetAttributes(material, nextTarget);
      if (settleTimer.current !== null) {
        clearTimeout(settleTimer.current);
        settleTimer.current = null;
      }
      if (hideTimer.current !== null) {
        clearTimeout(hideTimer.current);
        hideTimer.current = null;
      }
      if (!nextTarget) {
        targetOpacity.set(0);
        targetPull.set(0);
        if (shouldReduceMotion) renderedPull.jump(0);
        hideTimer.current = setTimeout(() => {
          if (target.get() === null) hasGeometry.current = false;
          hideTimer.current = null;
        }, 280);
        return;
      }

      const baseCenter = nextTarget.left + nextTarget.width / 2;
      const velocity = nextTarget.velocity ?? 0;
      const velocityStretch = nextTarget.mode === "drag" || nextTarget.mode === "gap" || nextTarget.mode === "item" ? Math.min(5.5, Math.abs(velocity) / 310) : 0;
      const animatedCenter = baseCenter + Math.sign(velocity) * velocityStretch * 0.1;
      const animatedWidth = nextTarget.width + velocityStretch;
      const pull = nextTarget.pull ?? 0;

      if (!hasGeometry.current || shouldReduceMotion) {
        jumpTo(baseCenter, nextTarget.top, nextTarget.width, nextTarget.height);
        hasGeometry.current = true;
      } else {
        targetCenter.set(animatedCenter);
        targetTop.set(nextTarget.top);
        targetWidth.set(animatedWidth);
        targetHeight.set(nextTarget.height);
      }
      targetOpacity.set(1);
      targetPull.set(pull);
      if (shouldReduceMotion) renderedPull.jump(pull);

      if (!shouldReduceMotion && velocityStretch > 0) {
        settleTimer.current = setTimeout(() => {
          targetCenter.set(baseCenter);
          targetWidth.set(nextTarget.width);
        }, 64);
      }
    };

    handleTarget(target.get());
    const unsubscribe = target.on("change", handleTarget);
    return () => {
      unsubscribe();
      if (settleTimer.current !== null) clearTimeout(settleTimer.current);
      if (hideTimer.current !== null) clearTimeout(hideTimer.current);
    };
  }, [renderedCenter, renderedHeight, renderedPull, renderedTop, renderedWidth, shouldReduceMotion, target, targetCenter, targetHeight, targetOpacity, targetPull, targetTop, targetWidth]);

  const materialBackground = isDark
    ? "radial-gradient(ellipse 82% 52% at 50% 0%,rgba(255,255,255,0.055),transparent 72%) padding-box,linear-gradient(180deg,rgba(255,255,255,0.055) 0%,rgba(255,255,255,0.032) 46%,rgba(255,255,255,0.1) 100%) padding-box,linear-gradient(180deg,rgba(255,255,255,0.2) 0%,rgba(255,255,255,0.065) 48%,rgba(255,255,255,0.16) 100%) border-box"
    : "radial-gradient(ellipse 82% 52% at 50% 0%,rgba(255,255,255,0.07),transparent 72%) padding-box,linear-gradient(180deg,rgba(255,255,255,0.065) 0%,rgba(255,255,255,0.04) 46%,rgba(255,255,255,0.105) 100%) padding-box,linear-gradient(180deg,rgba(255,255,255,0.22) 0%,rgba(255,255,255,0.075) 48%,rgba(255,255,255,0.18) 100%) border-box";

  return (
    <>
      <svg aria-hidden="true" className="pointer-events-none absolute h-0 w-0" focusable="false">
        <filter id={filterId} x="-36%" y="-70%" width="172%" height="240%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.007 0.034" numOctaves="1" seed="11" result="lensNoise" />
          <feGaussianBlur in="lensNoise" stdDeviation="0.55 1" result="softLensNoise" />
          <feDisplacementMap in="SourceGraphic" in2="softLensNoise" scale="22" xChannelSelector="R" yChannelSelector="B" result="warpedNavigation" />
          <feMorphology in="warpedNavigation" operator="dilate" radius="0.35 0.55" result="roundedNavigation" />
          <feGaussianBlur data-topbar-glass-smear="neutral" in="roundedNavigation" stdDeviation="2.4 0.32" result="smearedNavigation" />
          <feColorMatrix in="smearedNavigation" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0.44 0" result="neutralSmear" />
          <feOffset in="smearedNavigation" dx="-2.3" result="cyanOffset" />
          <feColorMatrix data-topbar-chromatic-channel="cyan" in="cyanOffset" type="matrix" values="0 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0.24 0" result="cyanFringe" />
          <feOffset in="smearedNavigation" dx="2.3" result="magentaOffset" />
          <feColorMatrix data-topbar-chromatic-channel="magenta" in="magentaOffset" type="matrix" values="1 0 0 0 0  0 0 0 0 0  0 0 1 0 0  0 0 0 0.21 0" result="magentaFringe" />
          <feColorMatrix data-topbar-glass-core="attenuated" in="warpedNavigation" type="matrix" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 0.78 0" result="warpedCore" />
          <feMerge>
            <feMergeNode data-topbar-glass-smear-output="true" in="neutralSmear" />
            <feMergeNode in="cyanFringe" />
            <feMergeNode in="magentaFringe" />
            <feMergeNode in="warpedCore" />
          </feMerge>
        </filter>
      </svg>
      <motion.span
        ref={materialRef}
        data-topbar-glass-indicator="true"
        data-topbar-glass-origin="droplet-center"
        data-topbar-glass-shape="continuous-waterdrop"
        data-topbar-glass-material={isDark ? "dark" : "light"}
        data-topbar-glass-edge="replicated-lens-refraction"
        data-topbar-glass-edge-thickness="feathered-lens-band"
        data-topbar-glass-edge-distortion="visible"
        data-topbar-glass-motion={shouldReduceMotion ? "reduced" : "raf-spring"}
        data-topbar-glass-renderer="motion-value-raf"
        data-topbar-glass-geometry="continuous-capsule"
        data-topbar-glass-edge-response="filtered-foreground-replica"
        data-topbar-glass-surface="transparent"
        data-topbar-glass-chromatic="split-fringe"
        data-topbar-glass-stretch="integrated-endcap"
        aria-hidden="true"
        style={{
          x: renderedLeft,
          y: renderedTop,
          width: renderedWidth,
          height: renderedHeight,
          opacity: renderedOpacity,
          background: materialBackground,
          border: "1px solid transparent",
          borderRadius: renderedRadius,
          boxShadow: "inset 0 1px 0 rgba(255,255,255,0.16),inset 0 -1px 0 rgba(255,255,255,0.07),0 3px 10px rgba(3,56,39,0.1)",
          backdropFilter: "blur(4px) saturate(1.08) brightness(1.02)",
          WebkitBackdropFilter: "blur(4px) saturate(1.08) brightness(1.02)",
        }}
        className="pointer-events-none absolute top-0 left-0 z-0 overflow-hidden will-change-transform"
      >
        <span
          data-topbar-glass-refraction="background-adaptive"
          style={{ background: "radial-gradient(ellipse 72% 40% at 50% 0%,rgba(255,255,255,0.055),transparent 76%)" }}
          className="absolute inset-px rounded-[inherit]"
        />
      </motion.span>
      <motion.span
        data-topbar-glass-optics="foreground-endcaps"
        data-topbar-glass-edge-zone="feathered"
        aria-hidden="true"
        style={{
          x: renderedLeft,
          y: renderedTop,
          width: renderedWidth,
          height: renderedHeight,
          opacity: renderedOpacity,
          borderRadius: renderedRadius,
          ...edgeBackdrop,
        }}
        className="pointer-events-none absolute top-0 left-0 z-20 overflow-hidden will-change-transform"
      >
        <motion.span
          ref={refractionTrackRef}
          data-topbar-refraction-track="filtered-navigation-copy"
          data-topbar-lens-magnification="1.10x1.06"
          className="pointer-events-none absolute top-0 left-0"
          style={{ x: inverseLeft, y: inverseTop, scaleX: 1.1, scaleY: 1.06, filter: `url(#${filterId})`, transformOrigin: lensTransformOrigin }}
        />
      </motion.span>
    </>
  );
}

export function TopbarActiveUnderline({ isDark }: { isDark: boolean }) {
  return (
    <span
      data-topbar-active-underline="true"
      aria-hidden="true"
      className={`pointer-events-none absolute bottom-1 left-1/2 z-20 h-0.5 w-4 -translate-x-1/2 rounded-full ${isDark ? "bg-emerald-300/90" : "bg-emerald-200"}`}
    />
  );
}
