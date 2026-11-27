import {useEffect, useMemo, useRef, useState} from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  Bookmark,
  Check,
  Copy,
  History,
  Search,
  Star,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import type {
  DeviceMode,
  ErrorCategory,
  ErrorCodesDatabase,
  ErrorMatch,
  SensorHit,
  SensorIndex,
} from '../types/atm';
import {
  CATEGORY_TITLES,
  MODE_OPTIONS,
  devicesForError,
  extractCodes,
  lookupValue,
  searchErrorsByKeywordFull,
  type ErrorIndexes,
} from '../utils/errorLookup';
import {
  findSensor,
  findSensorsInText,
  getSensorHintsForError,
  splitTextWithSensors,
} from '../utils/sensorLookup';
import {SchemeViewer} from './SchemeViewer';

const HISTORY_STORAGE_KEY = 'atm_service_error_history_v1';
const MAX_HISTORY = 8;

const QUICK_EXAMPLES: Array<{label: string; query: string; mode?: DeviceMode}> = [
  {label: '-1335', query: '-1335'},
  {label: '25523 (с датчиком)', query: '25523'},
  {label: '08', query: '08'},
  {label: '21 (CCDM)', query: '21', mode: 'ccdm'},
  {label: '71 (CMD-V4)', query: '71', mode: 'cmd_v4'},
  {label: 'shutter', query: 'shutter'},
];

export interface FavoriteErrorItem {
  id: string;
  category: ErrorCategory;
  key: string;
  summary: string;
}

interface ErrorLookupViewProps {
  errorDb: ErrorCodesDatabase;
  errorIndexes: ErrorIndexes;
  sensorIndex: SensorIndex;
  sensorMinLen: number;
  initialQuery?: string;
  initialMode?: DeviceMode;
  favorites: FavoriteErrorItem[];
  onToggleFavorite: (item: FavoriteErrorItem) => void;
  onStateChange?: (query: string, mode: DeviceMode) => void;
  externalQuery?: string | null;
  onConsumeExternalQuery?: () => void;
  onOpenSensorInSchemes: (sensorName: string, device?: string) => void;
}

function loadHistory(): string[] {
  try {
    const raw = localStorage.getItem(HISTORY_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === 'string').slice(0, MAX_HISTORY)
      : [];
  } catch {
    return [];
  }
}

function HighlightedText({text, needle}: {text: string; needle: string}) {
  const clean = needle.trim();
  if (clean.length < 2) return <>{text}</>;
  const escaped = clean.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const parts = text.split(new RegExp(`(${escaped})`, 'gi'));
  return (
    <>
      {parts.map((part, idx) =>
        part.toLowerCase() === clean.toLowerCase() ? (
          <mark
            key={idx}
            className="bg-amber-200/80 dark:bg-amber-500/30 text-slate-900 dark:text-amber-100 rounded-xs px-0.5 font-medium"
          >
            {part}
          </mark>
        ) : (
          <span key={idx}>{part}</span>
        ),
      )}
    </>
  );
}

function InteractiveSensorText({
  text,
  allowedDevices,
  sensorIndex,
  onOpenSensor,
}: {
  text: string;
  allowedDevices: readonly string[];
  sensorIndex: SensorIndex;
  onOpenSensor: (sensorName: string, device?: string) => void;
}) {
  const parts = useMemo(
    () => splitTextWithSensors(text, allowedDevices, sensorIndex),
    [text, allowedDevices, sensorIndex],
  );

  return (
    <>
      {parts.map((part, idx) =>
        part.kind === 'sensor' && part.sensorName ? (
          <button
            key={`${part.value}-${idx}`}
            type="button"
            onClick={() => onOpenSensor(part.sensorName!, part.device)}
            title={`Открыть датчик ${part.sensorName} на схеме`}
            className="inline-flex items-center gap-0.5 px-1.5 py-0.5 mx-0.5 font-mono text-[0.9em] font-semibold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-500/15 hover:bg-blue-100 dark:hover:bg-blue-500/25 rounded transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 align-baseline"
          >
            <span>{part.value}</span>
            <ArrowUpRight className="w-3 h-3 shrink-0" aria-hidden="true" />
          </button>
        ) : (
          <span key={idx}>{part.value}</span>
        ),
      )}
    </>
  );
}

