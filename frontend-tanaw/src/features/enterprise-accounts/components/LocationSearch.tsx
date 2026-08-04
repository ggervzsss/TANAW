import { AlertCircle, LoaderCircle, MapPin, Search, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { getApiErrorMessage } from "@/shared/utils/apiErrors";
import { filterRelatedLocationSuggestions } from "../model";
import { searchEnterpriseLocations } from "../services";
import type { EnterpriseLocationSuggestion } from "../types";

const SEARCH_DEBOUNCE_MS = 180;
const MINIMUM_QUERY_LENGTH = 2;

type LocationSearchProps = {
  inputId: string;
  onSelect: (suggestion: EnterpriseLocationSuggestion) => void;
};

export function LocationSearch({ inputId, onSelect }: LocationSearchProps) {
  const listboxId = useId();
  const selectedQueryRef = useRef("");
  const [query, setQuery] = useState("");
  const [suggestions, setSuggestions] = useState<EnterpriseLocationSuggestion[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const normalizedQuery = query.trim();

  useEffect(() => {
    if (normalizedQuery.length < MINIMUM_QUERY_LENGTH) {
      return undefined;
    }
    if (selectedQueryRef.current === normalizedQuery) {
      selectedQueryRef.current = "";
      return undefined;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setIsLoading(true);
      setError(null);
      setHasSearched(false);
      void searchEnterpriseLocations(normalizedQuery, controller.signal)
        .then((results) => {
          setSuggestions((current) => (results.length > 0 ? results : filterRelatedLocationSuggestions(current, normalizedQuery)));
          setActiveIndex(0);
          setHasSearched(true);
          setIsOpen(true);
        })
        .catch((requestError: unknown) => {
          if (controller.signal.aborted) return;
          setSuggestions([]);
          setError(getApiErrorMessage(requestError, "Location suggestions are temporarily unavailable. Place the marker manually instead."));
          setHasSearched(true);
          setIsOpen(true);
        })
        .finally(() => {
          if (!controller.signal.aborted) setIsLoading(false);
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [normalizedQuery]);

  const showPanel = isOpen && normalizedQuery.length >= MINIMUM_QUERY_LENGTH && (isLoading || hasSearched);
  const activeSuggestion = suggestions[activeIndex];

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === "Escape") {
      setIsOpen(false);
      return;
    }
    if (event.key === "ArrowDown" && suggestions.length > 0) {
      event.preventDefault();
      setIsOpen(true);
      setActiveIndex((current) => (current + 1) % suggestions.length);
      return;
    }
    if (event.key === "ArrowUp" && suggestions.length > 0) {
      event.preventDefault();
      setIsOpen(true);
      setActiveIndex((current) => (current - 1 + suggestions.length) % suggestions.length);
      return;
    }
    if (event.key === "Enter" && isOpen) {
      event.preventDefault();
      if (activeSuggestion) selectSuggestion(activeSuggestion);
    }
  }

  function selectSuggestion(suggestion: EnterpriseLocationSuggestion) {
    selectedQueryRef.current = suggestion.name.trim();
    setQuery(suggestion.name);
    setSuggestions([]);
    setError(null);
    setHasSearched(false);
    setIsLoading(false);
    setIsOpen(false);
    onSelect(suggestion);
  }

  return (
    <div
      className="relative z-500"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setIsOpen(false);
      }}
    >
      <label htmlFor={inputId} className="mb-1.5 block text-[11px] font-bold tracking-wide text-slate-600 uppercase dark:text-slate-300">
        Search for a place or address
      </label>
      <div className="relative">
        <Search size={16} className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
        <input
          id={inputId}
          type="search"
          value={query}
          role="combobox"
          autoComplete="off"
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-expanded={showPanel}
          aria-activedescendant={showPanel && activeSuggestion ? `${listboxId}-${activeSuggestion.placeId}` : undefined}
          placeholder="Enter a landmark, street, or address"
          className="focus:border-tanaw-green focus:ring-tanaw-green/15 w-full rounded-xl border border-slate-200 bg-white py-2.5 pr-10 pl-10 text-sm text-slate-800 shadow-sm transition outline-none focus:ring-4 dark:border-slate-600 dark:bg-[#121c31] dark:text-slate-100"
          onChange={(event) => {
            const nextQuery = event.target.value;
            selectedQueryRef.current = "";
            setQuery(nextQuery);
            setIsOpen(true);
            setActiveIndex(0);
            if (nextQuery.trim().length < MINIMUM_QUERY_LENGTH) {
              setSuggestions([]);
              setIsLoading(false);
              setError(null);
              setHasSearched(false);
            } else {
              setSuggestions((current) => filterRelatedLocationSuggestions(current, nextQuery));
              setIsLoading(true);
              setError(null);
              setHasSearched(false);
            }
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
        />
        {isLoading ? (
          <LoaderCircle size={16} className="absolute top-1/2 right-3 -translate-y-1/2 animate-spin text-emerald-700" aria-label="Searching locations" />
        ) : query ? (
          <button
            type="button"
            aria-label="Clear location search"
            className="absolute top-1/2 right-2.5 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-700 dark:hover:text-slate-100"
            onClick={() => {
              setQuery("");
              setSuggestions([]);
              setError(null);
              setHasSearched(false);
              setIsLoading(false);
              setIsOpen(false);
            }}
          >
            <X size={15} />
          </button>
        ) : null}
      </div>
      <p className="mt-1.5 text-right text-[10px] font-medium text-slate-400">
        Search powered by{" "}
        <a href="https://www.geoapify.com/" target="_blank" rel="noreferrer" className="font-bold text-emerald-700 hover:underline dark:text-emerald-300">
          Geoapify
        </a>
      </p>

      {showPanel ? (
        <div
          id={listboxId}
          role="listbox"
          className="absolute top-full right-0 left-0 mt-2 max-h-64 overflow-y-auto rounded-xl border border-slate-200 bg-white p-1.5 shadow-xl dark:border-slate-600 dark:bg-[#121c31]"
        >
          {error ? (
            <div role="status" className="flex items-start gap-2 px-3 py-2.5 text-xs font-semibold text-amber-700 dark:text-amber-300">
              <AlertCircle size={15} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          ) : isLoading && suggestions.length === 0 ? (
            <p role="status" className="px-3 py-2.5 text-xs font-semibold text-slate-500">
              Searching within San Pedro…
            </p>
          ) : suggestions.length > 0 ? (
            suggestions.map((suggestion, index) => (
              <button
                key={suggestion.placeId}
                id={`${listboxId}-${suggestion.placeId}`}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                className={`flex w-full items-start gap-2.5 rounded-lg px-3 py-2.5 text-left transition ${index === activeIndex ? "bg-emerald-50 text-emerald-900 dark:bg-emerald-500/15 dark:text-emerald-100" : "text-slate-700 hover:bg-slate-50 dark:text-slate-200 dark:hover:bg-slate-700/60"}`}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => selectSuggestion(suggestion)}
              >
                <MapPin size={16} className="mt-0.5 shrink-0 text-emerald-700 dark:text-emerald-300" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-bold">{suggestion.name}</span>
                  <span className="mt-0.5 block text-xs leading-relaxed text-slate-500 dark:text-slate-400">{suggestion.formattedAddress}</span>
                </span>
              </button>
            ))
          ) : (
            <p role="status" className="px-3 py-2.5 text-xs font-semibold text-slate-500">
              No matching locations were found inside San Pedro. Try a nearby street or place the marker manually.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
