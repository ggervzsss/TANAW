import type { ReactNode } from "react";
import { Dialog } from "../../../design-system";

type ModalFrameProps = {
  title: string;
  children: ReactNode;
  onClose: () => void;
  /** Tailwind max-width class for the panel, max-w-3xl by default. */
  maxWidthClassName?: string;
  eyebrow?: ReactNode;
};

/** The design-system Dialog as this app's detail modal. */
export function ModalFrame({ title, children, onClose, maxWidthClassName = "max-w-3xl", eyebrow }: ModalFrameProps) {
  return (
    <Dialog title={title} eyebrow={eyebrow} onClose={onClose} closeLabel="Close modal" accent="thread" size="lg" className={maxWidthClassName}>
      {children}
    </Dialog>
  );
}
