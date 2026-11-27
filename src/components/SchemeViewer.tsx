import {useCallback, useEffect, useLayoutEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {
  Crosshair,
  Expand,
  Eye,
  EyeOff,
  ImageOff,
  Maximize2,
  Minimize2,
  RotateCcw,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import type {SensorScheme} from '../types/atm';
import {getSchemeImageUrl} from '../utils/assetPaths';
import {
  MAX_PINCH_ZOOM,
  MIN_PINCH_ZOOM,
  clampZoom,
  computePinchZoom,
  getTouchDistance,
  getTouchMidpoint,
} from '../utils/pinchZoom';

export interface HighlightPoint {
  name: string;
  x: number;
  y: number;
}

interface SchemeViewerProps {
  imageId: string;
  title: string;
  subtitle?: string;
  scheme?: SensorScheme;
  highlightedPoints?: HighlightPoint[];
  selectedSensorName?: string | null;
  onSelectSensor?: (sensorName: string) => void;
  onLookupErrorsForSensor?: (sensorName: string) => void;
  compact?: boolean;
  embedded?: boolean;
  fullscreenTrigger?: number;
}

const ZOOM_PRESETS = [1, 1.35, 1.75, 2.25, 3, 4, 5] as const;

function stepZoomUp(current: number): number {
  const next = ZOOM_PRESETS.find((z) => z > current + 0.05);
  return next ?? MAX_PINCH_ZOOM;
}

function stepZoomDown(current: number): number {
  for (let i = ZOOM_PRESETS.length - 1; i >= 0; i -= 1) {
    if (ZOOM_PRESETS[i] < current - 0.05) {
      return ZOOM_PRESETS[i];
    }
  }
  return MIN_PINCH_ZOOM;
}

interface DiagramSurfaceProps {
  imageUrl: string;
  imageId: string;
  title: string;
  scheme?: SensorScheme;
  highlightedPoints: HighlightPoint[];
  showAllPins: boolean;
  zoom: number;
  onZoomChange: (nextZoom: number) => void;
  isFullscreenMode: boolean;
  onRequestFullscreen?: () => void;
  maxHeightClass: string;
  imgStatus: 'loading' | 'loaded' | 'error';
  onImgStatusChange: (status: 'loading' | 'loaded' | 'error') => void;
  onSelectSensor?: (sensorName: string) => void;
}

function DiagramSurface({
  imageUrl,
  imageId,
  title,
  scheme,
  highlightedPoints,
  showAllPins,
  zoom,
  onZoomChange,
  isFullscreenMode,
  onRequestFullscreen,
  maxHeightClass,
  imgStatus,
  onImgStatusChange,
  onSelectSensor,
}: DiagramSurfaceProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;
  const onZoomChangeRef = useRef(onZoomChange);
  onZoomChangeRef.current = onZoomChange;

  const dragState = useRef<{
    active: boolean;
    pointerId: number | null;
    startX: number;
    startY: number;
    scrollLeft: number;
    scrollTop: number;
    moved: boolean;
  }>({
    active: false,
    pointerId: null,
    startX: 0,
    startY: 0,
    scrollLeft: 0,
    scrollTop: 0,
    moved: false,
  });

  const pinchState = useRef<{
    active: boolean;
    startDistance: number;
    startZoom: number;
    imgRatioX: number;
    imgRatioY: number;
  }>({
    active: false,
    startDistance: 0,
    startZoom: 1,
    imgRatioX: 0.5,
    imgRatioY: 0.5,
  });

  const recentPinchUntilRef = useRef<number>(0);
  const lastTapRef = useRef<{time: number; x: number; y: number}>({
    time: 0,
    x: 0,
    y: 0,
  });
  const pendingAnchorRef = useRef<{
    imgRatioX: number;
    imgRatioY: number;
    viewportX: number;
    viewportY: number;
  } | null>(null);

  const [isDragging, setIsDragging] = useState(false);

  const highlightedSet = new Set(
    highlightedPoints.map((p) => `${p.name}:${p.x.toFixed(4)}:${p.y.toFixed(4)}`),
  );

  const allMarkers = scheme?.markers ?? [];
  const passiveMarkers = showAllPins
    ? allMarkers.filter(
        ([name, x, y]) => !highlightedSet.has(`${name}:${x.toFixed(4)}:${y.toFixed(4)}`),
      )
    : [];

  // Auto-center only when image finishes loading or highlighted target changes
  const centerOnHighlight = useCallback(
    (smooth = false) => {
      const container = scrollRef.current;
      if (!container || imgStatus !== 'loaded' || highlightedPoints.length === 0) return;

      const target = highlightedPoints[0];
      const targetX = target.x * container.scrollWidth;
      const targetY = target.y * container.scrollHeight;
      const nextLeft = Math.max(0, targetX - container.clientWidth / 2);
      const nextTop = Math.max(0, targetY - container.clientHeight / 2);

      container.scrollTo({
        left: nextLeft,
        top: nextTop,
        behavior: smooth ? 'smooth' : 'auto',
      });
    },
    [imgStatus, highlightedPoints],
  );

  useEffect(() => {
    const id = window.requestAnimationFrame(() => centerOnHighlight(false));
    return () => window.cancelAnimationFrame(id);
  }, [centerOnHighlight]);

  // Apply focal-point scroll synchronously right after zoom width commits to DOM
  useLayoutEffect(() => {
    const pending = pendingAnchorRef.current;
    const container = scrollRef.current;
    const inner = innerRef.current;
    if (!pending || !container || !inner) return;
    const targetX = inner.offsetLeft + pending.imgRatioX * inner.offsetWidth;
    const targetY = inner.offsetTop + pending.imgRatioY * inner.offsetHeight;
    container.scrollLeft = Math.max(0, targetX - pending.viewportX);
    container.scrollTop = Math.max(0, targetY - pending.viewportY);
    pendingAnchorRef.current = null;
  }, [zoom]);

  // Native non-passive touch & wheel listeners so 2-finger pinch works reliably on Android/iOS
  useEffect(() => {
    const container = scrollRef.current;
    if (!container) return;

    const getImgRatioAt = (clientX: number, clientY: number) => {
      const inner = innerRef.current;
      if (!inner || inner.offsetWidth === 0 || inner.offsetHeight === 0) {
        return {imgRatioX: 0.5, imgRatioY: 0.5};
      }
      const innerRect = inner.getBoundingClientRect();
      return {
        imgRatioX: (clientX - innerRect.left) / innerRect.width,
        imgRatioY: (clientY - innerRect.top) / innerRect.height,
      };
    };

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const t0 = e.touches[0];
        const t1 = e.touches[1];
        const dist = getTouchDistance(t0, t1);
        const mid = getTouchMidpoint(t0, t1);
        const {imgRatioX, imgRatioY} = getImgRatioAt(mid.clientX, mid.clientY);

        dragState.current.active = false;
        dragState.current.pointerId = null;
        setIsDragging(false);

        pinchState.current = {
          active: true,
          startDistance: dist,
          startZoom: zoomRef.current,
          imgRatioX,
          imgRatioY,
        };
        recentPinchUntilRef.current = Date.now() + 450;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        e.preventDefault();
        const t0 = e.touches[0];
        const t1 = e.touches[1];
        const dist = getTouchDistance(t0, t1);
        const mid = getTouchMidpoint(t0, t1);
        const rect = container.getBoundingClientRect();
        const viewportX = mid.clientX - rect.left;
        const viewportY = mid.clientY - rect.top;

        if (!pinchState.current.active) {
          const {imgRatioX, imgRatioY} = getImgRatioAt(mid.clientX, mid.clientY);
          pinchState.current = {
            active: true,
            startDistance: dist,
            startZoom: zoomRef.current,
            imgRatioX,
            imgRatioY,
          };
          return;
        }

        const prevZoom = zoomRef.current;
        const nextZoom = computePinchZoom(
          pinchState.current.startDistance,
          dist,
          pinchState.current.startZoom,
          MIN_PINCH_ZOOM,
          MAX_PINCH_ZOOM,
        );

        recentPinchUntilRef.current = Date.now() + 450;

        if (Math.abs(nextZoom - prevZoom) > 0.001) {
          pendingAnchorRef.current = {
            imgRatioX: pinchState.current.imgRatioX,
            imgRatioY: pinchState.current.imgRatioY,
            viewportX,
            viewportY,
          };
          onZoomChangeRef.current(nextZoom);
        } else if (innerRef.current) {
          const inner = innerRef.current;
          const targetX = inner.offsetLeft + pinchState.current.imgRatioX * inner.offsetWidth;
          const targetY = inner.offsetTop + pinchState.current.imgRatioY * inner.offsetHeight;
          container.scrollLeft = Math.max(0, targetX - viewportX);
          container.scrollTop = Math.max(0, targetY - viewportY);
        }
      }
    };

    const handleTouchEnd = (e: TouchEvent) => {
      if (pinchState.current.active && e.touches.length < 2) {
        pinchState.current.active = false;
        recentPinchUntilRef.current = Date.now() + 350;
        dragState.current.active = false;
        dragState.current.pointerId = null;
        setIsDragging(false);
      }
    };

    // Trackpad pinch (ctrl+wheel) support for laptops & tablets
    const handleWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const prevZoom = zoomRef.current;
      const factor = Math.exp(-e.deltaY * 0.008);
      const nextZoom = clampZoom(prevZoom * factor, MIN_PINCH_ZOOM, MAX_PINCH_ZOOM);
      if (Math.abs(nextZoom - prevZoom) < 0.001) return;

      const rect = container.getBoundingClientRect();
      const {imgRatioX, imgRatioY} = getImgRatioAt(e.clientX, e.clientY);
      pendingAnchorRef.current = {
        imgRatioX,
        imgRatioY,
        viewportX: e.clientX - rect.left,
        viewportY: e.clientY - rect.top,
      };
      onZoomChangeRef.current(nextZoom);
    };

    container.addEventListener('touchstart', handleTouchStart, {passive: false});
    container.addEventListener('touchmove', handleTouchMove, {passive: false});
    container.addEventListener('touchend', handleTouchEnd, {passive: false});
    container.addEventListener('touchcancel', handleTouchEnd, {passive: false});
    container.addEventListener('wheel', handleWheel, {passive: false});

    return () => {
      container.removeEventListener('touchstart', handleTouchStart);
      container.removeEventListener('touchmove', handleTouchMove);
      container.removeEventListener('touchend', handleTouchEnd);
      container.removeEventListener('touchcancel', handleTouchEnd);
      container.removeEventListener('wheel', handleWheel);
    };
  }, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (pinchState.current.active || !e.isPrimary) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('button')) return;
    const container = scrollRef.current;
    if (!container) return;

    dragState.current = {
      active: true,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      scrollLeft: container.scrollLeft,
      scrollTop: container.scrollTop,
      moved: false,
    };
    if (zoom > 1 || isFullscreenMode) {
      setIsDragging(true);
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (pinchState.current.active) return;
    if (!dragState.current.active || dragState.current.pointerId !== e.pointerId) return;
    const container = scrollRef.current;
    if (!container) return;

    const dx = e.clientX - dragState.current.startX;
    const dy = e.clientY - dragState.current.startY;
    if (Math.hypot(dx, dy) > 6) {
      dragState.current.moved = true;
    }

    if (zoom > 1 || isFullscreenMode) {
      container.scrollLeft = dragState.current.scrollLeft - dx;
      container.scrollTop = dragState.current.scrollTop - dy;
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const wasActive =
      dragState.current.active && dragState.current.pointerId === e.pointerId;
    const moved = dragState.current.moved;
    dragState.current.active = false;
    dragState.current.pointerId = null;
    setIsDragging(false);

    if (!wasActive || moved || pinchState.current.active) return;
    if (Date.now() < recentPinchUntilRef.current) return;

    const target = e.target as HTMLElement;
    if (target.closest('button')) return;
    if (imgStatus !== 'loaded') return;

    if (!isFullscreenMode) {
      onRequestFullscreen?.();
      return;
    }

    // In fullscreen mode: double-tap toggles between 100% and 225% around tapped point
    const now = Date.now();
    const prev = lastTapRef.current;
    const tapDist = Math.hypot(e.clientX - prev.x, e.clientY - prev.y);
    if (now - prev.time < 300 && tapDist < 32) {
      lastTapRef.current = {time: 0, x: 0, y: 0};
      const container = scrollRef.current;
      const inner = innerRef.current;
      if (!container || !inner || inner.offsetWidth === 0 || inner.offsetHeight === 0) return;
      const rect = container.getBoundingClientRect();
      const innerRect = inner.getBoundingClientRect();
      const nextZoom = zoom > 1.15 ? 1 : 2.25;
      pendingAnchorRef.current = {
        imgRatioX: (e.clientX - innerRect.left) / innerRect.width,
        imgRatioY: (e.clientY - innerRect.top) / innerRect.height,
        viewportX: e.clientX - rect.left,
        viewportY: e.clientY - rect.top,
      };
      onZoomChange(nextZoom);
    } else {
      lastTapRef.current = {time: now, x: e.clientX, y: e.clientY};
    }
  };

  const cancelDrag = () => {
    dragState.current.active = false;
    dragState.current.pointerId = null;
    setIsDragging(false);
  };

  const cursorClass =
    zoom > 1
      ? isDragging
        ? 'cursor-grabbing'
        : 'cursor-grab'
      : !isFullscreenMode && imgStatus === 'loaded'
        ? 'cursor-zoom-in'
        : '';

  return (
    <div
      ref={scrollRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={cancelDrag}
      onPointerLeave={cancelDrag}
      style={{
        touchAction: isFullscreenMode || zoom > 1 ? 'none' : 'pan-y',
        overscrollBehavior: isFullscreenMode ? 'contain' : 'auto',
      }}
      className={`relative overflow-auto bg-slate-100/80 dark:bg-neutral-900 ${
        isFullscreenMode ? 'flex flex-col' : ''
      } ${maxHeightClass} ${cursorClass}`}
    >
      {!imageUrl || imgStatus === 'error' ? (
        <div className="flex flex-col items-center justify-center py-16 px-6 text-center bg-slate-50 dark:bg-neutral-800">
          <ImageOff className="w-10 h-10 text-slate-400 dark:text-neutral-500 mb-3" aria-hidden="true" />
          <p className="text-sm font-medium text-slate-800 dark:text-neutral-200">{title}</p>
          <p className="text-xs text-slate-500 dark:text-neutral-400 mt-1">
            Не удалось загрузить изображение схемы ({imageId}).
          </p>
        </div>
      ) : (
        <div
          ref={innerRef}
          className={`relative shrink-0 origin-top-left ${
            isFullscreenMode ? 'm-auto' : 'mx-auto'
          }`}
          style={{width: `${zoom * 100}%`}}
        >
          <img
            src={imageUrl}
            alt={title}
            draggable={false}
            referrerPolicy="no-referrer"
            onLoad={() => onImgStatusChange('loaded')}
            onError={() => onImgStatusChange('error')}
            className="block w-full h-auto select-none"
          />

          {imgStatus === 'loaded' &&
            passiveMarkers.map(([name, x, y], idx) => {
              const nearTop = y < 0.12;
              return (
                <button
                  key={`passive-${name}-${idx}`}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectSensor?.(name);
                  }}
                  aria-label={`Выбрать датчик ${name}`}
                  style={{
                    left: `${x * 100}%`,
                    top: `${y * 100}%`,
                  }}
                  className="group absolute -translate-x-1/2 -translate-y-1/2 w-6 h-6 rounded-full flex items-center justify-center cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 z-10"
                >
                  <span className="w-2.5 h-2.5 rounded-full bg-blue-700/90 border border-white shadow-sm group-hover:scale-125 group-hover:bg-blue-600 transition-transform" />
                  <span
                    className={`pointer-events-none opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity absolute left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded bg-neutral-900/95 text-white font-mono text-[10px] font-medium whitespace-nowrap shadow-sm z-30 ${
                      nearTop ? 'top-6' : '-top-6'
                    }`}
                  >
                    {name}
                  </span>
                </button>
              );
            })}

          {imgStatus === 'loaded' &&
            highlightedPoints.map((pt, idx) => {
              const nearTop = pt.y < 0.14;
              return (
                <button
                  key={`target-${pt.name}-${idx}`}
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectSensor?.(pt.name);
                  }}
                  aria-label={`Целевой датчик ${pt.name}`}
                  style={{
                    left: `${pt.x * 100}%`,
                    top: `${pt.y * 100}%`,
                  }}
                  className="group absolute -translate-x-1/2 -translate-y-1/2 w-11 h-11 rounded-full flex items-center justify-center cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-600 z-20"
                >
                  <span
                    className="absolute inset-0 rounded-full border-2 border-red-600/75 pointer-events-none"
                    aria-hidden="true"
                  />
                  <span
                    className="w-6 h-6 rounded-full border-2 border-red-600 bg-red-600/20 flex items-center justify-center pointer-events-none"
                    aria-hidden="true"
                  >
                    <span className="w-2 h-2 rounded-full bg-red-600" />
                  </span>
                  <span
                    className={`absolute left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded bg-neutral-900 text-white font-mono text-[11px] font-semibold whitespace-nowrap shadow-sm ${
                      nearTop ? 'top-11' : '-top-6'
                    }`}
                  >
                    {pt.name}
                  </span>
                </button>
              );
            })}
        </div>
      )}
    </div>
  );
}

