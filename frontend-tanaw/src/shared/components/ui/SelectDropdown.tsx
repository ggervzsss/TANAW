import { Check, ChevronDown, Search } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type KeyboardEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ModalPortal } from "./ModalPortal";
import { getNextDropdownIndex } from "./dropdownKeyboard";
import { shouldShowDropdownSearch } from "./dropdownSearch";

export type SelectDropdownOption = string | readonly [string, string] | { value: string; label: string; meta?: string; searchText?: string };

type SelectDropdownProps = {
  value: string;
  onChange: (value: string) => void;
  options: readonly SelectDropdownOption[];
  ariaLabel?: string;
  className?: string;
  disabled?: boolean;
  error?: string;
  label?: string;
  name?: string;
  placeholder?: string;
  required?: boolean;
  searchable?: boolean;
  searchPlaceholder?: string;
  variant?: "default" | "directory";
};

type NormalizedOption = { value: string; label: string; meta?: string; searchText?: string };

type MenuPosition = {
  bottom?: number;
  left: number;
  maxHeight: number;
  top?: number;
  width: number;
};

export function SelectDropdown({
  value,
  onChange,
  options,
  ariaLabel,
  className = "",
  disabled = false,
  error,
  label,
  name,
  placeholder = "Select an option",
  required = false,
  searchable = false,
  searchPlaceholder = "Search options...",
  variant = "default",
}: SelectDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const activeOptionRef = useRef<HTMLButtonElement | null>(null);
  const listboxId = useId();
  const normalizedOptions = useMemo(() => options.map(normalizeOption), [options]);
  const searchEnabled = shouldShowDropdownSearch(searchable, normalizedOptions.length);
  const filteredOptions = useMemo(() => {
    if (!searchEnabled) return normalizedOptions;
    const normalizedSearch = search.trim().toLowerCase();
    if (!normalizedSearch) return normalizedOptions;
    return normalizedOptions.filter((option) => `${option.label} ${option.value} ${option.searchText ?? ""}`.toLowerCase().includes(normalizedSearch));
  }, [normalizedOptions, search, searchEnabled]);
  const selectedOption = normalizedOptions.find((option) => option.value === value);
  const safeActiveIndex = Math.min(activeIndex, Math.max(filteredOptions.length - 1, 0));
  const activeOption = filteredOptions[safeActiveIndex];
  const isDirectory = variant === "directory";

  const updateMenuPosition = useCallback(() => {
    const button = buttonRef.current;
    if (!button) return;

    const rect = button.getBoundingClientRect();
    const viewportPadding = 12;
    const gap = 6;
    const spaceBelow = window.innerHeight - rect.bottom - viewportPadding - gap;
    const spaceAbove = rect.top - viewportPadding - gap;
    const openUpward = spaceBelow < 180 && spaceAbove > spaceBelow;
    const availableHeight = Math.max(openUpward ? spaceAbove : spaceBelow, 112);
    const maxHeight = Math.min(searchEnabled ? 320 : 280, availableHeight);
    const width = Math.min(Math.max(rect.width, 176), window.innerWidth - viewportPadding * 2);
    const left = Math.max(viewportPadding, Math.min(rect.left, window.innerWidth - width - viewportPadding));

    setMenuPosition({
      ...(openUpward ? { bottom: window.innerHeight - rect.top + gap } : { top: rect.bottom + gap }),
      left,
      maxHeight,
      width,
    });
  }, [searchEnabled]);

  const closeMenu = useCallback((restoreFocus = false) => {
    setIsOpen(false);
    setSearch("");
    setMenuPosition(null);
    if (restoreFocus) window.setTimeout(() => buttonRef.current?.focus(), 0);
  }, []);

  const openMenu = useCallback(() => {
    if (disabled) return;
    const selectedIndex = normalizedOptions.findIndex((option) => option.value === value);
    setActiveIndex(Math.max(selectedIndex, 0));
    updateMenuPosition();
    setIsOpen(true);
  }, [disabled, normalizedOptions, updateMenuPosition, value]);

  const selectOption = useCallback(
    (option: NormalizedOption) => {
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
    if (!isOpen) return;
    activeOptionRef.current?.scrollIntoView({ block: "nearest" });
  }, [isOpen, safeActiveIndex]);

  useEffect(() => {
    if (!isOpen || searchEnabled) return;
    menuRef.current?.focus();
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
      closeMenu();
      return;
    }
    if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
      event.preventDefault();
      setActiveIndex((current) => getNextDropdownIndex(current, filteredOptions.length, event.key as "ArrowDown" | "ArrowUp" | "End" | "Home"));
      return;
    }
    if (event.key === "Enter" || (!searchEnabled && event.key === " ")) {
      event.preventDefault();
      if (activeOption) selectOption(activeOption);
    }
  };

  const buttonClasses = isDirectory
    ? "tanaw-directory-select-trigger flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border px-3.5 py-2.5 text-left transition focus:outline-none"
    : "focus:border-tanaw-green focus:ring-tanaw-green/15 tanaw-data-filter flex min-h-10 items-center justify-between gap-3 rounded-lg border border-gray-300 bg-white px-3 py-2 text-left text-sm text-gray-700 outline-none transition focus:ring-4 disabled:cursor-not-allowed disabled:opacity-60 dark:border-slate-700 dark:bg-[#0f172a] dark:text-slate-200";

  return (
    <div data-field-name={name} className={`relative min-w-0 ${className}`}>
      {label && (
        <span
          className={`mb-2 block font-bold ${isDirectory ? "tanaw-directory-select-label text-[11px] tracking-[0.06em] uppercase" : "text-[11px] tracking-wide text-slate-500 uppercase dark:text-slate-300"}`}
        >
          {label}
        </span>
      )}
      {name && <input type="hidden" name={name} value={value} />}
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        role="combobox"
        aria-activedescendant={isOpen && activeOption ? `${listboxId}-${safeActiveIndex}` : undefined}
        aria-controls={listboxId}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-invalid={Boolean(error)}
        aria-label={ariaLabel ?? label}
        aria-required={required}
        aria-describedby={error && name ? `${name}-description` : undefined}
        data-form-error-focus
        onClick={() => (isOpen ? closeMenu() : openMenu())}
        onKeyDown={handleKeyDown}
        className={`${buttonClasses} ${error ? "border-red-400" : ""}`}
      >
        <span className={`truncate ${isDirectory ? "tanaw-directory-select-value text-[12px] font-semibold" : selectedOption ? "font-medium" : "text-gray-400 dark:text-slate-500"}`}>
          {selectedOption?.label ?? placeholder}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {selectedOption?.meta && (
            <span className={isDirectory ? "tanaw-directory-select-meta rounded-md px-2 py-0.5 font-mono text-[10px] font-bold" : "text-xs font-semibold text-gray-400 dark:text-slate-400"}>
              {selectedOption.meta}
            </span>
          )}
          <ChevronDown
            size={16}
            className={`shrink-0 transition-transform duration-200 ${isDirectory ? "tanaw-directory-select-chevron" : "text-gray-400 dark:text-slate-400"} ${isOpen ? "rotate-180" : ""}`}
          />
        </span>
      </button>
      {error && (
        <p id={name ? `${name}-description` : undefined} role="alert" className="mt-1.5 text-xs font-semibold text-red-600 dark:text-red-300">
          {error}
        </p>
      )}

      <AnimatePresence>
        {isOpen && menuPosition && (
          <ModalPortal>
            <div className="fixed inset-0 z-1500" onPointerDown={() => closeMenu()} />
            <motion.div
              ref={menuRef}
              tabIndex={-1}
              initial={{ opacity: 0, y: -6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.98 }}
              transition={{ duration: 0.14, ease: "easeOut" }}
              style={menuPosition}
              onKeyDown={handleKeyDown}
              onPointerDown={(event) => event.stopPropagation()}
              className={`fixed z-1501 flex flex-col overflow-hidden rounded-xl shadow-[0_22px_54px_rgba(0,0,0,0.32)] outline-none ${
                isDirectory ? "tanaw-directory-select-menu border backdrop-blur-md" : "border border-gray-200 bg-white dark:border-slate-700 dark:bg-[#121c31]"
              }`}
            >
              {searchEnabled && (
                <div className={`shrink-0 border-b p-2 ${isDirectory ? "tanaw-directory-select-search-shell" : "border-gray-100 dark:border-slate-700"}`}>
                  <label
                    className={`relative flex items-center rounded-lg border ${isDirectory ? "tanaw-directory-select-search" : "border-gray-200 bg-gray-50 dark:border-slate-700 dark:bg-[#0f172a]"}`}
                  >
                    <Search size={14} className={`absolute left-3 ${isDirectory ? "tanaw-directory-select-chevron" : "text-gray-400"}`} />
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
                      className={`min-w-0 flex-1 bg-transparent py-2.5 pr-3 pl-9 text-sm outline-none ${isDirectory ? "tanaw-directory-select-value text-xs font-medium placeholder:font-normal" : "text-gray-900 dark:text-slate-100 dark:placeholder:text-slate-500"}`}
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
                      onClick={() => selectOption(option)}
                      onMouseEnter={() => setActiveIndex(index)}
                      className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition ${
                        isDirectory
                          ? active || selected
                            ? "tanaw-directory-select-option--active font-semibold ring-1"
                            : "tanaw-directory-select-option"
                          : active
                            ? "bg-emerald-50 font-semibold text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200"
                            : selected
                              ? "font-semibold text-emerald-800 dark:text-emerald-200"
                              : "text-gray-700 hover:bg-gray-50 dark:text-slate-200 dark:hover:bg-slate-800"
                      }`}
                    >
                      <span className={isDirectory ? "truncate text-xs font-medium" : "truncate"}>{option.label}</span>
                      <span className="flex shrink-0 items-center gap-2">
                        {option.meta && (
                          <span className={isDirectory ? "tanaw-directory-select-meta rounded-md px-2 py-0.5 font-mono text-[10px] font-bold" : "text-xs text-gray-400 dark:text-slate-400"}>
                            {option.meta}
                          </span>
                        )}
                        {selected && <Check size={15} className={isDirectory ? "text-emerald-600 dark:text-emerald-300" : "text-emerald-700 dark:text-emerald-300"} />}
                      </span>
                    </button>
                  );
                })}
                {filteredOptions.length === 0 && (
                  <div className={`px-3 py-5 text-center text-xs font-semibold ${isDirectory ? "tanaw-directory-select-label" : "text-gray-400"}`}>No matching options</div>
                )}
              </div>
            </motion.div>
          </ModalPortal>
        )}
      </AnimatePresence>
    </div>
  );
}

function normalizeOption(option: SelectDropdownOption): NormalizedOption {
  if (typeof option === "string") return { value: option, label: option };
  if (Array.isArray(option)) return { value: option[0], label: option[1] };
  return option as NormalizedOption;
}
