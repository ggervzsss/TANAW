import { Unstyled } from "@storybook/addon-docs/blocks";
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

function Chip({ token, dark }: { token: string; dark: boolean }) {
  const { ref, value } = useResolved();
  return (
    <span className={dark ? "dark flex items-center gap-2" : "flex items-center gap-2"}>
      <span ref={ref} style={{ color: `var(${token})`, background: `var(${token})` }} className="h-9 w-9 shrink-0 rounded-tanaw-sm border border-(--tanaw-border-soft)" />
      <span className="font-mono text-[11px] leading-4 text-(--tanaw-text-muted)">
        {dark ? "Dark" : "Light"}
        <br />
        {toHex(value)}
      </span>
    </span>
  );
}

/** One token with its light and dark values; the .dark wrapper rescopes the tokens. */
export function Swatch({ token, name, use }: { token: string; name: string; use: string }) {
  return (
    <div className="rounded-tanaw-md border border-(--tanaw-border-soft) bg-(--tanaw-surface) p-3 text-sm">
      <p className="font-bold text-(--tanaw-text)">{name}</p>
      <p className="font-mono text-xs text-(--tanaw-text-muted)">{token}</p>
      <div className="my-2.5 flex gap-4">
        <Chip token={token} dark={false} />
        <span className="dark rounded-tanaw-sm bg-(--tanaw-page) px-1.5 py-1">
          <Chip token={token} dark />
        </span>
      </div>
      <p className="text-xs leading-5 text-(--tanaw-text-secondary)">{use}</p>
    </div>
  );
}

export function SwatchGrid({ items }: { items: ReadonlyArray<{ token: string; name: string; use: string }> }) {
  return (
    <Unstyled>
      <div className="my-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {items.map((item) => (
          <Swatch key={item.token} {...item} />
        ))}
      </div>
    </Unstyled>
  );
}

export function TypeSample({ label, className, spec, children }: { label: string; className: string; spec: string; children: string }) {
  return (
    <Unstyled>
    <div className="border-b border-(--tanaw-border-soft) py-4">
      <p className="mb-1 font-mono text-xs text-(--tanaw-text-muted)">
        {label} · {spec}
      </p>
      <p className={className}>{children}</p>
    </div>
    </Unstyled>
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
