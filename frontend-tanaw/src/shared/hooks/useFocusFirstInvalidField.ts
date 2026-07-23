import { useCallback, useEffect, useRef } from "react";
import toast from "react-hot-toast/headless";

const DEFAULT_ERROR_MESSAGE = "Please complete the highlighted required field.";

export function useFocusFirstInvalidField() {
  const animationFrameRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (animationFrameRef.current !== null) window.cancelAnimationFrame(animationFrameRef.current);
    },
    [],
  );

  return useCallback((form: HTMLFormElement, invalidFieldNames: readonly string[], message = DEFAULT_ERROR_MESSAGE) => {
    if (animationFrameRef.current !== null) window.cancelAnimationFrame(animationFrameRef.current);
    toast.error(message);
    animationFrameRef.current = window.requestAnimationFrame(() => {
      animationFrameRef.current = null;
      const target = findFirstInvalidTarget(form, invalidFieldNames);
      if (!target) return;

      const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      const behavior: ScrollBehavior = prefersReducedMotion ? "auto" : "smooth";
      const scrollContainer = target.scrollTarget.closest<HTMLElement>("[data-modal-scroll-container]");
      if (scrollContainer) {
        scrollWithinContainer(scrollContainer, target.scrollTarget, behavior);
      } else {
        target.scrollTarget.scrollIntoView({ behavior, block: "center", inline: "nearest" });
      }
      target.focusTarget.focus({ preventScroll: true });
    });
  }, []);
}

type InvalidTarget = {
  focusTarget: HTMLElement;
  scrollTarget: HTMLElement;
};

function findFirstInvalidTarget(form: HTMLFormElement, invalidFieldNames: readonly string[]): InvalidTarget | null {
  const fieldGroups = Array.from(form.querySelectorAll<HTMLElement>("[data-field-name]"));
  for (const fieldName of invalidFieldNames) {
    const fieldGroup = fieldGroups.find((candidate) => candidate.dataset.fieldName === fieldName);
    const focusTarget = fieldGroup?.querySelector<HTMLElement>("[data-form-error-focus]") ?? findNamedControl(form, fieldName);
    if (focusTarget) return { focusTarget, scrollTarget: fieldGroup ?? focusTarget };
  }

  const fallback = form.querySelector<HTMLElement>('[aria-invalid="true"]:not([type="hidden"]), :invalid:not([type="hidden"])');
  return fallback ? { focusTarget: fallback, scrollTarget: fallback.closest<HTMLElement>("[data-field-name]") ?? fallback } : null;
}

function findNamedControl(form: HTMLFormElement, fieldName: string) {
  const namedControl = form.elements.namedItem(fieldName);
  if (namedControl instanceof HTMLElement && namedControl.getAttribute("type") !== "hidden") return namedControl;
  if (namedControl && "length" in namedControl) {
    for (let index = 0; index < namedControl.length; index += 1) {
      const option = namedControl.item(index);
      if (option instanceof HTMLElement && option.getAttribute("type") !== "hidden") return option;
    }
  }
  return null;
}

function scrollWithinContainer(container: HTMLElement, target: HTMLElement, behavior: ScrollBehavior) {
  const containerRect = container.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const visibleOffset = Math.max((container.clientHeight - targetRect.height) * 0.34, 16);
  const top = Math.max(0, container.scrollTop + targetRect.top - containerRect.top - visibleOffset);
  container.scrollTo({ behavior, top });
}
