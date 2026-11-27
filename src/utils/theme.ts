export type ThemeMode = 'light' | 'dark';

export const THEME_STORAGE_KEY = 'atm_service_theme_v1';

export function parseStoredTheme(raw: string | null | undefined): ThemeMode | null {
  if (raw === 'dark' || raw === 'light') return raw;
  return null;
}

export function resolveTheme(
  stored: string | null | undefined,
  systemPrefersDark: boolean,
): ThemeMode {
  const parsed = parseStoredTheme(stored);
  if (parsed) return parsed;
  return systemPrefersDark ? 'dark' : 'light';
}

export function getNextTheme(current: ThemeMode): ThemeMode {
  return current === 'dark' ? 'light' : 'dark';
}
