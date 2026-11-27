import {useState} from 'react';
import {createPortal} from 'react-dom';
import {Download, Smartphone, WifiOff, X} from 'lucide-react';
import {useOnlineStatus, usePWAInstall} from '../hooks/usePWAInstall';

interface PWAInstallControlProps {
  compact?: boolean;
}

export function PWAInstallControl({compact = false}: PWAInstallControlProps) {
  const {isInstallable, isInstalled, isAndroid, isIOS, install} = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  const handleClick = async () => {
    if (isInstallable) {
      await install();
      return;
    }
    setShowGuide(true);
  };

  const buttonLabel = isInstallable
    ? compact
      ? 'Установить'
      : 'Установить приложение'
    : isAndroid
      ? 'На Android'
      : isIOS
        ? 'На экран'
        : compact
          ? 'PWA / Android'
          : 'Установить на Android';

  const modal = showGuide
    ? createPortal(
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="pwa-guide-title"
          className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-slate-900/50 dark:bg-neutral-950/80 backdrop-blur-xs p-0 sm:p-4"
        >
          <div className="w-full sm:max-w-md bg-white dark:bg-neutral-800 border border-slate-200 dark:border-neutral-700 rounded-t-2xl sm:rounded-2xl p-6 pb-safe space-y-4 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2
                  id="pwa-guide-title"
                  className="text-base font-bold text-slate-900 dark:text-neutral-100"
                >
                  {isIOS
                    ? 'Установка на iPhone / iPad'
                    : 'Установка на Android как приложение'}
                </h2>
                <p className="text-xs text-slate-500 dark:text-neutral-400 mt-1">
                  Все базы ошибок, схемы датчиков и инструкции работают офлайн после установки.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                aria-label="Закрыть подсказку по установке"
                className="p-2 -mr-2 -mt-1 text-slate-400 hover:text-slate-700 dark:hover:text-neutral-200 rounded-lg min-h-[44px] min-w-[44px] flex items-center justify-center cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              >
                <X className="w-5 h-5" aria-hidden="true" />
              </button>
            </div>

            {isIOS ? (
              <ol className="space-y-2.5 text-sm text-slate-700 dark:text-neutral-300 list-decimal list-inside">
                <li>
                  Нажмите кнопку <strong>«Поделиться»</strong> в нижней панели Safari.
                </li>
                <li>
                  Выберите пункт <strong>«На экран „Домой“»</strong> и подтвердите добавление.
                </li>
              </ol>
            ) : (
              <ol className="space-y-2.5 text-sm text-slate-700 dark:text-neutral-300 list-decimal list-inside">
                <li>
                  Откройте приложение в браузере <strong>Chrome</strong> на Android.
                </li>
                <li>
                  Нажмите меню <strong>⋮</strong> в правом верхнем углу браузера.
                </li>
                <li>
                  Выберите <strong>«Установить приложение»</strong> (или{' '}
                  <strong>«Добавить на гл. экран»</strong>) — иконка появится на рабочем столе и справочник будет доступен без интернета.
                </li>
              </ol>
            )}

            <button
              type="button"
              onClick={() => setShowGuide(false)}
              className="w-full min-h-[44px] py-2.5 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 rounded-xl transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            >
              Понятно
            </button>
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        className={`inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
          isInstallable
            ? 'bg-blue-700 hover:bg-blue-800 text-white px-3.5 py-2 text-xs sm:text-sm min-h-[40px]'
            : 'bg-slate-100 dark:bg-neutral-700 hover:bg-slate-200 dark:hover:bg-neutral-600 text-slate-800 dark:text-neutral-100 border border-slate-200 dark:border-neutral-600 px-3 py-2 text-xs sm:text-sm min-h-[40px]'
        }`}
      >
        {isInstallable ? (
          <Download className="w-4 h-4 shrink-0" aria-hidden="true" />
        ) : (
          <Smartphone className="w-4 h-4 shrink-0 text-blue-700 dark:text-blue-400" aria-hidden="true" />
        )}
        <span>{buttonLabel}</span>
      </button>

      {modal}
    </>
  );
}

export function OfflineIndicator() {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div
      role="status"
      className="fixed bottom-20 md:bottom-4 left-4 right-4 sm:right-auto z-40 inline-flex items-center gap-2 rounded-lg bg-amber-600 px-3.5 py-2 text-xs font-medium text-white shadow-md"
    >
      <WifiOff className="w-4 h-4 shrink-0" aria-hidden="true" />
      <span>Офлайн-режим · используются сохранённые данные</span>
    </div>
  );
}
