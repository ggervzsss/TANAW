/*
 * GENERATED FILE. Do not edit; change design-system/src/components/ModalPortal.tsx instead.
 * Update with: node design-system/scripts/sync.mjs
 * Source SHA-256: 5e1b46558da3835e87b1fa3d8f09d83cab19a1d93e1f5f781225d0b61f5b6447
 */
import { useEffect, type ReactNode } from "react";
import { createPortal } from "react-dom";

export type ModalPortalProps = {
  children: ReactNode;
  /** Stops the page behind from scrolling while open (dialogs). Menus and tooltips leave it off. */
  lockScroll?: boolean;
};

/**
 * Renders children into document.body so overlays escape every ancestor's overflow, stacking
 * context and transform, and position: fixed means the viewport.
 */
export function ModalPortal({ children, lockScroll = false }: ModalPortalProps) {
  const root = typeof document === "undefined" ? null : document.body;

  useEffect(() => {
    if (!root || !lockScroll) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [root, lockScroll]);

  return root ? createPortal(children, root) : null;
}
