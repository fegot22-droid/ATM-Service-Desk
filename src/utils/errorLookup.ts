import type {
  DeviceMode,
  ErrorCategory,
  ErrorCodesDatabase,
  ErrorMatch,
  ParsedDescription,
} from '../types/atm';

export const CATEGORY_TITLES: Record<ErrorCategory, string> = {
  grg: 'GRG',
  cmd_v4: 'Wincor CMD-V4',
  ccdm: 'Wincor CCDM',
};

export const MODE_OPTIONS: Array<{
  id: DeviceMode;
  title: string;
  shortTitle: string;
  hint: string;
}> = [
  {id: 'all', title: 'Все базы', shortTitle: 'Все базы', hint: '-1335, 08, 21'},
  {id: 'grg', title: 'GRG (CRM / CAM / CDM)', shortTitle: 'GRG', hint: '-1335, 25523'},
  {id: 'ccdm', title: 'Wincor CCDM (кеш-ин)', shortTitle: 'CCDM', hint: '08, 21'},
  {id: 'cmd_v4', title: 'Wincor CMD-V4 (кеш-аут)', shortTitle: 'CMD-V4', hint: '21, 71'},
];

const DASH_CHARS = /[\u2212\u2012\u2013\u2014\u2015\u2010\u2011\ufe63\uff0d]/g;
const THOUSANDS_RE = /(?<=\d)[,.](?=\d{3}(?!\d))/g;
const CODE_RE = /(?:^|[^\w-])(-\s*)?(\d{1,9})(?!\d)/g;
export const MAX_CODES_PER_QUERY = 10;

export type ErrorIndexes = Record<ErrorCategory, Map<number, string>>;

function buildCategoryIndex(table: Record<string, string> | undefined): Map<number, string> {
  const index = new Map<number, string>();
  if (!table) return index;
  for (const key of Object.keys(table)) {
    const parsed = Number(key);
    if (!Number.isInteger(parsed) || key.trim() === '') continue;
    if (!index.has(parsed)) {
      index.set(parsed, key);
    }
  }
  return index;
}

export function buildIndexes(data: ErrorCodesDatabase): ErrorIndexes {
  return {
    grg: buildCategoryIndex(data.grg),
    cmd_v4: buildCategoryIndex(data.cmd_v4),
    ccdm: buildCategoryIndex(data.ccdm),
  };
}

export function extractCodes(raw: string): number[] {
  const normalized = (raw || '').replace(DASH_CHARS, '-').replace(THOUSANDS_RE, '');
  const codes: number[] = [];
  CODE_RE.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = CODE_RE.exec(normalized)) !== null) {
    let value = Number.parseInt(match[2], 10);
    if (match[1]) {
      value = -value;
    }
    if (Object.is(value, -0)) {
      value = 0;
    }
    if (!codes.includes(value)) {
      codes.push(value);
    }
    if (codes.length >= MAX_CODES_PER_QUERY) {
      break;
    }
  }
  return codes;
}

export function parseDescription(rawText: string): ParsedDescription {
  let category: string | undefined;
  const descLines: string[] = [];
  const recLines: string[] = [];
  let inRec = false;

  for (const rawLine of rawText.trim().split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const colonIdx = line.indexOf(':');
    if (colonIdx !== -1) {
      const label = line.slice(0, colonIdx).trim();
      const rest = line.slice(colonIdx + 1).trim();
      if (label === 'Категория') {
        category = rest;
        inRec = false;
        continue;
      }
      if (label === 'Описание') {
        if (rest) descLines.push(rest);
        inRec = false;
        continue;
      }
      if (label === 'Рекомендации') {
        if (rest && rest !== '-') recLines.push(rest);
        inRec = true;
        continue;
      }
    }
    if (inRec) {
      recLines.push(line);
    } else {
      descLines.push(line);
    }
  }

  return {
    category,
    description: descLines.join('\n').trim(),
    recommendations: recLines.join('\n').trim(),
  };
}

