import type {
  DeviceGroupId,
  ErrorCategory,
  SchemesDatabase,
  SensorHit,
  SensorIndex,
  SensorScheme,
} from '../types/atm';
import {devicesForError} from './errorLookup';

const LOOKALIKE_MAP: Record<string, string> = {
  А: 'A', В: 'B', С: 'C', Е: 'E', Н: 'H', К: 'K',
  М: 'M', О: 'O', Р: 'P', Т: 'T', Х: 'X', У: 'Y',
  а: 'A', в: 'B', с: 'C', е: 'E', н: 'H', к: 'K',
  м: 'M', о: 'O', р: 'P', т: 'T', х: 'X', у: 'Y',
};

const ALIASES: Record<string, string> = {
  VLS13: 'VSL13',
};

const RANGE_RE = /^(.*\d)([a-z])-([a-z])$/;
const SENSOR_TOKEN_RE = /[A-Z][A-Z0-9_]{1,9}/g;
export const MAX_AUTO_SCHEMES = 4;

export const DEVICE_GROUPS: Record<
  Exclude<DeviceGroupId, 'all'>,
  {
    title: string;
    devices: readonly string[];
    galleryPrefixes: readonly string[];
  }
> = {
  ccdm: {
    title: 'Wincor CCDM',
    devices: ['CCDM'],
    galleryPrefixes: ['CCDM'],
  },
  cmd: {
    title: 'Wincor CMD-V4',
    devices: ['CMD-V4'],
    galleryPrefixes: ['CMD-V4'],
  },
  grg: {
    title: 'GRG (CRM / CAM / CDM)',
    devices: ['CRM9250N', 'CAM8320', 'CDM8240'],
    galleryPrefixes: ['CRM9250', 'CAM8320', 'CDM8240'],
  },
  crs: {
    title: 'Wincor CRS 4060 FL',
    devices: ['CRS 4060 FL'],
    galleryPrefixes: ['CRS 4060 FL'],
  },
};

export function normalizeSensorName(name: string): string {
  const mapped = (name || '')
    .split('')
    .map((ch) => LOOKALIKE_MAP[ch] ?? ch)
    .join('')
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[_\-]+/g, '_');
  return mapped;
}

export function buildSensorIndex(schemes: SchemesDatabase): {
  index: SensorIndex;
  minLen: number;
} {
  const index: SensorIndex = new Map();

  for (const scheme of schemes.sensor_schemes) {
    const grouped = new Map<string, Array<{x: number; y: number}>>();
    for (const [name, x, y] of scheme.markers) {
      const list = grouped.get(name) ?? [];
      list.push({x, y});
      grouped.set(name, list);
    }

    for (const [name, points] of grouped.entries()) {
      const key = normalizeSensorName(name);
      const list = index.get(key) ?? [];
      list.push({scheme, name, points});
      index.set(key, list);
    }
  }

  for (const [alias, target] of Object.entries(ALIASES)) {
    const targetHits = index.get(normalizeSensorName(target));
    if (targetHits) {
      const aliasKey = normalizeSensorName(alias);
      const list = index.get(aliasKey) ?? [];
      list.push(...targetHits);
      index.set(aliasKey, list);
    }
  }

  const snapshotEntries = Array.from(index.entries());
  for (const [, hits] of snapshotEntries) {
    for (const hit of hits) {
      const match = RANGE_RE.exec(hit.name);
      if (!match) continue;
      const [, base, first, last] = match;
      const aliases: string[] = [];
      for (let code = first.charCodeAt(0); code <= last.charCodeAt(0); code++) {
        aliases.push(base + String.fromCharCode(code));
      }
      aliases.push(base);

      for (const alias of aliases) {
        const aliasKey = normalizeSensorName(alias);
        const existing = index.get(aliasKey) ?? [];
        const alreadySameName = existing.some((item) => item.name === alias);
        if (!existing.includes(hit) && !alreadySameName) {
          existing.push(hit);
          index.set(aliasKey, existing);
        }
      }
    }
  }

  let minLen = Infinity;
  for (const key of index.keys()) {
    if (key.length < minLen) minLen = key.length;
  }

  return {index, minLen: Number.isFinite(minLen) ? minLen : 2};
}

export function findSensor(name: string, index: SensorIndex): SensorHit[] {
  return index.get(normalizeSensorName(name)) ?? [];
}

