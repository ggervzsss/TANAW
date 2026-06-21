import { type KeyboardEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, ChevronDown, Search } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { ModalPortal } from "./ModalPortal";

export type DropdownOption = readonly [string, string];

type SearchableDropdownFieldProps = {
  name: string;
  label: string;
  options: readonly DropdownOption[];
  value: string;
  onChange: (value: string) => void;
  required?: boolean;
  error?: string;
};

export function SearchableDropdownField({ name, label, options, value, onChange, required = false, error }: SearchableDropdownFieldProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [menuStyle, setMenuStyle] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const activeOptionRef = useRef<HTMLButtonElement | null>(null);
  const selectedOption = options.find(([optionValue]) => optionValue === value);
  const filteredOptions = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    if (!normalizedSearch) return options;
    return options.filter(([optionValue, optionLabel]) => `${optionValue} ${optionLabel}`.toLowerCase().includes(normalizedSearch));
  }, [options, search]);
  const safeActiveIndex = Math.min(activeIndex, Math.max(filteredOptions.length - 1, 0));

  useEffect(() => {
    if (!isOpen) return;
    activeOptionRef.current?.scrollIntoView({ block: "nearest" });
  }, [safeActiveIndex, isOpen]);

  const updateMenuPosition = useCallback(() => {
    const button = buttonRef.current;
    if (!button) return;

    const rect = button.getBoundingClientRect();
    const viewportPadding = 12;
    const gap = 6;
    const spaceBelow = window.innerHeight - rect.bottom - viewportPadding;
    const availableSpace = Math.max(spaceBelow - gap, 96);
    const maxHeight = Math.min(280, availableSpace);
    const left = Math.max(viewportPadding, Math.min(rect.left, window.innerWidth - rect.width - viewportPadding));
    const top = rect.bottom + gap;

    setMenuStyle({ top, left, width: rect.width, maxHeight });
  }, []);

  useEffect(() => {
    if (!isOpen) return;

    updateMenuPosition();
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);

    return () => {
      window.removeEventListener("resize", updateMenuPosition);
      window.removeEventListener("scroll", updateMenuPosition, true);
    };
  }, [isOpen, updateMenuPosition]);

  const handleToggle = () => {
    if (isOpen) {
      setIsOpen(false);
      setSearch("");
      setMenuStyle(null);
      return;
    }

    if (!isOpen) {
      updateMenuPosition();
    }
    setIsOpen((current) => !current);
  };

  const selectOption = (optionValue: string) => {
    onChange(optionValue);
    setIsOpen(false);
    setSearch("");
    setMenuStyle(null);
  };

  const handleDropdownKeyDown = (event: KeyboardEvent) => {
    if (!isOpen && (event.key === "ArrowDown" || event.key === "ArrowUp" || event.key === "Enter" || event.key === " ")) {
      event.preventDefault();
      updateMenuPosition();
      setIsOpen(true);
      return;
    }

    if (!isOpen) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => Math.min(current + 1, Math.max(filteredOptions.length - 1, 0)));
      return;
    }

    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => Math.max(current - 1, 0));
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      const option = filteredOptions[safeActiveIndex];
      if (option) {
        selectOption(option[0]);
      }
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      setIsOpen(false);
      setSearch("");
      setMenuStyle(null);
      buttonRef.current?.focus();
    }
  };

  return (
    <div className="relative" onKeyDown={handleDropdownKeyDown}>
      <span className="mb-1.5 block text-[11px] font-bold tracking-wide text-slate-500 uppercase">{label}</span>
      <input name={name} value={value} required={required} readOnly className="sr-only" tabIndex={-1} />
      <button
        ref={buttonRef}
        type="button"
        onClick={handleToggle}
        aria-expanded={isOpen}
        aria-haspopup="listbox"
        className={[
          "focus:border-tanaw-green focus:ring-tanaw-green/15 flex w-full items-center justify-between gap-3 rounded-xl border bg-white px-4 py-3 text-left text-sm transition outline-none focus:ring-4",
          error ? "border-red-300" : "border-slate-300",
        ].join(" ")}
      >
        <span className={selectedOption ? "font-semibold text-gray-900" : "text-gray-400"}>{selectedOption?.[1] ?? `Select ${label.toLowerCase()}`}</span>
        <ChevronDown size={16} className={`shrink-0 text-gray-400 transition-transform ${isOpen ? "rotate-180" : ""}`} />
      </button>
      {error && <p className="mt-1.5 text-xs font-semibold text-red-600">{error}</p>}

      <AnimatePresence>
        {isOpen && menuStyle && (
          <ModalPortal>
            <div
              className="fixed inset-0 z-[1390]"
              onMouseDown={() => {
                setIsOpen(false);
                setSearch("");
                setMenuStyle(null);
              }}
            />
            <motion.div
              initial={{ opacity: 0, y: -6, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: -6, scale: 0.98 }}
              transition={{ duration: 0.14, ease: "easeOut" }}
              style={{ top: menuStyle.top, left: menuStyle.left, width: menuStyle.width, maxHeight: menuStyle.maxHeight }}
              className="fixed z-[1401] flex flex-col overflow-hidden rounded-xl border border-gray-200 bg-white shadow-xl"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <div className="shrink-0 border-b border-gray-100 p-2">
                <label className="relative block">
                  <Search size={14} className="absolute top-1/2 left-3 -translate-y-1/2 text-gray-400" />
                  <input
                    value={search}
                    onChange={(event) => {
                      setSearch(event.target.value);
                      setActiveIndex(0);
                    }}
                    autoFocus
                    placeholder={`Search ${label.toLowerCase()}`}
                    role="combobox"
                    aria-expanded={isOpen}
                    className="focus:ring-tgreen-dark w-full rounded-md border border-gray-200 bg-gray-50 py-2 pr-3 pl-9 text-sm outline-none focus:ring-1"
                  />
                </label>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto p-1.5" role="listbox">
                {filteredOptions.map(([optionValue, optionLabel], index) => {
                  const selected = value === optionValue;
                  const active = index === safeActiveIndex;
                  return (
                    <button
                      key={optionValue}
                      ref={active ? activeOptionRef : null}
                      type="button"
                      onClick={() => selectOption(optionValue)}
                      onMouseEnter={() => setActiveIndex(index)}
                      role="option"
                      aria-selected={selected}
                      className={`flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left text-sm transition ${
                        active ? "bg-emerald-50 font-semibold text-emerald-800" : selected ? "font-semibold text-emerald-800" : "text-gray-700 hover:bg-gray-50"
                      }`}
                    >
                      <span>{optionLabel}</span>
                      {selected && <Check size={15} className="text-emerald-700" />}
                    </button>
                  );
                })}
                {filteredOptions.length === 0 && <div className="px-3 py-4 text-center text-xs font-semibold text-gray-400">No matching options</div>}
              </div>
            </motion.div>
          </ModalPortal>
        )}
      </AnimatePresence>
    </div>
  );
}
