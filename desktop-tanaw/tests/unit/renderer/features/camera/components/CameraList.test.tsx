import { isValidElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Camera } from "../../../../../../src/types/enterprise";
import { CameraList } from "../../../../../../src/features/camera/components/CameraList";

const actions = { onAdd: () => undefined, onDelete: () => undefined, onSelect: () => undefined };

describe("CameraList", () => {
  it("keeps one Add Camera action available for an empty camera list", () => {
    const markup = renderToStaticMarkup(<CameraList cameras={[]} activeCamId={null} cameraLimit={6} {...actions} />);
    expect(markup).toContain("No cameras registered.");
    expect(markup.match(/Add Camera/g)).toHaveLength(1);
  });

  it("shows placeholder rows instead of the empty message while the saved cameras load", () => {
    const loading = renderToStaticMarkup(<CameraList cameras={[]} activeCamId={null} cameraLimit={6} loading {...actions} />);
    expect(loading).toContain('aria-label="Loading cameras"');
    expect(loading).toContain('aria-busy="true"');
    expect(loading).not.toContain("No cameras registered.");
    expect(loading.match(/Add Camera/g)).toHaveLength(1);

    const loaded = renderToStaticMarkup(<CameraList cameras={[camera(1)]} activeCamId={1} cameraLimit={6} loading {...actions} />);
    expect(loaded).not.toContain("Loading cameras");
    expect(loaded).toContain("Camera 1");
  });

  it("shows the heading alone, with no camera count or collapse toggle", () => {
    const markup = renderToStaticMarkup(<CameraList cameras={[camera(1), camera(2)]} activeCamId={1} cameraLimit={6} {...actions} />);
    expect(markup).toContain(">My Cameras</h3>");
    expect(markup).not.toContain("configured cameras\"");
    expect(markup).not.toContain("aria-expanded");
    expect(markup).not.toContain("camera-list-count");
  });

  it("gives every camera row its own named delete button beside the select button", () => {
    const markup = renderToStaticMarkup(<CameraList cameras={[camera(1), camera(2)]} activeCamId={2} cameraLimit={6} {...actions} />);
    expect(markup).toContain('aria-label="Delete Camera 1"');
    expect(markup).toContain('aria-label="Delete Camera 2"');
    expect(markup).toMatch(/<div class="camera-list-row" data-selected="true"><button[^>]*aria-label="Camera 2, /);
    expect(markup).not.toMatch(/<button[^>]*camera-list-item[^>]*>(?:(?!<\/button>).)*camera-list-delete/);
  });

  it("asks to delete the row's camera without also selecting it", () => {
    const deleted: Camera[] = [];
    const selected: number[] = [];
    const cameras = [camera(1), camera(2)];
    const tree = CameraList({ cameras, activeCamId: 1, cameraLimit: 6, onAdd: () => undefined, onDelete: (value) => deleted.push(value), onSelect: (id) => selected.push(id) });
    const deleteButton = findElement(tree, (props) => props["aria-label"] === "Delete Camera 2");
    let propagationStopped = false;
    (deleteButton.props.onClick as (event: { stopPropagation: () => void }) => void)({ stopPropagation: () => (propagationStopped = true) });

    expect(deleted).toEqual([cameras[1]]);
    expect(selected).toEqual([]);
    expect(propagationStopped).toBe(true);
  });

  it("shows independent running cards and retains one sidebar action", () => {
    const markup = renderToStaticMarkup(<CameraList cameras={[camera(1), camera(2)]} activeCamId={2} cameraLimit={6} {...actions} />);
    expect(markup.match(/>Running<\/span>/g)).toHaveLength(2);
    expect(markup.match(/Add Camera/g)).toHaveLength(1);
    expect(markup).toContain('aria-pressed="true"');
  });

  it("renders six independent cards and disables registration at the policy limit", () => {
    const markup = renderToStaticMarkup(
      <CameraList cameras={Array.from({ length: 6 }, (_, index) => camera(index + 1))} activeCamId={6} cameraLimit={6} {...actions} />,
    );

    expect(markup.match(/>Running<\/span>/g)).toHaveLength(6);
    expect(markup).toContain("This Enterprise account can register up to 6 cameras.");
    expect(markup).toContain("disabled");
  });

  it("keeps camera names, status and selection accessible", () => {
    const markup = renderToStaticMarkup(
      <CameraList cameras={[camera(1), { ...camera(2), status: "stopped" }]} activeCamId={2} cameraLimit={2} {...actions} />,
    );

    expect(markup).toMatch(/aria-label="Camera 2, Zone 2, Entry \/ Exit, stopped"[^>]*aria-pressed="true"/);
    expect(markup).toContain('aria-label="Camera 1, Zone 1, Entry / Exit, running"');
    expect(markup).toContain('aria-describedby="camera-configuration-limit"');
    expect(markup).toContain("disabled");
  });
});

type ElementProps = Record<string, unknown> & { children?: unknown };

/** Finds the first host element in a rendered tree whose props match, without a DOM. */
function findElement(node: unknown, matches: (props: ElementProps) => boolean): { props: ElementProps } {
  const found = searchElement(node, matches);
  if (!found) throw new Error("Element not found");
  return found;
}

function searchElement(node: unknown, matches: (props: ElementProps) => boolean): { props: ElementProps } | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = searchElement(child, matches);
      if (found) return found;
    }
    return null;
  }
  if (!isValidElement<ElementProps>(node)) return null;
  if (matches(node.props)) return node;
  return searchElement(node.props.children, matches);
}

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
