export type MetricsFieldPoint = { x: number; y: number };
export type MetricsFieldLine = MetricsFieldPoint & { angle: number; offsetX: number; offsetY: number };

const lineSpacing = 16;
const fieldRadius = 64;
const maximumOffset = 8;

export function createMetricsField(width: number, height: number) {
  const lines: MetricsFieldLine[] = [];
  for (let y = lineSpacing / 2; y < height; y += lineSpacing) {
    for (let x = lineSpacing / 2; x < width; x += lineSpacing) {
      lines.push({ x, y, angle: 0, offsetX: 0, offsetY: 0 });
    }
  }
  return lines;
}

export function advanceMetricsField(lines: MetricsFieldLine[], pointer: MetricsFieldPoint | null, elapsedMs: number) {
  const distantEase = 1 - Math.exp(-elapsedMs / 145);
  const nearbyEase = 1 - Math.exp(-elapsedMs / 52);
  let moving = false;

  for (const line of lines) {
    let targetAngle = 0;
    let offsetX = 0;
    let offsetY = 0;
    let influence = 0;

    if (pointer) {
      const dx = pointer.x - line.x;
      const dy = pointer.y - line.y;
      const distanceSquared = dx * dx + dy * dy;
      if (distanceSquared < fieldRadius * fieldRadius) {
        const distance = Math.sqrt(distanceSquared);
        const proximity = 1 - distance / fieldRadius;
        influence = proximity * proximity * (3 - 2 * proximity);
        const push = (maximumOffset * influence) / Math.max(4, distance);
        offsetX = -dx * push;
        offsetY = -dy * push;
      }
      targetAngle = distanceSquared > 0 ? Math.atan2(dx, dy) : line.angle;
    }

    const turn = normalizeAxis(targetAngle - line.angle);
    const dx = offsetX - line.offsetX;
    const dy = offsetY - line.offsetY;
    const settled = Math.abs(turn) < 0.002 && Math.abs(dx) < 0.03 && Math.abs(dy) < 0.03;
    const ease = settled ? 1 : distantEase + (nearbyEase - distantEase) * influence;
    line.angle = normalizeAxis(line.angle + turn * ease);
    line.offsetX = settled ? offsetX : line.offsetX + dx * ease;
    line.offsetY = settled ? offsetY : line.offsetY + dy * ease;
    moving ||= !settled;
  }

  return moving;
}

// A stroke has no arrowhead, so angles a half turn apart are the same axis.
function normalizeAxis(angle: number) {
  return angle - Math.round(angle / Math.PI) * Math.PI;
}
