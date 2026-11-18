import type { ReactNode } from "react";
import { ModalPortal as DesignModalPortal } from "../design-system";

/** The design-system ModalPortal; this app's overlays always lock page scroll. */
export function ModalPortal({ children }: { children: ReactNode }) {
  return <DesignModalPortal lockScroll>{children}</DesignModalPortal>;
}
