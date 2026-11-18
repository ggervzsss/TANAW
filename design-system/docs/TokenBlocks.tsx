import { useEffect, useRef, useState } from "react";

/** Reads a CSS custom property as the browser resolves it, so the docs always show the live token. */
function useResolved(property: "color" | "backgroundImage" = "color") {
  const ref = useRef<HTMLSpanElement>(null);
  const [value, setValue] = useState("");
  useEffect(() => {
    const read = () => {
      if (!ref.current) return;
      const style = getComputedStyle(ref.current);
      setValue(property === "color" ? style.color : style.backgroundImage);
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => observer.disconnect();
  }, [property]);
  return { ref, value };
}

function toHex(rgb: string) {
  const match = /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(rgb);
  if (!match) return rgb;
  const hex = `#${[match[1], match[2], match[3]].map((part) => Number(part).toString(16).padStart(2, "0")).join("")}`;
  return match[4] && match[4] !== "1" ? `${hex} / ${match[4]}` : hex;
}

export function Swatch({ token, name, use }: { token: string; name: string; use: string }) {
  const { ref, value } = useResolved();
  return (
    <div className="flex items-center gap-3 rounded-tanaw-md border border-(--tanaw-border-soft) bg-(--tanaw-surface) p-3">
      <span ref={ref} style={{ color: `var(${token})`, background: `var(${token})` }} className="h-11 w-11 shrink-0 rounded-tanaw-sm border border-(--tanaw-border-soft)" />
      <div className="min-w-0 text-sm">
        <p className="font-bold text-(--tanaw-text)">{name}</p>
        <p className="font-mono text-xs text-(--tanaw-text-muted)">
          {token} · {toHex(value)}
        </p>
        <p className="mt-0.5 text-xs text-(--tanaw-text-secondary)">{use}</p>
      </div>
    </div>
  );
}

export function SwatchGrid({ items }: { items: ReadonlyArray<{ token: string; name: string; use: string }> }) {
  return (
    <div className="my-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => (
        <Swatch key={item.token} {...item} />
      ))}
    </div>
  );
}

export function TypeSample({ label, className, spec, children }: { label: string; className: string; spec: string; children: string }) {
  return (
    <div className="border-b border-(--tanaw-border-soft) py-4">
      <p className="mb-1 font-mono text-xs text-(--tanaw-text-muted)">
        {label} · {spec}
      </p>
      <p className={className}>{children}</p>
    </div>
  );
}

export function ShapeSample({ label, className }: { label: string; className: string }) {
  return (
    <div className="flex flex-col items-center gap-2">
      <span className={`h-20 w-28 border border-(--tanaw-border-soft) bg-(--tanaw-surface) ${className}`} />
      <span className="font-mono text-xs text-(--tanaw-text-muted)">{label}</span>
    </div>
  );
}
