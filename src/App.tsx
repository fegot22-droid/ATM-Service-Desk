import {useCallback, useEffect, useState} from 'react';
import {
  AlertCircle,
  BookOpen,
  Cpu,
  FileWarning,
  Moon,
  RefreshCw,
  Star,
  Sun,
} from 'lucide-react';
import {
  ErrorLookupView,
  type FavoriteErrorItem,
} from './components/ErrorLookupView';
import {GuidesView} from './components/GuidesView';
import {
  OfflineIndicator,
  PWAInstallControl,
} from './components/PWAInstallControl';
import {SchemesSensorsView} from './components/SchemesSensorsView';
import {useAtmData} from './hooks/useAtmData';
import {useTheme} from './hooks/useTheme';
import type {DeviceGroupId, DeviceMode} from './types/atm';
import {CATEGORY_TITLES} from './utils/errorLookup';
import {
  parseUrlState,
  serializeUrlState,
  type AppTab,
  type AppUrlState,
} from './utils/urlState';

const FAVORITES_STORAGE_KEY = 'atm_service_error_favorites_v1';

const NAV_ITEMS: Array<{
  id: AppTab;
  label: string;
  mobileLabel: string;
  icon: typeof FileWarning;
}> = [
  {id: 'errors', label: 'Коды ошибок', mobileLabel: 'Коды', icon: FileWarning},
  {id: 'schemes', label: 'Датчики и схемы', mobileLabel: 'Схемы', icon: Cpu},
  {id: 'guides', label: 'Инструкции', mobileLabel: 'Инструкции', icon: BookOpen},
];

