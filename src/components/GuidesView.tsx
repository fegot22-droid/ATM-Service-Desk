import {useEffect, useMemo, useState} from 'react';
import {
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Circle,
  Copy,
  FileText,
  List,
  RotateCcw,
  Search,
  X,
} from 'lucide-react';
import type {Guide, GuideSection} from '../types/atm';
import {searchAllGuides, segmentGuideText} from '../utils/guideParser';
import {GuideImageBlock} from './GuideImageBlock';

const GUIDE_PROGRESS_KEY = 'atm_service_guide_progress_v1';

interface GuidesViewProps {
  guides: Guide[];
  initialGuideId?: string;
  initialSectionIdx?: number;
  onStateChange?: (guideId: string, sectionIdx: number) => void;
}

function loadCompletedMap(): Record<string, number[]> {
  try {
    const raw = localStorage.getItem(GUIDE_PROGRESS_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function HighlightMatch({text, needle}: {text: string; needle: string}) {
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
            className="bg-amber-200/85 dark:bg-amber-500/30 text-slate-900 dark:text-amber-100 rounded-xs px-0.5 font-medium"
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

function CopyableCodeBlock({text, searchNeedle}: {text: string; searchNeedle: string}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      // Ignore clipboard failures
    }
  };

  return (
    <div className="my-2.5 bg-neutral-900 dark:bg-neutral-900 text-neutral-100 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-white/[0.06] bg-neutral-950/60">
        <span className="text-[11px] font-mono text-neutral-400">
          Параметр / путь
        </span>
        <button
          type="button"
          onClick={handleCopy}
          className="inline-flex items-center gap-1 text-[11px] font-medium text-neutral-300 hover:text-white cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-400 rounded px-1.5 py-0.5"
        >
          {copied ? (
            <>
              <Check className="w-3 h-3 text-emerald-400" aria-hidden="true" />
              <span>Скопировано</span>
            </>
          ) : (
            <>
              <Copy className="w-3 h-3" aria-hidden="true" />
              <span>Копировать</span>
            </>
          )}
        </button>
      </div>
      <pre className="p-3 text-xs font-mono leading-relaxed overflow-x-auto whitespace-pre-wrap break-all">
        <HighlightMatch text={text} needle={searchNeedle} />
      </pre>
    </div>
  );
}

function SectionBody({
  section,
  searchNeedle,
}: {
  section: GuideSection;
  searchNeedle: string;
}) {
  return (
    <div className="space-y-3">
      {section.blocks.map((block, bIdx) => {
        if (block.kind === 'img') {
          return (
            <GuideImageBlock
              key={`img-${bIdx}`}
              fileName={block.value}
              sectionTitle={section.title}
            />
          );
        }

        const segments = segmentGuideText(block.value);
        return (
          <div key={`txt-${bIdx}`} className="space-y-2">
            {segments.map((seg, sIdx) => {
              if (seg.kind === 'code') {
                return (
                  <CopyableCodeBlock
                    key={`seg-${sIdx}`}
                    text={seg.text}
                    searchNeedle={searchNeedle}
                  />
                );
              }
              if (seg.kind === 'step') {
                return (
                  <p
                    key={`seg-${sIdx}`}
                    className="text-sm sm:text-[15px] leading-relaxed text-slate-900 dark:text-neutral-100 pl-3 border-l border-slate-200 dark:border-neutral-700 wrap-anywhere"
                  >
                    <HighlightMatch text={seg.text} needle={searchNeedle} />
                  </p>
                );
              }
              return (
                <p
                  key={`seg-${sIdx}`}
                  className="text-sm sm:text-[15px] leading-relaxed text-slate-800 dark:text-neutral-200 wrap-anywhere"
                >
                  <HighlightMatch text={seg.text} needle={searchNeedle} />
                </p>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}

export function GuidesView({
  guides,
  initialGuideId,
  initialSectionIdx = 0,
  onStateChange,
}: GuidesViewProps) {
  const [activeGuideId, setActiveGuideId] = useState<string>(
    initialGuideId && guides.some((g) => g.id === initialGuideId)
      ? initialGuideId
      : guides[0]?.id ?? 'ncr',
  );
  const [sectionIdx, setSectionIdx] = useState<number>(initialSectionIdx);
  const [readMode, setReadMode] = useState<'section' | 'full'>('section');
  const [searchQuery, setSearchQuery] = useState('');
  const [mobileTocOpen, setMobileTocOpen] = useState(false);
  const [completedMap, setCompletedMap] = useState<Record<string, number[]>>(() =>
    loadCompletedMap(),
  );

  const activeGuide = useMemo(() => {
    return guides.find((g) => g.id === activeGuideId) ?? guides[0];
  }, [guides, activeGuideId]);

  const safeSectionIdx = activeGuide
    ? Math.min(Math.max(0, sectionIdx), Math.max(0, activeGuide.sections.length - 1))
    : 0;

  useEffect(() => {
    if (activeGuide) {
      onStateChange?.(activeGuide.id, safeSectionIdx);
    }
  }, [activeGuide, safeSectionIdx, onStateChange]);

  const matchingSectionIndexes = useMemo(() => {
    if (!activeGuide) return [];
    const needle = searchQuery.trim().toLowerCase();
    if (!needle) {
      return activeGuide.sections.map((_, idx) => idx);
    }
    return activeGuide.sections
      .map((sec, idx) => {
        const inTitle = sec.title.toLowerCase().includes(needle);
        const inBody = sec.blocks.some(
          (b) => b.kind === 'text' && b.value.toLowerCase().includes(needle),
        );
        return inTitle || inBody ? idx : -1;
      })
      .filter((idx) => idx !== -1);
  }, [activeGuide, searchQuery]);

  const otherGuideMatches = useMemo(() => {
    if (!activeGuide || searchQuery.trim().length < 2) return [];
    return searchAllGuides(guides, searchQuery).filter(
      (m) => m.guideId !== activeGuide.id,
    );
  }, [guides, activeGuide, searchQuery]);

  if (!activeGuide) {
    return (
      <div className="bg-white dark:bg-neutral-800 shadow-xs dark:shadow-none rounded-xl p-8 text-center text-sm text-slate-600 dark:text-neutral-400">
        Инструкции пока не загружены.
      </div>
    );
  }

  const currentSection = activeGuide.sections[safeSectionIdx];
  const completedSections = completedMap[activeGuide.id] ?? [];
  const completedSet = new Set(completedSections);
  const isCurrentCompleted = completedSet.has(safeSectionIdx);

  const persistCompleted = (nextMap: Record<string, number[]>) => {
    setCompletedMap(nextMap);
    try {
      localStorage.setItem(GUIDE_PROGRESS_KEY, JSON.stringify(nextMap));
    } catch {
      // Ignore storage errors
    }
  };

  const toggleSectionCompleted = (idx: number) => {
    const cur = completedMap[activeGuide.id] ?? [];
    const next = cur.includes(idx)
      ? cur.filter((i) => i !== idx)
      : [...cur, idx].sort((a, b) => a - b);
    persistCompleted({...completedMap, [activeGuide.id]: next});
  };

  const resetGuideProgress = () => {
    const next = {...completedMap};
    delete next[activeGuide.id];
    persistCompleted(next);
  };

  const selectGuide = (gid: string, targetSection = 0, keepSearch = false) => {
    setActiveGuideId(gid);
    setSectionIdx(targetSection);
    if (!keepSearch) {
      setSearchQuery('');
    }
    setMobileTocOpen(false);
  };

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <section
        aria-label="Выбор инструкции и режим чтения"
        className="bg-white dark:bg-neutral-800 shadow-xs dark:shadow-none rounded-xl p-5 sm:p-6 space-y-4 transition-colors"
      >
        <div className="flex flex-col sm:flex-row sm:items-baseline sm:justify-between gap-2">
          <div>
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-neutral-100">
              Инструкции по настройке и запуску
            </h1>
            <p className="text-sm text-slate-600 dark:text-neutral-400 mt-1">
              {activeGuide.subtitle} · {activeGuide.sourceFileName} ·{' '}
              <span className="tabular-nums">{activeGuide.sections.length} разделов</span>
            </p>
          </div>
          {completedSections.length > 0 && (
            <div className="flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-400 font-medium tabular-nums whitespace-nowrap shrink-0">
              <span>
                Выполнено: {completedSections.length} / {activeGuide.sections.length}
              </span>
              <button
                type="button"
                onClick={resetGuideProgress}
                aria-label="Сбросить отметки выполнения"
                className="inline-flex items-center gap-1 text-slate-500 dark:text-neutral-400 hover:text-slate-800 dark:hover:text-neutral-200 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>
          )}
        </div>

        {/* Guide Switcher & Read Mode Toggle */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div
            className="flex flex-wrap items-center gap-1.5 p-1 bg-slate-100 dark:bg-neutral-900 rounded-lg"
            role="group"
            aria-label="Модель банкомата"
          >
            {guides.map((g) => {
              const active = g.id === activeGuide.id;
              return (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => selectGuide(g.id)}
                  aria-pressed={active}
                  className={`px-3.5 py-2 min-h-[40px] sm:min-h-0 text-xs sm:text-sm font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                    active
                      ? 'bg-white dark:bg-neutral-800 text-slate-900 dark:text-neutral-100 shadow-xs'
                      : 'text-slate-600 dark:text-neutral-400 hover:text-slate-900 dark:hover:text-neutral-100'
                  }`}
                >
                  {g.id.toUpperCase()}
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {activeGuide.sourceFileUrl && (
              <a
                href={activeGuide.sourceFileUrl}
                download={activeGuide.sourceFileName}
                className="inline-flex items-center gap-1.5 px-3 py-2 min-h-[40px] sm:min-h-0 text-xs font-medium text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-500/15 hover:bg-blue-100 dark:hover:bg-blue-500/25 rounded-lg transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              >
                <FileText className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Скачать PDF</span>
              </a>
            )}

            <div
              className="flex items-center gap-1.5 p-1 bg-slate-100 dark:bg-neutral-900 rounded-lg"
              role="group"
              aria-label="Режим отображения инструкции"
            >
              <button
                type="button"
                onClick={() => setReadMode('section')}
                aria-pressed={readMode === 'section'}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[36px] sm:min-h-0 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                  readMode === 'section'
                    ? 'bg-white dark:bg-neutral-800 text-slate-900 dark:text-neutral-100 shadow-xs'
                    : 'text-slate-600 dark:text-neutral-400 hover:text-slate-900 dark:hover:text-neutral-100'
                }`}
              >
                <List className="w-3.5 h-3.5" aria-hidden="true" />
                <span>По разделам</span>
              </button>
              <button
                type="button"
                onClick={() => setReadMode('full')}
                aria-pressed={readMode === 'full'}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 min-h-[36px] sm:min-h-0 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                  readMode === 'full'
                    ? 'bg-white dark:bg-neutral-800 text-slate-900 dark:text-neutral-100 shadow-xs'
                    : 'text-slate-600 dark:text-neutral-400 hover:text-slate-900 dark:hover:text-neutral-100'
                }`}
              >
                <BookOpen className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Вся инструкция</span>
              </button>
            </div>
          </div>
        </div>

        {/* Search across guides */}
        <div className="space-y-2.5">
          <div className="relative">
            <label htmlFor="guide-search-input" className="sr-only">
              Поиск по тексту инструкций
            </label>
            <Search
              className="w-4 h-4 text-slate-400 dark:text-neutral-500 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              id="guide-search-input"
              type="text"
              enterKeyHint="search"
              value={searchQuery}
              onChange={(e) => {
                const val = e.target.value;
                setSearchQuery(val);
                if (val.trim()) {
                  const needle = val.trim().toLowerCase();
                  const firstMatch = activeGuide.sections.findIndex(
                    (sec) =>
                      sec.title.toLowerCase().includes(needle) ||
                      sec.blocks.some(
                        (b) => b.kind === 'text' && b.value.toLowerCase().includes(needle),
                      ),
                  );
                  if (firstMatch !== -1) {
                    setSectionIdx(firstMatch);
                  }
                }
              }}
              placeholder="Поиск по всем инструкциям: Ploutus, 50000, NeoVideo, Keepaliv..."
              className="w-full min-h-[44px] pl-10 pr-10 py-2 text-sm bg-slate-100 dark:bg-neutral-900 border border-transparent rounded-lg text-slate-900 dark:text-neutral-100 placeholder:text-slate-400 dark:placeholder:text-neutral-500 focus:bg-white dark:focus:bg-neutral-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                aria-label="Очистить поиск по инструкции"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 p-2 min-h-[36px] min-w-[36px] flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-neutral-200 rounded cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            )}
          </div>

          {otherGuideMatches.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
              <span className="text-slate-500 dark:text-neutral-400 shrink-0">Найдено в других инструкциях:</span>
              {otherGuideMatches.slice(0, 6).map((m) => (
                <button
                  key={`${m.guideId}-${m.sectionIndex}`}
                  type="button"
                  onClick={() => {
                    selectGuide(m.guideId, m.sectionIndex, true);
                    setReadMode('section');
                  }}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-500/15 hover:bg-blue-100 dark:hover:bg-blue-500/25 rounded-md transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                >
                  <span className="font-mono font-semibold">{m.guideTitle}</span>
                  <span aria-hidden="true">·</span>
                  <span className="truncate max-w-[200px]">{m.sectionTitle}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Mobile Collapsible TOC (< lg) */}
      <div className="lg:hidden bg-white dark:bg-neutral-800 shadow-xs dark:shadow-none rounded-xl overflow-hidden">
        <button
          type="button"
          onClick={() => setMobileTocOpen((v) => !v)}
          aria-expanded={mobileTocOpen}
          className="w-full px-4 py-3 flex items-center justify-between gap-3 text-left text-sm font-semibold text-slate-900 dark:text-neutral-100 cursor-pointer"
        >
          <span>
            Содержание · раздел {safeSectionIdx + 1} из {activeGuide.sections.length}
          </span>
          <ChevronDown
            className={`w-4 h-4 text-slate-500 dark:text-neutral-400 transition-transform ${
              mobileTocOpen ? 'rotate-180' : ''
            }`}
            aria-hidden="true"
          />
        </button>
        {mobileTocOpen && (
          <ul className="border-t border-slate-200/70 dark:border-white/[0.06] divide-y divide-slate-100 dark:divide-white/[0.06] max-h-72 overflow-y-auto">
            {activeGuide.sections.map((sec, idx) => {
              const isSelected = readMode === 'section' && idx === safeSectionIdx;
              const isMatch = matchingSectionIndexes.includes(idx);
              if (searchQuery.trim() && !isMatch) return null;
              return (
                <li key={`mobile-toc-${idx}`}>
                  <button
                    type="button"
                    onClick={() => {
                      setSectionIdx(idx);
                      setReadMode('section');
                      setMobileTocOpen(false);
                    }}
                    className={`w-full text-left px-4 py-2.5 text-sm flex items-center justify-between gap-2 cursor-pointer ${
                      isSelected
                        ? 'bg-blue-50 dark:bg-neutral-700 text-blue-800 dark:text-blue-300 font-semibold'
                        : 'text-slate-700 dark:text-neutral-300 hover:bg-slate-50 dark:hover:bg-neutral-700/60'
                    }`}
                  >
                    <span className="flex items-baseline gap-2 min-w-0">
                      <span className="font-mono text-xs tabular-nums text-slate-400 dark:text-neutral-500 shrink-0">
                        {String(idx + 1).padStart(2, '0')}.
                      </span>
                      <span className="truncate">{sec.title}</span>
                    </span>
                    {completedSet.has(idx) && (
                      <CheckCircle2
                        className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0"
                        aria-hidden="true"
                      />
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {/* Split TOC + Reading Pane */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Desktop Table of Contents */}
        <nav
          id="guide-toc"
          aria-label="Оглавление инструкции"
          className="hidden lg:block lg:col-span-4 bg-white dark:bg-neutral-800 shadow-xs dark:shadow-none rounded-xl overflow-hidden"
        >
          <div className="px-4 py-3 border-b border-slate-200/70 dark:border-white/[0.06] bg-slate-50/70 dark:bg-neutral-900/60 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold text-slate-900 dark:text-neutral-100">Содержание</h2>
            {searchQuery.trim() && (
              <span className="text-xs text-slate-500 dark:text-neutral-400 tabular-nums">
                Совпадений: {matchingSectionIndexes.length}
              </span>
            )}
          </div>
          <ul className="divide-y divide-slate-100 dark:divide-white/[0.06] max-h-[640px] overflow-y-auto">
            {activeGuide.sections.map((sec, idx) => {
              const isSelected = readMode === 'section' && idx === safeSectionIdx;
              const isMatch = matchingSectionIndexes.includes(idx);
              if (searchQuery.trim() && !isMatch) return null;

              return (
                <li key={`${activeGuide.id}-toc-${idx}`}>
                  <button
                    type="button"
                    onClick={() => {
                      setSectionIdx(idx);
                      setReadMode('section');
                    }}
                    className={`w-full text-left px-4 py-2.5 text-sm transition-colors flex items-center justify-between gap-2 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600 ${
                      isSelected
                        ? 'bg-blue-50 dark:bg-neutral-700 text-blue-800 dark:text-blue-300 font-semibold'
                        : 'text-slate-700 dark:text-neutral-300 hover:bg-slate-50 dark:hover:bg-neutral-700/60 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    <span className="flex items-baseline gap-2.5 min-w-0">
                      <span className="font-mono text-xs tabular-nums text-slate-400 dark:text-neutral-500 shrink-0">
                        {String(idx + 1).padStart(2, '0')}.
                      </span>
                      <span className="leading-snug">{sec.title}</span>
                    </span>
                    {completedSet.has(idx) && (
                      <CheckCircle2
                        className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0"
                        aria-hidden="true"
                      />
                    )}
                  </button>
                </li>
              );
            })}
            {searchQuery.trim() && matchingSectionIndexes.length === 0 && (
              <li className="px-4 py-6 text-center text-xs text-slate-500 dark:text-neutral-400">
                В текущей инструкции разделы не найдены.
              </li>
            )}
          </ul>
        </nav>

        {/* Reading Pane */}
        <article className="lg:col-span-8 bg-white dark:bg-neutral-800 shadow-xs dark:shadow-none rounded-xl overflow-hidden">
          {readMode === 'section' ? (
            <>
              <div className="px-5 sm:px-6 py-4 border-b border-slate-200/70 dark:border-white/[0.06] bg-slate-50/60 dark:bg-neutral-900/60 flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-bold text-slate-900 dark:text-neutral-100">
                  <HighlightMatch
                    text={currentSection?.title ?? ''}
                    needle={searchQuery}
                  />
                </h2>
                <div className="flex items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => toggleSectionCompleted(safeSectionIdx)}
                    aria-pressed={isCurrentCompleted}
                    className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 ${
                      isCurrentCompleted
                        ? 'bg-emerald-50 dark:bg-emerald-500/15 text-emerald-800 dark:text-emerald-300'
                        : 'bg-slate-100 dark:bg-neutral-700/80 text-slate-600 dark:text-neutral-200 hover:text-slate-900 dark:hover:text-white'
                    }`}
                  >
                    {isCurrentCompleted ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                    ) : (
                      <Circle className="w-3.5 h-3.5 text-slate-400 dark:text-neutral-400" aria-hidden="true" />
                    )}
                    <span>{isCurrentCompleted ? 'Выполнено' : 'Отметить шаг'}</span>
                  </button>
                  <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-neutral-400">
                    {safeSectionIdx + 1} / {activeGuide.sections.length}
                  </span>
                </div>
              </div>

              <div className="p-5 sm:p-6 max-w-3xl">
                {currentSection && (
                  <SectionBody section={currentSection} searchNeedle={searchQuery} />
                )}
              </div>

              {/* Pagination Footer */}
              <div className="px-5 sm:px-6 py-3.5 border-t border-slate-200/70 dark:border-white/[0.06] bg-slate-50/50 dark:bg-neutral-900/60 flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => setSectionIdx((i) => Math.max(0, i - 1))}
                  disabled={safeSectionIdx === 0}
                  className="inline-flex items-center gap-1.5 min-h-[44px] sm:min-h-0 px-3.5 py-2 text-xs sm:text-sm font-medium text-slate-700 dark:text-neutral-100 bg-slate-100 dark:bg-neutral-700/80 hover:bg-slate-200 dark:hover:bg-neutral-600 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                >
                  <ChevronLeft className="w-4 h-4" aria-hidden="true" />
                  <span>Назад</span>
                </button>

                <span className="text-xs text-slate-500 dark:text-neutral-400 font-mono tabular-nums">
                  {safeSectionIdx + 1} / {activeGuide.sections.length}
                </span>

                <button
                  type="button"
                  onClick={() =>
                    setSectionIdx((i) => Math.min(activeGuide.sections.length - 1, i + 1))
                  }
                  disabled={safeSectionIdx >= activeGuide.sections.length - 1}
                  className="inline-flex items-center gap-1.5 min-h-[44px] sm:min-h-0 px-3.5 py-2 text-xs sm:text-sm font-medium text-white bg-blue-700 hover:bg-blue-800 dark:bg-blue-600 dark:hover:bg-blue-500 rounded-lg disabled:opacity-40 disabled:cursor-not-allowed whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
                >
                  <span>Дальше</span>
                  <ChevronRight className="w-4 h-4" aria-hidden="true" />
                </button>
              </div>
            </>
          ) : (
            <div className="divide-y divide-slate-200/70 dark:divide-white/[0.06]">
              <div className="px-6 py-4 bg-slate-50/60 dark:bg-neutral-900/60 flex items-baseline justify-between">
                <h2 className="text-lg font-bold text-slate-900 dark:text-neutral-100">{activeGuide.title}</h2>
                <span className="text-xs font-mono tabular-nums text-slate-500 dark:text-neutral-400">
                  {matchingSectionIndexes.length} разделов
                </span>
              </div>
              {matchingSectionIndexes.length === 0 ? (
                <div className="p-8 text-center text-sm text-slate-500 dark:text-neutral-400">
                  По запросу «{searchQuery}» совпадений не найдено.
                </div>
              ) : (
                matchingSectionIndexes.map((idx) => {
                  const sec = activeGuide.sections[idx];
                  return (
                    <section key={`full-sec-${idx}`} className="p-6 max-w-3xl space-y-3">
                      <h3 className="text-base font-bold text-slate-900 dark:text-neutral-100">
                        <span className="font-mono text-sm text-slate-400 dark:text-neutral-500 mr-2 tabular-nums">
                          {String(idx + 1).padStart(2, '0')}.
                        </span>
                        <HighlightMatch text={sec.title} needle={searchQuery} />
                      </h3>
                      <SectionBody section={sec} searchNeedle={searchQuery} />
                    </section>
                  );
                })
              )}
            </div>
          )}
        </article>
      </div>
    </div>
  );
}
