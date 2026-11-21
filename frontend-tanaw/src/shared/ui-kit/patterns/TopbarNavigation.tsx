import { useLayoutEffect, useRef, type ComponentPropsWithoutRef } from "react";
import "./TopbarNavigation.css";

type NavigationProps = ComponentPropsWithoutRef<"nav"> & { activeId: string | null };

export function TopbarNavigation({ activeId, children, ...navProps }: NavigationProps) {
  const navRef = useRef<HTMLElement>(null);
  const underlineRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const nav = navRef.current;
    const underline = underlineRef.current;
    if (!nav || !underline) return;
    const items = Array.from(nav.querySelectorAll<HTMLElement>("[data-topbar-navigation]"));
    const selected = items.find((item) => item.dataset.topbarNavigation === activeId);
    const label = selected?.querySelector<HTMLElement>("[data-topbar-label]");
    const position = () => {
      underline.hidden = !label?.offsetWidth;
      if (underline.hidden || !label) return;
      const navRect = nav.getBoundingClientRect();
      const labelRect = label.getBoundingClientRect();
      // The desktop renderer can apply zoom to the entire app.
      const scale = navRect.width / nav.offsetWidth || 1;
      const width = (labelRect.width / scale) * 0.8;
      const x = (labelRect.left + labelRect.width / 2 - navRect.left) / scale - width / 2;
      const y = (labelRect.bottom - navRect.top) / scale + 4;
      underline.style.transform = `translate(${x}px, ${y}px)`;
      underline.style.width = `${width}px`;
    };
    position();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(position);
    observer.observe(nav);
    items.forEach((item) => observer.observe(item));
    if (label) observer.observe(label);
    return () => observer.disconnect();
  }, [activeId, children]);

  return (
    <nav {...navProps} ref={navRef} data-topbar-underline-navigation>
      <span ref={underlineRef} hidden aria-hidden="true" data-topbar-underline />
      {children}
    </nav>
  );
}
