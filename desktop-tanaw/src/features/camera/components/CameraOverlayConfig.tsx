import { useState, type PointerEvent } from "react";
import { RotateCcw } from "lucide-react";
import type { Camera, TripwireLine } from "../../../types/enterprise";

type CameraOverlayConfigProps = {
  config: Camera["config"];
  isEditMode: boolean;
  onConfigChange?: (config: Camera["config"]) => void;
};

type TripwireKind = "entry" | "exit";
type DragState =
  | { mode: "draw"; line: TripwireKind }
  | { mode: "point"; line: TripwireKind; point: "start" | "end" }
  | { mode: "line"; line: TripwireKind; origin: { x: number; y: number }; original: TripwireLine };

const lineStyles: Record<TripwireKind, { color: string; label: string; textClass: string }> = {
  entry: { color: "#22c55e", label: "ENTRY", textClass: "bg-emerald-400 text-black" },
  exit: { color: "#ef4444", label: "EXIT", textClass: "bg-red-500 text-white" },
};

export function CameraOverlayConfig({ config, isEditMode, onConfigChange }: CameraOverlayConfigProps) {
  const [activeLine, setActiveLine] = useState<TripwireKind>("entry");
  const [dragState, setDragState] = useState<DragState | null>(null);
  const canEdit = isEditMode && Boolean(onConfigChange);
  const tripwires = config.tripwires ?? getDefaultTripwires(config.tripwire);

  const updateLine = (line: TripwireKind, nextLine: TripwireLine) => {
    onConfigChange?.({
      ...config,
      tripwires: {
        ...tripwires,
        [line]: nextLine,
      },
    });
  };

  const handleCanvasPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (!canEdit) return;

    const point = getPointerPercent(event);
    updateLine(activeLine, { start: point, end: point });
    setDragState({ mode: "draw", line: activeLine });
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (!canEdit || dragState === null) return;

    const point = getPointerPercent(event);
    if (dragState.mode === "draw") {
      updateLine(dragState.line, { ...tripwires[dragState.line], end: point });
      return;
    }

    if (dragState.mode === "point") {
      updateLine(dragState.line, { ...tripwires[dragState.line], [dragState.point]: point });
      return;
    }

    const deltaX = point.x - dragState.origin.x;
    const deltaY = point.y - dragState.origin.y;
    updateLine(dragState.line, {
      start: {
        x: clampPercent(dragState.original.start.x + deltaX),
        y: clampPercent(dragState.original.start.y + deltaY),
      },
      end: {
        x: clampPercent(dragState.original.end.x + deltaX),
        y: clampPercent(dragState.original.end.y + deltaY),
      },
    });
  };

  const handlePointerUp = (event: PointerEvent<SVGSVGElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragState(null);
  };

  const resetLines = () => {
    onConfigChange?.({
      ...config,
      tripwires: getDefaultTripwires(config.tripwire),
    });
  };

  return (
    <div className={`absolute inset-0 ${canEdit ? "" : "pointer-events-none"}`}>
      <div
        className={`pointer-events-none absolute border-2 border-dashed ${isEditMode ? "border-[#2d5eff] bg-[#2d5eff]/10" : "border-[#2d5eff]/60 bg-[#2d5eff]/5"}`}
        style={{
          top: `${config.roi.top}%`,
          left: `${config.roi.left}%`,
          width: `${config.roi.width}%`,
          height: `${config.roi.height}%`,
        }}
      >
        <span className="absolute right-1 bottom-1 rounded-sm bg-white/90 px-1 text-[9px] font-bold text-[#2d5eff] shadow-sm">ROI</span>
      </div>

      {canEdit && (
        <div className="absolute top-3 left-3 z-10 flex gap-1 rounded-sm border border-white/15 bg-black/70 p-1 shadow-sm backdrop-blur-sm">
          {(["entry", "exit"] as const).map((line) => (
            <button
              key={line}
              type="button"
              onClick={() => setActiveLine(line)}
              className={`rounded-sm px-2 py-1 text-[10px] font-bold transition-colors ${activeLine === line ? lineStyles[line].textClass : "bg-white/10 text-white hover:bg-white/20"}`}
            >
              {lineStyles[line].label}
            </button>
          ))}
          <button type="button" onClick={resetLines} className="rounded-sm p-1 text-white transition-colors hover:bg-white/20" title="Reset tripwire lines">
            <RotateCcw size={13} />
          </button>
        </div>
      )}

      <svg
        className={`absolute inset-0 h-full w-full ${canEdit ? "cursor-crosshair touch-none" : ""}`}
        preserveAspectRatio="none"
        viewBox="0 0 100 100"
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {(["entry", "exit"] as const).map((line) => (
          <TripwireSvgLine
            key={line}
            canEdit={canEdit}
            isActive={activeLine === line}
            line={tripwires[line]}
            lineKind={line}
            onLinePointerDown={(event) => {
              if (!canEdit) return;
              event.stopPropagation();
              setActiveLine(line);
              setDragState({ mode: "line", line, origin: getPointerPercent(event), original: tripwires[line] });
            }}
            onPointPointerDown={(event, point) => {
              if (!canEdit) return;
              event.stopPropagation();
              setActiveLine(line);
              setDragState({ mode: "point", line, point });
            }}
          />
        ))}
      </svg>
    </div>
  );
}

