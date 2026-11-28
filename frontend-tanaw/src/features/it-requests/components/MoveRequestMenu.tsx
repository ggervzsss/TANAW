import { Check, ChevronDown } from "lucide-react";
import { useCallback, useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import type { RequestGroup } from "@/shared/services/requests";
import { Button, cn, getNextDropdownIndex, useExclusivePopupDismissal, type DropdownKey } from "@/shared/ui-kit";

type MoveRequestMenuProps = {
  options: Array<{ group: RequestGroup; selected: boolean }>;
  disabled?: boolean;
  loading?: boolean;
  onMove: (group: RequestGroup) => void;
};

/** "Move to another type": a button that opens a short menu of request types. */
export function MoveRequestMenu({ options, disabled = false, loading = false, onMove }: MoveRequestMenuProps) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const menuId = useId();

  const close = useCallback((restoreFocus = false) => {
    setOpen(false);
    if (restoreFocus) window.setTimeout(() => buttonRef.current?.focus(), 0);
  }, []);
  useExclusivePopupDismissal(open, close, buttonRef, menuRef);

  useEffect(() => {
    if (open) itemRefs.current[active]?.focus();
  }, [active, open]);

  const openMenu = () => {
    setActive(
      Math.max(
        options.findIndex((option) => option.selected),
        0,
      ),
    );
    setOpen(true);
  };

  const pick = (group: RequestGroup, selected: boolean) => {
    close(true);
    if (!selected) onMove(group);
  };

  const handleMenuKey = (event: KeyboardEvent<HTMLDivElement>) => {
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      setActive((current) => getNextDropdownIndex(current, options.length, event.key as DropdownKey));
    } else if (event.key === "Tab") {
      close();
    }
  };

  return (
    <div className="relative max-sm:basis-full">
      <Button
        ref={buttonRef}
        variant="secondary"
        size="lg"
        className="h-11 text-sm max-sm:w-full"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        data-exclusive-popup-trigger=""
        disabled={disabled}
        loading={loading}
        trailingIcon={<ChevronDown size={16} aria-hidden="true" className={cn("transition-transform duration-150 motion-reduce:transition-none", open && "rotate-180 text-(--tanaw-accent-ink)")} />}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={(event) => {
          if (!open && (event.key === "ArrowDown" || event.key === "ArrowUp")) {
            event.preventDefault();
            openMenu();
          }
        }}
      >
        Move to another type
      </Button>
      {open && (
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label="Move to another type"
          onKeyDown={handleMenuKey}
          className="it-requests__menu rounded-tanaw-md shadow-tanaw-raised absolute top-[calc(100%+6px)] left-0 z-30 min-w-68 max-sm:right-0 max-sm:min-w-0 border border-(--tanaw-border-soft) bg-(--tanaw-surface-raised) p-1.5"
        >
          {options.map((option, index) => (
            <button
              key={option.group}
              ref={(element) => {
                itemRefs.current[index] = element;
              }}
              type="button"
              role="menuitemradio"
              aria-checked={option.selected}
              tabIndex={index === active ? 0 : -1}
              onClick={() => pick(option.group, option.selected)}
              className={cn(
                "rounded-tanaw-sm flex min-h-10 w-full cursor-pointer pointer-coarse:min-h-11 items-center justify-between gap-3.5 px-3 text-left text-sm whitespace-nowrap text-(--tanaw-text) transition-colors duration-150 hover:bg-(--tanaw-control-hover) focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-(--tanaw-focus-ring)",
                option.selected && "bg-(--tanaw-selected-bg) font-semibold text-(--tanaw-accent-ink)",
              )}
            >
              <span>{option.group}</span>
              <Check size={16} aria-hidden="true" className={cn("shrink-0 text-(--tanaw-accent-ink)", !option.selected && "opacity-0")} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
