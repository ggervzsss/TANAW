import { SlidersHorizontal, X } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Button, ModalPortal, cn, useDialogFocus } from "@/shared/ui-kit";
import { PHONE_MEDIA_QUERY } from "../hooks/useMediaQuery";
import "./phoneFilterSheet.css";

type PhoneFilterSheetProps = {
  /** How many filters differ from their defaults, shown on the Filters button. */
  activeCount: number;
  /** The filter controls. From 48rem up they sit inline in the parent's grid, exactly as before. */
  children: ReactNode;
  /** Resets every filter; offered in the sheet while any is active. */
  onClear?: () => void;
  /** What the filters narrow, for the sheet's caption ("enterprises", "requests"). */
  noun: string;
  /** The live result count line, repeated at the foot of the sheet so the effect of a choice shows. */
  resultLabel?: string;
  className?: string;
};

/**
 * On phones the filters fold behind a "Filters" button next to the search and open as a bottom sheet;
 * from 48rem up the same controls stay inline (their wrapper is `display: contents`), so desktop and
 * tablet layouts are unchanged. While the sheet is open its controls render in a portal above the
 * page and topbar, and nowhere else, so no control or text is ever on the page twice. The sheet keeps
 * focus inside, closes on Escape, the scrim or Done, and returns focus to the button.
 *
 * Kit candidate: a shared phone filter sheet. It lives here until the UI kit offers one.
 */
export function PhoneFilterSheet({ activeCount, children, onClear, noun, resultLabel, className }: PhoneFilterSheetProps) {
  const [open, setOpen] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelId = useId();
  const titleId = useId();
  const close = useCallback(() => setOpen(false), []);
  useDialogFocus(panelRef, close, open);

  // Leaving phone width (a rotated tablet, a resized window) puts the controls back inline.
  useEffect(() => {
    if (!open || typeof window.matchMedia !== "function") return undefined;
    const query = window.matchMedia(PHONE_MEDIA_QUERY);
    const onChange = () => {
      if (!query.matches) setOpen(false);
    };
    query.addEventListener("change", onChange);
    return () => query.removeEventListener("change", onChange);
  }, [open]);

  return (
    <>
      <button type="button" className={cn("tanaw-phone-filters__toggle", className)} aria-haspopup="dialog" aria-expanded={open} aria-controls={open ? panelId : undefined} onClick={() => setOpen(true)}>
        <SlidersHorizontal size={16} aria-hidden="true" />
        Filters
        {activeCount > 0 && (
          <span className="tanaw-phone-filters__count">
            <span className="sr-only">, </span>
            {activeCount}
            <span className="sr-only"> on</span>
          </span>
        )}
      </button>
      {open ? (
        <ModalPortal lockScroll>
          <div aria-hidden="true" className="tanaw-phone-filters__scrim tanaw-dialog-backdrop" onClick={close} />
          <div ref={panelRef} id={panelId} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className="tanaw-phone-filters__sheet">
            <div className="tanaw-phone-filters__head">
              <span aria-hidden="true" className="tanaw-phone-filters__grip" />
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 id={titleId} className="m-0 text-lg font-[650] text-(--tanaw-text)">
                    Filters
                  </h2>
                  <p className="mt-0.5 text-[13px] text-(--tanaw-text-secondary)">Choose which {noun} to show.</p>
                </div>
                <button type="button" aria-label="Close filters" onClick={close} className="tanaw-phone-filters__close">
                  <X size={18} aria-hidden="true" />
                </button>
              </div>
            </div>
            <div className="tanaw-phone-filters__body">{children}</div>
            <div className="tanaw-phone-filters__foot">
              {resultLabel && <p className="min-w-0 flex-1 text-sm font-semibold text-(--tanaw-text) tabular-nums">{resultLabel}</p>}
              {onClear && activeCount > 0 && (
                <Button variant="ghost" onClick={onClear} className="min-h-11">
                  Clear
                </Button>
              )}
              <Button onClick={close} className="min-h-11">
                Done
              </Button>
            </div>
          </div>
        </ModalPortal>
      ) : (
        <div className="tanaw-phone-filters__inline">{children}</div>
      )}
    </>
  );
}
