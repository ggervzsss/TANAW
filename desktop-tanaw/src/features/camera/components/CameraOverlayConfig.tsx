import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from "react";
import { GripVertical, Minus, Move, Plus, RotateCcw, Trash2, Waves } from "lucide-react";
import type { Camera, TripwireLine, TripwirePoint } from "../../../types/enterprise";
import { clampFloatingToolbarPosition, hasExceededDragThreshold } from "../utils/floating-toolbar";
import { buildTripwireSvgPath, clampPoint, createTripwireLine, getTripwireAnchors, normalizeTripwireLine, pointDistance } from "../utils/tripwire-path";

type CameraOverlayConfigProps = {
  config: Camera["config"];
  isEditMode: boolean;
  onConfigChange?: (config: Camera["config"]) => void;
};

type TripwireKind = "entry" | "exit";
type SelectedPoint = { line: TripwireKind; pointIndex: number };
type ToolbarPosition = { x: number; y: number };
type ToolbarDragState = {
  offsetX: number;
  offsetY: number;
  pointerId: number;
  startClientX: number;
  startClientY: number;
  moved: boolean;
};
type DragState = { mode: "point"; line: TripwireKind; pointIndex: number } | { mode: "path"; line: TripwireKind; origin: TripwirePoint; originalPoints: TripwirePoint[] };

const lineStyles: Record<TripwireKind, { color: string; label: string; textClass: string }> = {
  entry: { color: "#22c55e", label: "ENTRY", textClass: "bg-emerald-400 text-black" },
  exit: { color: "#ef4444", label: "EXIT", textClass: "bg-red-500 text-white" },
};
const TOOLBAR_DRAG_THRESHOLD_PX = 5;

