/*
 * GENERATED FILE. Do not edit; change design-system/src/components/Select.tsx instead.
 * Update with: node design-system/scripts/sync.mjs
 * Source SHA-256: c4b1b73e6baad47c4ba9353e169f93d2b65c9d49e626c2b91552f4c0641fe2a8
 */
import { Check, ChevronDown, Search } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "../lib/cn";
import { getNextDropdownIndex, shouldShowDropdownSearch, type DropdownKey } from "../lib/dropdown";
import { popIn } from "../lib/motion";
import { useExclusivePopupDismissal } from "../lib/popup-dismissal";
import { ModalPortal } from "./ModalPortal";

/** A plain string, a [value, label] pair, or an object with optional meta text and extra search words. */
export type SelectOption = string | readonly [string, string] | { value: string; label: string; meta?: string; searchText?: string; disabled?: boolean };

type NormalizedOption = { value: string; label: string; meta?: string; searchText?: string; disabled?: boolean };
type MenuPosition = { bottom?: number; left: number; maxHeight: number; top?: number; width: number };

export type SelectProps = {
  value: string;
  onChange: (value: string) => void;
  options: readonly SelectOption[];
  /** A visible label above the control. Either label or ariaLabel is required. */
  label?: string;
  ariaLabel?: string;
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  /** Validation message under the control; also marks it invalid. */
  error?: string;
  /** Marks it invalid without a message (when a Field shows the message). */
  invalid?: boolean;
  /** Ids of elements describing the control. */
  ariaDescribedBy?: string;
  /** Adds a hidden input so the value is posted with a form. */
  name?: string;
  /** Shows a search field once the list reaches searchMinOptions (8 by default). */
  searchable?: boolean;
  searchMinOptions?: number;
  searchPlaceholder?: string;
  /** sm 32px, md 40px. */
  size?: "sm" | "md";
  /** "directory" is the map's glass style; its look comes from the web map stylesheet. */
  variant?: "default" | "directory";
  /**
   * "exclusive": opening this closes other exclusive popups, and an outside click only dismisses
   * (it does not also press what was clicked). "backdrop" (default) uses a transparent overlay.
   */
  dismissal?: "backdrop" | "exclusive";
  /** Tab moves focus back to the trigger instead of onward. */
  restoreFocusOnTab?: boolean;
  /** Lets the app's form-error helper focus this control. */
  focusOnFormError?: boolean;
  id?: string;
  className?: string;
  menuClassName?: string;
};

