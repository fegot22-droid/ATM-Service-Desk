import {useEffect, useMemo, useState} from 'react';
import {ImageOff, Search, Star, X} from 'lucide-react';
import type {
  DeviceGroupId,
  SchemesDatabase,
  SensorHit,
  SensorIndex,
  SensorScheme,
} from '../types/atm';
import {getSchemeImageUrl} from '../utils/assetPaths';
import {
  DEVICE_GROUPS,
  findMatchingSensors,
  findSensor,
  getExtendedGallery,
  listSensorsByDevice,
  normalizeSensorName,
} from '../utils/sensorLookup';
import {SchemeViewer, type HighlightPoint} from './SchemeViewer';

const GROUP_TABS: Array<{id: DeviceGroupId; label: string}> = [
  {id: 'all', label: 'Все устройства'},
  {id: 'ccdm', label: 'Wincor CCDM'},
  {id: 'cmd', label: 'Wincor CMD-V4'},
  {id: 'grg', label: 'GRG'},
  {id: 'crs', label: 'CRS 4060 FL'},
];

const QUICK_SENSORS = ['SF17', 'VLS12', 'ССЕ1', 'PS27', 'TUB_PS1b', 'Print head'];
const FAVORITE_SENSORS_KEY = 'atm_service_favorite_sensors_v1';

interface SchemesSensorsViewProps {
  schemesDb: SchemesDatabase;
  sensorIndex: SensorIndex;
  initialGroup?: DeviceGroupId;
  initialSensor?: string;
  initialScheme?: string;
  onStateChange?: (group: DeviceGroupId, sensor: string | null, scheme: string) => void;
  externalSelection?: {sensorName: string; device?: string} | null;
  onConsumeExternalSelection?: () => void;
  onLookupErrorsForSensor: (sensorName: string) => void;
}

function loadFavoriteSensors(): string[] {
  try {
    const raw = localStorage.getItem(FAVORITE_SENSORS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((s): s is string => typeof s === 'string').slice(0, 12)
      : [];
  } catch {
    return [];
  }
}

function ThumbnailCard({
  imageId,
  title,
  device,
  markerCount,
  active,
  onClick,
}: {
  imageId: string;
  title: string;
  device: string;
  markerCount: number;
  active: boolean;
  onClick: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const url = getSchemeImageUrl(imageId);

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`group text-left bg-white dark:bg-slate-900 border rounded-xl overflow-hidden transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
        active
          ? 'border-blue-600 dark:border-blue-500 ring-1 ring-blue-600 dark:ring-blue-500'
          : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
      }`}
    >
      <div className="aspect-4/3 bg-slate-100 dark:bg-slate-800 overflow-hidden flex items-center justify-center">
        {!url || failed ? (
          <div className="flex flex-col items-center justify-center p-3 text-slate-400 dark:text-slate-500">
            <ImageOff className="w-6 h-6 mb-1" aria-hidden="true" />
            <span className="text-[11px] text-center">{imageId}</span>
          </div>
        ) : (
          <img
            src={url}
            alt={title}
            referrerPolicy="no-referrer"
            onError={() => setFailed(true)}
            className="w-full h-full object-cover object-center group-hover:scale-[1.02] transition-transform duration-150"
          />
        )}
      </div>
      <div className="px-3 py-2 border-t border-slate-100 dark:border-slate-800 space-y-0.5">
        <p className="text-xs font-medium text-slate-800 dark:text-slate-100 truncate">{title}</p>
        <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate tabular-nums">
          {device}
          {markerCount > 0 ? ` · ${markerCount} меток` : ' · обзорная'}
        </p>
      </div>
    </button>
  );
}