export function CameraOverlayConfig({ config, isEditMode, onConfigChange }: CameraOverlayConfigProps) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const suppressToolbarClickRef = useRef(false);
  const [activeLine, setActiveLine] = useState<TripwireKind>("entry");
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [selectedPoint, setSelectedPoint] = useState<SelectedPoint | null>(null);
  const [isAddMode, setIsAddMode] = useState(false);
  const [isToolbarCollapsed, setIsToolbarCollapsed] = useState(false);
  const [toolbarPosition, setToolbarPosition] = useState<ToolbarPosition>({ x: 12, y: 12 });
  const [toolbarDragState, setToolbarDragState] = useState<ToolbarDragState | null>(null);
  const canEdit = isEditMode && Boolean(onConfigChange);
  const tripwires = normalizeTripwires(config.tripwires ?? getDefaultTripwires(config.tripwire));
  const activeTripwire = tripwires[activeLine];
  const activePoints = getTripwireAnchors(activeTripwire);
  const activeCurve = activeTripwire.curve ?? "smooth";
  const canDeleteSelectedPoint = Boolean(selectedPoint && selectedPoint.line === activeLine && activePoints.length > 2);
  const showRoiOverlay = !isFullFrameRoi(config.roi);

  const clampToolbarPosition = useCallback((position: ToolbarPosition): ToolbarPosition => {
    const overlay = overlayRef.current;
    if (!overlay) {
      return {
        x: Math.max(8, position.x),
        y: Math.max(8, position.y),
      };
    }

    const padding = 8;
    const bounds = overlay.getBoundingClientRect();
    const toolbarWidth = toolbarRef.current?.offsetWidth ?? 0;
    const toolbarHeight = toolbarRef.current?.offsetHeight ?? 0;
    return clampFloatingToolbarPosition(position, { width: bounds.width, height: bounds.height }, { width: toolbarWidth, height: toolbarHeight }, padding);
  }, []);

  useEffect(() => {
    if (!canEdit) return undefined;

    const overlay = overlayRef.current;
    if (!overlay) return undefined;

    const resizeObserver = new ResizeObserver(() => {
      setToolbarPosition((current) => clampToolbarPosition(current));
    });
    resizeObserver.observe(overlay);

    return () => resizeObserver.disconnect();
  }, [canEdit, clampToolbarPosition]);

  useEffect(() => {
    if (!canEdit) return undefined;

    const frameId = window.requestAnimationFrame(() => {
      setToolbarPosition((current) => clampToolbarPosition(current));
    });

    return () => window.cancelAnimationFrame(frameId);
  }, [canEdit, clampToolbarPosition, isToolbarCollapsed]);

  const updateLine = (line: TripwireKind, nextLine: TripwireLine) => {
    onConfigChange?.({
      ...config,
      tripwires: {
        ...tripwires,
        [line]: normalizeTripwireLine(nextLine),
      },
    });
  };

  const updateLinePoints = (line: TripwireKind, points: TripwirePoint[], curve = tripwires[line].curve ?? "smooth") => {
    updateLine(line, createTripwireLine(points, curve));
  };

  const handleCanvasPointerDown = (event: PointerEvent<SVGSVGElement>) => {
    if (!canEdit) return;

    if (isAddMode) {
      const point = getPointerPercent(event);
      const nextPoints = insertPointAtNearestSegment(activePoints, point);
      const pointIndex = findNearestPointIndex(nextPoints, point);
      updateLinePoints(activeLine, nextPoints);
      setSelectedPoint({ line: activeLine, pointIndex });
      setIsAddMode(false);
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }

    setSelectedPoint(null);
  };

  const handlePointerMove = (event: PointerEvent<SVGSVGElement>) => {
    if (!canEdit || dragState === null) return;

    const point = getPointerPercent(event);
    if (dragState.mode === "point") {
      const points = getTripwireAnchors(tripwires[dragState.line]);
      const nextPoints = points.map((existingPoint, index) => (index === dragState.pointIndex ? point : existingPoint));
      updateLinePoints(dragState.line, nextPoints);
      return;
    }

    const deltaX = point.x - dragState.origin.x;
    const deltaY = point.y - dragState.origin.y;
    updateLinePoints(
      dragState.line,
      dragState.originalPoints.map((originalPoint) =>
        clampPoint({
          x: originalPoint.x + deltaX,
          y: originalPoint.y + deltaY,
        }),
      ),
    );
  };

  const handlePointerUp = (event: PointerEvent<SVGSVGElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setDragState(null);
  };

  const handleDoubleClick = (event: React.MouseEvent<SVGSVGElement>) => {
    if (!canEdit) return;

    const point = getPointerPercent(event);
    const nextPoints = insertPointAtNearestSegment(activePoints, point);
    const pointIndex = findNearestPointIndex(nextPoints, point);
    updateLinePoints(activeLine, nextPoints);
    setSelectedPoint({ line: activeLine, pointIndex });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (!canEdit || (event.key !== "Delete" && event.key !== "Backspace")) return;
    if (!deleteSelectedPoint()) return;

    event.preventDefault();
  };

  const addPointToActivePath = () => {
    const insertion = midpointOfLongestSegment(activePoints);
    const nextPoints = [...activePoints.slice(0, insertion.segmentIndex + 1), insertion.point, ...activePoints.slice(insertion.segmentIndex + 1)];
    updateLinePoints(activeLine, nextPoints);
    setSelectedPoint({ line: activeLine, pointIndex: insertion.segmentIndex + 1 });
    setIsAddMode(false);
  };

  const deleteSelectedPoint = () => {
    if (!canDeleteSelectedPoint || selectedPoint?.line !== activeLine) return false;

    const nextPoints = activePoints.filter((_, index) => index !== selectedPoint.pointIndex);
    updateLinePoints(activeLine, nextPoints);
    setSelectedPoint({ line: activeLine, pointIndex: Math.min(selectedPoint.pointIndex, nextPoints.length - 1) });
    return true;
  };

  const toggleCurveMode = () => {
    updateLinePoints(activeLine, activePoints, activeCurve === "smooth" ? "linear" : "smooth");
  };

  const resetActiveLine = () => {
    updateLine(activeLine, getDefaultTripwires(config.tripwire)[activeLine]);
    setSelectedPoint(null);
    setIsAddMode(false);
  };

  const handleToolbarDragStart = (event: PointerEvent<HTMLButtonElement>) => {
    if (!canEdit) return;

    const overlay = overlayRef.current;
    if (!overlay) return;

    const overlayBounds = overlay.getBoundingClientRect();
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    suppressToolbarClickRef.current = false;
    setToolbarDragState({
      offsetX: event.clientX - overlayBounds.left - toolbarPosition.x,
      offsetY: event.clientY - overlayBounds.top - toolbarPosition.y,
      pointerId: event.pointerId,
      startClientX: event.clientX,
      startClientY: event.clientY,
      moved: false,
    });
  };

  const handleToolbarDragMove = (event: PointerEvent<HTMLButtonElement>) => {
    if (toolbarDragState === null || toolbarDragState.pointerId !== event.pointerId) return;

    const overlay = overlayRef.current;
    if (!overlay) return;

    const overlayBounds = overlay.getBoundingClientRect();
    const moved =
      toolbarDragState.moved || hasExceededDragThreshold({ x: toolbarDragState.startClientX, y: toolbarDragState.startClientY }, { x: event.clientX, y: event.clientY }, TOOLBAR_DRAG_THRESHOLD_PX);
    if (!moved) return;

    event.preventDefault();
    event.stopPropagation();
    suppressToolbarClickRef.current = true;
    if (!toolbarDragState.moved) {
      setToolbarDragState((current) => (current ? { ...current, moved: true } : current));
    }
    setToolbarPosition(
      clampToolbarPosition({
        x: event.clientX - overlayBounds.left - toolbarDragState.offsetX,
        y: event.clientY - overlayBounds.top - toolbarDragState.offsetY,
      }),
    );
  };

  const handleToolbarDragEnd = (event: PointerEvent<HTMLButtonElement>) => {
    if (toolbarDragState?.pointerId === event.pointerId && event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setToolbarDragState(null);
  };

  return (
    <div ref={overlayRef} className={`absolute inset-0 ${canEdit ? "" : "pointer-events-none"}`} onKeyDown={handleKeyDown} tabIndex={canEdit ? 0 : -1}>
      {showRoiOverlay && (
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
      )}

      {canEdit && (
        <div
          ref={toolbarRef}
          className="pointer-events-auto absolute top-0 left-0 z-20 max-w-[calc(100%-1rem)] rounded-sm border border-white/15 bg-black/75 p-1.5 shadow-sm backdrop-blur-sm"
          style={{ transform: `translate(${toolbarPosition.x}px, ${toolbarPosition.y}px)` }}
        >
          {isToolbarCollapsed ? (
            <button
              type="button"
              onClick={() => {
                if (suppressToolbarClickRef.current) {
                  suppressToolbarClickRef.current = false;
                  return;
                }
                setIsToolbarCollapsed(false);
              }}
              onPointerDown={handleToolbarDragStart}
              onPointerMove={handleToolbarDragMove}
              onPointerUp={handleToolbarDragEnd}
              onPointerCancel={handleToolbarDragEnd}
              onLostPointerCapture={() => setToolbarDragState(null)}
              className="flex cursor-grab touch-none items-center gap-1.5 rounded-sm bg-white/10 px-2 py-1.5 text-[10px] font-bold text-white transition-colors hover:bg-white/20 active:cursor-grabbing"
              aria-label="Show tripwire toolbar"
            >
              <Waves size={13} /> Tripwire
            </button>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-1">
                <button
                  type="button"
                  onPointerDown={handleToolbarDragStart}
                  onPointerMove={handleToolbarDragMove}
                  onPointerUp={handleToolbarDragEnd}
                  onPointerCancel={handleToolbarDragEnd}
                  onLostPointerCapture={() => setToolbarDragState(null)}
                  className="cursor-grab rounded-sm p-1.5 text-white/80 transition-colors hover:bg-white/20 hover:text-white active:cursor-grabbing"
                  aria-label="Move tripwire toolbar"
                >
                  <GripVertical size={13} />
                </button>
                {(["entry", "exit"] as const).map((line) => (
                  <button
                    key={line}
                    type="button"
                    onClick={() => {
                      setActiveLine(line);
                      setSelectedPoint(null);
                    }}
                    className={`rounded-sm px-2 py-1 text-[10px] font-bold transition-colors ${activeLine === line ? lineStyles[line].textClass : "bg-white/10 text-white hover:bg-white/20"}`}
                    aria-pressed={activeLine === line}
                  >
                    {lineStyles[line].label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setIsAddMode((current) => !current)}
                  className={`flex items-center gap-1 rounded-sm px-2 py-1 text-[10px] font-bold transition-colors ${isAddMode ? "bg-white text-slate-950" : "bg-white/10 text-white hover:bg-white/20"}`}
                  aria-label="Click the video to add an anchor point"
                  aria-pressed={isAddMode}
                >
                  <Plus size={12} /> Point
                </button>
                <button type="button" onClick={addPointToActivePath} className="rounded-sm p-1.5 text-white transition-colors hover:bg-white/20" aria-label="Insert an anchor on the longest segment">
                  <Move size={13} />
                </button>
                <button
                  type="button"
                  onClick={deleteSelectedPoint}
                  disabled={!canDeleteSelectedPoint}
                  className="rounded-sm p-1.5 text-white transition-colors hover:bg-white/20 disabled:cursor-not-allowed disabled:text-white/30"
                  aria-label="Delete selected anchor"
                >
                  <Trash2 size={13} />
                </button>
                <button type="button" onClick={toggleCurveMode} className="rounded-sm p-1.5 text-white transition-colors hover:bg-white/20" aria-label="Toggle smooth or linear tripwire path">
                  <Waves size={13} />
                </button>
                <button type="button" onClick={resetActiveLine} className="rounded-sm p-1.5 text-white transition-colors hover:bg-white/20" aria-label="Reset active tripwire">
                  <RotateCcw size={13} />
                </button>
                <button type="button" onClick={() => setIsToolbarCollapsed(true)} className="rounded-sm p-1.5 text-white transition-colors hover:bg-white/20" aria-label="Hide tripwire toolbar">
                  <Minus size={13} />
                </button>
              </div>
              <p className="mt-1 max-w-96 text-[9px] leading-snug font-semibold text-white/70">Drag anchors or the path. Double-click to add an anchor, select one and press Delete to remove it.</p>
            </>
          )}
        </div>
      )}

      <svg
        className={`absolute inset-0 h-full w-full touch-none ${canEdit && isAddMode ? "cursor-crosshair" : canEdit ? "cursor-default" : ""}`}
        preserveAspectRatio="none"
        viewBox="0 0 100 100"
        onDoubleClick={handleDoubleClick}
        onPointerDown={handleCanvasPointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {(["entry", "exit"] as const).map((line) => (
          <TripwireSvgPath
            key={line}
            canEdit={canEdit}
            isActive={activeLine === line}
            line={tripwires[line]}
            lineKind={line}
            selectedPointIndex={selectedPoint?.line === line ? selectedPoint.pointIndex : null}
            onPathPointerDown={(event) => {
              if (!canEdit) return;
              event.stopPropagation();
              setActiveLine(line);
              setSelectedPoint(null);
              event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId);
              setDragState({
                mode: "path",
                line,
                origin: getPointerPercent(event),
                originalPoints: getTripwireAnchors(tripwires[line]),
              });
            }}
            onPointPointerDown={(event, pointIndex) => {
              if (!canEdit) return;
              event.stopPropagation();
              setActiveLine(line);
              setSelectedPoint({ line, pointIndex });
              event.currentTarget.ownerSVGElement?.setPointerCapture(event.pointerId);
              setDragState({ mode: "point", line, pointIndex });
            }}
          />
        ))}
      </svg>
    </div>
  );
}

type TripwireSvgPathProps = {
  canEdit: boolean;
  isActive: boolean;
  line: TripwireLine;
  lineKind: TripwireKind;
  selectedPointIndex: number | null;
  onPathPointerDown: (event: PointerEvent<SVGPathElement>) => void;
  onPointPointerDown: (event: PointerEvent<SVGCircleElement>, pointIndex: number) => void;
};

function TripwireSvgPath({ canEdit, isActive, line, lineKind, selectedPointIndex, onPathPointerDown, onPointPointerDown }: TripwireSvgPathProps) {
  const style = lineStyles[lineKind];
  const points = getTripwireAnchors(line);
  const path = buildTripwireSvgPath(line);
  const firstPoint = points[0];
  const labelX = Math.min(94, Math.max(2, firstPoint.x + 1.5));
  const labelY = Math.min(96, Math.max(4, firstPoint.y - 2));

  return (
    <g>
      <path d={path} fill="none" stroke="rgba(0,0,0,0.62)" strokeLinecap="round" strokeLinejoin="round" strokeWidth={isActive ? 3.4 : 2.8} vectorEffect="non-scaling-stroke" />
      <path
        d={path}
        fill="none"
        stroke={style.color}
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={isActive ? 2.5 : 2}
        vectorEffect="non-scaling-stroke"
        className={canEdit ? "cursor-move" : ""}
        onPointerDown={onPathPointerDown}
      />
      {canEdit && <path d={path} fill="none" stroke="transparent" strokeLinecap="round" strokeLinejoin="round" strokeWidth={8} className="cursor-move" onPointerDown={onPathPointerDown} />}
      <text x={labelX} y={labelY} fill={style.color} className="text-[2.7px] font-bold drop-shadow-[0_1px_1px_rgba(0,0,0,0.8)]">
        {style.label}
      </text>
      {canEdit &&
        points.map((point, pointIndex) => {
          const isSelected = selectedPointIndex === pointIndex;
          return (
            <g key={`${lineKind}-${pointIndex}`}>
              <circle
                cx={point.x}
                cy={point.y}
                r={isSelected ? 2.4 : isActive ? 1.9 : 1.35}
                fill={isSelected ? style.color : "#ffffff"}
                stroke={isSelected ? "#ffffff" : style.color}
                strokeWidth={isSelected ? 0.9 : 0.75}
                vectorEffect="non-scaling-stroke"
                className="cursor-grab"
                onPointerDown={(event) => onPointPointerDown(event, pointIndex)}
              />
              {isSelected && <circle cx={point.x} cy={point.y} r={3.25} fill="none" stroke="rgba(255,255,255,0.75)" strokeWidth={0.65} vectorEffect="non-scaling-stroke" />}
            </g>
          );
        })}
    </g>
  );
}

function getPointerPercent(event: PointerEvent<SVGElement> | MouseEvent<SVGElement>) {
  const svg = event.currentTarget instanceof SVGSVGElement ? event.currentTarget : event.currentTarget.ownerSVGElement;
  const bounds = svg?.getBoundingClientRect();
  if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
    return { x: 0, y: 0 };
  }

  return clampPoint({
    x: ((event.clientX - bounds.left) / bounds.width) * 100,
    y: ((event.clientY - bounds.top) / bounds.height) * 100,
  });
}

function getDefaultTripwires(centerX: number) {
  return normalizeTripwires({
    entry: createTripwireLine([
      { x: Math.max(5, centerX - 8), y: 12 },
      { x: Math.max(5, centerX - 8), y: 88 },
    ]),
    exit: createTripwireLine([
      { x: Math.min(95, centerX + 8), y: 12 },
      { x: Math.min(95, centerX + 8), y: 88 },
    ]),
  });
}

function isFullFrameRoi(roi: Camera["config"]["roi"]) {
  return roi.top === 0 && roi.left === 0 && roi.width === 100 && roi.height === 100;
}

function normalizeTripwires(tripwires: Camera["config"]["tripwires"]) {
  return {
    entry: normalizeTripwireLine(tripwires.entry),
    exit: normalizeTripwireLine(tripwires.exit),
  };
}

function insertPointAtNearestSegment(points: TripwirePoint[], point: TripwirePoint) {
  const segmentIndex = nearestSegmentIndex(points, point);
  return [...points.slice(0, segmentIndex + 1), point, ...points.slice(segmentIndex + 1)];
}

function nearestSegmentIndex(points: TripwirePoint[], point: TripwirePoint) {
  let closestIndex = 0;
  let closestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < points.length - 1; index += 1) {
    const distance = distanceToSegment(point, points[index], points[index + 1]);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestIndex = index;
    }
  }

  return closestIndex;
}

