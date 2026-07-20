import { Check, ChevronDown, Search } from "lucide-react";
import { type KeyboardEvent, useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { ModalPortal } from "./ModalPortal";
import { getNextDropdownIndex } from "./dropdownKeyboard";

export type SelectDropdownOption = string | readonly [string, string] | { value: string; label: string; meta?: string; searchText?: string };

type SelectDropdownProps = {
  value: string;
  onChange: (value: string) => void;
  options: readonly SelectDropdownOption[];
  ariaLabel: string;
  className?: string;
  disabled?: boolean;
  searchable?: boolean;
  searchPlaceholder?: string;
  size?: "compact" | "default";
};

type NormalizedOption = { value: string; label: string; meta?: string; searchText?: string };
type MenuPosition = { bottom?: number; left: number; maxHeight: number; top?: number; width: number };

export function SelectDropdown({ value, onChange, options, ariaLabel, className = "", disabled = false, searchable = false, searchPlaceholder = "Search options...", size = "default" }: SelectDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [menuPosition, setMenuPosition] = useState<MenuPosition | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const activeOptionRef = useRef<HTMLButtonElement | null>(null);
  const listboxId = useId();
  const normalizedOptions = useMemo(() => options.map(normalizeOption), [options]);
  const filteredOptions = useMemo(() => {
    const query = search.trim().toLowerCase();
    if (!query) return normalizedOptions;
    return normalizedOptions.filter((option) => `${option.label} ${option.value} ${option.searchText ?? ""}`.toLowerCase().includes(query));
  }, [normalizedOptions, search]);
  const selectedOption = normalizedOptions.find((option) => option.value === value);
  const safeActiveIndex = Math.min(activeIndex, Math.max(filteredOptions.length - 1, 0));
  const activeOption = filteredOptions[safeActiveIndex];

  const updateMenuPosition = useCallback(() => {
    const button = buttonRef.current;
    if (!button) return;
    const rect = button.getBoundingClientRect();
    const padding = 12;
    const gap = 6;
    const below = window.innerHeight - rect.bottom - padding - gap;
    const above = rect.top - padding - gap;
    const openUpward = below < 180 && above > below;
    const maxHeight = Math.min(searchable ? 320 : 280, Math.max(openUpward ? above : below, 112));
    const width = Math.min(Math.max(rect.width, 176), window.innerWidth - padding * 2);
    const left = Math.max(padding, Math.min(rect.left, window.innerWidth - width - padding));
    setMenuPosition({ ...(openUpward ? { bottom: window.innerHeight - rect.top + gap } : { top: rect.bottom + gap }), left, maxHeight, width });
  }, [searchable]);

  const closeMenu = useCallback((restoreFocus = false) => {
    setIsOpen(false);
    setSearch("");
    setMenuPosition(null);
    if (restoreFocus) window.setTimeout(() => buttonRef.current?.focus(), 0);
  }, []);

  const openMenu = useCallback(() => {
    if (disabled) return;
    setActiveIndex(Math.max(normalizedOptions.findIndex((option) => option.value === value), 0));
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
    if (isOpen && !searchable) menuRef.current?.focus();
  }, [isOpen, searchable]);

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
    if (event.key === "Enter" || (!searchable && event.key === " ")) {
      event.preventDefault();
      if (activeOption) selectOption(activeOption);
    }
  };

  return (
    <div className={`relative min-w-0 ${className}`}>
      <button
        ref={buttonRef}
        type="button"
        disabled={disabled}
        role="combobox"
        aria-activedescendant={isOpen && activeOption ? `${listboxId}-${safeActiveIndex}` : undefined}
        aria-controls={listboxId}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        onClick={() => (isOpen ? closeMenu() : openMenu())}
        onKeyDown={handleKeyDown}
        className={`flex w-full items-center justify-between gap-2 border border-gray-300 bg-white text-left font-semibold text-gray-800 shadow-sm transition outline-none hover:border-emerald-700/50 focus:border-[#065f46] focus:ring-2 focus:ring-emerald-600/15 disabled:cursor-not-allowed disabled:bg-gray-100 disabled:opacity-60 dark:border-slate-600 dark:bg-[#111b2f] dark:text-slate-100 ${size === "compact" ? "min-h-8 rounded-md px-2 py-1.5 text-xs" : "min-h-10 rounded-xl px-3 py-2.5 text-sm"}`}
      >
        <span className="truncate">{selectedOption?.label ?? "Select an option"}</span>
        <span className="flex shrink-0 items-center gap-2">
          {selectedOption?.meta && <span className="text-xs text-gray-400 dark:text-slate-400">{selectedOption.meta}</span>}
          <ChevronDown size={14} className={`text-gray-400 transition-transform dark:text-slate-400 ${isOpen ? "rotate-180" : ""}`} />
        </span>
      </button>

      {isOpen && menuPosition && (
        <ModalPortal>
          <div className="fixed inset-0 z-1300" onPointerDown={() => closeMenu()} />
          <div
            ref={menuRef}
            tabIndex={-1}
            style={menuPosition}
            onKeyDown={handleKeyDown}
            onPointerDown={(event) => event.stopPropagation()}
            className="fixed z-1301 flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-[0_22px_54px_rgba(0,0,0,0.32)] outline-none dark:border-slate-700 dark:bg-[#121c31]"
          >
            {searchable && (
              <div className="shrink-0 border-b border-gray-100 p-2 dark:border-slate-700">
                <label className="relative flex items-center rounded-md border border-gray-200 bg-gray-50 dark:border-slate-700 dark:bg-[#0f172a]">
                  <Search size={14} className="absolute left-3 text-gray-400" />
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
                    className="min-w-0 flex-1 bg-transparent py-2 pr-3 pl-9 text-sm text-gray-900 outline-none dark:text-slate-100 dark:placeholder:text-slate-500"
                  />
                </label>
              </div>
            )}
            <div id={listboxId} role="listbox" aria-label={ariaLabel} className="min-h-0 flex-1 overflow-y-auto p-1.5">
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
                    className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition ${active ? "bg-emerald-50 font-semibold text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-200" : selected ? "font-semibold text-emerald-800 dark:text-emerald-200" : "text-gray-700 hover:bg-gray-50 dark:text-slate-200 dark:hover:bg-slate-800"}`}
                  >
                    <span className="truncate">{option.label}</span>
                    <span className="flex shrink-0 items-center gap-2">
                      {option.meta && <span className="text-xs text-gray-400 dark:text-slate-400">{option.meta}</span>}
                      {selected && <Check size={15} className="text-emerald-700 dark:text-emerald-300" />}
                    </span>
                  </button>
                );
              })}
              {filteredOptions.length === 0 && <div className="px-3 py-5 text-center text-xs font-semibold text-gray-400">No matching options</div>}
            </div>
          </div>
        </ModalPortal>
      )}
    </div>
  );
}

function normalizeOption(option: SelectDropdownOption): NormalizedOption {
  if (typeof option === "string") return { value: option, label: option };
  if (Array.isArray(option)) return { value: option[0], label: option[1] };
  return option as NormalizedOption;
}
