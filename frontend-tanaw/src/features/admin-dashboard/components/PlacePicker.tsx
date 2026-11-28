import { Building2, Check, ChevronDown, Landmark, Search } from "lucide-react";
import { LayoutGroup, motion, useReducedMotion } from "motion/react";
import { useCallback, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { useExclusivePopupDismissal } from "@/shared/ui-kit";
import { filterPlaces, type PlaceOption } from "../model/places";

/** The highlight's glide between options: the app's 150–260ms ease-out. */
const GLIDE = { type: "tween", duration: 0.2, ease: [0.2, 0.8, 0.2, 1] } as const;

type PlacePickerProps = {
  places: readonly PlaceOption[];
  /** The chosen enterprise id, or null for all of San Pedro. */
  value: string | null;
  onChange: (enterpriseId: string | null) => void;
  monitoredCount: number;
};

/** Pill trigger and searchable popover choosing "All of San Pedro" or one enterprise. */
export function PlacePicker({ places, value, onChange, monitoredCount }: PlacePickerProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const reduceMotion = useReducedMotion();
  const optionId = (index: number) => `${listId}-option-${index}`;
  const selected = places.find((place) => place.enterpriseId === value) ?? null;
  const matches = useMemo(() => filterPlaces(places, query), [places, query]);
  // Option 0 is "All of San Pedro" while the search is empty; it stays out of filtered results.
  const options = useMemo<(PlaceOption | null)[]>(() => (query.trim() ? matches : [null, ...matches]), [matches, query]);

  const close = useCallback((restoreFocus?: boolean) => {
    setOpen(false);
    if (restoreFocus) triggerRef.current?.focus();
  }, []);
  useExclusivePopupDismissal(open, close, triggerRef, panelRef);

  const choose = (option: PlaceOption | null) => {
    onChange(option?.enterpriseId ?? null);
    close(true);
  };

  const onSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (options.length === 0) return;
      setActive((index) => (index + (event.key === "ArrowDown" ? 1 : -1) + options.length) % options.length);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const option = options[active];
      if (option !== undefined) choose(option);
    }
  };

  return (
    <div className="tanaw-place-picker relative">
      <button
        ref={triggerRef}
        type="button"
        className="tanaw-dashboard-pill"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={`Place: ${selected?.name ?? "All of San Pedro"}. Choose where to show peak occupancy`}
        data-exclusive-popup-trigger=""
        onClick={() => {
          if (open) return close();
          setQuery("");
          setActive(Math.max(0, value === null ? 0 : places.findIndex((place) => place.enterpriseId === value) + 1));
          setOpen(true);
        }}
      >
        {selected ? (
          <Building2 size={15} className="shrink-0 text-(--tanaw-accent-ink)" aria-hidden="true" />
        ) : (
          <Landmark size={15} className="shrink-0 text-(--tanaw-accent-ink)" aria-hidden="true" />
        )}
        <span className="min-w-0 truncate">{selected?.name ?? "All of San Pedro"}</span>
        <ChevronDown size={15} className="shrink-0" aria-hidden="true" />
      </button>
      {/* On phones the picker rises as a bottom sheet over a scrim (dashboard.css); a tap on the scrim closes it. */}
      {open && <div aria-hidden="true" className="tanaw-dashboard-popover-scrim tanaw-dialog-backdrop" />}
      {open && (
        <div ref={panelRef} role="dialog" aria-label="Choose where to show peak occupancy" className="tanaw-dashboard-popover">
          <label className="tanaw-dashboard-search-field relative block">
            <span className="sr-only">Search enterprise or barangay</span>
            <span className="pointer-events-none absolute top-1/2 left-3 flex -translate-y-1/2">
              <Search size={16} className="tanaw-dashboard-search__icon" aria-hidden="true" />
            </span>
            <input
              // The search is what the popover is for, so it takes focus when it opens.
              autoFocus
              type="search"
              role="combobox"
              aria-expanded="true"
              aria-controls={listId}
              aria-autocomplete="list"
              aria-activedescendant={options.length > 0 ? optionId(Math.min(active, options.length - 1)) : undefined}
              value={query}
              placeholder="Search enterprise or barangay"
              onChange={(event) => {
                setQuery(event.target.value);
                setActive(0);
              }}
              onKeyDown={onSearchKeyDown}
              className="tanaw-dashboard-search"
            />
          </label>
          <LayoutGroup id={listId}>
            <ul id={listId} role="listbox" aria-label="Places" className="mt-2.5 max-h-72 list-none overflow-y-auto overscroll-contain p-0">
              {options.length === 0 && (
                <li role="presentation" className="px-3 py-3 text-sm text-(--tanaw-text-secondary)">
                  No enterprise or barangay matches “{query.trim()}”. Check the spelling or clear the search.
                </li>
              )}
              {options.map((option, index) => {
                const isSelected = option === null ? value === null : option.enterpriseId === value;
                const isActive = index === Math.min(active, options.length - 1);
                return [
                  <li
                    key={option?.enterpriseId ?? "all"}
                    id={optionId(index)}
                    role="option"
                    aria-selected={isSelected}
                    onPointerDown={(event) => event.preventDefault()}
                    onClick={() => choose(option)}
                    onMouseMove={() => setActive(index)}
                    className="tanaw-dashboard-option"
                  >
                    {isActive && <motion.span layoutId="place-picker-highlight" aria-hidden="true" className="tanaw-dashboard-option__glide" transition={reduceMotion ? { duration: 0 } : GLIDE} />}
                    <span className="min-w-0 flex-1">
                      <span className={`tanaw-dashboard-option__name block truncate text-sm text-(--tanaw-text) ${option === null ? "font-[650]" : "font-semibold"}`}>{option?.name ?? "All of San Pedro"}</span>
                      <span className="mt-0.5 block truncate text-[13px] text-(--tanaw-text-muted)">
                        {option ? `Barangay ${option.barangay}` : `All ${monitoredCount} monitored ${monitoredCount === 1 ? "enterprise" : "enterprises"} combined`}
                      </span>
                    </span>
                    {isSelected && <Check size={16} className="tanaw-dashboard-option__check shrink-0 text-(--tanaw-accent-ink)" aria-hidden="true" />}
                  </li>,
                  option === null && options.length > 1 ? <li key="all-rule" role="presentation" aria-hidden="true" className="mx-3 my-1 h-px bg-(--tanaw-border-soft)" /> : null,
                ];
              })}
            </ul>
          </LayoutGroup>
        </div>
      )}
    </div>
  );
}
