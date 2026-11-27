import {useCallback, useEffect, useRef, useState} from 'react';
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
}

const EMBEDDED_ZOOM_LEVELS = [1, 1.4, 1.85, 2.5] as const;
const FULLSCREEN_ZOOM_LEVELS = [1, 1.35, 1.75, 2.25, 3] as const;

interface DiagramSurfaceProps {
  imageUrl: string;
  imageId: string;
  title: string;
  scheme?: SensorScheme;
  highlightedPoints: HighlightPoint[];
  showAllPins: boolean;
  zoom: number;
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
  maxHeightClass,
  imgStatus,
  onImgStatusChange,
  onSelectSensor,
}: DiagramSurfaceProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const dragState = useRef<{
    active: boolean;
    startX: number;
    startY: number;
    scrollLeft: number;
    scrollTop: number;
    moved: boolean;
  }>({
    active: false,
    startX: 0,
    startY: 0,
    scrollLeft: 0,
    scrollTop: 0,
    moved: false,
  });
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

  // Auto-center the viewport on the first highlighted marker when loaded or changed
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
  }, [centerOnHighlight, zoom]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (zoom <= 1 || e.button !== 0) return;
    const target = e.target as HTMLElement;
    if (target.closest('button')) return;
    const container = scrollRef.current;
    if (!container) return;
    dragState.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      scrollLeft: container.scrollLeft,
      scrollTop: container.scrollTop,
      moved: false,
    };
    setIsDragging(true);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragState.current.active) return;
    const container = scrollRef.current;
    if (!container) return;
    const dx = e.clientX - dragState.current.startX;
    const dy = e.clientY - dragState.current.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      dragState.current.moved = true;
    }
    container.scrollLeft = dragState.current.scrollLeft - dx;
    container.scrollTop = dragState.current.scrollTop - dy;
  };

  const endDrag = () => {
    dragState.current.active = false;
    setIsDragging(false);
  };

  return (
    <div
      ref={scrollRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
      onPointerLeave={endDrag}
      style={{touchAction: zoom > 1 ? 'none' : 'pan-x pan-y pinch-zoom'}}
      className={`relative overflow-auto bg-slate-100/80 dark:bg-slate-800/80 ${maxHeightClass} ${
        zoom > 1 ? (isDragging ? 'cursor-grabbing' : 'cursor-grab') : ''
      }`}
    >
      {!imageUrl || imgStatus === 'error' ? (
        <div className="flex flex-col items-center justify-center py-16 px-6 text-center bg-slate-50 dark:bg-slate-900">
          <ImageOff className="w-10 h-10 text-slate-400 mb-3" aria-hidden="true" />
          <p className="text-sm font-medium text-slate-800 dark:text-slate-200">{title}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Не удалось загрузить изображение схемы ({imageId}).
          </p>
        </div>
      ) : (
        <div
          className="relative mx-auto transition-[width] duration-150 origin-top-left"
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
                  onClick={() => onSelectSensor?.(name)}
                  aria-label={`Выбрать датчик ${name}`}
                  style={{
                    left: `${x * 100}%`,
                    top: `${y * 100}%`,
                  }}
                  className="group absolute -translate-x-1/2 -translate-y-1/2 w-6 h-6 rounded-full flex items-center justify-center cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 z-10"
                >
                  <span className="w-2.5 h-2.5 rounded-full bg-blue-700/90 border border-white shadow-sm group-hover:scale-125 group-hover:bg-blue-600 transition-transform" />
                  <span
                    className={`pointer-events-none opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100 transition-opacity absolute left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded bg-slate-900/95 text-white font-mono text-[10px] font-medium whitespace-nowrap shadow-sm z-30 ${
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
                  onClick={() => onSelectSensor?.(pt.name)}
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
                    className={`absolute left-1/2 -translate-x-1/2 px-1.5 py-0.5 rounded bg-slate-900 text-white font-mono text-[11px] font-semibold whitespace-nowrap shadow-sm ${
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
}: SchemeViewerProps) {
  const [zoomIdx, setZoomIdx] = useState(0);
  const [fsZoomIdx, setFsZoomIdx] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showAllPins, setShowAllPins] = useState(highlightedPoints.length === 0);
  const [imgStatus, setImgStatus] = useState<'loading' | 'loaded' | 'error'>('loading');

  const imageUrl = getSchemeImageUrl(imageId);
  const zoom = EMBEDDED_ZOOM_LEVELS[zoomIdx];
  const fsZoom = FULLSCREEN_ZOOM_LEVELS[fsZoomIdx];

  useEffect(() => {
    setImgStatus('loading');
    setZoomIdx(0);
  }, [imageId]);

  useEffect(() => {
    if (highlightedPoints.length > 0) {
      setShowAllPins(false);
    } else if (scheme && scheme.markers.length > 0) {
      setShowAllPins(true);
    }
  }, [imageId, highlightedPoints.length, scheme]);

  useEffect(() => {
    if (!isFullscreen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsFullscreen(false);
      } else if (e.key === '+' || e.key === '=') {
        setFsZoomIdx((i) => Math.min(FULLSCREEN_ZOOM_LEVELS.length - 1, i + 1));
      } else if (e.key === '-') {
        setFsZoomIdx((i) => Math.max(0, i - 1));
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

  const fullscreenDialog = isFullscreen
    ? createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`Схема: ${title}`}
          className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-xs flex flex-col p-2 sm:p-4"
        >
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden flex flex-col flex-1 min-h-0 shadow-2xl">
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950/60">
              <div className="min-w-0">
                <h2 className="text-sm sm:text-base font-semibold text-slate-900 dark:text-slate-100 truncate">
                  {title}
                </h2>
                {activeSensorLabel && (
                  <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5 truncate">
                    Выделенный элемент:{' '}
                    <span className="font-mono font-semibold text-red-700 dark:text-red-400">
                      {activeSensorLabel}
                    </span>
                  </p>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                {scheme && scheme.markers.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setShowAllPins((v) => !v)}
                    aria-pressed={showAllPins}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[40px] sm:min-h-0 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                      showAllPins
                        ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800'
                        : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
                    }`}
                  >
                    {showAllPins ? (
                      <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                    ) : (
                      <EyeOff className="w-3.5 h-3.5" aria-hidden="true" />
                    )}
                    <span>
                      {showAllPins
                        ? `Все метки (${scheme.markers.length})`
                        : 'Показать все метки'}
                    </span>
                  </button>
                )}

                <div
                  className="inline-flex items-center border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 overflow-hidden"
                  role="group"
                  aria-label="Масштаб полноэкранной схемы"
                >
                  <button
                    type="button"
                    onClick={() => setFsZoomIdx((i) => Math.max(0, i - 1))}
                    disabled={fsZoomIdx === 0}
                    aria-label="Уменьшить масштаб"
                    className="p-2 min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 cursor-pointer"
                  >
                    <ZoomOut className="w-4 h-4" aria-hidden="true" />
                  </button>
                  <span className="px-2.5 text-xs font-mono tabular-nums text-slate-700 dark:text-slate-200 border-x border-slate-200 dark:border-slate-700 select-none">
                    {Math.round(fsZoom * 100)}%
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setFsZoomIdx((i) => Math.min(FULLSCREEN_ZOOM_LEVELS.length - 1, i + 1))
                    }
                    disabled={fsZoomIdx === FULLSCREEN_ZOOM_LEVELS.length - 1}
                    aria-label="Увеличить масштаб"
                    className="p-2 min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 cursor-pointer"
                  >
                    <ZoomIn className="w-4 h-4" aria-hidden="true" />
                  </button>
                  {fsZoomIdx !== 0 && (
                    <button
                      type="button"
                      onClick={() => setFsZoomIdx(0)}
                      aria-label="Сбросить масштаб"
                      className="p-2 min-h-[40px] min-w-[40px] flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-700 border-l border-slate-200 dark:border-slate-700 cursor-pointer"
                    >
                      <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                    </button>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => setIsFullscreen(false)}
                  aria-label="Закрыть полноэкранный просмотр"
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[40px] text-xs font-medium text-white bg-slate-900 dark:bg-blue-600 hover:bg-slate-800 dark:hover:bg-blue-500 rounded-lg cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                >
                  <Minimize2 className="w-3.5 h-3.5" aria-hidden="true" />
                  <span className="hidden sm:inline">Свернуть</span>
                  <X className="w-4 h-4 sm:hidden" aria-hidden="true" />
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
                maxHeightClass="flex-1 min-h-0"
                imgStatus={imgStatus}
                onImgStatusChange={setImgStatus}
                onSelectSensor={onSelectSensor}
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs text-slate-600 dark:text-slate-400">
              <span>
                {fsZoom > 1
                  ? 'Перетаскивайте схему мышью или пальцем для обзора · Esc — закрыть'
                  : 'Нажмите на синюю метку для выбора элемента · + / - — масштаб'}
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
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/60">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 truncate">
            {title}
          </h3>
          {subtitle && (
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 truncate">
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
              className={`inline-flex items-center gap-1.5 px-2.5 sm:px-3 py-1.5 min-h-[40px] sm:min-h-0 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                showAllPins
                  ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border-blue-200 dark:border-blue-800'
                  : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
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
            className="inline-flex items-center border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800 overflow-hidden"
            role="group"
            aria-label="Масштаб схемы"
          >
            <button
              type="button"
              onClick={() => setZoomIdx((i) => Math.max(0, i - 1))}
              disabled={zoomIdx === 0}
              aria-label="Уменьшить масштаб"
              className="p-2 sm:p-1.5 min-h-[40px] min-w-[36px] sm:min-h-0 sm:min-w-0 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600"
            >
              <ZoomOut className="w-4 h-4" aria-hidden="true" />
            </button>
            <span className="px-2 text-xs font-mono tabular-nums text-slate-700 dark:text-slate-200 border-x border-slate-200 dark:border-slate-700 select-none">
              {Math.round(zoom * 100)}%
            </span>
            <button
              type="button"
              onClick={() =>
                setZoomIdx((i) => Math.min(EMBEDDED_ZOOM_LEVELS.length - 1, i + 1))
              }
              disabled={zoomIdx === EMBEDDED_ZOOM_LEVELS.length - 1}
              aria-label="Увеличить масштаб"
              className="p-2 sm:p-1.5 min-h-[40px] min-w-[36px] sm:min-h-0 sm:min-w-0 flex items-center justify-center text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600"
            >
              <ZoomIn className="w-4 h-4" aria-hidden="true" />
            </button>
            {zoomIdx > 0 && (
              <button
                type="button"
                onClick={() => setZoomIdx(0)}
                aria-label="Сбросить масштаб"
                className="p-2 sm:p-1.5 min-h-[40px] min-w-[36px] sm:min-h-0 sm:min-w-0 flex items-center justify-center text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-50 dark:hover:bg-slate-700 border-l border-slate-200 dark:border-slate-700 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600"
              >
                <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={() => {
              setFsZoomIdx(Math.max(1, zoomIdx));
              setIsFullscreen(true);
            }}
            aria-label="Открыть схему на весь экран"
            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 min-h-[40px] sm:min-h-0 text-xs font-medium text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
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
        maxHeightClass={compact ? 'max-h-[460px]' : 'max-h-[640px]'}
        imgStatus={imgStatus}
        onImgStatusChange={setImgStatus}
        onSelectSensor={onSelectSensor}
      />

      {/* Footer info / active sensor actions */}
      {(activeSensorLabel || (scheme && scheme.markers.length > 0)) && (
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 border-t border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs text-slate-600 dark:text-slate-400">
          <div className="flex flex-wrap items-center gap-2">
            {activeSensorLabel ? (
              <>
                <Crosshair className="w-3.5 h-3.5 text-red-600 dark:text-red-400 shrink-0" aria-hidden="true" />
                <span>
                  Выделено:{' '}
                  <strong className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                    {activeSensorLabel}
                  </strong>
                </span>
                {highlightedPoints.length > 0 && (
                  <>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono tabular-nums text-slate-500 dark:text-slate-400">
                      {highlightedPoints.length}{' '}
                      {highlightedPoints.length === 1 ? 'точка' : 'точки'}
                    </span>
                  </>
                )}
              </>
            ) : (
              <>
                <Maximize2 className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-hidden="true" />
                <span>Нажмите на любую синюю метку на схеме для выделения элемента</span>
              </>
            )}
          </div>

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
      )}

      {fullscreenDialog}
    </div>
  );
}
