import { useCallback, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { usePopupDismissal } from "../../../components/usePopupDismissal";

/** Fixed portal avoids clipping by report cards; contents stay mounted to retain edits. */
export function ReportPopover({ label, icon, className, children }: { label: string; icon: ReactNode; className: string; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState({ left: 12, top: 12, width: 640, maxHeight: 300, upward: false });
  const trigger = useRef<HTMLButtonElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const id = useId();
  const close = useCallback((restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus({ preventScroll: true });
  }, []);
  usePopupDismissal(open, close, trigger, content);
  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      if (!trigger.current?.getClientRects().length) {
        close();
        return;
      }
      const padding = 12,
        gap = 8;
      const width = Math.min(className === "report-allocation-tools" ? 640 : 280, window.innerWidth - padding * 2);
      const below = window.innerHeight - rect.bottom - gap - padding;
      const above = rect.top - gap - padding;
      const preferredHeight = Math.min(content.current?.scrollHeight ?? 400, 640);
      const upward = below < preferredHeight && above > below;
      const maxHeight = Math.max(40, Math.min(640, upward ? above : below, window.innerHeight - padding * 2));
      const height = Math.min(preferredHeight, maxHeight);
      setPosition({
        width,
        maxHeight,
        upward,
        left: Math.max(padding, Math.min(rect.right - width, window.innerWidth - width - padding)),
        top: Math.max(padding, upward ? rect.top - gap - height : Math.min(rect.bottom + gap, window.innerHeight - height - padding)),
      });
    };
    update();
    const observer = new ResizeObserver(update);
    if (content.current) observer.observe(content.current);
    if (trigger.current) observer.observe(trigger.current);
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, className, close]);
  return (
    <div className={className}>
      <button ref={trigger} type="button" aria-expanded={open} aria-controls={id} data-reports-popup-trigger onClick={() => setOpen((value) => !value)}>
        {icon}
        {label}
      </button>
      {typeof document !== "undefined" &&
        createPortal(
          <div className="tanaw-reports-workspace report-floating-layer" hidden={!open}>
            <div
              ref={content}
              id={id}
              role="region"
              aria-label={label}
              className={className === "report-allocation-tools" ? "report-allocation-popover" : "report-search-popover"}
              data-placement={position.upward ? "top" : "bottom"}
              style={{ position: "fixed", left: position.left, top: position.top, width: position.width, maxHeight: position.maxHeight }}
            >
              {children}
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
