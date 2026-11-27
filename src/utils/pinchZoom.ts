export interface TouchPoint {
  clientX: number;
  clientY: number;
}

export interface FocalScrollInput {
  prevZoom: number;
  nextZoom: number;
  prevFocalX: number;
  prevFocalY: number;
  nextFocalX: number;
  nextFocalY: number;
  currentScrollLeft: number;
  currentScrollTop: number;
}

export const MIN_PINCH_ZOOM = 1;
export const MAX_PINCH_ZOOM = 5;

export function clampZoom(
  zoom: number,
  min: number = MIN_PINCH_ZOOM,
  max: number = MAX_PINCH_ZOOM,
): number {
  if (!Number.isFinite(zoom)) return min;
  const clamped = Math.min(max, Math.max(min, zoom));
  return Math.round(clamped * 1000) / 1000;
}

export function getTouchDistance(a: TouchPoint, b: TouchPoint): number {
  return Math.hypot(b.clientX - a.clientX, b.clientY - a.clientY);
}

export function getTouchMidpoint(a: TouchPoint, b: TouchPoint): TouchPoint {
  return {
    clientX: (a.clientX + b.clientX) / 2,
    clientY: (a.clientY + b.clientY) / 2,
  };
}

export function computePinchZoom(
  startDistance: number,
  currentDistance: number,
  startZoom: number,
  min: number = MIN_PINCH_ZOOM,
  max: number = MAX_PINCH_ZOOM,
): number {
  if (
    !Number.isFinite(startDistance) ||
    !Number.isFinite(currentDistance) ||
    startDistance <= 0 ||
    currentDistance <= 0
  ) {
    return clampZoom(startZoom, min, max);
  }
  return clampZoom(startZoom * (currentDistance / startDistance), min, max);
}

export function computeFocalScroll({
  prevZoom,
  nextZoom,
  prevFocalX,
  prevFocalY,
  nextFocalX,
  nextFocalY,
  currentScrollLeft,
  currentScrollTop,
}: FocalScrollInput): {scrollLeft: number; scrollTop: number} {
  if (!Number.isFinite(prevZoom) || prevZoom <= 0) {
    return {
      scrollLeft: Math.max(0, currentScrollLeft),
      scrollTop: Math.max(0, currentScrollTop),
    };
  }
  const ratio = nextZoom / prevZoom;
  const contentX = (currentScrollLeft + prevFocalX) * ratio;
  const contentY = (currentScrollTop + prevFocalY) * ratio;

  return {
    scrollLeft: Math.max(0, contentX - nextFocalX),
    scrollTop: Math.max(0, contentY - nextFocalY),
  };
}