export function lookupValue(
  value: number,
  data: ErrorCodesDatabase,
  indexes: ErrorIndexes,
  mode: DeviceMode = 'all',
): ErrorMatch[] {
  const results: ErrorMatch[] = [];
  const negative = value < 0;

  if (mode === 'cmd_v4' || mode === 'ccdm') {
    const key = indexes[mode].get(Math.abs(value));
    if (key !== undefined) {
      const rawText = data[mode][key];
      results.push({
        category: mode,
        key,
        rawText,
        parsed: parseDescription(rawText),
        signMatches: !negative,
        inputValue: value,
      });
    }
    return results;
  }

  const grgIndex = indexes.grg;
  const grgTable = data.grg || {};
  const exact = grgIndex.get(value);
  const opposite = value !== 0 ? grgIndex.get(-value) : undefined;

  if (exact !== undefined) {
    const rawText = grgTable[exact];
    results.push({
      category: 'grg',
      key: exact,
      rawText,
      parsed: parseDescription(rawText),
      signMatches: true,
      inputValue: value,
    });
    if (!negative && opposite !== undefined) {
      const oppText = grgTable[opposite];
      results.push({
        category: 'grg',
        key: opposite,
        rawText: oppText,
        parsed: parseDescription(oppText),
        signMatches: false,
        inputValue: value,
      });
    }
  } else if (opposite !== undefined) {
    const oppText = grgTable[opposite];
    results.push({
      category: 'grg',
      key: opposite,
      rawText: oppText,
      parsed: parseDescription(oppText),
      signMatches: false,
      inputValue: value,
    });
  }

  if (mode === 'grg') {
    return results;
  }

  for (const category of ['cmd_v4', 'ccdm'] as const) {
    const key = indexes[category].get(Math.abs(value));
    if (key !== undefined) {
      const rawText = data[category][key];
      results.push({
        category,
        key,
        rawText,
        parsed: parseDescription(rawText),
        signMatches: !negative,
        inputValue: value,
      });
    }
  }

  return results;
}

export interface KeywordSearchResult {
  category: ErrorCategory;
  key: string;
  rawText: string;
  parsed: ParsedDescription;
}

export function searchErrorsByKeyword(
  query: string,
  data: ErrorCodesDatabase,
  mode: DeviceMode = 'all',
  limit = 40,
): KeywordSearchResult[] {
  const needle = query.trim().toLowerCase();
  if (needle.length < 2) return [];

  const categories: ErrorCategory[] =
    mode === 'all' ? ['ccdm', 'cmd_v4', 'grg'] : [mode];

  const matches: KeywordSearchResult[] = [];
  for (const category of categories) {
    const table = data[category] || {};
    for (const [key, rawText] of Object.entries(table)) {
      if (rawText.toLowerCase().includes(needle) || key.toLowerCase().includes(needle)) {
        matches.push({
          category,
          key,
          rawText,
          parsed: parseDescription(rawText),
        });
        if (matches.length >= limit) {
          return matches;
        }
      }
    }
  }
  return matches;
}

export function searchErrorsByKeywordFull(
  query: string,
  data: ErrorCodesDatabase,
  mode: DeviceMode = 'all',
  limit = 100,
): {items: KeywordSearchResult[]; total: number} {
  const needle = query.trim().toLowerCase();
  if (needle.length < 2) return {items: [], total: 0};

  const categories: ErrorCategory[] =
    mode === 'all' ? ['ccdm', 'cmd_v4', 'grg'] : [mode];

  const items: KeywordSearchResult[] = [];
  let total = 0;

  for (const category of categories) {
    const table = data[category] || {};
    for (const [key, rawText] of Object.entries(table)) {
      if (rawText.toLowerCase().includes(needle) || key.toLowerCase().includes(needle)) {
        total++;
        if (items.length < limit) {
          items.push({
            category,
            key,
            rawText,
            parsed: parseDescription(rawText),
          });
        }
      }
    }
  }
  return {items, total};
}

export const GRG_DEVICES = ['CRM9250N', 'CAM8320', 'CDM8240'] as const;

export function devicesForError(category: ErrorCategory, rawText: string): readonly string[] {
  if (category === 'cmd_v4') return ['CMD-V4'];
  if (category === 'ccdm') return ['CCDM'];
  const head = rawText.split('\n', 1)[0] || '';
  if (head.includes('CRM9250')) return ['CRM9250N'];
  if (head.includes('CDM8240')) return ['CDM8240'];
  if (head.includes('CAM83')) return ['CAM8320'];
  return GRG_DEVICES;
}
