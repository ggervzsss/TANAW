import { Check, ChevronDown, Search } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { cn } from "../lib/cn";
import { getNextDropdownIndex, shouldShowDropdownSearch, type DropdownKey } from "../lib/dropdown";
import { useIsPhone } from "../lib/media";
import { easeOut, popIn, sheetIn } from "../lib/motion";
import { useExclusivePopupDismissal } from "../lib/popup-dismissal";
import { ModalPortal } from "./ModalPortal";

/**
 * A plain string, a [value, label] pair, or an object. `meta` is a short note at the option's right
 * (a code, a count) that the closed field also shows; `description` is a longer explanation shown
 * under the label in the open menu only, wrapping onto a second line when it must.
 */
export type SelectOption = string | readonly [string, string] | { value: string; label: string; meta?: string; description?: string; searchText?: string; disabled?: boolean };

type NormalizedOption = { value: string; label: string; meta?: string; description?: string; searchText?: string; disabled?: boolean };
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

/**
 * A custom select: a combobox trigger and a listbox menu with keyboard support and optional search.
 * On phones the menu is a bottom sheet over a scrim, titled with the field's label, with 48px rows.
 */
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
  const generatedErrorId = useId();
  // Forms address a named field's message as `${name}-description`.
  const errorId = name ? `${name}-description` : generatedErrorId;
  const normalizedOptions = useMemo(() => options.map(normalizeOption), [options]);
  const hasDescriptions = normalizedOptions.some((option) => Boolean(option.description));
  const searchEnabled = shouldShowDropdownSearch(searchable, normalizedOptions.length, searchMinOptions);
  const filteredOptions = useMemo(() => {
    const query = searchEnabled ? search.trim().toLowerCase() : "";
    if (!query) return normalizedOptions;
    return normalizedOptions.filter((option) => `${option.label} ${option.value} ${option.description ?? ""} ${option.searchText ?? ""}`.toLowerCase().includes(query));
  }, [normalizedOptions, search, searchEnabled]);
  const selectedOption = normalizedOptions.find((option) => option.value === value);
  const safeActiveIndex = Math.min(activeIndex, Math.max(filteredOptions.length - 1, 0));
  const activeOption = filteredOptions[safeActiveIndex];
  const isDirectory = variant === "directory";
  // The map's glass directory keeps its own dropdown; every other select is a sheet on phones.
  const asSheet = useIsPhone() && !isDirectory;
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
    const width = Math.min(Math.max(rect.width, 176, hasDescriptions ? 304 : 0), window.innerWidth - padding * 2);
    const left = Math.max(padding, Math.min(rect.left, window.innerWidth - width - padding));
    setMenuPosition({ ...(openUpward ? { bottom: window.innerHeight - rect.top + gap } : { top: rect.bottom + gap }), left, maxHeight, width });
  }, [hasDescriptions, searchEnabled]);

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
    // A phone sheet is pinned to the bottom edge by its classes; a dropdown follows its trigger.
    if (asSheet) setMenuPosition({ bottom: 0, left: 0, maxHeight: 0, width: 0 });
    else updateMenuPosition();
    setIsOpen(true);
  }, [asSheet, disabled, normalizedOptions, updateMenuPosition, value]);

  const selectOption = useCallback(
    (option: NormalizedOption) => {
      if (option.disabled) return;
      onChange(option.value);
      closeMenu(true);
    },
    [closeMenu, onChange],
  );

  useEffect(() => {
    if (!isOpen || asSheet) return undefined;
    updateMenuPosition();
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [asSheet, isOpen, updateMenuPosition]);

  useEffect(() => {
    if (isOpen) activeOptionRef.current?.scrollIntoView({ block: "nearest" });
  }, [isOpen, safeActiveIndex]);

  useEffect(() => {
    // A sheet does not open the on-screen keyboard on its own; the search field is a tap away.
    if (isOpen && (!searchEnabled || asSheet)) menuRef.current?.focus();
  }, [asSheet, isOpen, searchEnabled]);

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
    ? "tanaw-directory-select-trigger flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border px-3.5 py-2.5 text-left transition duration-150 ease-tanaw-out focus:outline-none"
    : cn(
        "tanaw-select-trigger flex w-full items-center justify-between gap-2 border border-(--tanaw-control-border) bg-(--tanaw-control-bg) text-left font-medium text-(--tanaw-text) transition-[background-color,border-color,box-shadow,color,scale] duration-200 ease-tanaw-out outline-none hover:border-(--tanaw-control-border-hover) hover:bg-(--tanaw-control-bg-hover) focus-visible:border-(--tanaw-accent-ink) focus-visible:shadow-(--tanaw-field-ring) active:scale-[0.99] aria-expanded:border-(--tanaw-accent-ink) aria-expanded:bg-(--tanaw-control-bg-focus) aria-expanded:shadow-(--tanaw-field-ring) disabled:cursor-not-allowed disabled:border-transparent disabled:bg-(--tanaw-control-disabled) disabled:opacity-60 motion-reduce:transition-none motion-reduce:active:scale-100",
        size === "sm" ? "min-h-8 rounded-tanaw-sm px-2.5 py-1.5 text-xs pointer-coarse:min-h-11" : "min-h-11 rounded-tanaw-md px-3.5 py-2 text-sm",
        isInvalid && "border-(--tanaw-error)",
      );

  return (
    <div data-field-name={name} className={cn("relative min-w-0", className)}>
      {label && (
        <span className={cn("mb-2 block", isDirectory ? "tanaw-directory-select-label text-xs font-bold tracking-label uppercase" : "text-[0.8125rem] font-semibold text-(--tanaw-text-secondary)")}>{label}</span>
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
        <span className={cn("min-w-0 flex-1 truncate", isDirectory ? "tanaw-directory-select-value text-[13px] font-semibold" : !selectedOption && "font-normal text-(--tanaw-text-placeholder)")}>
          {selectedOption?.label ?? placeholder}
        </span>
        <span className="flex max-w-[48%] min-w-0 shrink-0 items-center gap-2">
          {selectedOption?.meta && (
            <span className={cn("min-w-0 truncate", isDirectory ? "tanaw-directory-select-meta rounded-md px-2 py-0.5 font-mono text-[11px] font-bold" : "text-xs font-semibold text-(--tanaw-text-muted)")}>{selectedOption.meta}</span>
          )}
          <ChevronDown
            size={size === "sm" ? 14 : 16}
            aria-hidden="true"
            className={cn("tanaw-select-chevron shrink-0", isDirectory ? "tanaw-directory-select-chevron" : "text-(--tanaw-text-muted)", isOpen && "rotate-180")}
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
            {asSheet ? (
              <motion.div
                aria-hidden="true"
                className="tanaw-dialog-backdrop fixed inset-0 z-1500"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2, ease: easeOut }}
                onPointerDown={() => closeMenu()}
              />
            ) : (
              dismissal === "backdrop" && <div className="fixed inset-0 z-1500" onPointerDown={() => closeMenu()} />
            )}
            <motion.div
              ref={menuRef}
              tabIndex={-1}
              {...(asSheet ? sheetIn : popIn)}
              style={asSheet ? undefined : { ...menuPosition, transformOrigin: menuPosition.bottom === undefined ? "top center" : "bottom center" }}
              onKeyDown={handleKeyDown}
              onPointerDown={(event) => event.stopPropagation()}
              data-sheet={asSheet || undefined}
              className={cn(
                "tanaw-dropdown-menu fixed z-1501 flex flex-col overflow-hidden shadow-tanaw-dialog outline-none",
                asSheet ? "tanaw-dialog inset-x-0 bottom-0 max-h-[72dvh] rounded-t-3xl border-t border-(--tanaw-border-soft) bg-(--tanaw-surface-raised) pb-[env(safe-area-inset-bottom)]" : "rounded-tanaw-lg",
                !asSheet && (isDirectory ? "tanaw-directory-select-menu border backdrop-blur-md" : "border border-(--tanaw-border-soft) bg-(--tanaw-surface-raised)"),
                menuClassName,
              )}
            >
              {asSheet && (label ?? ariaLabel) && (
                <p aria-hidden="true" className="shrink-0 px-5 pt-5 pb-2 text-[0.9375rem] font-semibold text-(--tanaw-text)">
                  {label ?? ariaLabel}
                </p>
              )}
              {searchEnabled && (
                <div className={cn("shrink-0 border-b p-2", isDirectory ? "tanaw-directory-select-search-shell" : "border-(--tanaw-border-soft)")}>
                  <label
                    className={cn(
                      "tanaw-field relative flex items-center rounded-tanaw-sm border",
                      isDirectory
                        ? "tanaw-directory-select-search"
                        : "border-(--tanaw-control-border) bg-(--tanaw-control-bg) transition-[background-color,border-color,box-shadow] duration-200 ease-tanaw-out focus-within:border-(--tanaw-accent-ink) focus-within:bg-(--tanaw-control-bg-focus) focus-within:shadow-(--tanaw-field-ring)",
                    )}
                  >
                    <Search size={14} aria-hidden="true" className={cn("absolute left-3", isDirectory ? "tanaw-directory-select-chevron" : "tanaw-field-icon text-(--tanaw-text-muted)")} />
                    <input
                      autoFocus={!asSheet}
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
                      className={cn(
                        "min-w-0 flex-1 bg-transparent py-2 pr-3 pl-9 text-sm outline-none placeholder:text-(--tanaw-text-placeholder)",
                        isDirectory ? "tanaw-directory-select-value text-xs font-medium" : "text-(--tanaw-text)",
                      )}
                    />
                  </label>
                </div>
              )}
              <div id={listboxId} role="listbox" aria-label={ariaLabel ?? label ?? "Options"} className={cn("min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5", asSheet && "px-3 pb-3")}>
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
                        "relative isolate flex w-full items-center justify-between gap-3 rounded-tanaw-sm px-3 py-2.5 text-left text-sm transition-colors duration-150 pointer-coarse:min-h-11",
                        asSheet && "min-h-12 text-[0.9375rem]",
                        option.disabled && "cursor-not-allowed opacity-50",
                        isDirectory
                          ? active || selected
                            ? "tanaw-directory-select-option--active font-semibold ring-1"
                            : "tanaw-directory-select-option"
                          : selected
                            ? "font-semibold text-(--tanaw-accent-ink)"
                            : active
                              ? "text-(--tanaw-text)"
                              : "text-(--tanaw-text-secondary)",
                      )}
                    >
                      {/* The highlight glides to the option under the pointer or the arrow keys instead of jumping. */}
                      {!isDirectory && active && (
                        <motion.span
                          aria-hidden="true"
                          layoutId={`${listboxId}-active`}
                          className="absolute inset-0 -z-10 rounded-tanaw-sm bg-(--tanaw-interactive-selected-bg)"
                          transition={{ duration: 0.18, ease: easeOut }}
                        />
                      )}
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className={cn("truncate", isDirectory && "text-xs font-medium")}>{option.label}</span>
                        {option.description && <span className="line-clamp-2 text-xs leading-snug font-normal whitespace-normal text-(--tanaw-text-muted)">{option.description}</span>}
                      </span>
                      <span className="flex max-w-[48%] min-w-0 shrink-0 items-center gap-2">
                        {option.meta && (
                          <span className={cn("min-w-0 truncate", isDirectory ? "tanaw-directory-select-meta rounded-md px-2 py-0.5 font-mono text-[11px] font-bold" : "text-xs text-(--tanaw-text-muted)")}>{option.meta}</span>
                        )}
                        {selected && <Check size={15} aria-hidden="true" className="tanaw-pop-in text-(--tanaw-accent-ink)" />}
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
