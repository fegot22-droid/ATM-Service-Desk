export type ErrorCategory = 'grg' | 'cmd_v4' | 'ccdm';

export type DeviceMode = 'all' | ErrorCategory;

export type DeviceGroupId = 'all' | 'ccdm' | 'cmd' | 'grg' | 'crs';

export interface ErrorCodesMeta {
  source: string;
  grg_count: number;
  cmd_v4_count: number;
  ccdm_count: number;
}

export interface ErrorCodesDatabase {
  meta: ErrorCodesMeta;
  grg: Record<string, string>;
  cmd_v4: Record<string, string>;
  ccdm: Record<string, string>;
}

export interface ParsedDescription {
  category?: string;
  description: string;
  recommendations: string;
}

export interface ErrorMatch {
  category: ErrorCategory;
  key: string;
  rawText: string;
  parsed: ParsedDescription;
  signMatches: boolean;
  inputValue: number;
}

export type MarkerTuple = [string, number, number];

export interface SensorScheme {
  vendor: string;
  device: string;
  part: string;
  image: string;
  markers: MarkerTuple[];
}

export interface GalleryItem {
  title: string;
  image: string;
}

export interface SchemesDatabase {
  images: Record<string, string>;
  gallery: GalleryItem[];
  sensor_schemes: SensorScheme[];
  source?: string;
}

export interface SensorPoint {
  x: number;
  y: number;
}

export interface SensorHit {
  scheme: SensorScheme;
  name: string;
  points: SensorPoint[];
}

export type SensorIndex = Map<string, SensorHit[]>;

export interface GuideBlock {
  kind: 'text' | 'img';
  value: string;
}

export interface GuideSection {
  title: string;
  blocks: GuideBlock[];
}

export interface Guide {
  id: string;
  title: string;
  subtitle: string;
  sourceFileName: string;
  sourceFileUrl?: string;
  sections: GuideSection[];
}
