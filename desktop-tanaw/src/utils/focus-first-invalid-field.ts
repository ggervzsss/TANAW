type InvalidTarget = {
  focusTarget: HTMLElement;
  scrollTarget: HTMLElement;
};

export function focusFirstInvalidField(form: HTMLFormElement, invalidFieldNames: readonly string[]) {
  const target = findFirstInvalidTarget(form, invalidFieldNames);
  if (!target) return;

  const behavior: ScrollBehavior = window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
  const scrollContainer = target.scrollTarget.closest<HTMLElement>("[data-form-scroll-container]");
  if (scrollContainer) {
    scrollWithinContainer(scrollContainer, target.scrollTarget, behavior);
  } else {
    target.scrollTarget.scrollIntoView({ behavior, block: "center", inline: "nearest" });
  }
  target.focusTarget.focus({ preventScroll: true });
}

function findFirstInvalidTarget(form: HTMLFormElement, invalidFieldNames: readonly string[]): InvalidTarget | null {
  const fieldGroups = Array.from(form.querySelectorAll<HTMLElement>("[data-field-name]"));
  for (const fieldName of invalidFieldNames) {
    const fieldGroup = fieldGroups.find((candidate) => candidate.dataset.fieldName === fieldName);
    const focusTarget = fieldGroup?.querySelector<HTMLElement>("[data-form-error-focus]");
    if (focusTarget) return { focusTarget, scrollTarget: fieldGroup ?? focusTarget };
  }
  return null;
}

function scrollWithinContainer(container: HTMLElement, target: HTMLElement, behavior: ScrollBehavior) {
  const containerRect = container.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const topbarOffset = 112;
  const top = Math.max(0, container.scrollTop + targetRect.top - containerRect.top - topbarOffset);
  container.scrollTo({ behavior, top });
}
