import { AlertCircle, LoaderCircle, MapPin, Search, X } from "lucide-react";
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { cn, controlClassName } from "@/shared/ui-kit";
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
      <label htmlFor={inputId} className="mb-1.5 block text-[13px] font-medium text-(--tanaw-text-secondary)">
        Search for a place or address
      </label>
      <div className="tanaw-field relative flex items-center">
        <Search size={16} aria-hidden="true" className="tanaw-field-icon pointer-events-none absolute left-3.5 text-(--tanaw-text-muted)" />
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
          className={cn(controlClassName, "h-11 pr-10 pl-10 [&::-webkit-search-cancel-button]:appearance-none")}
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
          <LoaderCircle size={16} className="absolute right-3.5 animate-spin text-(--tanaw-accent-ink) motion-reduce:animate-none" aria-label="Searching locations" />
        ) : query ? (
          <button
            type="button"
            aria-label="Clear location search"
            className="tanaw-pop-in ease-tanaw-out absolute right-2 flex size-7 items-center pointer-coarse:right-0.5 pointer-coarse:size-10 justify-center rounded-full text-(--tanaw-text-muted) transition-[background-color,color,scale] duration-200 hover:bg-(--tanaw-control-bg-hover) hover:text-(--tanaw-text) active:scale-90 motion-reduce:transition-none"
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
      <p className="mt-1.5 text-right text-xs text-(--tanaw-text-muted)">
        Search powered by{" "}
        <a href="https://www.geoapify.com/" target="_blank" rel="noreferrer" className="font-semibold text-(--tanaw-accent-ink) hover:underline">
          Geoapify
        </a>
      </p>

      {showPanel ? (
        <div
          id={listboxId}
          role="listbox"
          className="rounded-tanaw-md shadow-tanaw-raised absolute top-full right-0 left-0 mt-2 max-h-64 overflow-y-auto border border-(--tanaw-border-soft) bg-(--tanaw-surface-raised) p-1.5"
        >
          {error ? (
            <div role="status" className="flex items-start gap-2 px-3 py-2.5 text-[13px] font-medium text-(--tanaw-warn-ink)">
              <AlertCircle size={15} className="mt-0.5 shrink-0" />
              <span>{error}</span>
            </div>
          ) : isLoading && suggestions.length === 0 ? (
            <p role="status" className="px-3 py-2.5 text-[13px] text-(--tanaw-text-secondary)">
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
                className={`rounded-tanaw-sm flex min-h-11 w-full items-start gap-2.5 px-3 py-2.5 text-left transition-colors duration-150 ${index === activeIndex ? "bg-(--tanaw-selected-bg) text-(--tanaw-accent-ink)" : "text-(--tanaw-text) hover:bg-(--tanaw-control-hover)"}`}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => selectSuggestion(suggestion)}
              >
                <MapPin size={16} className="mt-0.5 shrink-0 text-(--tanaw-accent-ink)" />
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{suggestion.name}</span>
                  <span className="mt-0.5 block text-[13px] leading-relaxed text-(--tanaw-text-secondary)">{suggestion.formattedAddress}</span>
                </span>
              </button>
            ))
          ) : (
            <p role="status" className="px-3 py-2.5 text-[13px] text-(--tanaw-text-secondary)">
              No matching locations were found inside San Pedro. Try a nearby street or place the marker manually.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