export function SchemeViewer({
  imageId,
  title,
  subtitle,
  scheme,
  highlightedPoints = [],
  selectedSensorName,
  onSelectSensor,
  onLookupErrorsForSensor,
  compact = false,
  embedded = false,
  fullscreenTrigger,
}: SchemeViewerProps) {
  const [zoom, setZoom] = useState(1);
  const [fsZoom, setFsZoom] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showAllPins, setShowAllPins] = useState(highlightedPoints.length === 0);
  const [imgStatus, setImgStatus] = useState<'loading' | 'loaded' | 'error'>('loading');

  const imageUrl = getSchemeImageUrl(imageId);

  useEffect(() => {
    setImgStatus('loading');
    setZoom(1);
    setFsZoom(1);
  }, [imageId]);

  useEffect(() => {
    if (fullscreenTrigger && fullscreenTrigger > 0) {
      setFsZoom(1);
      setIsFullscreen(true);
    }
  }, [fullscreenTrigger]);

  useEffect(() => {
    if (highlightedPoints.length > 0) {
      setShowAllPins(false);
    } else if (scheme && scheme.markers.length > 0) {
      setShowAllPins(true);
    }
  }, [imageId, highlightedPoints.length, scheme]);

  // Lock background page scroll while fullscreen modal is open
  useEffect(() => {
    if (!isFullscreen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prevOverflow;
    };
  }, [isFullscreen]);

  useEffect(() => {
    if (!isFullscreen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsFullscreen(false);
      } else if (e.key === '+' || e.key === '=') {
        setFsZoom((z) => stepZoomUp(z));
      } else if (e.key === '-') {
        setFsZoom((z) => stepZoomDown(z));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isFullscreen]);

  const activeSensorLabel =
    selectedSensorName ??
    (highlightedPoints.length > 0
      ? Array.from(new Set(highlightedPoints.map((p) => p.name))).join(', ')
      : null);

  const openFullscreen = useCallback(() => {
    setFsZoom(Math.max(1, zoom));
    setIsFullscreen(true);
  }, [zoom]);

  const fullscreenDialog = isFullscreen
    ? createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Схема: ${title}`}
          className="fixed inset-0 z-50 bg-neutral-950/90 backdrop-blur-xs flex flex-col sm:p-4"
        >
          <div className="bg-white dark:bg-neutral-800 sm:rounded-xl overflow-hidden flex flex-col flex-1 min-h-0 shadow-2xl">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-3.5 sm:px-4 py-2.5 sm:py-3 border-b border-slate-200/70 dark:border-white/[0.06] bg-slate-50 dark:bg-neutral-900/70">
              <div className="flex items-start justify-between gap-2 min-w-0 flex-1">
                <div className="min-w-0">
                  <h2 className="text-sm sm:text-base font-semibold text-slate-900 dark:text-neutral-100 truncate">
                    {title}
                  </h2>
                  {activeSensorLabel && (
                    <p className="text-xs text-slate-600 dark:text-neutral-400 mt-0.5 truncate">
                      Выделенный элемент:{' '}
                      <span className="font-mono font-semibold text-red-700 dark:text-red-400">
                        {activeSensorLabel}
                      </span>
                    </p>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => setIsFullscreen(false)}
                  aria-label="Закрыть полноэкранный просмотр"
                  className="sm:hidden inline-flex items-center justify-center p-2 min-h-[40px] min-w-[40px] text-white bg-slate-900 dark:bg-blue-600 hover:bg-slate-800 dark:hover:bg-blue-500 rounded-lg shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                >
                  <X className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>

              <div className="flex flex-wrap items-center justify-between sm:justify-end gap-1.5 sm:gap-2 shrink-0">
                {scheme && scheme.markers.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowAllPins((v) => !v)}
                    aria-pressed={showAllPins}
                    className={`inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 min-h-[40px] sm:min-h-0 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                      showAllPins
                        ? 'bg-blue-50 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300'
                        : 'bg-slate-100 dark:bg-neutral-700/80 text-slate-700 dark:text-neutral-100 hover:bg-slate-200 dark:hover:bg-neutral-600'
                    }`}
                  >
                    {showAllPins ? (
                      <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                    ) : (
                      <EyeOff className="w-3.5 h-3.5" aria-hidden="true" />
                    )}
                    <span className="sm:hidden">
                      {showAllPins ? `Метки (${scheme.markers.length})` : 'Все метки'}
                    </span>
                    <span className="hidden sm:inline">
                      {showAllPins
                        ? `Все метки (${scheme.markers.length})`
                        : 'Показать все метки'}
                    </span>
                  </button>
                )}

                <div
                  className="inline-flex items-center rounded-lg bg-slate-100 dark:bg-neutral-700/80 overflow-hidden"
                  role="group"
                  aria-label="Масштаб полноэкранной схемы"
                >
                  <button
                    type="button"
                    onClick={() => setFsZoom((z) => stepZoomDown(z))}
                    disabled={fsZoom <= MIN_PINCH_ZOOM + 0.01}
                    aria-label="Уменьшить масштаб"
                    className="p-2 min-h-[40px] min-w-[38px] flex items-center justify-center text-slate-600 dark:text-neutral-200 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/70 dark:hover:bg-neutral-600 disabled:opacity-40 cursor-pointer"
                  >
                    <ZoomOut className="w-4 h-4" aria-hidden="true" />
                  </button>
                  <span className="px-2 text-xs font-mono tabular-nums text-slate-700 dark:text-neutral-100 border-x border-slate-200/80 dark:border-white/[0.08] select-none">
                    {Math.round(fsZoom * 100)}%
                  </span>
                  <button
                    type="button"
                    onClick={() => setFsZoom((z) => stepZoomUp(z))}
                    disabled={fsZoom >= MAX_PINCH_ZOOM - 0.01}
                    aria-label="Увеличить масштаб"
                    className="p-2 min-h-[40px] min-w-[38px] flex items-center justify-center text-slate-600 dark:text-neutral-200 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/70 dark:hover:bg-neutral-600 disabled:opacity-40 cursor-pointer"
                  >
                    <ZoomIn className="w-4 h-4" aria-hidden="true" />
                  </button>
                  {fsZoom > MIN_PINCH_ZOOM + 0.01 && (
                    <button
                      type="button"
                      onClick={() => setFsZoom(MIN_PINCH_ZOOM)}
                      aria-label="Сбросить масштаб"
                      className="p-2 min-h-[40px] min-w-[38px] flex items-center justify-center text-slate-500 dark:text-neutral-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/70 dark:hover:bg-neutral-600 border-l border-slate-200/80 dark:border-white/[0.08] cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => setIsFullscreen(false)}
                  aria-label="Закрыть полноэкранный просмотр"
                  className="hidden sm:inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[40px] text-xs font-medium text-white bg-slate-900 dark:bg-blue-600 hover:bg-slate-800 dark:hover:bg-blue-500 rounded-lg cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                >
                  <Minimize2 className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Свернуть</span>
                </button>
              </div>
            </div>

            <div className="flex-1 min-h-0 flex flex-col">
              <DiagramSurface
                imageUrl={imageUrl}
                imageId={imageId}
                title={title}
                scheme={scheme}
                highlightedPoints={highlightedPoints}
                showAllPins={showAllPins}
                zoom={fsZoom}
                onZoomChange={setFsZoom}
                isFullscreenMode
                maxHeightClass="flex-1 min-h-0"
                imgStatus={imgStatus}
                onImgStatusChange={setImgStatus}
                onSelectSensor={onSelectSensor}
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-t border-slate-200/70 dark:border-white/[0.06] bg-white dark:bg-neutral-800 text-xs text-slate-600 dark:text-neutral-400">
              <span>
                {fsZoom > 1
                  ? 'Двигайте пальцем для обзора · сводите/разводите пальцы для масштаба · двойной тап — сброс'
                  : 'Разводите пальцы для увеличения · двойной тап — 225%'}
              </span>
              {activeSensorLabel && onLookupErrorsForSensor && (
                <button
                  type="button"
                  onClick={() => {
                    setIsFullscreen(false);
                    onLookupErrorsForSensor(activeSensorLabel.split(',')[0].trim());
                  }}
                  className="text-xs font-medium text-blue-700 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 hover:underline whitespace-nowrap shrink-0 cursor-pointer"
                >
                  Найти ошибки с {activeSensorLabel.split(',')[0].trim()}
                </button>
              )}
            </div>
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <div
      className={`rounded-xl overflow-hidden ${
        embedded
          ? 'bg-slate-100/80 dark:bg-neutral-900/70'
          : 'bg-white dark:bg-neutral-800 shadow-xs dark:shadow-none'
      }`}
    >
      {/* Toolbar */}
      <div
        className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3 ${
          embedded
            ? 'border-b border-slate-200/60 dark:border-white/[0.06]'
            : 'border-b border-slate-200/70 dark:border-white/[0.06] bg-slate-50/70 dark:bg-neutral-900/60'
        }`}
      >
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-neutral-100 truncate">
            {title}
          </h3>
          {subtitle && (
            <p className="text-xs text-slate-500 dark:text-neutral-400 mt-0.5 truncate">
              {subtitle}
            </p>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5 sm:gap-2 shrink-0 max-w-full">
          {scheme && scheme.markers.length > 0 && (
            <button
              type="button"
              onClick={() => setShowAllPins((v) => !v)}
              aria-pressed={showAllPins}
              className={`inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 min-h-[40px] sm:min-h-0 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                showAllPins
                  ? 'bg-blue-50 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300'
                  : 'bg-slate-100 dark:bg-neutral-700/80 text-slate-700 dark:text-neutral-100 hover:bg-slate-200 dark:hover:bg-neutral-600'
              }`}
            >
              {showAllPins ? (
                <Eye className="w-3.5 h-3.5" aria-hidden="true" />
              ) : (
                <EyeOff className="w-3.5 h-3.5" aria-hidden="true" />
              )}
              <span className="sm:hidden">
                {showAllPins ? `Метки (${scheme.markers.length})` : 'Все метки'}
              </span>
              <span className="hidden sm:inline">
                {showAllPins
                  ? `Все метки (${scheme.markers.length})`
                  : 'Показать все метки'}
              </span>
            </button>
          )}

          <div
            className="inline-flex items-center rounded-lg bg-slate-100 dark:bg-neutral-700/80 overflow-hidden"
            role="group"
            aria-label="Масштаб схемы"
          >
            <button
              type="button"
              onClick={() => setZoom((z) => stepZoomDown(z))}
              disabled={zoom <= MIN_PINCH_ZOOM + 0.01}
              aria-label="Уменьшить масштаб"
              className="p-2 sm:p-1.5 min-h-[40px] min-w-[36px] sm:min-h-0 sm:min-w-0 flex items-center justify-center text-slate-600 dark:text-neutral-200 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/70 dark:hover:bg-neutral-600 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600"
            >
              <ZoomOut className="w-4 h-4" aria-hidden="true" />
            </button>
            <span className="px-2 text-xs font-mono tabular-nums text-slate-700 dark:text-neutral-100 border-x border-slate-200/80 dark:border-white/[0.08] select-none">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={() => setZoom((z) => stepZoomUp(z))}
              disabled={zoom >= MAX_PINCH_ZOOM - 0.01}
              aria-label="Увеличить масштаб"
              className="p-2 sm:p-1.5 min-h-[40px] min-w-[36px] sm:min-h-0 sm:min-w-0 flex items-center justify-center text-slate-600 dark:text-neutral-200 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/70 dark:hover:bg-neutral-600 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600"
            >
              <ZoomIn className="w-4 h-4" aria-hidden="true" />
            </button>
            {zoom > MIN_PINCH_ZOOM + 0.01 && (
              <button
                type="button"
                onClick={() => setZoom(MIN_PINCH_ZOOM)}
                aria-label="Сбросить масштаб"
                className="p-2 sm:p-1.5 min-h-[40px] min-w-[36px] sm:min-h-0 sm:min-w-0 flex items-center justify-center text-slate-500 dark:text-neutral-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-200/70 dark:hover:bg-neutral-600 border-l border-slate-200/80 dark:border-white/[0.08] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600"
              >
                <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={openFullscreen}
            aria-label="Открыть схему на весь экран"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 min-h-[40px] sm:min-h-0 text-xs font-medium text-slate-700 dark:text-neutral-100 bg-slate-100 dark:bg-neutral-700/80 hover:bg-slate-200 dark:hover:bg-neutral-600 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
          >
            <Expand className="w-3.5 h-3.5" aria-hidden="true" />
            <span className="hidden sm:inline">На весь экран</span>
          </button>
        </div>
      </div>

      {/* Scrollable interactive diagram surface */}
      <DiagramSurface
        imageUrl={imageUrl}
        imageId={imageId}
        title={title}
        scheme={scheme}
        highlightedPoints={highlightedPoints}
        showAllPins={showAllPins}
        zoom={zoom}
        onZoomChange={setZoom}
        isFullscreenMode={false}
        onRequestFullscreen={openFullscreen}
        maxHeightClass={compact ? 'max-h-[460px]' : 'max-h-[640px]'}
        imgStatus={imgStatus}
        onImgStatusChange={setImgStatus}
        onSelectSensor={onSelectSensor}
      />

      {/* Footer info / active sensor actions */}
      <div
        className={`flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 border-t border-slate-200/60 dark:border-white/[0.06] text-xs text-slate-600 dark:text-neutral-400 ${
          embedded ? '' : 'bg-white dark:bg-neutral-800'
        }`}
      >
        <div className="flex flex-wrap items-center gap-2">
          {activeSensorLabel ? (
            <>
              <Crosshair className="w-3.5 h-3.5 text-red-600 dark:text-red-400 shrink-0" aria-hidden="true" />
              <span>
                Выделено:{' '}
                <strong className="font-mono font-semibold text-slate-900 dark:text-neutral-100">
                  {activeSensorLabel}
                </strong>
              </span>
              {highlightedPoints.length > 0 && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono tabular-nums text-slate-500 dark:text-neutral-400">
                    {highlightedPoints.length}{' '}
                    {highlightedPoints.length === 1 ? 'точка' : 'точки'}
                  </span>
                </>
              )}
            </>
          ) : (
            <>
              <Maximize2 className="w-3.5 h-3.5 text-slate-400 dark:text-neutral-500 shrink-0" aria-hidden="true" />
              <span>Нажмите на схему для полного экрана · сводите и разводите пальцы для масштаба</span>
            </>
          )}
        </div>

        <div className="flex items-center gap-3">
          {activeSensorLabel && (
            <button
              type="button"
              onClick={openFullscreen}
              className="text-xs font-medium text-slate-600 dark:text-neutral-300 hover:text-slate-900 dark:hover:text-white hover:underline whitespace-nowrap shrink-0 cursor-pointer sm:hidden"
            >
              Во весь экран
            </button>
          )}
          {activeSensorLabel && onLookupErrorsForSensor && (
            <button
              type="button"
              onClick={() =>
                onLookupErrorsForSensor(activeSensorLabel.split(',')[0].trim())
              }
              className="text-xs font-medium text-blue-700 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-300 hover:underline whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded"
            >
              Найти ошибки с {activeSensorLabel.split(',')[0].trim()}
            </button>
          )}
        </div>
      </div>

      {fullscreenDialog}
    </div>
  );
}
