import { createPortal } from "react-dom";
import type { ReactNode } from "react";

/**
 * Renders children into document.body via a React Portal.
 * This ensures that modals escape ALL ancestor containing blocks,
 * stacking contexts, overflow clipping, and transform-based positioning
 * constraints — guaranteeing true viewport-level `position: fixed` behavior.
 */
export function ModalPortal({ children }: { children: ReactNode }) {
  return createPortal(children, document.body);
}
