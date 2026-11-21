// The desktop helper modules must stay thin re-exports of the design-system helpers. Their behavior
// is tested once, in frontend-tanaw/tests/unit/design-system/canonical-helpers.test.ts, and
// tests/unit/configuration/design-system.test.ts proves this app's copy is identical to the source.
import { describe, expect, it } from "vitest";
import * as canonical from "../../../../src/design-system";
import { getNextDropdownIndex } from "../../../../src/components/dropdownKeyboard";
import { toSentenceCase } from "../../../../src/utils/sentence-case";

describe("desktop helpers re-export the design-system implementation", () => {
  it("uses the canonical dropdown and sentence-case helpers", () => {
    expect(getNextDropdownIndex).toBe(canonical.getNextDropdownIndex);
    expect(toSentenceCase).toBe(canonical.toSentenceCase);
  });
});
