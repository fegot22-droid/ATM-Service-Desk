import {useCallback, useEffect, useState} from 'react';
import {
  THEME_STORAGE_KEY,
  getNextTheme,
  parseStoredTheme,
  resolveTheme,
  type ThemeMode,
} from '../utils/theme';

function getSystemPrefersDark(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-color-scheme: dark)').matches;
}

function readInitialTheme(): {theme: ThemeMode; hasExplicit: boolean} {
  if (typeof window === 'undefined') {
    return {theme: 'light', hasExplicit: false};
  }
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(THEME_STORAGE_KEY);
  } catch {
    stored = null;
  }
  const explicit = parseStoredTheme(stored);
  return {
    theme: resolveTheme(explicit, getSystemPrefersDark()),
    hasExplicit: explicit !== null,
  };
}

function applyThemeToDocument(theme: ThemeMode) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  if (theme === 'dark') {
    root.classList.add('dark');
  } else {
    root.classList.remove('dark');
  }
  const metaThemeColor = document.querySelector('meta[name="theme-color"]');
  if (metaThemeColor) {
    metaThemeColor.setAttribute('content', theme === 'dark' ? '#0f172a' : '#1d4ed8');
  }
}

export function useTheme() {
  const [initial] = useState(readInitialTheme);
  const [theme, setTheme] = useState<ThemeMode>(initial.theme);
  const [hasExplicitPreference, setHasExplicitPreference] = useState<boolean>(
    initial.hasExplicit,
  );

  useEffect(() => {
    applyThemeToDocument(theme);
  }, [theme]);

  // Respect system preference changes when user has not explicitly overridden
  useEffect(() => {
    if (hasExplicitPreference || typeof window === 'undefined' || !window.matchMedia) {
      return;
    }
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => {
      setTheme(e.matches ? 'dark' : 'light');
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, [hasExplicitPreference]);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => {
      const next = getNextTheme(prev);
      setHasExplicitPreference(true);
      try {
        localStorage.setItem(THEME_STORAGE_KEY, next);
      } catch {
        // Ignore storage errors
      }
      return next;
    });
  }, []);

  const resetToSystemTheme = useCallback(() => {
    setHasExplicitPreference(false);
    try {
      localStorage.removeItem(THEME_STORAGE_KEY);
    } catch {
      // Ignore storage errors
    }
    setTheme(getSystemPrefersDark() ? 'dark' : 'light');
  }, []);

  return {
    theme,
    isDark: theme === 'dark',
    hasExplicitPreference,
    toggleTheme,
    resetToSystemTheme,
  };
}
