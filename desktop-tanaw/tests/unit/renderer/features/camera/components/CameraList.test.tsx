import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Camera } from "../../../../../../src/types/enterprise";
import { CameraList } from "../../../../../../src/features/camera/components/CameraList";

const actions = { onAdd: () => undefined, onSelect: () => undefined, onToggle: () => undefined };

describe("CameraList", () => {
  it("keeps one Add Camera action available for an empty camera list", () => {
    const markup = renderToStaticMarkup(<CameraList cameras={[]} activeCamId={null} cameraLimit={6} collapsed={false} {...actions} />);
    expect(markup).toContain("No cameras registered.");
    expect(markup.match(/Add Camera/g)).toHaveLength(1);
  });

  it("keeps an accessible toggle for both sidebar states", () => {
    const expanded = renderToStaticMarkup(<CameraList cameras={[]} activeCamId={null} cameraLimit={6} collapsed={false} {...actions} />);
    const collapsed = renderToStaticMarkup(<CameraList cameras={[]} activeCamId={null} cameraLimit={6} collapsed {...actions} />);
    expect(expanded).toContain('aria-label="Collapse configured cameras"');
    expect(expanded).toContain('aria-expanded="true"');
    expect(collapsed).toContain('aria-label="Expand configured cameras"');
    expect(collapsed).toContain('aria-expanded="false"');
  });

  it("shows independent running cards and retains one sidebar action", () => {
    const markup = renderToStaticMarkup(<CameraList cameras={[camera(1), camera(2)]} activeCamId={2} cameraLimit={6} collapsed={false} {...actions} />);
    expect(markup.match(/>Running<\/span>/g)).toHaveLength(2);
    expect(markup.match(/Add Camera/g)).toHaveLength(1);
    expect(markup).toContain('aria-pressed="true"');
  });

  it("renders six independent cards and disables registration at the policy limit", () => {
    const markup = renderToStaticMarkup(
      <CameraList cameras={Array.from({ length: 6 }, (_, index) => camera(index + 1))} activeCamId={6} cameraLimit={6} collapsed={false} {...actions} />,
    );

    expect(markup.match(/>Running<\/span>/g)).toHaveLength(6);
    expect(markup).toContain("This Enterprise account can register up to 6 cameras.");
    expect(markup).toContain("disabled");
  });

  it("keeps camera names, status and selection accessible in compact mode", () => {
    const markup = renderToStaticMarkup(
      <CameraList cameras={[camera(1), { ...camera(2), status: "stopped" }]} activeCamId={2} cameraLimit={2} collapsed {...actions} />,
    );

    expect(markup).toContain('aria-label="2 configured cameras"');
    expect(markup).toMatch(/aria-label="Camera 2, Zone 2, Entry \/ Exit, stopped"[^>]*aria-pressed="true"/);
    expect(markup).toContain('aria-label="Camera 1, Zone 1, Entry / Exit, running"');
    expect(markup).toContain('aria-label="Add Camera"');
    expect(markup).toContain("disabled");
  });
});

function camera(id: number): Camera {
  return {
    id,
    name: `Camera ${id}`,
    status: "running",
    zone: `Zone ${id}`,
    rtsp: `rtsp://192.168.1.${id}/stream2`,
    cameraHost: `192.168.1.${id}`,
    processingProfile: "auto",
    confidence: 0.35,
    config: {
      tripwire: 50,
      tripwires: {
        entry: { start: { x: 40, y: 0 }, end: { x: 40, y: 100 } },
        exit: { start: { x: 60, y: 0 }, end: { x: 60, y: 100 } },
      },
      roi: { top: 0, left: 0, width: 100, height: 100 },
      reverse: false,
    },
  };
}