type TripwireSvgLineProps = {
  canEdit: boolean;
  isActive: boolean;
  line: TripwireLine;
  lineKind: TripwireKind;
  onLinePointerDown: (event: PointerEvent<SVGLineElement>) => void;
  onPointPointerDown: (event: PointerEvent<SVGCircleElement>, point: "start" | "end") => void;
};

function TripwireSvgLine({ canEdit, isActive, line, lineKind, onLinePointerDown, onPointPointerDown }: TripwireSvgLineProps) {
  const style = lineStyles[lineKind];
  const labelX = Math.min(94, Math.max(2, line.start.x + 1.5));
  const labelY = Math.min(96, Math.max(4, line.start.y - 2));

  return (
    <g>
      <line x1={line.start.x} y1={line.start.y} x2={line.end.x} y2={line.end.y} stroke="rgba(0,0,0,0.45)" strokeWidth={isActive ? 1.5 : 1.1} vectorEffect="non-scaling-stroke" />
      <line
        x1={line.start.x}
        y1={line.start.y}
        x2={line.end.x}
        y2={line.end.y}
        stroke={style.color}
        strokeWidth={isActive ? 2.4 : 2}
        vectorEffect="non-scaling-stroke"
        className={canEdit ? "cursor-move" : ""}
        onPointerDown={onLinePointerDown}
      />
      <text x={labelX} y={labelY} fill={style.color} className="text-[2.6px] font-bold drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]">
        {style.label}
      </text>
      {canEdit &&
        (["start", "end"] as const).map((point) => (
          <circle
            key={point}
            cx={line[point].x}
            cy={line[point].y}
            r={isActive ? 2.2 : 1.8}
            fill="#ffffff"
            stroke={style.color}
            strokeWidth={0.8}
            vectorEffect="non-scaling-stroke"
            className="cursor-grab"
            onPointerDown={(event) => onPointPointerDown(event, point)}
          />
        ))}
    </g>
  );
}

function getPointerPercent(event: PointerEvent<SVGElement>) {
  const svg = event.currentTarget instanceof SVGSVGElement ? event.currentTarget : event.currentTarget.ownerSVGElement;
  const bounds = svg?.getBoundingClientRect();
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
    return { x: 0, y: 0 };
  }

  return {
    x: clampPercent(((event.clientX - bounds.left) / bounds.width) * 100),
    y: clampPercent(((event.clientY - bounds.top) / bounds.height) * 100),
  };
}

function getDefaultTripwires(centerX: number) {
  return {
    entry: {
      start: { x: Math.max(5, centerX - 8), y: 12 },
      end: { x: Math.max(5, centerX - 8), y: 88 },
    },
    exit: {
      start: { x: Math.min(95, centerX + 8), y: 12 },
      end: { x: Math.min(95, centerX + 8), y: 88 },
    },
  };
}

function clampPercent(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}
