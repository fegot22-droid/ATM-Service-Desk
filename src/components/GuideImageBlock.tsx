import {useEffect, useLayoutEffect, useRef, useState} from 'react';
import {createPortal} from 'react-dom';
import {
  Expand,
  Image as ImageIcon,
  ImageOff,
  Minimize2,
  RotateCcw,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {getGuideImageUrl} from '../utils/assetPaths';
import {
  MAX_PINCH_ZOOM,
  MIN_PINCH_ZOOM,
  clampZoom,
  computePinchZoom,
  getTouchDistance,
  getTouchMidpoint,
} from '../utils/pinchZoom';

const ZOOM_PRESETS = [1, 1.5, 2.25, 3, 4, 5] as const;

function stepZoomUp(current: number): number {
  return ZOOM_PRESETS.find((z) => z > current + 0.05) ?? MAX_PINCH_ZOOM;
}

function stepZoomDown(current: number): number {
  for (let i = ZOOM_PRESETS.length - 1; i >= 0; i -= 1) {
    if (ZOOM_PRESETS[i] < current - 0.05) {
      return ZOOM_PRESETS[i];
    }
  }
  return MIN_PINCH_ZOOM;
}

interface GuideImageBlockProps {
  fileName: string;
  sectionTitle: string;
}

export function GuideImageBlock({fileName, sectionTitle}: GuideImageBlockProps) {
  const imageUrl = getGuideImageUrl(fileName);
  const [imgStatus, setImgStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [fsZoom, setFsZoom] = useState(1);

  const scrollRef = useRef<HTMLDivElement>(null);
  const innerRef = useRef<HTMLDivElement>(null);
  const zoomRef = useRef(fsZoom);
  zoomRef.current = fsZoom;

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
  const lastTapRef = useRef<{time: number; x: number; y: number}>({time: 0, x: 0, y: 0});
  const pendingAnchorRef = useRef<{
    imgRatioX: number;
    imgRatioY: number;
    viewportX: number;
    viewportY: number;
  } | null>(null);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    setImgStatus('loading');
    setFsZoom(1);
  }, [fileName]);

  useEffect(() => {
    if (!isFullscreen) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
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
    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [isFullscreen]);

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
  }, [fsZoom]);

  useEffect(() => {
    if (!isFullscreen) return;
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
          setFsZoom(nextZoom);
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
      setFsZoom(nextZoom);
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
  }, [isFullscreen]);

  if (!imageUrl) {
    return (
      <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg bg-slate-100/80 dark:bg-neutral-900/70 text-xs text-slate-500 dark:text-neutral-400">
        <ImageIcon className="w-3.5 h-3.5 text-slate-400 dark:text-neutral-500 shrink-0" aria-hidden="true" />
        <span>
          Иллюстрация из документа:{' '}
          <span className="font-mono text-slate-700 dark:text-neutral-200">{fileName}</span>
        </span>
      </div>
    );
  }

  const openFullscreen = () => {
    setFsZoom(1);
    setIsFullscreen(true);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (pinchState.current.active || !e.isPrimary) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
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
    if (fsZoom > 1) {
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
    if (fsZoom > 1) {
      container.scrollLeft = dragState.current.scrollLeft - dx;
      container.scrollTop = dragState.current.scrollTop - dy;
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    const wasActive = dragState.current.active && dragState.current.pointerId === e.pointerId;
    const moved = dragState.current.moved;
    dragState.current.active = false;
    dragState.current.pointerId = null;
    setIsDragging(false);
    if (!wasActive || moved || pinchState.current.active) return;
    if (Date.now() < recentPinchUntilRef.current) return;

    const now = Date.now();
    const prev = lastTapRef.current;
    if (now - prev.time < 300 && Math.hypot(e.clientX - prev.x, e.clientY - prev.y) < 32) {
      lastTapRef.current = {time: 0, x: 0, y: 0};
      const container = scrollRef.current;
      const inner = innerRef.current;
      if (!container || !inner || inner.offsetWidth === 0 || inner.offsetHeight === 0) return;
      const rect = container.getBoundingClientRect();
      const innerRect = inner.getBoundingClientRect();
      const nextZoom = fsZoom > 1.15 ? 1 : 2.25;
      pendingAnchorRef.current = {
        imgRatioX: (e.clientX - innerRect.left) / innerRect.width,
        imgRatioY: (e.clientY - innerRect.top) / innerRect.height,
        viewportX: e.clientX - rect.left,
        viewportY: e.clientY - rect.top,
      };
      setFsZoom(nextZoom);
    } else {
      lastTapRef.current = {time: now, x: e.clientX, y: e.clientY};
    }
  };

  const cancelDrag = () => {
    dragState.current.active = false;
    dragState.current.pointerId = null;
    setIsDragging(false);
  };

  return (
    <>
      <figure className="my-3 rounded-xl overflow-hidden bg-slate-100/80 dark:bg-neutral-900/70">
        {imgStatus === 'error' ? (
          <div className="flex items-center gap-2.5 px-3 py-3 text-xs text-slate-500 dark:text-neutral-400">
            <ImageOff className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>
              Не удалось загрузить иллюстрацию:{' '}
              <span className="font-mono text-slate-700 dark:text-neutral-200">{fileName}</span>
            </span>
          </div>
        ) : (
          <>
            <button
              type="button"
              onClick={openFullscreen}
              aria-label={`Открыть скриншот ${fileName} на весь экран`}
              className="block w-full p-2 sm:p-3 cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600"
            >
              <img
                src={imageUrl}
                alt={`${sectionTitle} — ${fileName}`}
                loading="lazy"
                draggable={false}
                onLoad={() => setImgStatus('loaded')}
                onError={() => setImgStatus('error')}
                className="mx-auto max-h-[380px] w-auto max-w-full rounded-lg object-contain bg-white"
              />
            </button>
            <figcaption className="flex items-center justify-between gap-2 px-3 py-2 border-t border-slate-200/60 dark:border-white/[0.06] text-xs text-slate-500 dark:text-neutral-400">
              <span className="font-mono truncate">{fileName}</span>
              <button
                type="button"
                onClick={openFullscreen}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-slate-700 dark:text-neutral-200 bg-white/80 dark:bg-neutral-800 hover:bg-white dark:hover:bg-neutral-700 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              >
                <Expand className="w-3.5 h-3.5" aria-hidden="true" />
                <span>На весь экран</span>
              </button>
            </figcaption>
          </>
        )}
      </figure>

      {isFullscreen &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label={`Иллюстрация: ${fileName}`}
            className="fixed inset-0 z-50 bg-neutral-950/90 backdrop-blur-xs flex flex-col sm:p-4"
          >
            <div className="bg-white dark:bg-neutral-800 sm:rounded-xl overflow-hidden flex flex-col flex-1 min-h-0 shadow-2xl">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 px-3.5 sm:px-4 py-2.5 sm:py-3 border-b border-slate-200/70 dark:border-white/[0.06] bg-slate-50 dark:bg-neutral-900/70">
                <div className="flex items-start justify-between gap-2 min-w-0 flex-1">
                  <div className="min-w-0">
                    <h2 className="text-sm sm:text-base font-semibold text-slate-900 dark:text-neutral-100 truncate">
                      {sectionTitle}
                    </h2>
                    <p className="text-xs font-mono text-slate-500 dark:text-neutral-400 mt-0.5 truncate">
                      {fileName}
                    </p>
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
                  <div
                    className="inline-flex items-center rounded-lg bg-slate-100 dark:bg-neutral-700/80 overflow-hidden"
                    role="group"
                    aria-label="Масштаб иллюстрации"
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

              <div
                ref={scrollRef}
                onPointerDown={handlePointerDown}
                onPointerMove={handlePointerMove}
                onPointerUp={handlePointerUp}
                onPointerCancel={cancelDrag}
                onPointerLeave={cancelDrag}
                style={{touchAction: 'none', overscrollBehavior: 'contain'}}
                className={`relative flex-1 min-h-0 overflow-auto bg-slate-100/80 dark:bg-neutral-900 flex flex-col ${
                  fsZoom > 1 ? (isDragging ? 'cursor-grabbing' : 'cursor-grab') : ''
                }`}
              >
                <div
                  ref={innerRef}
                  className="relative shrink-0 origin-top-left m-auto p-2"
                  style={{width: `${fsZoom * 100}%`}}
                >
                  <img
                    src={imageUrl}
                    alt={`${sectionTitle} — ${fileName}`}
                    draggable={false}
                    className="block mx-auto max-w-full h-auto select-none rounded-lg bg-white"
                  />
                </div>
              </div>

              <div className="px-4 py-2.5 border-t border-slate-200/70 dark:border-white/[0.06] bg-white dark:bg-neutral-800 text-xs text-slate-600 dark:text-neutral-400">
                {fsZoom > 1
                  ? 'Двигайте пальцем для обзора · сводите/разводите пальцы для масштаба · двойной тап — сброс'
                  : 'Разводите пальцы для увеличения · двойной тап — 225%'}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
