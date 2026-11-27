import type {DeviceGroupId, DeviceMode} from '../types/atm';

export type AppTab = 'errors' | 'schemes' | 'guides';

export interface AppUrlState {
  tab: AppTab;
  q?: string;
  mode?: DeviceMode;
  sensor?: string;
  scheme?: string;
  group?: DeviceGroupId;
  guide?: string;
  section?: number;
}

const VALID_TABS = new Set<AppTab>(['errors', 'schemes', 'guides']);
const VALID_MODES = new Set<DeviceMode>(['all', 'grg', 'ccdm', 'cmd_v4']);
const VALID_GROUPS = new Set<DeviceGroupId>(['all', 'ccdm', 'cmd', 'grg', 'crs']);

export function parseUrlState(search: string): AppUrlState {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const rawTab = params.get('tab') as AppTab | null;
  const tab: AppTab = rawTab && VALID_TABS.has(rawTab) ? rawTab : 'errors';

  const rawMode = params.get('mode') as DeviceMode | null;
  const mode = rawMode && VALID_MODES.has(rawMode) ? rawMode : undefined;

  const rawGroup = params.get('group') as DeviceGroupId | null;
  const group = rawGroup && VALID_GROUPS.has(rawGroup) ? rawGroup : undefined;

  const rawSection = params.get('section');
  const parsedSection = rawSection !== null ? Number.parseInt(rawSection, 10) : NaN;
  const section =
    Number.isInteger(parsedSection) && parsedSection >= 0 ? parsedSection : undefined;

  const q = params.get('q') ?? undefined;
  const sensor = params.get('sensor') ?? undefined;
  const scheme = params.get('scheme') ?? undefined;
  const guide = params.get('guide') ?? undefined;

  return {tab, q, mode, sensor, scheme, group, guide, section};
}

export function serializeUrlState(state: AppUrlState): string {
  const params = new URLSearchParams();
  params.set('tab', state.tab);

  if (state.tab === 'errors') {
    if (state.q && state.q.trim()) params.set('q', state.q.trim());
    if (state.mode && state.mode !== 'all') params.set('mode', state.mode);
  } else if (state.tab === 'schemes') {
    if (state.group && state.group !== 'all') params.set('group', state.group);
    if (state.sensor && state.sensor.trim()) params.set('sensor', state.sensor.trim());
    if (state.scheme && state.scheme.trim()) params.set('scheme', state.scheme.trim());
  } else if (state.tab === 'guides') {
    if (state.guide && state.guide.trim()) params.set('guide', state.guide.trim());
    if (typeof state.section === 'number' && state.section > 0) {
      params.set('section', String(state.section));
    }
  }

  const str = params.toString();
  return str ? `?${str}` : '';
}