function midpointOfLongestSegment(points: TripwirePoint[]) {
  let segmentIndex = 0;
  let segmentLength = 0;

  for (let index = 0; index < points.length - 1; index += 1) {
    const length = pointDistance(points[index], points[index + 1]);
    if (length > segmentLength) {
      segmentLength = length;
      segmentIndex = index;
    }
  }

  const start = points[segmentIndex];
  const end = points[segmentIndex + 1];
  return {
    point: {
      x: (start.x + end.x) / 2,
      y: (start.y + end.y) / 2,
    },
    segmentIndex,
  };
}

function findNearestPointIndex(points: TripwirePoint[], point: TripwirePoint) {
  return points.reduce((closestIndex, currentPoint, currentIndex) => {
    return pointDistance(currentPoint, point) < pointDistance(points[closestIndex], point) ? currentIndex : closestIndex;
  }, 0);
}

function distanceToSegment(point: TripwirePoint, start: TripwirePoint, end: TripwirePoint) {
  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const lengthSquared = deltaX * deltaX + deltaY * deltaY;

  if (lengthSquared <= 1e-9) return pointDistance(point, start);

  const projection = Math.max(0, Math.min(1, ((point.x - start.x) * deltaX + (point.y - start.y) * deltaY) / lengthSquared));
  return pointDistance(point, {
    x: start.x + projection * deltaX,
    y: start.y + projection * deltaY,
  });
}
