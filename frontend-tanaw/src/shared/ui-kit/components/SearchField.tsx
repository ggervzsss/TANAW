import { forwardRef, type InputHTMLAttributes } from "react";
import { Search, X } from "lucide-react";
import { Input } from "./Input";

export type SearchFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "size" | "onChange" | "value"> & {
  value: string;
  onChange: (value: string) => void;
  /** Says what can be searched, for example "Search name or email". */
  placeholder: string;
  /** Read by screen readers; defaults to the placeholder. */
  label?: string;
  size?: "sm" | "md";
};

/** An input with a leading search icon and a clear button once something is typed. */
export const SearchField = forwardRef<HTMLInputElement, SearchFieldProps>(function SearchField({ value, onChange, placeholder, label, size = "md", className, ...props }, ref) {
  return (
    <Input
      ref={ref}
      type="search"
      role="searchbox"
      size={size}
      value={value}
      placeholder={placeholder}
      aria-label={label ?? placeholder}
      onChange={(event) => onChange(event.target.value)}
      className={className}
      leading={<Search size={15} aria-hidden="true" />}
      trailing={
        value ? (
          <button
            type="button"
            aria-label="Clear search"
            onClick={() => onChange("")}
            className="flex h-6 w-6 items-center justify-center rounded-full text-(--tanaw-text-muted) hover:bg-(--tanaw-control-hover) hover:text-(--tanaw-text) focus-visible:outline-2 focus-visible:outline-(--tanaw-focus-ring)"
          >
            <X size={14} aria-hidden="true" />
          </button>
        ) : undefined
      }
      {...props}
    />
  );
});
