import { motion, useAnimationControls, useReducedMotion } from "motion/react";
import { useEffect, useRef } from "react";
import type { CSSProperties } from "react";

export type TopbarGlassTarget = {
  deformation: number;
  height: number;
  id: string;
  left: number;
  mode: "gap" | "item";
  top: number;
  width: number;
};

const opticalEdgeMask: CSSProperties = {
  backdropFilter: "blur(0.8px) brightness(1.14) contrast(1.42) saturate(1.04)",
  WebkitMask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
  WebkitMaskComposite: "xor",
  WebkitBackdropFilter: "blur(0.8px) brightness(1.14) contrast(1.42) saturate(1.04)",
  maskComposite: "exclude",
};

const TOPBAR_EDGE_FILTER_ID = "tanaw-topbar-edge-distortion";

const interpolate = (from: number, to: number, progress: number) => from + (to - from) * progress;

export function TopbarLiquidGlass({ isDark, target }: { isDark: boolean; target: TopbarGlassTarget | null }) {
  const controls = useAnimationControls();
  const shouldReduceMotion = useReducedMotion();
  const previousTarget = useRef<TopbarGlassTarget | null>(null);
  const currentTarget = useRef<TopbarGlassTarget | null>(target);

  useEffect(() => {
    currentTarget.current = target;
    const previous = previousTarget.current;

    if (!target) {
      if (!previous) return;
      void controls
        .start({
          borderRadius: "999px",
          height: previous.height,
          left: previous.left,
          opacity: 0,
          scaleX: shouldReduceMotion ? 0.96 : 0.88,
          scaleY: shouldReduceMotion ? 0.96 : 0.92,
          top: previous.top,
          transition: { duration: shouldReduceMotion ? 0.1 : 0.3, ease: [0.4, 0, 0.72, 0.22] },
          width: previous.width,
        })
        .then(() => {
          if (!currentTarget.current) previousTarget.current = null;
        });
      return;
    }

    previousTarget.current = target;
    if (shouldReduceMotion) {
      void controls.start({
        borderRadius: "999px",
        height: target.height,
        left: target.left,
        opacity: 1,
        scaleX: 1,
        scaleY: 1,
        top: target.top,
        transition: { duration: 0.12, ease: "easeOut" },
        width: target.width,
      });
      return;
    }

    if (!previous) {
      controls.set({
        borderRadius: "999px",
        height: target.height,
        left: target.left,
        opacity: 0,
        scaleX: 0.9,
        scaleY: 0.92,
        top: target.top,
        width: target.width,
      });
      void controls.start({
        borderRadius: "999px",
        height: target.height,
        left: target.left,
        opacity: [0, 1, 1],
        scaleX: [0.9, 1.025, 1],
        scaleY: [0.92, 1.025, 1],
        top: target.top,
        transition: { duration: 0.44, ease: [0.2, 0.78, 0.22, 1], times: [0, 0.68, 1] },
        width: target.width,
      });
      return;
    }

    if (target.mode === "gap") {
      void controls.start({
        borderRadius: "999px",
        height: target.height,
        left: target.left,
        opacity: 1,
        scaleX: 1 + target.deformation * 0.012,
        scaleY: 1 - target.deformation * 0.025,
        top: target.top,
        transition: { type: "spring", stiffness: 520, damping: 38, mass: 0.48 },
        width: target.width,
      });
      return;
    }

    if (previous.mode === "gap") {
      void controls.start({
        borderRadius: "999px",
        height: target.height,
        left: target.left,
        opacity: 1,
        scaleX: 1,
        scaleY: 1,
        top: target.top,
        transition: { type: "spring", stiffness: 430, damping: 32, mass: 0.56 },
        width: target.width,
      });
      return;
    }

    const previousRight = previous.left + previous.width;
    const targetRight = target.left + target.width;
    const previousCenter = previous.left + previous.width / 2;
    const targetCenter = target.left + target.width / 2;
    const movingRight = targetCenter >= previousCenter;
    const distance = Math.abs(targetCenter - previousCenter);
    const duration = Math.min(0.56, 0.4 + distance / 1200);
    const firstLeft = interpolate(previous.left, target.left, movingRight ? 0.34 : 0.72);
    const firstRight = interpolate(previousRight, targetRight, movingRight ? 0.72 : 0.34);
    const secondLeft = interpolate(previous.left, target.left, movingRight ? 0.88 : 1.02);
    const secondRight = interpolate(previousRight, targetRight, movingRight ? 1.02 : 0.88);

    controls.set({
      borderRadius: "999px",
      height: previous.height,
      left: previous.left,
      opacity: 1,
      scaleX: 1,
      scaleY: 1,
      top: previous.top,
      width: previous.width,
    });
    void controls.start({
      borderRadius: "999px",
      height: [previous.height, interpolate(previous.height, target.height, 0.55), target.height, target.height],
      left: [previous.left, firstLeft, secondLeft, target.left],
      opacity: 1,
      scaleX: 1,
      scaleY: [1, 0.965, 1.02, 1],
      top: [previous.top, interpolate(previous.top, target.top, 0.55), target.top, target.top],
      transition: { duration, ease: [0.22, 0.72, 0.18, 1], times: [0, 0.48, 0.82, 1] },
      width: [previous.width, firstRight - firstLeft, secondRight - secondLeft, target.width],
    });
  }, [controls, shouldReduceMotion, target]);

  const materialClass = isDark
    ? "bg-[radial-gradient(ellipse_at_42%_36%,rgba(255,255,255,0.09),rgba(255,255,255,0.018)_58%,rgba(1,12,15,0.045))] shadow-[inset_0.5px_0.5px_1px_rgba(255,255,255,0.24),inset_-0.5px_-0.5px_1px_rgba(0,0,0,0.16),0_5px_12px_rgba(0,0,0,0.12)]"
    : "bg-[radial-gradient(ellipse_at_42%_36%,rgba(255,255,255,0.16),rgba(255,255,255,0.025)_58%,rgba(3,36,29,0.035))] shadow-[inset_0.5px_0.5px_1px_rgba(255,255,255,0.36),inset_-0.5px_-0.5px_1px_rgba(4,42,32,0.1),0_5px_12px_rgba(2,25,18,0.1)]";

  return (
    <motion.span
      data-topbar-glass-indicator={target ? "true" : undefined}
      data-topbar-glass-target={target?.id}
      data-topbar-glass-state={target?.mode}
      data-topbar-glass-deformation={target ? target.deformation.toFixed(3) : undefined}
      data-topbar-glass-origin="droplet-center"
      data-topbar-glass-shape="capsule-droplet"
      data-topbar-glass-material={isDark ? "dark" : "light"}
      data-topbar-glass-edge="adaptive-neutral-refraction"
      data-topbar-glass-edge-thickness="hairline"
      data-topbar-glass-edge-distortion="subtle"
      data-topbar-glass-motion={shouldReduceMotion ? "reduced" : "edge-glide"}
      data-topbar-glass-geometry="independent-endcaps"
      aria-hidden="true"
      animate={controls}
      initial={{ opacity: 0 }}
      style={{ transformOrigin: "50% 50%" }}
      className={`pointer-events-none absolute z-0 overflow-hidden rounded-full border-0 backdrop-blur-[5px] backdrop-saturate-175 will-change-[left,top,width,height,transform,opacity] ${materialClass}`}
    >
      <svg aria-hidden="true" className="absolute h-0 w-0" focusable="false">
        <filter id={TOPBAR_EDGE_FILTER_ID} x="-8%" y="-12%" width="116%" height="124%" colorInterpolationFilters="sRGB">
          <feTurbulence type="fractalNoise" baseFrequency="0.012 0.09" numOctaves="1" seed="8" result="edgeNoise" />
          <feDisplacementMap in="SourceGraphic" in2="edgeNoise" scale="0.65" xChannelSelector="R" yChannelSelector="B" />
        </filter>
      </svg>
      <span className="absolute inset-[10%] rounded-[inherit] bg-[radial-gradient(ellipse_at_35%_32%,rgba(255,255,255,0.13),transparent_58%)]" />
      <span
        data-topbar-glass-refraction="background-adaptive"
        className={`absolute inset-0 rounded-[inherit] p-[0.75px] ${
          isDark
            ? "bg-[conic-gradient(from_205deg,rgba(255,255,255,0.72),rgba(255,255,255,0.1)_20%,rgba(255,255,255,0.02)_38%,rgba(255,255,255,0.34)_60%,rgba(255,255,255,0.06)_79%,rgba(255,255,255,0.64))] opacity-72"
            : "bg-[conic-gradient(from_205deg,rgba(255,255,255,0.88),rgba(255,255,255,0.14)_20%,rgba(255,255,255,0.03)_38%,rgba(255,255,255,0.48)_60%,rgba(255,255,255,0.09)_79%,rgba(255,255,255,0.8))] opacity-82"
        }`}
        style={{ ...opticalEdgeMask, filter: `url(#${TOPBAR_EDGE_FILTER_ID})` }}
      />
      <span className="absolute top-[16%] bottom-[16%] -left-0.5 w-2 rounded-full bg-[radial-gradient(ellipse,rgba(255,255,255,0.42),rgba(255,255,255,0.08)_46%,transparent_74%)] blur-[0.7px]" />
      <span className="absolute top-[18%] -right-0.5 bottom-[18%] w-2 rounded-full bg-[radial-gradient(ellipse,rgba(255,255,255,0.32),rgba(255,255,255,0.06)_46%,transparent_74%)] blur-[0.7px]" />
    </motion.span>
  );
}

export function TopbarActiveUnderline({ isDark }: { isDark: boolean }) {
  return <span data-topbar-active-underline="true" aria-hidden="true" className={`pointer-events-none absolute bottom-1 left-1/2 z-20 h-0.5 w-4 -translate-x-1/2 rounded-full ${isDark ? "bg-emerald-300/90" : "bg-emerald-200"}`} />;
}