export function findSensorsInText(
  text: string,
  index: SensorIndex,
  minLen: number,
): string[] {
  const trimmed = (text || '').trim();
  if (!trimmed) return [];

  const tokens = trimmed
    .split(/[\s,;]+/)
    .map((t) => t.replace(/^[().:!?\"']+|[().:!?\"']+$/g, ''));

  const candidates = [trimmed, ...tokens];
  const found: string[] = [];
  const seen = new Set<string>();

  for (const candidate of candidates) {
    const key = normalizeSensorName(candidate);
    if (key.length < minLen || seen.has(key) || !index.has(key)) continue;
    seen.add(key);
    found.push(key);
  }
  return found;
}

export interface LinkedSchemePreview {
  scheme: SensorScheme;
  sensorNames: string[];
  points: Array<{name: string; x: number; y: number}>;
}

export function getSensorHintsForError(
  category: ErrorCategory,
  rawText: string,
  index: SensorIndex,
): {
  pairs: Array<{device: string; name: string}>;
  previews: LinkedSchemePreview[];
} {
  const devices = devicesForError(category, rawText);
  const pairs: Array<{device: string; name: string}> = [];
  const seenPair = new Set<string>();
  const tokens = rawText.match(SENSOR_TOKEN_RE) ?? [];

  for (const token of tokens) {
    for (const hit of findSensor(token, index)) {
      if (!devices.includes(hit.scheme.device)) continue;
      const sig = `${hit.scheme.device}::${hit.name}`;
      if (!seenPair.has(sig)) {
        seenPair.add(sig);
        pairs.push({device: hit.scheme.device, name: hit.name});
      }
    }
  }

  const byImage = new Map<string, LinkedSchemePreview>();
  for (const {device, name} of pairs) {
    for (const hit of findSensor(name, index)) {
      if (hit.scheme.device !== device) continue;
      let entry = byImage.get(hit.scheme.image);
      if (!entry) {
        entry = {scheme: hit.scheme, sensorNames: [], points: []};
        byImage.set(hit.scheme.image, entry);
      }
      if (!entry.sensorNames.includes(hit.name)) {
        entry.sensorNames.push(hit.name);
        for (const pt of hit.points) {
          entry.points.push({name: hit.name, x: pt.x, y: pt.y});
        }
      }
    }
  }

  return {
    pairs,
    previews: Array.from(byImage.values()).slice(0, MAX_AUTO_SCHEMES),
  };
}

export function listSensorsByDevice(
  schemes: SchemesDatabase,
  group: DeviceGroupId = 'all',
): Array<{
  vendor: string;
  device: string;
  label: string;
  sensors: string[];
}> {
  const allowedDevices = group === 'all' ? null : DEVICE_GROUPS[group].devices;
  const map = new Map<string, {vendor: string; device: string; names: Set<string>}>();

  for (const scheme of schemes.sensor_schemes) {
    if (allowedDevices && !allowedDevices.includes(scheme.device)) continue;
    const key = `${scheme.vendor} ${scheme.device}`;
    let entry = map.get(key);
    if (!entry) {
      entry = {vendor: scheme.vendor, device: scheme.device, names: new Set()};
      map.set(key, entry);
    }
    for (const [name] of scheme.markers) {
      entry.names.add(name);
    }
  }

  return Array.from(map.entries()).map(([label, entry]) => ({
    vendor: entry.vendor,
    device: entry.device,
    label,
    sensors: Array.from(entry.names).sort((a, b) => a.localeCompare(b)),
  }));
}

export function filterGalleryByGroup(
  schemes: SchemesDatabase,
  group: DeviceGroupId,
) {
  if (group === 'all') return schemes.gallery;
  const prefixes = DEVICE_GROUPS[group].galleryPrefixes;
  return schemes.gallery.filter((item) =>
    prefixes.some((p) => item.title.startsWith(p)),
  );
}

export interface ExtendedGalleryItem {
  image: string;
  title: string;
  device: string;
  markerCount: number;
}

export function getExtendedGallery(
  schemes: SchemesDatabase,
  group: DeviceGroupId = 'all',
): ExtendedGalleryItem[] {
  const schemeByImage = new Map<string, SensorScheme>();
  for (const sc of schemes.sensor_schemes) {
    if (!schemeByImage.has(sc.image)) {
      schemeByImage.set(sc.image, sc);
    }
  }

  const seenImages = new Set<string>();
  const items: ExtendedGalleryItem[] = [];

  for (const g of schemes.gallery) {
    if (seenImages.has(g.image)) continue;
    seenImages.add(g.image);
    const sc = schemeByImage.get(g.image);
    items.push({
      image: g.image,
      title: g.title,
      device: sc ? `${sc.vendor} ${sc.device}` : g.title.split(' ')[0] ?? '',
      markerCount: sc?.markers.length ?? 0,
    });
  }

  for (const sc of schemes.sensor_schemes) {
    if (seenImages.has(sc.image)) continue;
    seenImages.add(sc.image);
    items.push({
      image: sc.image,
      title: `${sc.device} · ${sc.part}`,
      device: `${sc.vendor} ${sc.device}`,
      markerCount: sc.markers.length,
    });
  }

  if (group === 'all') return items;
  const prefixes = DEVICE_GROUPS[group].galleryPrefixes;
  const allowedDevices = DEVICE_GROUPS[group].devices;
  return items.filter((item) => {
    const sc = schemeByImage.get(item.image);
    if (sc && allowedDevices.includes(sc.device)) return true;
    return prefixes.some((p) => item.title.startsWith(p));
  });
}

export interface SensorSuggestion {
  name: string;
  devices: string[];
  schemeCount: number;
}

export function findMatchingSensors(
  query: string,
  schemes: SchemesDatabase,
  group: DeviceGroupId = 'all',
  limit = 14,
): SensorSuggestion[] {
  const needle = normalizeSensorName(query);
  if (!needle) return [];

  const allowedDevices = group === 'all' ? null : DEVICE_GROUPS[group].devices;
  const grouped = new Map<
    string,
    {name: string; devices: Set<string>; images: Set<string>}
  >();

  for (const sc of schemes.sensor_schemes) {
    if (allowedDevices && !allowedDevices.includes(sc.device)) continue;
    for (const [name] of sc.markers) {
      const norm = normalizeSensorName(name);
      if (!norm.includes(needle)) continue;
      let entry = grouped.get(norm);
      if (!entry) {
        entry = {name, devices: new Set(), images: new Set()};
        grouped.set(norm, entry);
      }
      entry.devices.add(sc.device);
      entry.images.add(sc.image);
    }
  }

  const list = Array.from(grouped.entries()).map(([norm, entry]) => ({
    norm,
    name: entry.name,
    devices: Array.from(entry.devices),
    schemeCount: entry.images.size,
  }));

  list.sort((a, b) => {
    const aExact = a.norm === needle ? 0 : a.norm.startsWith(needle) ? 1 : 2;
    const bExact = b.norm === needle ? 0 : b.norm.startsWith(needle) ? 1 : 2;
    if (aExact !== bExact) return aExact - bExact;
    return a.name.localeCompare(b.name);
  });

  return list.slice(0, limit).map(({name, devices, schemeCount}) => ({
    name,
    devices,
    schemeCount,
  }));
}

export interface TextWithSensorPart {
  kind: 'text' | 'sensor';
  value: string;
  sensorName?: string;
  device?: string;
}

export function splitTextWithSensors(
  text: string,
  allowedDevices: readonly string[],
  index: SensorIndex,
): TextWithSensorPart[] {
  if (!text) return [];
  const parts: TextWithSensorPart[] = [];
  const re = new RegExp(SENSOR_TOKEN_RE.source, 'g');
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(text)) !== null) {
    const token = match[0];
    const start = match.index;
    const hits = findSensor(token, index).filter((h) =>
      allowedDevices.includes(h.scheme.device),
    );
    if (hits.length === 0) continue;

    if (start > lastIndex) {
      parts.push({kind: 'text', value: text.slice(lastIndex, start)});
    }
    parts.push({
      kind: 'sensor',
      value: token,
      sensorName: hits[0].name,
      device: hits[0].scheme.device,
    });
    lastIndex = start + token.length;
  }

  if (lastIndex < text.length) {
    parts.push({kind: 'text', value: text.slice(lastIndex)});
  }

  return parts.length > 0 ? parts : [{kind: 'text', value: text}];
}
