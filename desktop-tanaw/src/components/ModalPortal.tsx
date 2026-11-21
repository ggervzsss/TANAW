import type { ReactNode } from "react";
import { ModalPortal as DesignModalPortal } from "../ui-kit";

/** The UI-kit ModalPortal; this app's overlays always lock page scroll. */
export function ModalPortal({ children }: { children: ReactNode }) {
  return <DesignModalPortal lockScroll>{children}</DesignModalPortal>;
}
