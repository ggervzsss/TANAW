import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { PortalBrand } from "./PortalTopbar";
import { getPortalTopbarThemeClasses } from "./portalTopbarTheme";

describe("PortalBrand", () => {
  it.each([
    ["admin", "Admin Portal"],
    ["staff", "Staff Portal"],
    ["it", "IT Portal"],
  ] as const)("renders the %s portal label as non-interactive text", (role, label) => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <PortalBrand role={role} />
      </MemoryRouter>,
    );
    const interactiveContents = Array.from(markup.matchAll(/<(?:a|button)\b[^>]*>([\s\S]*?)<\/(?:a|button)>/g), (match) => match[1]);
    const labelElement = markup.match(new RegExp(`<span[^>]*data-portal-role-label[^>]*>${label}<\\/span>`));

    expect(labelElement).not.toBeNull();
    expect(labelElement?.[0]).not.toContain("tabindex");
    expect(interactiveContents.every((content) => !content.includes(label))).toBe(true);
  });
});

describe("portal topbar theme treatment", () => {
  it("uses a materially darker frame and overlay for dark mode", () => {
    const light = getPortalTopbarThemeClasses("light");
    const dark = getPortalTopbarThemeClasses("dark");
    expect(light.frame).toContain("#043817");
    expect(dark.frame).toContain("#02090d");
    expect(dark.overlay).toContain("rgba(1,8,11,0.99)");
    expect(dark.image).not.toBe(light.image);
  });
});
