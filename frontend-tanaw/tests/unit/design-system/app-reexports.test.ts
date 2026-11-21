// The portal's helper modules must stay thin re-exports of the design-system helpers, whose
// behavior is tested once in canonical-helpers.test.ts.
import { describe, expect, it } from "vitest";
import * as canonical from "../../../src/design-system";
import { getNextDropdownIndex } from "../../../src/shared/components/ui/dropdownKeyboard";
import { DROPDOWN_SEARCH_MIN_OPTIONS, shouldShowDropdownSearch } from "../../../src/shared/components/ui/dropdownSearch";
import { toSentenceCase } from "../../../src/shared/utils/sentenceCase";

describe("portal helpers re-export the design-system implementation", () => {
  it("uses the canonical dropdown and sentence-case helpers", () => {
    expect(getNextDropdownIndex).toBe(canonical.getNextDropdownIndex);
    expect(shouldShowDropdownSearch).toBe(canonical.shouldShowDropdownSearch);
    expect(DROPDOWN_SEARCH_MIN_OPTIONS).toBe(canonical.DROPDOWN_SEARCH_MIN_OPTIONS);
    expect(toSentenceCase).toBe(canonical.toSentenceCase);
  });
});
