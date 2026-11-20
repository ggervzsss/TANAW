import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { PerformanceStatus } from "../../../../../../src/features/camera/components/PerformanceStatus";

function render(effectiveProfile: string | null, analyticsFps: number | null) {
  return renderToStaticMarkup(
    <MemoryRouter>
      <PerformanceStatus effectiveProfile={effectiveProfile} analyticsFps={analyticsFps} />
    </MemoryRouter>,
  );
}

describe("PerformanceStatus", () => {
  it("shows what Auto picked and the AI frame rate, with a link to Developer Settings", () => {
    const markup = render("balanced", 11.64);
    expect(markup).toContain("Auto, using Balanced");
    expect(markup).toContain("(11.6 AI FPS)");
    expect(markup).toContain('href="/enterprise/settings/developer"');
    expect(markup).toContain(">Change<");
  });

  it("shows Auto alone before a camera reports its profile", () => {
    const markup = render(null, null);
    expect(markup).toContain(">Auto<");
    expect(markup).not.toContain("AI FPS");
  });
});