export function SchemesSensorsView({
  schemesDb,
  sensorIndex,
  initialGroup = 'all',
  initialSensor,
  initialScheme,
  onStateChange,
  externalSelection,
  onConsumeExternalSelection,
  onLookupErrorsForSensor,
}: SchemesSensorsViewProps) {
  const [group, setGroup] = useState<DeviceGroupId>(initialGroup);
  const [sensorQuery, setSensorQuery] = useState(initialSensor ?? '');
  const [selectedSensor, setSelectedSensor] = useState<string | null>(
    initialSensor !== undefined ? initialSensor : 'SF17',
  );
  const [activeImageId, setActiveImageId] = useState<string>(initialScheme || 'crm_up');
  const [favoriteSensors, setFavoriteSensors] = useState<string[]>(() =>
    loadFavoriteSensors(),
  );

  useEffect(() => {
    if (externalSelection) {
      const hits = findSensor(externalSelection.sensorName, sensorIndex);
      const preferred =
        (externalSelection.device
          ? hits.find((h) => h.scheme.device === externalSelection.device)
          : undefined) ?? hits[0];
      if (preferred) {
        setSensorQuery(externalSelection.sensorName);
        setSelectedSensor(preferred.name);
        setActiveImageId(preferred.scheme.image);
        setGroup('all');
      }
      onConsumeExternalSelection?.();
    }
  }, [externalSelection, sensorIndex, onConsumeExternalSelection]);

  useEffect(() => {
    onStateChange?.(group, selectedSensor, activeImageId);
  }, [group, selectedSensor, activeImageId, onStateChange]);

  const toggleFavoriteSensor = (name: string) => {
    const next = favoriteSensors.includes(name)
      ? favoriteSensors.filter((s) => s !== name)
      : [name, ...favoriteSensors].slice(0, 12);
    setFavoriteSensors(next);
    try {
      localStorage.setItem(FAVORITE_SENSORS_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage errors
    }
  };

  const sensorHits: SensorHit[] = useMemo(() => {
    const query = selectedSensor ?? sensorQuery.trim();
    if (!query) return [];
    const hits = findSensor(query, sensorIndex);
    if (group === 'all') return hits;
    const allowed = DEVICE_GROUPS[group].devices;
    return hits.filter((h) => allowed.includes(h.scheme.device));
  }, [selectedSensor, sensorQuery, sensorIndex, group]);

  const instantMatches = useMemo(() => {
    if (!sensorQuery.trim()) return [];
    return findMatchingSensors(sensorQuery, schemesDb, group, 14);
  }, [sensorQuery, schemesDb, group]);

  const activeScheme: SensorScheme | undefined = useMemo(() => {
    return schemesDb.sensor_schemes.find((s) => s.image === activeImageId);
  }, [schemesDb.sensor_schemes, activeImageId]);

  const activeGalleryItem = useMemo(() => {
    return schemesDb.gallery.find((g) => g.image === activeImageId);
  }, [schemesDb.gallery, activeImageId]);

  const highlightedPoints: HighlightPoint[] = useMemo(() => {
    if (!selectedSensor) return [];
    const matchedHit = sensorHits.find((h) => h.scheme.image === activeImageId);
    if (matchedHit) {
      return matchedHit.points.map((pt) => ({
        name: matchedHit.name,
        x: pt.x,
        y: pt.y,
      }));
    }
    if (!activeScheme) return [];
    const normSel = normalizeSensorName(selectedSensor);
    return activeScheme.markers
      .filter(([name]) => normalizeSensorName(name) === normSel)
      .map(([name, x, y]) => ({name, x, y}));
  }, [selectedSensor, sensorHits, activeImageId, activeScheme]);

  const extendedGallery = useMemo(() => {
    return getExtendedGallery(schemesDb, group);
  }, [schemesDb, group]);

  const deviceDirectories = useMemo(() => {
    const dirs = listSensorsByDevice(schemesDb, group);
    const needle = normalizeSensorName(sensorQuery);
    if (!needle) return dirs;
    return dirs
      .map((dir) => ({
        ...dir,
        sensors: dir.sensors.filter((s) => normalizeSensorName(s).includes(needle)),
      }))
      .filter((dir) => dir.sensors.length > 0);
  }, [schemesDb, group, sensorQuery]);

  const selectSensorByName = (name: string) => {
    const hits = findSensor(name, sensorIndex);
    const allowed = group === 'all' ? null : DEVICE_GROUPS[group].devices;
    const scopedHits = allowed
      ? hits.filter((h) => allowed.includes(h.scheme.device))
      : hits;
    const chosenHits = scopedHits.length > 0 ? scopedHits : hits;

    setSelectedSensor(chosenHits[0]?.name ?? name);
    if (chosenHits.length > 0) {
      const sameImage = chosenHits.find((h) => h.scheme.image === activeImageId);
      if (!sameImage) {
        setActiveImageId(chosenHits[0].scheme.image);
      }
    }
  };

  const handleSearchChange = (value: string) => {
    setSensorQuery(value);
    const trimmed = value.trim();
    if (!trimmed) {
      setSelectedSensor(null);
      return;
    }
    const exactHits = findSensor(trimmed, sensorIndex);
    if (exactHits.length > 0) {
      setSelectedSensor(exactHits[0].name);
      setActiveImageId(exactHits[0].scheme.image);
    }
  };

  const viewerTitle = activeScheme
    ? `${activeScheme.vendor} ${activeScheme.device} · ${activeScheme.part}`
    : activeGalleryItem?.title ?? activeImageId;

  const viewerSubtitle = activeScheme
    ? `Размечено точек на схеме: ${activeScheme.markers.length}`
    : 'Обзорная схема узла (без индивидуальных меток)';

  const isSelectedFavorite = selectedSensor
    ? favoriteSensors.includes(selectedSensor)
    : false;

  return (
    <div className="space-y-6">
      {/* Header & Search Controls */}
      <section
        aria-label="Поиск датчиков и схем"
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl p-5 sm:p-6 space-y-4 transition-colors"
      >
        <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-2">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
              Датчики, моторы и схемы узлов
            </h1>
            <p className="text-sm text-slate-600 dark:text-slate-400 mt-1">
              Поиск работает с кириллической раскладкой (например, ССЕ1), пробелами и диапазонами CRS 4060 FL.
            </p>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 font-mono tabular-nums whitespace-nowrap shrink-0">
            {extendedGallery.length} схем в каталоге · {Object.keys(schemesDb.images).length} чертежей
          </p>
        </div>

        {/* Device Group Tabs */}
        <div
          className="flex flex-wrap items-center gap-1.5 p-1 bg-slate-100 dark:bg-slate-800 rounded-lg w-full sm:w-fit"
          role="group"
          aria-label="Фильтр по модулю банкомата"
        >
          {GROUP_TABS.map((tab) => {
            const active = group === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setGroup(tab.id)}
                aria-pressed={active}
                className={`px-3 py-2 min-h-[40px] sm:min-h-0 text-xs sm:text-sm font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                  active
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-100 shadow-xs'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            );
          })}
        </div>

        {/* Sensor Search Input */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <label htmlFor="sensor-search-input" className="sr-only">
              Поиск датчика или мотора по названию
            </label>
            <Search
              className="w-4 h-4 text-slate-400 dark:text-slate-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              id="sensor-search-input"
              type="text"
              enterKeyHint="search"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              value={sensorQuery}
              onChange={(e) => handleSearchChange(e.target.value)}
              placeholder="Поиск элемента: SF17, ССЕ1, PS27, TUB_PS1b, KLS1_1..."
              className="w-full min-h-[44px] pl-10 pr-10 py-2.5 text-sm font-mono bg-white dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-lg text-slate-900 dark:text-slate-100 placeholder:font-sans placeholder:text-slate-400 dark:placeholder:text-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
            />
            {sensorQuery && (
              <button
                type="button"
                onClick={() => {
                  setSensorQuery('');
                  setSelectedSensor(null);
                }}
                aria-label="Очистить фильтр датчиков"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 p-2 min-h-[36px] min-w-[36px] flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            )}
          </div>

          {selectedSensor && (
            <button
              type="button"
              onClick={() => toggleFavoriteSensor(selectedSensor)}
              aria-pressed={isSelectedFavorite}
              className={`inline-flex items-center justify-center gap-1.5 min-h-[44px] px-4 py-2 text-xs sm:text-sm font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                isSelectedFavorite
                  ? 'bg-amber-50 dark:bg-amber-950/50 text-amber-800 dark:text-amber-200 border-amber-200 dark:border-amber-800/60'
                  : 'bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
              }`}
            >
              <Star
                className={`w-4 h-4 ${
                  isSelectedFavorite ? 'fill-amber-500 text-amber-500' : ''
                }`}
                aria-hidden="true"
              />
              <span>
                {isSelectedFavorite
                  ? `${selectedSensor} в избранном`
                  : `Закрепить ${selectedSensor}`}
              </span>
            </button>
          )}
        </div>

        {/* Instant Matching Sensors Strip (visible right below search on mobile & desktop) */}
        {sensorQuery.trim() && (
          <div className="pt-2 border-t border-slate-100 dark:border-slate-800 space-y-2">
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className="font-medium text-slate-600 dark:text-slate-400">
                {instantMatches.length > 0
                  ? `Подходящие элементы (${instantMatches.length}):`
                  : `Элементы по запросу «${sensorQuery.trim()}» не найдены`}
              </span>
            </div>
            {instantMatches.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {instantMatches.map((item) => {
                  const isActive = selectedSensor === item.name;
                  return (
                    <button
                      key={`instant-${item.name}`}
                      type="button"
                      onClick={() => selectSensorByName(item.name)}
                      aria-pressed={isActive}
                      className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-mono rounded-md border transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                        isActive
                          ? 'bg-blue-700 dark:bg-blue-600 text-white border-blue-700 dark:border-blue-600 font-semibold'
                          : 'bg-slate-50 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700'
                      }`}
                    >
                      <span>{item.name}</span>
                      <span
                        className={`font-sans text-[11px] ${
                          isActive ? 'text-blue-100' : 'text-slate-500 dark:text-slate-400'
                        }`}
                      >
                        {item.devices[0]}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* Quick sensor chips & Favorite sensors */}
        <div className="flex flex-col gap-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-slate-500 dark:text-slate-400 shrink-0">Быстрый выбор:</span>
            {QUICK_SENSORS.map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => handleSearchChange(name)}
                className="px-2.5 py-1.5 sm:py-1 font-mono text-xs text-slate-700 dark:text-slate-200 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              >
                {name}
              </button>
            ))}
          </div>

          {favoriteSensors.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-slate-100 dark:border-slate-800">
              <Star className="w-3.5 h-3.5 text-amber-500 fill-amber-500 shrink-0" aria-hidden="true" />
              <span className="text-slate-500 dark:text-slate-400 mr-1">Закреплённые:</span>
              {favoriteSensors.map((name) => (
                <button
                  key={`fav-sensor-${name}`}
                  type="button"
                  onClick={() => selectSensorByName(name)}
                  className="px-2.5 py-1 font-mono text-xs text-slate-800 dark:text-amber-200 bg-amber-50/70 dark:bg-amber-950/50 hover:bg-amber-100 dark:hover:bg-amber-900/60 border border-amber-200 dark:border-amber-800/60 rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                >
                  {name}
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Main Split Workspace: Interactive Viewer + Sensor Directory */}
      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-start">
        {/* Left/Center: Interactive Diagram + Multi-scheme Switcher + Gallery */}
        <div className="xl:col-span-8 space-y-5">
          {sensorHits.length > 1 && (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl px-4 py-3 flex flex-wrap items-center gap-2">
              <span className="text-xs font-medium text-slate-600 dark:text-slate-400 mr-1">
                Датчик{' '}
                <span className="font-mono font-semibold text-slate-900 dark:text-slate-100">
                  {sensorHits[0].name}
                </span>{' '}
                встречается на нескольких схемах:
              </span>
              {sensorHits.map((hit) => {
                const isCur = hit.scheme.image === activeImageId;
                return (
                  <button
                    key={`${hit.scheme.image}-${hit.scheme.part}`}
                    type="button"
                    onClick={() => setActiveImageId(hit.scheme.image)}
                    className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                      isCur
                        ? 'bg-blue-700 dark:bg-blue-600 text-white border-blue-700 dark:border-blue-600'
                        : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700'
                    }`}
                  >
                    {hit.scheme.device} · {hit.scheme.part}
                  </button>
                );
              })}
            </div>
          )}

          <SchemeViewer
            imageId={activeImageId}
            title={viewerTitle}
            subtitle={viewerSubtitle}
            scheme={activeScheme}
            highlightedPoints={highlightedPoints}
            selectedSensorName={selectedSensor}
            onSelectSensor={(name) => selectSensorByName(name)}
            onLookupErrorsForSensor={onLookupErrorsForSensor}
          />

          {/* Scheme Gallery */}
          <section aria-label="Галерея схем" className="space-y-3">
            <div className="flex items-baseline justify-between px-1">
              <h2 className="text-sm font-semibold text-slate-800 dark:text-slate-200">
                Галерея схем
              </h2>
              <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
                Показано: {extendedGallery.length}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {extendedGallery.map((item) => (
                <ThumbnailCard
                  key={`${item.image}-${item.title}`}
                  imageId={item.image}
                  title={item.title}
                  device={item.device}
                  markerCount={item.markerCount}
                  active={activeImageId === item.image}
                  onClick={() => {
                    setActiveImageId(item.image);
                    setSelectedSensor(null);
                  }}
                />
              ))}
            </div>
          </section>
        </div>

        {/* Right: Searchable Sensor Directory */}
        <aside
          aria-label="Справочник датчиков по устройствам"
          className="xl:col-span-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden"
        >
          <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-950/50 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Список датчиков и моторов
            </h2>
            <span className="text-xs text-slate-500 dark:text-slate-400 tabular-nums">
              {deviceDirectories.reduce((acc, d) => acc + d.sensors.length, 0)} шт.
            </span>
          </div>

          <div className="max-h-[760px] overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800">
            {deviceDirectories.length === 0 ? (
              <div className="p-6 text-center text-sm text-slate-500 dark:text-slate-400">
                Датчики по запросу «{sensorQuery}» не найдены.
              </div>
            ) : (
              deviceDirectories.map((dir) => (
                <div key={dir.label} className="p-4 space-y-2.5">
                  <div className="flex items-baseline justify-between gap-2">
                    <h3 className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                      {dir.label}
                    </h3>
                    <span className="text-[11px] font-mono tabular-nums text-slate-400 dark:text-slate-500">
                      {dir.sensors.length}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {dir.sensors.map((sensorName) => {
                      const isActive = selectedSensor === sensorName;
                      return (
                        <button
                          key={`${dir.label}:${sensorName}`}
                          type="button"
                          onClick={() => selectSensorByName(sensorName)}
                          aria-pressed={isActive}
                          className={`px-3 py-2 sm:px-2 sm:py-1 text-xs font-mono rounded border transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                            isActive
                              ? 'bg-blue-700 dark:bg-blue-600 text-white border-blue-700 dark:border-blue-600 font-semibold'
                              : 'bg-slate-50 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-700 hover:text-slate-900 dark:hover:text-white'
                          }`}
                        >
                          {sensorName}
                        </button>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