export function ErrorLookupView({
  errorDb,
  errorIndexes,
  sensorIndex,
  sensorMinLen,
  initialQuery = '25523',
  initialMode = 'all',
  favorites,
  onToggleFavorite,
  onStateChange,
  externalQuery,
  onConsumeExternalQuery,
  onOpenSensorInSchemes,
}: ErrorLookupViewProps) {
  const [mode, setMode] = useState<DeviceMode>(initialMode);
  const [inputValue, setInputValue] = useState(initialQuery);
  const [submittedQuery, setSubmittedQuery] = useState(initialQuery);
  const [history, setHistory] = useState<string[]>(() => loadHistory());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [keywordLimit, setKeywordLimit] = useState<number>(25);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (externalQuery && externalQuery.trim()) {
      const q = externalQuery.trim();
      setMode('all');
      setInputValue(q);
      setSubmittedQuery(q);
      setKeywordLimit(25);
      onConsumeExternalQuery?.();
    }
  }, [externalQuery, onConsumeExternalQuery]);

  // Live search preview (instant for numeric/sensor queries, gentle debounce for words)
  useEffect(() => {
    const trimmed = inputValue.trim();
    if (trimmed === submittedQuery) return;
    const isNumeric = /^[\s,\d\-−–—]+$/.test(trimmed);
    const delay = trimmed === '' || isNumeric ? 60 : 160;
    const timer = window.setTimeout(() => {
      setSubmittedQuery(trimmed);
      setKeywordLimit(25);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [inputValue, submittedQuery]);

  // Sync active state up to URL
  useEffect(() => {
    onStateChange?.(submittedQuery, mode);
  }, [submittedQuery, mode, onStateChange]);

  // Press '/' anywhere to jump straight into search
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      inputRef.current?.focus();
      inputRef.current?.select();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const persistHistory = (next: string[]) => {
    setHistory(next);
    try {
      localStorage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // Ignore storage quota errors
    }
  };

  const runSearch = (rawQuery: string, nextMode: DeviceMode = mode) => {
    const cleaned = rawQuery.trim();
    setInputValue(rawQuery);
    setSubmittedQuery(cleaned);
    setKeywordLimit(25);
    if (nextMode !== mode) {
      setMode(nextMode);
    }
    if (cleaned) {
      const updated = [cleaned, ...history.filter((h) => h !== cleaned)].slice(
        0,
        MAX_HISTORY,
      );
      persistHistory(updated);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    runSearch(inputValue, mode);
  };

  const handleCopy = async (id: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      window.setTimeout(() => setCopiedId((cur) => (cur === id ? null : cur)), 1800);
    } catch {
      // Ignore clipboard permission denials
    }
  };

  const lookupResult = useMemo(() => {
    const query = submittedQuery.trim();
    if (!query) {
      return {
        codes: [] as number[],
        matches: [] as Array<{code: number; items: ErrorMatch[]}>,
        directSensors: [] as SensorHit[],
        keywordMatches: [] as ReturnType<typeof searchErrorsByKeywordFull>['items'],
        keywordTotal: 0,
      };
    }

    const codes = extractCodes(query);
    const matches = codes.map((code) => ({
      code,
      items: lookupValue(code, errorDb, errorIndexes, mode),
    }));

    const sensorNamesInQuery = findSensorsInText(query, sensorIndex, sensorMinLen);
    const directSensors: SensorHit[] = [];
    for (const sName of sensorNamesInQuery) {
      directSensors.push(...findSensor(sName, sensorIndex));
    }

    const totalCodeMatches = matches.reduce((acc, g) => acc + g.items.length, 0);
    const kw =
      codes.length === 0 || (totalCodeMatches === 0 && query.length >= 2)
        ? searchErrorsByKeywordFull(query, errorDb, mode, keywordLimit)
        : {items: [], total: 0};

    return {
      codes,
      matches,
      directSensors,
      keywordMatches: kw.items,
      keywordTotal: kw.total,
    };
  }, [submittedQuery, mode, errorDb, errorIndexes, sensorIndex, sensorMinLen, keywordLimit]);

  const totalErrorMatches = lookupResult.matches.reduce(
    (sum, group) => sum + group.items.length,
    0,
  );

  const countForMode = (m: DeviceMode): number => {
    if (m === 'grg') return errorDb.meta.grg_count;
    if (m === 'ccdm') return errorDb.meta.ccdm_count;
    if (m === 'cmd_v4') return errorDb.meta.cmd_v4_count;
    return errorDb.meta.grg_count + errorDb.meta.ccdm_count + errorDb.meta.cmd_v4_count;
  };

  const favoriteSet = useMemo(
    () => new Set(favorites.map((f) => f.id)),
    [favorites],
  );

  return (
    <div className="space-y-6">
      {/* Search & Mode Control Panel */}
      <section
        aria-label="Поиск кодов ошибок"
        className="bg-white dark:bg-neutral-800 shadow-xs dark:shadow-none rounded-xl p-5 sm:p-6 space-y-4 transition-colors"
      >
        <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-2">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-neutral-100">
              Поиск кодов ошибок банкоматов
            </h1>
            <p className="text-sm text-slate-600 dark:text-neutral-400 mt-1">
              Введите один или несколько кодов через пробел (до 10 за раз), имя датчика или слово из описания.
            </p>
          </div>
          <p className="text-xs text-slate-500 dark:text-neutral-400 font-mono tabular-nums whitespace-nowrap shrink-0">
            База: {countForMode(mode).toLocaleString('ru-RU')} записей
          </p>
        </div>

        {/* Device Mode Segmented Tabs */}
        <div
          className="grid grid-cols-2 sm:inline-flex sm:flex-wrap items-center gap-1.5 p-1 bg-slate-100 dark:bg-neutral-900 rounded-lg w-full sm:w-fit"
          role="group"
          aria-label="Фильтр по базе оборудования"
        >
          {MODE_OPTIONS.map((opt) => {
            const active = mode === opt.id;
            return (
              <button
                key={opt.id}
                type="button"
                onClick={() => setMode(opt.id)}
                aria-pressed={active}
                className={`px-3 py-2 min-h-[40px] sm:min-h-0 text-xs sm:text-sm font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                  active
                    ? 'bg-white dark:bg-neutral-800 text-slate-900 dark:text-neutral-100 shadow-xs'
                    : 'text-slate-600 dark:text-neutral-400 hover:text-slate-900 dark:hover:text-neutral-100'
                }`}
              >
                <span>{opt.shortTitle}</span>
                <span className="ml-1.5 text-[11px] font-mono tabular-nums text-slate-400 dark:text-neutral-500">
                  {countForMode(opt.id).toLocaleString('ru-RU')}
                </span>
              </button>
            );
          })}
        </div>

        {/* Search Form */}
        <form onSubmit={handleSubmit} className="flex flex-col sm:flex-row gap-2.5">
          <div className="relative flex-1">
            <label htmlFor="error-search-input" className="sr-only">
              Код ошибки, датчик или ключевое слово
            </label>
            <Search
              className="w-4 h-4 text-slate-400 dark:text-neutral-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              ref={inputRef}
              id="error-search-input"
              type="text"
              enterKeyHint="search"
              autoCapitalize="off"
              autoCorrect="off"
              spellCheck={false}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape' && inputValue) {
                  setInputValue('');
                  setSubmittedQuery('');
                }
              }}
              placeholder="Например: -1335, 25523, 08, SF17 или shutter"
              className="w-full min-h-[44px] pl-10 pr-10 py-2.5 text-sm font-mono bg-slate-100 dark:bg-neutral-900 border border-transparent rounded-lg text-slate-900 dark:text-neutral-100 placeholder:font-sans placeholder:text-slate-400 dark:placeholder:text-neutral-500 focus:bg-white dark:focus:bg-neutral-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
            {inputValue && (
              <button
                type="button"
                onClick={() => {
                  setInputValue('');
                  setSubmittedQuery('');
                  inputRef.current?.focus();
                }}
                aria-label="Очистить строку поиска"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 p-2 min-h-[36px] min-w-[36px] flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-neutral-200 rounded cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            )}
          </div>
          <button
            type="submit"
            className="min-h-[44px] px-5 py-2.5 text-sm font-semibold text-white bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 rounded-lg transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-neutral-800"
          >
            Найти код
          </button>
        </form>

        {/* Quick Examples, Favorites & Recent History */}
        <div className="flex flex-col gap-2.5 pt-1">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-slate-500 dark:text-neutral-400 shrink-0">Примеры:</span>
            {QUICK_EXAMPLES.map((ex) => (
              <button
                key={ex.label}
                type="button"
                onClick={() => runSearch(ex.query, ex.mode ?? 'all')}
                className="px-2.5 py-1.5 sm:py-1 font-mono text-xs text-slate-700 dark:text-neutral-200 bg-slate-100 dark:bg-neutral-700/80 hover:bg-slate-200 dark:hover:bg-neutral-600 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              >
                {ex.label}
              </button>
            ))}
          </div>

          {favorites.length > 0 && (
            <div className="flex flex-wrap items-center gap-1.5 pt-2 border-t border-slate-100 dark:border-white/[0.06] text-xs">
              <Bookmark className="w-3.5 h-3.5 text-amber-600 dark:text-amber-400 shrink-0" aria-hidden="true" />
              <span className="text-slate-500 dark:text-neutral-400 mr-1">Избранное:</span>
              {favorites.map((fav) => (
                <button
                  key={fav.id}
                  type="button"
                  onClick={() => runSearch(fav.key, fav.category)}
                  title={fav.summary}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 font-mono text-xs text-slate-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-500/15 hover:bg-amber-100 dark:hover:bg-amber-500/25 rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                >
                  <span className="font-semibold">{fav.key}</span>
                  <span className="font-sans text-[11px] text-slate-500 dark:text-amber-300/70">
                    {CATEGORY_TITLES[fav.category]}
                  </span>
                </button>
              ))}
            </div>
          )}

          {history.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-100 dark:border-white/[0.06] text-xs">
              <div className="flex flex-wrap items-center gap-1.5">
                <History className="w-3.5 h-3.5 text-slate-400 dark:text-neutral-500 shrink-0" aria-hidden="true" />
                <span className="text-slate-500 dark:text-neutral-400 mr-1">Недавние:</span>
                {history.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => runSearch(item, mode)}
                    className="px-2 py-1 font-mono text-xs text-slate-700 dark:text-neutral-200 bg-slate-100 dark:bg-neutral-700/80 hover:bg-slate-200 dark:hover:bg-neutral-600 rounded transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                  >
                    {item}
                  </button>
                ))}
              </div>
              <button
                type="button"
                onClick={() => persistHistory([])}
                className="inline-flex items-center gap-1 text-xs text-slate-500 dark:text-neutral-400 hover:text-red-600 dark:hover:text-red-400 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded px-1.5 py-0.5"
              >
                <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Очистить историю</span>
              </button>
            </div>
          )}
        </div>
      </section>

      {/* Empty initial state */}
      {!submittedQuery && (
        <section className="bg-white dark:bg-neutral-800 shadow-xs dark:shadow-none rounded-xl p-8 text-center">
          <p className="text-base font-semibold text-slate-900 dark:text-neutral-100">
            Введите код ошибки для расшифровки
          </p>
          <p className="text-sm text-slate-600 dark:text-neutral-400 mt-1.5 max-w-xl mx-auto">
            Поддерживаются отрицательные коды с любым тире, пробелы и запятые в разрядах,
            ведущие нули для Wincor CCDM / CMD-V4, а также автоматическая привязка датчиков к схемам.
          </p>
        </section>
      )}

      {/* Results for numeric codes */}
      {submittedQuery && lookupResult.codes.length > 0 && (
        <div className="space-y-5">
          {lookupResult.matches.map(({code, items}) => (
            <section
              key={code}
              aria-label={`Результаты по коду ${code}`}
              className="space-y-3"
            >
              <div className="flex items-baseline justify-between gap-4 px-1">
                <h2 className="text-sm font-semibold text-slate-700 dark:text-neutral-300">
                  Запрос{' '}
                  <span className="font-mono text-slate-900 dark:text-neutral-100 tabular-nums">{code}</span>
                </h2>
                <span className="text-xs text-slate-500 dark:text-neutral-400 tabular-nums">
                  {items.length > 0
                    ? `Найдено совпадений: ${items.length}`
                    : 'Совпадений в выбранной базе нет'}
                </span>
              </div>

              {items.length === 0 ? (
                <div className="bg-white dark:bg-neutral-800 shadow-xs dark:shadow-none rounded-xl p-5 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600 dark:text-neutral-400">
                  <span>
                    Код <span className="font-mono font-semibold text-slate-900 dark:text-neutral-100">{code}</span> не
                    найден
                    {mode !== 'all'
                      ? ` в базе ${MODE_OPTIONS.find((m) => m.id === mode)?.title}.`
                      : '.'}
                  </span>
                  {mode !== 'all' && (
                    <button
                      type="button"
                      onClick={() => setMode('all')}
                      className="px-3 py-1.5 text-xs font-medium text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-500/15 hover:bg-blue-100 dark:hover:bg-blue-500/25 rounded-lg cursor-pointer"
                    >
                      Искать по всем базам
                    </button>
                  )}
                </div>
              ) : (
                <div className="space-y-4">
                  {items.map((match) => {
                    const cardId = `${match.category}:${match.key}`;
                    const isFavorite = favoriteSet.has(cardId);
                    const devices = devicesForError(match.category, match.rawText);
                    const hints = getSensorHintsForError(
                      match.category,
                      match.rawText,
                      sensorIndex,
                    );
                    const copyText = [
                      `${CATEGORY_TITLES[match.category]} · код ${match.key}`,
                      match.parsed.category ? `Категория: ${match.parsed.category}` : '',
                      match.parsed.description ? `Описание: ${match.parsed.description}` : '',
                      match.parsed.recommendations
                        ? `Рекомендации: ${match.parsed.recommendations}`
                        : '',
                    ]
                      .filter(Boolean)
                      .join('\n');

                    return (
                      <article
                        key={cardId}
                        className="bg-white dark:bg-neutral-800 shadow-xs dark:shadow-none rounded-xl overflow-hidden transition-colors"
                      >
                        {/* Card header */}
                        <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5 border-b border-slate-100 dark:border-white/[0.06]">
                          <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-neutral-400">
                            <span className="font-semibold text-blue-700 dark:text-blue-400">
                              {CATEGORY_TITLES[match.category]}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span className="font-mono text-sm font-bold text-slate-900 dark:text-neutral-100 tabular-nums">
                              код {match.key}
                            </span>
                            <span aria-hidden="true">·</span>
                            <span>{devices.join(' / ')}</span>
                            {match.parsed.category &&
                              match.parsed.category.toLowerCase() !==
                                devices.join(' / ').toLowerCase() && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span>{match.parsed.category}</span>
                                </>
                              )}
                          </div>

                          <div className="flex items-center gap-2 shrink-0">
                            <button
                              type="button"
                              onClick={() =>
                                onToggleFavorite({
                                  id: cardId,
                                  category: match.category,
                                  key: match.key,
                                  summary:
                                    match.parsed.description.split('\n')[0] || match.rawText,
                                })
                              }
                              aria-pressed={isFavorite}
                              aria-label={
                                isFavorite
                                  ? `Убрать код ${match.key} из избранного`
                                  : `Добавить код ${match.key} в избранное`
                              }
                              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 sm:py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                                isFavorite
                                  ? 'text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-500/15'
                                  : 'text-slate-600 dark:text-neutral-200 hover:text-slate-900 dark:hover:text-white bg-slate-100 dark:bg-neutral-700/80 hover:bg-slate-200 dark:hover:bg-neutral-600'
                              }`}
                            >
                              <Star
                                className={`w-3.5 h-3.5 ${
                                  isFavorite ? 'fill-amber-500 text-amber-500' : ''
                                }`}
                                aria-hidden="true"
                              />
                              <span>{isFavorite ? 'В избранном' : 'В избранное'}</span>
                            </button>

                            <button
                              type="button"
                              onClick={() => handleCopy(cardId, copyText)}
                              className="inline-flex items-center gap-1.5 px-2.5 py-1.5 sm:py-1 text-xs font-medium text-slate-600 dark:text-neutral-200 hover:text-slate-900 dark:hover:text-white bg-slate-100 dark:bg-neutral-700/80 hover:bg-slate-200 dark:hover:bg-neutral-600 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                            >
                              {copiedId === cardId ? (
                                <>
                                  <Check className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                                  <span>Скопировано</span>
                                </>
                              ) : (
                                <>
                                  <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                                  <span>Копировать</span>
                                </>
                              )}
                            </button>
                          </div>
                        </div>

                        {/* Sign mismatch notice */}
                        {!match.signMatches && (
                          <div className="flex items-center gap-2 px-5 py-2.5 bg-amber-50 dark:bg-amber-500/10 text-xs text-amber-900 dark:text-amber-200">
                            <AlertTriangle
                              className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0"
                              aria-hidden="true"
                            />
                            <span>
                              Код найден с другим знаком: вы искали{' '}
                              <span className="font-mono font-semibold">{match.inputValue}</span>, в базе
                              записан <span className="font-mono font-semibold">{match.key}</span>.
                            </span>
                          </div>
                        )}

                        {/* Body */}
                        <div className="p-5 space-y-4">
                          <div>
                            <h3 className="text-xs font-semibold text-slate-500 dark:text-neutral-400 mb-1">
                              Описание
                            </h3>
                            <p className="text-sm sm:text-[15px] leading-relaxed text-slate-900 dark:text-neutral-100 whitespace-pre-line">
                              <InteractiveSensorText
                                text={match.parsed.description || match.rawText}
                                allowedDevices={devices}
                                sensorIndex={sensorIndex}
                                onOpenSensor={onOpenSensorInSchemes}
                              />
                            </p>
                          </div>

                          {match.parsed.recommendations && (
                            <div className="p-3.5 rounded-lg bg-slate-100/80 dark:bg-neutral-900/70">
                              <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-neutral-200 mb-1">
                                <Wrench className="w-3.5 h-3.5 text-blue-700 dark:text-blue-400" aria-hidden="true" />
                                <span>Рекомендации по устранению</span>
                              </div>
                              <p className="text-sm leading-relaxed text-slate-800 dark:text-neutral-200 whitespace-pre-line">
                                <InteractiveSensorText
                                  text={match.parsed.recommendations}
                                  allowedDevices={devices}
                                  sensorIndex={sensorIndex}
                                  onOpenSensor={onOpenSensorInSchemes}
                                />
                              </p>
                            </div>
                          )}

                          {/* Auto-linked sensors & schematic previews */}
                          {hints.pairs.length > 0 && (
                            <div className="pt-3 border-t border-slate-100 dark:border-white/[0.06] space-y-3">
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="text-xs font-semibold text-slate-700 dark:text-neutral-300">
                                  Упомянутые датчики на схемах
                                </span>
                                <div className="flex flex-wrap items-center gap-1.5">
                                  {hints.pairs.map((pair) => (
                                    <button
                                      key={`${pair.device}:${pair.name}`}
                                      type="button"
                                      onClick={() =>
                                        onOpenSensorInSchemes(pair.name, pair.device)
                                      }
                                      className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-mono font-medium text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-500/15 hover:bg-blue-100 dark:hover:bg-blue-500/25 rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                                    >
                                      <span>{pair.name}</span>
                                      <ArrowUpRight className="w-3 h-3" aria-hidden="true" />
                                    </button>
                                  ))}
                                </div>
                              </div>

                              <div
                                className={`grid gap-4 ${
                                  hints.previews.length === 1
                                    ? 'grid-cols-1'
                                    : 'grid-cols-1 lg:grid-cols-2'
                                }`}
                              >
                                {hints.previews.map((preview) => (
                                  <SchemeViewer
                                    key={preview.scheme.image}
                                    imageId={preview.scheme.image}
                                    title={`${preview.scheme.vendor} ${preview.scheme.device} · ${preview.scheme.part}`}
                                    subtitle={`Подсвечены датчики: ${preview.sensorNames.join(', ')}`}
                                    scheme={preview.scheme}
                                    highlightedPoints={preview.points}
                                    onSelectSensor={(sName) =>
                                      onOpenSensorInSchemes(sName, preview.scheme.device)
                                    }
                                    compact
                                    embedded
                                  />
                                ))}
                              </div>
                            </div>
                          )}
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </section>
          ))}
        </div>
      )}

      {/* Direct sensor matches if sensor token typed in search */}
      {submittedQuery && lookupResult.directSensors.length > 0 && (
        <section aria-label="Найденные датчики по запросу" className="space-y-3">
          <div className="flex items-baseline justify-between px-1">
            <h2 className="text-sm font-semibold text-slate-700 dark:text-neutral-300">
              Схемы найденных датчиков
            </h2>
            <span className="text-xs text-slate-500 dark:text-neutral-400 tabular-nums">
              {lookupResult.directSensors.length}{' '}
              {lookupResult.directSensors.length === 1 ? 'схема' : 'схемы'}
            </span>
          </div>
          <div
            className={`grid gap-4 ${
              lookupResult.directSensors.length === 1
                ? 'grid-cols-1'
                : 'grid-cols-1 lg:grid-cols-2'
            }`}
          >
            {lookupResult.directSensors.slice(0, 4).map((hit, idx) => (
              <SchemeViewer
                key={`${hit.scheme.image}-${hit.name}-${idx}`}
                imageId={hit.scheme.image}
                title={`${hit.scheme.vendor} ${hit.scheme.device} · ${hit.scheme.part}`}
                subtitle={`Датчик ${hit.name}`}
                scheme={hit.scheme}
                highlightedPoints={hit.points.map((pt) => ({
                  name: hit.name,
                  x: pt.x,
                  y: pt.y,
                }))}
                selectedSensorName={hit.name}
                onSelectSensor={(sName) =>
                  onOpenSensorInSchemes(sName, hit.scheme.device)
                }
                compact
              />
            ))}
          </div>
        </section>
      )}

      {/* Keyword fallback search results */}
      {submittedQuery && lookupResult.keywordMatches.length > 0 && (
        <section aria-label="Поиск по тексту описаний" className="space-y-3">
          <div className="flex flex-wrap items-baseline justify-between gap-2 px-1">
            <h2 className="text-sm font-semibold text-slate-700 dark:text-neutral-300">
              Совпадения в описаниях по запросу «{submittedQuery}»
            </h2>
            <span className="text-xs text-slate-500 dark:text-neutral-400 tabular-nums">
              Показано {lookupResult.keywordMatches.length} из {lookupResult.keywordTotal}
            </span>
          </div>

          <div className="bg-white dark:bg-neutral-800 shadow-xs dark:shadow-none rounded-xl divide-y divide-slate-100 dark:divide-white/[0.06]">
            {lookupResult.keywordMatches.map((item) => (
              <div
                key={`${item.category}:${item.key}`}
                className="p-4 flex flex-col sm:flex-row sm:items-start justify-between gap-3 hover:bg-slate-50/60 dark:hover:bg-neutral-700/40 transition-colors"
              >
                <div className="space-y-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-neutral-400">
                    <span className="font-semibold text-blue-700 dark:text-blue-400">
                      {CATEGORY_TITLES[item.category]}
                    </span>
                    <span aria-hidden="true">·</span>
                    <span className="font-mono font-bold text-slate-900 dark:text-neutral-100 tabular-nums">
                      код {item.key}
                    </span>
                    {item.parsed.category && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span>{item.parsed.category}</span>
                      </>
                    )}
                  </div>
                  <p className="text-sm text-slate-800 dark:text-neutral-200 line-clamp-2">
                    <HighlightedText
                      text={item.parsed.description || item.rawText}
                      needle={submittedQuery}
                    />
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => runSearch(item.key, item.category)}
                  className="px-3 py-1.5 min-h-[36px] text-xs font-medium text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-500/15 hover:bg-blue-100 dark:hover:bg-blue-500/25 rounded-lg whitespace-nowrap shrink-0 self-start cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                >
                  Открыть карточку
                </button>
              </div>
            ))}
          </div>

          {lookupResult.keywordTotal > lookupResult.keywordMatches.length && (
            <div className="flex justify-center">
              <button
                type="button"
                onClick={() => setKeywordLimit((n) => n + 50)}
                className="px-4 py-2 text-xs font-medium text-slate-700 dark:text-neutral-200 bg-white dark:bg-neutral-800 hover:bg-slate-50 dark:hover:bg-neutral-700 shadow-xs dark:shadow-none rounded-lg cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              >
                Показать ещё ({lookupResult.keywordTotal - lookupResult.keywordMatches.length})
              </button>
            </div>
          )}
        </section>
      )}

      {/* No results at all */}
      {submittedQuery &&
        totalErrorMatches === 0 &&
        lookupResult.directSensors.length === 0 &&
        lookupResult.keywordMatches.length === 0 && (
          <section className="bg-white dark:bg-neutral-800 shadow-xs dark:shadow-none rounded-xl p-8 text-center space-y-3">
            <p className="text-base font-semibold text-slate-900 dark:text-neutral-100">
              Ничего не найдено по запросу «{submittedQuery}»
            </p>
            <p className="text-sm text-slate-600 dark:text-neutral-400">
              Проверьте правильность кода или попробуйте выбрать фильтр «Все базы».
            </p>
            {mode !== 'all' && (
              <button
                type="button"
                onClick={() => setMode('all')}
                className="inline-flex px-4 py-2 text-xs font-medium text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-500/15 hover:bg-blue-100 dark:hover:bg-blue-500/25 rounded-lg cursor-pointer"
              >
                Сбросить фильтр на «Все базы»
              </button>
            )}
          </section>
        )}
    </div>
  );
}
