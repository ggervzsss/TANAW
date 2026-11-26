import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SettingsActions, SettingsGroup } from "../../../../src/ui-kit/patterns/GeneralSettings";

const noop = () => undefined;

describe("SettingsActions save bar", () => {
  it("shows no bar while the form has nothing to save, but keeps an empty live region mounted", () => {
    const markup = renderToStaticMarkup(
      <SettingsActions busy={false} dirty={false} onDiscard={noop}>
        Save changes
      </SettingsActions>,
    );
    expect(markup).toBe('<div class="contents"><p role="status" class="sr-only"></p></div>');
    expect(markup).not.toContain("tanaw-settings-actions");
    expect(markup).not.toContain("Discard");
    expect(markup).not.toContain("Save changes");
  });

  it("offers Discard and the save action once the form changes", () => {
    const markup = renderToStaticMarkup(
      <SettingsActions busy={false} dirty onDiscard={noop}>
        Save changes
      </SettingsActions>,
    );
    expect(markup).toContain("Unsaved changes");
    expect(markup).toContain("Discard");
    expect(markup).toContain('type="submit"');
    expect(markup).toContain("Save changes");
    expect(markup).not.toContain("Cancel");
  });

  it("stays while saving and blocks both actions", () => {
    const markup = renderToStaticMarkup(
      <SettingsActions busy dirty={false} onDiscard={noop}>
        Save changes
      </SettingsActions>,
    );
    expect(markup).toContain("Saving changes...");
    expect(markup.match(/disabled=""/g)).toHaveLength(2);
  });
});

describe("SettingsGroup", () => {
  it("puts group actions level with the title only when given", () => {
    expect(renderToStaticMarkup(<SettingsGroup title="Theme">body</SettingsGroup>)).not.toContain("tanaw-settings-group-actions");
    const markup = renderToStaticMarkup(
      <SettingsGroup title="Display Preferences" actions={<button type="button">Reset to default</button>}>
        body
      </SettingsGroup>,
    );
    expect(markup).toContain('class="tanaw-settings-group-header"');
    expect(markup).toContain('<div class="tanaw-settings-group-actions"><button type="button">Reset to default</button></div>');
  });
});
