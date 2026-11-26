import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DisplayPreferencesView } from "../../../../../src/features/preferences/DisplayPreferencesView";
import { SystemDisplayPreferencesContext, type SystemDisplayPreferences } from "../../../../../src/features/preferences/system-display-preferences";

function renderWith(overrides: Partial<SystemDisplayPreferences>) {
  const value: SystemDisplayPreferences = {
    timeFormat: "12-hour",
    displayPreferences: { textSize: "default" },
    saveStatus: "saved",
    updateDisplayPreferences: () => undefined,
    resetDisplayPreferences: () => undefined,
    retryDisplayPreferencesSave: () => undefined,
    ...overrides,
  };
  return renderToStaticMarkup(
    <SystemDisplayPreferencesContext.Provider value={value}>
      <DisplayPreferencesView />
    </SystemDisplayPreferencesContext.Provider>,
  );
}

describe("DisplayPreferencesView", () => {
  it("offers text size only, beside a live preview", () => {
    const markup = renderWith({});
    expect(markup).not.toMatch(/interface scale/i);
    expect(markup.match(/type="radio"/g)).toHaveLength(4);
    expect(markup).toContain('role="radiogroup"');
    expect(markup).toContain("Live preview");
  });

  it("keeps the save status and Reset in the group header", () => {
    const markup = renderWith({});
    const header = markup.slice(markup.indexOf("<header"), markup.indexOf("</header>"));
    expect(header).toContain("Saved");
    expect(header).toContain("Reset to default");
    expect(header).toMatch(/<button[^>]*disabled=""[^>]*>.*Reset to default/);
  });

  it("sets the preview in the chosen size's own pixel size", () => {
    const markup = renderWith({ displayPreferences: { textSize: "extra-large" } });
    expect(markup).toContain('class="tanaw-display-preview-card" style="font-size:20px"');
    expect(markup).toContain("Extra Large text, 20px base size");
    expect(markup).toMatch(/<button[^>]*>(?:(?!disabled).)*Reset to default/);
  });

  it("shows Retry when the last save failed", () => {
    expect(renderWith({ saveStatus: "error" })).toContain("Retry");
  });
});