function loadFavorites(): FavoriteErrorItem[] {
  try {
    const raw = localStorage.getItem(FAVORITES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter(
          (item): item is FavoriteErrorItem =>
            Boolean(item && typeof item.id === 'string' && typeof item.key === 'string'),
        )
      : [];
  } catch {
    return [];
  }
}

export default function App() {
  const data = useAtmData();
  const {isDark, toggleTheme} = useTheme();
  const [initialUrl] = useState<AppUrlState>(() =>
    typeof window !== 'undefined' ? parseUrlState(window.location.search) : {tab: 'errors'},
  );
  const [activeTab, setActiveTab] = useState<AppTab>(initialUrl.tab);

  const [urlSyncState, setUrlSyncState] = useState<AppUrlState>(initialUrl);
  const [favorites, setFavorites] = useState<FavoriteErrorItem[]>(() => loadFavorites());

  const [pendingErrorQuery, setPendingErrorQuery] = useState<string | null>(null);
  const [pendingSensorTarget, setPendingSensorTarget] = useState<{
    sensorName: string;
    device?: string;
  } | null>(null);

  // Sync active route state to URL query string without creating noisy history entries
  useEffect(() => {
    const nextSearch = serializeUrlState({...urlSyncState, tab: activeTab});
    if (typeof window !== 'undefined' && window.location.search !== nextSearch) {
      window.history.replaceState(null, '', `${window.location.pathname}${nextSearch}`);
    }
  }, [activeTab, urlSyncState]);

  const handleToggleFavorite = useCallback((item: FavoriteErrorItem) => {
    setFavorites((prev) => {
      const exists = prev.some((f) => f.id === item.id);
      const next = exists
        ? prev.filter((f) => f.id !== item.id)
        : [item, ...prev].slice(0, 16);
      try {
        localStorage.setItem(FAVORITES_STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Ignore storage errors
      }
      return next;
    });
  }, []);

  const handleErrorsStateChange = useCallback((q: string, mode: DeviceMode) => {
    setUrlSyncState((prev) => ({...prev, q, mode}));
  }, []);

  const handleSchemesStateChange = useCallback(
    (group: DeviceGroupId, sensor: string | null, scheme: string) => {
      setUrlSyncState((prev) => ({
        ...prev,
        group,
        sensor: sensor ?? undefined,
        scheme,
      }));
    },
    [],
  );

  const handleGuidesStateChange = useCallback((guide: string, section: number) => {
    setUrlSyncState((prev) => ({...prev, guide, section}));
  }, []);

  const openSensorInSchemes = (sensorName: string, device?: string) => {
    setPendingSensorTarget({sensorName, device});
    setActiveTab('schemes');
    window.scrollTo({top: 0, behavior: 'smooth'});
  };

  const openErrorsForSensor = (sensorName: string) => {
    setPendingErrorQuery(sensorName);
    setActiveTab('errors');
    window.scrollTo({top: 0, behavior: 'smooth'});
  };

  const openFavoriteCode = (fav: FavoriteErrorItem) => {
    setPendingErrorQuery(fav.key);
    setActiveTab('errors');
    window.scrollTo({top: 0, behavior: 'smooth'});
  };

  const selectTab = (tab: AppTab) => {
    setActiveTab(tab);
    window.scrollTo({top: 0, behavior: 'instant'});
  };

  const primaryHeaderAction =
    activeTab === 'errors'
      ? {label: 'Открыть схемы', target: 'schemes' as AppTab}
      : {label: 'Поиск кода', target: 'errors' as AppTab};

  const totalErrorCodes = data.errorDb
    ? data.errorDb.meta.grg_count +
      data.errorDb.meta.ccdm_count +
      data.errorDb.meta.cmd_v4_count
    : 0;

  return (
    <div className="min-h-dvh bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col">
      {/* Top Bar: static on mobile (keeps <=15% sticky cap with bottom nav), sticky on desktop */}
      <header className="md:sticky md:top-0 z-30 h-14 bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 px-4 lg:px-6 flex items-center justify-between gap-4 md:gap-8">
        <button
          type="button"
          onClick={() => selectTab('errors')}
          className="text-base sm:text-lg font-display font-bold tracking-tight text-slate-900 dark:text-slate-100 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded"
        >
          ATM Service Desk
        </button>

        <nav
          aria-label="Основные разделы"
          className="hidden md:flex items-center gap-6"
        >
          {NAV_ITEMS.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => selectTab(item.id)}
                aria-current={active ? 'page' : undefined}
                className={`text-sm font-medium py-1 border-b-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded-t ${
                  active
                    ? 'border-blue-700 dark:border-blue-400 text-blue-700 dark:text-blue-400'
                    : 'border-transparent text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="shrink-0 flex items-center gap-2">
          <button
            type="button"
            onClick={toggleTheme}
            aria-pressed={isDark}
            aria-label={isDark ? 'Включить светлую тему' : 'Включить тёмную тему'}
            title={isDark ? 'Светлая тема' : 'Тёмная тема'}
            className="inline-flex items-center justify-center min-h-[40px] min-w-[40px] p-2 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
          >
            {isDark ? (
              <Sun className="w-4 h-4 text-amber-400" aria-hidden="true" />
            ) : (
              <Moon className="w-4 h-4 text-slate-700" aria-hidden="true" />
            )}
          </button>

          <div className="md:hidden">
            <PWAInstallControl compact />
          </div>

          <button
            type="button"
            onClick={() => selectTab(primaryHeaderAction.target)}
            className="hidden md:inline-flex px-3.5 py-2 text-xs sm:text-sm font-medium text-white bg-slate-900 dark:bg-blue-600 hover:bg-slate-800 dark:hover:bg-blue-500 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
          >
            {primaryHeaderAction.label}
          </button>
        </div>
      </header>

      {/* Workspace Body: 256px Desktop Sidebar + Main Content */}
      <div className="flex-1 max-w-[1440px] w-full mx-auto flex">
        <aside
          aria-label="Навигация рабочего места"
          className="hidden lg:flex lg:flex-col lg:w-64 shrink-0 border-r border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 justify-between"
        >
          <div className="space-y-6">
            <nav aria-label="Разделы справочника" className="space-y-1">
              {NAV_ITEMS.map((item) => {
                const Icon = item.icon;
                const active = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => selectTab(item.id)}
                    aria-current={active ? 'page' : undefined}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 text-sm font-medium rounded-lg transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                      active
                        ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-800 dark:text-blue-300'
                        : 'text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/70 hover:text-slate-900 dark:hover:text-slate-100'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span className="truncate">{item.label}</span>
                  </button>
                );
              })}
            </nav>

            {favorites.length > 0 && (
              <div className="pt-5 border-t border-slate-100 dark:border-slate-800 space-y-2 px-2">
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
                  <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500" aria-hidden="true" />
                  <span>Избранные коды</span>
                </p>
                <ul className="space-y-1">
                  {favorites.slice(0, 6).map((fav) => (
                    <li key={`side-${fav.id}`}>
                      <button
                        type="button"
                        onClick={() => openFavoriteCode(fav)}
                        className="w-full text-left px-2 py-1.5 rounded-md hover:bg-slate-50 dark:hover:bg-slate-800/70 transition-colors flex items-baseline justify-between gap-2 text-xs cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                      >
                        <span className="font-mono font-semibold text-slate-900 dark:text-slate-100 tabular-nums">
                          {fav.key}
                        </span>
                        <span className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                          {CATEGORY_TITLES[fav.category]}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {data.status === 'ready' && data.errorDb && data.schemesDb && (
              <div className="pt-5 border-t border-slate-100 dark:border-slate-800 space-y-2.5 px-2">
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">
                  Состав справочника
                </p>
                <dl className="space-y-1.5 text-xs">
                  <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
                    <dt>Коды GRG</dt>
                    <dd className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                      {data.errorDb.meta.grg_count.toLocaleString('ru-RU')}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
                    <dt>Коды Wincor CCDM</dt>
                    <dd className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                      {data.errorDb.meta.ccdm_count}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
                    <dt>Коды CMD-V4</dt>
                    <dd className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                      {data.errorDb.meta.cmd_v4_count}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between text-slate-600 dark:text-slate-400 pt-1.5 border-t border-slate-100 dark:border-slate-800">
                    <dt>Всего кодов</dt>
                    <dd className="font-mono font-semibold tabular-nums text-slate-900 dark:text-slate-100">
                      {totalErrorCodes.toLocaleString('ru-RU')}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
                    <dt>Чертежи схем</dt>
                    <dd className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                      {Object.keys(data.schemesDb.images).length}
                    </dd>
                  </div>
                  <div className="flex items-center justify-between text-slate-600 dark:text-slate-400">
                    <dt>Инструкции</dt>
                    <dd className="font-mono tabular-nums text-slate-900 dark:text-slate-100">
                      {data.guides.length}
                    </dd>
                  </div>
                </dl>
              </div>
            )}
          </div>

          <div className="space-y-3 pt-4 border-t border-slate-100 dark:border-slate-800">
            <div className="px-1">
              <PWAInstallControl />
            </div>
            <p className="text-[11px] text-slate-400 dark:text-slate-500 px-2">
              GRG · Wincor Nixdorf · NCR
            </p>
          </div>
        </aside>

        <main className="flex-1 min-w-0 p-4 pb-24 sm:p-6 md:pb-8 lg:p-8">
          {data.status === 'loading' && (
            <div
              className="space-y-6 animate-pulse"
              aria-label="Загрузка справочника"
            >
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-4">
                <div className="h-7 w-72 bg-slate-200 dark:bg-slate-800 rounded" />
                <div className="h-4 w-96 max-w-full bg-slate-100 dark:bg-slate-800/70 rounded" />
                <div className="h-10 w-full bg-slate-100 dark:bg-slate-800/70 rounded-lg" />
              </div>
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-6 space-y-3">
                <div className="h-5 w-48 bg-slate-200 dark:bg-slate-800 rounded" />
                <div className="h-24 w-full bg-slate-100 dark:bg-slate-800/70 rounded-lg" />
              </div>
            </div>
          )}

          {data.status === 'error' && (
            <div
              role="alert"
              className="bg-white dark:bg-slate-900 border border-red-200 dark:border-red-900/60 rounded-xl p-8 text-center max-w-lg mx-auto my-8 space-y-4"
            >
              <AlertCircle
                className="w-10 h-10 text-red-600 dark:text-red-400 mx-auto"
                aria-hidden="true"
              />
              <div>
                <h1 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                  Ошибка загрузки данных справочника
                </h1>
                <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
                  {data.errorMessage || 'Проверьте соединение и повторите попытку.'}
                </p>
              </div>
              <button
                type="button"
                onClick={data.reload}
                className="inline-flex items-center gap-2 px-4 py-2.5 min-h-[44px] text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-lg cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              >
                <RefreshCw className="w-4 h-4" aria-hidden="true" />
                <span>Повторить загрузку</span>
              </button>
            </div>
          )}

          {data.status === 'ready' &&
            data.errorDb &&
            data.errorIndexes &&
            data.schemesDb &&
            data.sensorIndex && (
              <>
                {activeTab === 'errors' && (
                  <ErrorLookupView
                    errorDb={data.errorDb}
                    errorIndexes={data.errorIndexes}
                    sensorIndex={data.sensorIndex}
                    sensorMinLen={data.sensorMinLen}
                    initialQuery={urlSyncState.q ?? '25523'}
                    initialMode={urlSyncState.mode ?? 'all'}
                    favorites={favorites}
                    onToggleFavorite={handleToggleFavorite}
                    onStateChange={handleErrorsStateChange}
                    externalQuery={pendingErrorQuery}
                    onConsumeExternalQuery={() => setPendingErrorQuery(null)}
                    onOpenSensorInSchemes={openSensorInSchemes}
                  />
                )}

                {activeTab === 'schemes' && (
                  <SchemesSensorsView
                    schemesDb={data.schemesDb}
                    sensorIndex={data.sensorIndex}
                    initialGroup={urlSyncState.group ?? 'all'}
                    initialSensor={urlSyncState.sensor}
                    initialScheme={urlSyncState.scheme}
                    onStateChange={handleSchemesStateChange}
                    externalSelection={pendingSensorTarget}
                    onConsumeExternalSelection={() => setPendingSensorTarget(null)}
                    onLookupErrorsForSensor={openErrorsForSensor}
                  />
                )}

                {activeTab === 'guides' && (
                  <GuidesView
                    guides={data.guides}
                    initialGuideId={urlSyncState.guide}
                    initialSectionIdx={urlSyncState.section ?? 0}
                    onStateChange={handleGuidesStateChange}
                  />
                )}
              </>
            )}
        </main>
      </div>

      {/* Android-native Bottom Navigation Bar (thumb-zone ergonomic, < 768px) */}
      <nav
        aria-label="Нижняя навигация"
        className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-t border-slate-200 dark:border-slate-800 pb-safe"
      >
        <div className="grid grid-cols-3 h-16">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon;
            const active = activeTab === item.id;
            return (
              <button
                key={`mobile-${item.id}`}
                type="button"
                onClick={() => selectTab(item.id)}
                aria-current={active ? 'page' : undefined}
                className={`flex flex-col items-center justify-center gap-1 min-h-[48px] transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600 ${
                  active
                    ? 'text-blue-700 dark:text-blue-400'
                    : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                }`}
              >
                <Icon
                  className={`w-5 h-5 shrink-0 ${active ? 'stroke-[2.25]' : ''}`}
                  aria-hidden="true"
                />
                <span className="text-[11px] font-medium tracking-tight leading-none whitespace-nowrap">
                  {item.mobileLabel}
                </span>
              </button>
            );
          })}
        </div>
      </nav>

      <OfflineIndicator />
    </div>
  );
}
