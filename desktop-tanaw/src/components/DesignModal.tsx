import { useEffect, useRef, type ReactNode } from "react";
import { X } from "lucide-react";
import { ModalPortal } from "./ModalPortal";

export function DesignModal({ title, description, children, footer, onClose }: { title: string; description?: string; children: ReactNode; footer?: ReactNode; onClose: () => void }) {
  const dialog = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const frame = requestAnimationFrame(() => dialog.current?.focus());
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close.current();
      }
      if (event.key !== "Tab") return;
      const nodes = Array.from(
        dialog.current?.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]') ?? [],
      ).filter((node) => node.getClientRects().length > 0);
      const first = nodes[0];
      const last = nodes[nodes.length - 1];
      if (!first) {
        event.preventDefault();
        return;
      }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKey, true);
      previous?.focus();
    };
  }, []);
  return (
    <ModalPortal>
      <div
        className="design-modal-backdrop"
        onMouseDown={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <div ref={dialog} role="dialog" aria-modal="true" aria-label={title} tabIndex={-1} className="design-modal">
          <header>
            <div>
              <h2>{title}</h2>
              {description && <p>{description}</p>}
            </div>
            <button type="button" className="design-icon-button" aria-label={`Close ${title}`} onClick={onClose}>
              <X />
            </button>
          </header>
          <div className="design-modal-content">{children}</div>
          {footer && <footer>{footer}</footer>}
        </div>
      </div>
    </ModalPortal>
  );
}
