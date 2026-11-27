import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { planColumns, type FitList, type LowerPlacement, type SectionHeights } from "../model/columns";

/** The fewest rem the connection problems list shows before it scrolls: about two and a half rows. */
const FIT_LIST_FLOOR_REM = 16;

/** Marks each work list (its id as the value) so its height can be measured. */
const SECTION_ATTRIBUTE = "data-overview-section";

const sectionIds = ["it-overview-requests", "it-overview-connections", "it-overview-accounts", "it-overview-emails"] as const;

/**
 * Keeps the two work-list columns close to level. It measures each list, decides which of the
 * lower lists (accounts, emails) sit under Requests, and gives the connection problems list (marked
 * `data-fit-list`) the height that makes up the rest. The list height is written straight to the
 * container as `--it-overview-fit`, so it lands before the next paint. With one column there is
 * nothing to balance: the lists stack in their own order and the list keeps its usual height.
 */
export function useBalancedColumns() {
  const ref = useRef<HTMLDivElement>(null);
  const [lower, setLower] = useState<LowerPlacement>("none");
  const current = useRef<LowerPlacement>(lower);

  const measure = useCallback(() => {
    const container = ref.current;
    if (!container) return;
    const columns = getComputedStyle(container).gridTemplateColumns.trim().split(/\s+/).length;
    const sections = sectionIds.map((id) => container.querySelector<HTMLElement>(`[${SECTION_ATTRIBUTE}="${id}"]`));
    if (columns < 2 || sections.some((section) => !section)) {
      container.style.removeProperty("--it-overview-fit");
      if (current.current !== "none") setLower("none");
      return;
    }
    const [requests, connections, accounts, emails] = sections.map((section) => section?.offsetHeight ?? 0);
    const heights: SectionHeights = { requests, connections, accounts, emails };
    const element = sections[1]?.querySelector<HTMLElement>("[data-fit-list]") ?? null;
    let list: FitList | null = null;
    if (element) {
      const rem = Number.parseFloat(getComputedStyle(document.documentElement).fontSize) || 16;
      const content = element.scrollHeight;
      list = { chrome: connections - element.offsetHeight, min: Math.min(FIT_LIST_FLOOR_REM * rem, content), max: content };
    }
    const plan = planColumns(heights, list, current.current);
    const fit = plan.fit === null ? "" : `${plan.fit}px`;
    if (container.style.getPropertyValue("--it-overview-fit") !== fit) {
      if (fit) container.style.setProperty("--it-overview-fit", fit);
      else container.style.removeProperty("--it-overview-fit");
    }
    if (plan.lower !== current.current) setLower(plan.lower);
  }, []);

  // After every render: the lists may have new rows. Runs before paint.
  useLayoutEffect(() => {
    current.current = lower;
    measure();
  });

  // Width changes and late size changes (fonts, wrapped text) are measured on the next frame, so a
  // change made here never re-enters the observer in the same frame.
  useLayoutEffect(() => {
    const container = ref.current;
    if (!container || typeof ResizeObserver === "undefined") return undefined;
    let frame = 0;
    const schedule = () => {
      if (!frame)
        frame = requestAnimationFrame(() => {
          frame = 0;
          measure();
        });
    };
    const resize = new ResizeObserver(schedule);
    const observeAll = () => {
      resize.disconnect();
      resize.observe(container);
      for (const section of Array.from(container.querySelectorAll(`[${SECTION_ATTRIBUTE}]`))) resize.observe(section);
      const list = container.querySelector("[data-fit-list]");
      if (list) for (const row of Array.from(list.children)) resize.observe(row);
    };
    observeAll();
    const mutations = new MutationObserver(() => {
      observeAll();
      schedule();
    });
    mutations.observe(container, { childList: true, subtree: true });
    return () => {
      if (frame) cancelAnimationFrame(frame);
      resize.disconnect();
      mutations.disconnect();
    };
  }, [measure]);

  return { ref, lower };
}
