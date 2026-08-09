import { Search } from "lucide-react";

export function EmailDeliveriesToolbar({ query, onQueryChange }: { query: string; onQueryChange: (query: string) => void }) {
  return (
    <div className="border-b border-slate-200 bg-slate-50 p-4">
      <label className="relative block max-w-xl">
        <Search size={15} className="absolute top-1/2 left-3 -translate-y-1/2 text-slate-400" />
        <span className="sr-only">Search email delivery</span>
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          placeholder="Search recipient, purpose, or status"
          className="focus:ring-tanaw-green/20 w-full rounded-xl border border-slate-300 bg-white py-2.5 pr-4 pl-9 text-sm outline-none focus:ring-4"
        />
      </label>
    </div>
  );
}