/** A custom select: a combobox trigger and a listbox menu with keyboard support and optional search. */
export function Select({
  value,
  onChange,
  options,
  label,
  ariaLabel,
  placeholder = "Select an option",
  disabled = false,
  required = false,
  error,
  invalid = false,
  ariaDescribedBy,
  name,
  searchable = false,
  searchMinOptions,
  searchPlaceholder = "Search options...",
  size = "md",
  variant = "default",
  dismissal = "backdrop",
  restoreFocusOnTab = false,
  focusOnFormError = false,
  id,
  className,
  menuClassName,
}: SelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const activeOptionRef = useRef<HTMLButtonElement | null>(null);
  const listboxId = useId();
  const errorId = useId();
  const normalizedOptions = useMemo(() => options.map(normalizeOption), [options]);
  const searchEnabled = shouldShowDropdownSearch(searchable, normalizedOptions.length, searchMinOptions);
  const filteredOptions = useMemo(() => {
    const query = searchEnabled ? search.trim().toLowerCase() : "";
    if (!query) return normalizedOptions;
    return normalizedOptions.filter((option) => `${option.label} ${option.value} ${option.searchText ?? ""}`.toLowerCase().includes(query));
  }, [normalizedOptions, search, searchEnabled]);
  const selectedOption = normalizedOptions.find((option) => option.value === value);
  const safeActiveIndex = Math.min(activeIndex, Math.max(filteredOptions.length - 1, 0));
  const activeOption = filteredOptions[safeActiveIndex];
  const isDirectory = variant === "directory";
  const isInvalid = invalid || Boolean(error);
  const describedBy = [ariaDescribedBy, error ? errorId : undefined].filter(Boolean).join(" ") || undefined;

  const updateMenuPosition = useCallback(() => {
    const button = buttonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const padding = 12;
    const gap = 6;
    const below = window.innerHeight - rect.bottom - padding - gap;
    const above = rect.top - padding - gap;
    const openUpward = below < 180 && above > below;
    const maxHeight = Math.min(searchEnabled ? 320 : 280, Math.max(openUpward ? above : below, 112));
    const width = Math.min(Math.max(rect.width, 176), window.innerWidth - padding * 2);
    const left = Math.max(padding, Math.min(rect.left, window.innerWidth - width - padding));
    setMenuPosition({ ...(openUpward ? { bottom: window.innerHeight - rect.top + gap } : { top: rect.bottom + gap }), left, maxHeight, width });
  }, [searchEnabled]);

  const closeMenu = useCallback((restoreFocus = false) => {
    setIsOpen(false);
    setSearch("");
    setMenuPosition(null);
    if (restoreFocus) window.setTimeout(() => buttonRef.current?.focus(), 0);
  }, []);
  useExclusivePopupDismissal(dismissal === "exclusive" && isOpen, closeMenu, buttonRef, menuRef);

  const openMenu = useCallback(() => {
    if (disabled) return;
    setActiveIndex(Math.max(normalizedOptions.findIndex((option) => option.value === value), 0));
    updateMenuPosition();
    setIsOpen(true);
  }, [disabled, normalizedOptions, updateMenuPosition, value]);

  const selectOption = useCallback(
    (option: NormalizedOption) => {
      if (option.disabled) return;
      onChange(option.value);
      closeMenu(true);
    },
    [closeMenu, onChange],
  );

  useEffect(() => {
    if (!isOpen) return undefined;
    updateMenuPosition();
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [isOpen, updateMenuPosition]);

  useEffect(() => {
    if (isOpen) activeOptionRef.current?.scrollIntoView({ block: "nearest" });
  }, [isOpen, safeActiveIndex]);

  useEffect(() => {
    if (isOpen && !searchEnabled) menuRef.current?.focus();
  }, [isOpen, searchEnabled]);

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!isOpen && ["ArrowDown", "ArrowUp", "Enter", " "].includes(event.key)) {
      event.preventDefault();
      openMenu();
      return;
    }
    if (!isOpen) return;
    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu(true);
      return;
    }
    if (event.key === "Tab") {
      if (restoreFocusOnTab) buttonRef.current?.focus({ preventScroll: true });
      closeMenu();
      return;
    }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      setActiveIndex((current) => getNextDropdownIndex(current, filteredOptions.length, event.key as DropdownKey));
      return;
    }
    if (event.key === "Enter" || (!searchEnabled && event.key === " ")) {
      event.preventDefault();
      if (activeOption) selectOption(activeOption);
    }
  };

  const triggerClassName = isDirectory
    ? "tanaw-directory-select-trigger flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border px-3.5 py-2.5 text-left transition focus:outline-none"
    : cn(
        "tanaw-select-trigger flex w-full items-center justify-between gap-2 border border-(--tanaw-control-border) bg-(--tanaw-control-bg) text-left font-semibold text-(--tanaw-text) shadow-tanaw-resting transition outline-none hover:border-(--tanaw-control-border-hover) focus:border-(--tanaw-accent-ink) focus:ring-4 focus:ring-emerald-600/15 disabled:cursor-not-allowed disabled:bg-(--tanaw-control-disabled) disabled:opacity-60",
        size === "sm" ? "min-h-8 rounded-tanaw-sm px-2 py-1.5 text-xs" : "min-h-10 rounded-tanaw-md px-3 py-2 text-sm",
        isInvalid && "border-(--tanaw-error)",
      );

  return (
    <div data-field-name={name} className={cn("relative min-w-0", className)}>
      {label && (
        <span className={cn("mb-2 block text-xs font-bold tracking-label uppercase", isDirectory ? "tanaw-directory-select-label" : "text-(--tanaw-label)")}>{label}</span>
      )}
      {name && <input type="hidden" name={name} value={value} />}
      <button
        ref={buttonRef}
        id={id}
        type="button"
        disabled={disabled}
        role="combobox"
        aria-activedescendant={isOpen && activeOption ? `${listboxId}-${safeActiveIndex}` : undefined}
        aria-controls={listboxId}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-invalid={isInvalid || undefined}
        aria-label={ariaLabel ?? label}
        aria-required={required || undefined}
        aria-describedby={describedBy}
        data-form-error-focus={focusOnFormError ? "" : undefined}
        data-exclusive-popup-trigger={dismissal === "exclusive" ? "" : undefined}
        onClick={() => (isOpen ? closeMenu() : openMenu())}
        onKeyDown={handleKeyDown}
        className={triggerClassName}
      >
        <span className={cn("truncate", isDirectory ? "tanaw-directory-select-value text-[12px] font-semibold" : !selectedOption && "font-medium text-(--tanaw-text-placeholder)")}>
          {selectedOption?.label ?? placeholder}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {selectedOption?.meta && (
            <span className={isDirectory ? "tanaw-directory-select-meta rounded-md px-2 py-0.5 font-mono text-[10px] font-bold" : "text-xs font-semibold text-(--tanaw-text-muted)"}>{selectedOption.meta}</span>
          )}
          <ChevronDown
            size={size === "sm" ? 14 : 16}
            aria-hidden="true"
            className={cn("shrink-0 transition-transform duration-200", isDirectory ? "tanaw-directory-select-chevron" : "text-(--tanaw-text-muted)", isOpen && "rotate-180")}
          />
        </span>
      </button>
      {error && (
        <p id={errorId} role="alert" className="mt-1.5 text-xs font-semibold text-(--tanaw-error)">
          {error}
        </p>
      )}

      <AnimatePresence>
        {isOpen && menuPosition && (
          <ModalPortal>
            {dismissal === "backdrop" && <div className="fixed inset-0 z-1500" onPointerDown={() => closeMenu()} />}
            <motion.div
              ref={menuRef}
              tabIndex={-1}
              {...popIn}
              style={menuPosition}
              onKeyDown={handleKeyDown}
              onPointerDown={(event) => event.stopPropagation()}
              className={cn(
                "tanaw-dropdown-menu fixed z-1501 flex flex-col overflow-hidden rounded-tanaw-md shadow-tanaw-raised outline-none",
                isDirectory ? "tanaw-directory-select-menu border backdrop-blur-md" : "border border-(--tanaw-border-soft) bg-(--tanaw-surface-raised)",
                menuClassName,
              )}
            >
              {searchEnabled && (
                <div className={cn("shrink-0 border-b p-2", isDirectory ? "tanaw-directory-select-search-shell" : "border-(--tanaw-border-soft)")}>
                  <label className={cn("relative flex items-center rounded-tanaw-sm border", isDirectory ? "tanaw-directory-select-search" : "border-(--tanaw-border-soft) bg-(--tanaw-surface-inset)")}>
                    <Search size={14} aria-hidden="true" className={cn("absolute left-3", isDirectory ? "tanaw-directory-select-chevron" : "text-(--tanaw-text-muted)")} />
                    <input
                      autoFocus
                      type="search"
                      value={search}
                      role="searchbox"
                      aria-controls={listboxId}
                      aria-label={searchPlaceholder}
                      placeholder={searchPlaceholder}
                      onChange={(event) => {
                        setSearch(event.target.value);
                        setActiveIndex(0);
                      }}
                      onKeyDown={handleKeyDown}
                      className={cn(
                        "min-w-0 flex-1 bg-transparent py-2 pr-3 pl-9 text-sm outline-none placeholder:text-(--tanaw-text-placeholder)",
                        isDirectory ? "tanaw-directory-select-value text-xs font-medium" : "text-(--tanaw-text)",
                      )}
                    />
                  </label>
                </div>
              )}
              <div id={listboxId} role="listbox" aria-label={ariaLabel ?? label ?? "Options"} className="min-h-0 flex-1 overflow-y-auto p-1.5">
                {filteredOptions.map((option, index) => {
                  const selected = option.value === value;
                  const active = index === safeActiveIndex;
                  return (
                    <button
                      key={option.value}
                      id={`${listboxId}-${index}`}
                      ref={active ? activeOptionRef : null}
                      type="button"
                      role="option"
                      aria-selected={selected}
                      aria-disabled={option.disabled || undefined}
                      data-active={active}
                      onClick={() => selectOption(option)}
                      onMouseEnter={() => setActiveIndex(index)}
                      className={cn(
                        "flex w-full items-center justify-between gap-3 rounded-tanaw-sm px-3 py-2 text-left text-sm transition-colors",
                        option.disabled && "cursor-not-allowed opacity-50",
                        isDirectory
                          ? active || selected
                            ? "tanaw-directory-select-option--active font-semibold ring-1"
                            : "tanaw-directory-select-option"
                          : active
                            ? "bg-(--tanaw-interactive-selected-bg) font-semibold text-(--tanaw-accent-ink)"
                            : selected
                              ? "font-semibold text-(--tanaw-accent-ink)"
                              : "text-(--tanaw-text) hover:bg-(--tanaw-control-hover)",
                      )}
                    >
                      <span className={cn("truncate", isDirectory && "text-xs font-medium")}>{option.label}</span>
                      <span className="flex shrink-0 items-center gap-2">
                        {option.meta && (
                          <span className={isDirectory ? "tanaw-directory-select-meta rounded-md px-2 py-0.5 font-mono text-[10px] font-bold" : "text-xs text-(--tanaw-text-muted)"}>{option.meta}</span>
                        )}
                        {selected && <Check size={15} aria-hidden="true" className="text-(--tanaw-accent-ink)" />}
                      </span>
                    </button>
                  );
                })}
                {filteredOptions.length === 0 && <div className="px-3 py-5 text-center text-xs font-semibold text-(--tanaw-text-muted)">No matching options</div>}
              </div>
            </motion.div>
          </ModalPortal>
        )}
      </AnimatePresence>
    </div>
  );
}

function normalizeOption(option: SelectOption): NormalizedOption {
  if (typeof option === "string") return { value: option, label: option };
  if (Array.isArray(option)) return { value: option[0], label: option[1] };
  return option as NormalizedOption;
}
