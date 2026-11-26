export function ticketFieldClassName(extra = "") {
  return `w-full rounded-tanaw-md border border-(--tanaw-control-border) bg-(--tanaw-control-bg) px-3.5 py-3 text-sm text-(--tanaw-text) shadow-tanaw-resting outline-none transition-[border-color,box-shadow] duration-150 ease-tanaw-out placeholder:text-(--tanaw-text-placeholder) hover:border-(--tanaw-control-border-hover) focus:border-(--tanaw-accent-ink) focus:ring-4 focus:ring-emerald-600/15 aria-invalid:border-(--tanaw-error)! ${extra}`;
}
