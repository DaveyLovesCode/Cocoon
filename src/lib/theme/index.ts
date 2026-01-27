/**
 * Theme system - handles theme application, storage, and detection.
 *
 * Settings:
 * - theme: Base theme ID (cocoon, rose, violet, etc.)
 * - themeMode: 'light' | 'dark' | 'system'
 * - autoMatchFeedTheme: Boolean for matching website theme in feed overlay
 */

import {
  themes,
  getTheme,
  getThemeColors,
  getTwitterTheme,
  isLightMode,
  type Theme,
  type ThemeColors,
  type ThemeMode,
} from './themes';
import { TWITTER_VARIANT_CACHE_KEY } from '../constants';

export {
  themes,
  getTheme,
  getThemeColors,
  isLightMode,
  type Theme,
  type ThemeColors,
  type ThemeMode,
} from './themes';

const THEME_KEY = 'theme';
const MODE_KEY = 'themeMode';
const AUTO_MATCH_KEY = 'autoMatchFeedTheme';

// ============================================================================
// STORAGE
// ============================================================================

export async function getThemeSetting(): Promise<string> {
  const result = await browser.storage.sync.get([THEME_KEY]) as Record<string, string | undefined>;
  return result[THEME_KEY] || 'cocoon';
}

export async function setThemeSetting(themeId: string): Promise<void> {
  await browser.storage.sync.set({ [THEME_KEY]: themeId });
}

export async function getThemeMode(): Promise<ThemeMode> {
  const result = await browser.storage.sync.get([MODE_KEY]) as Record<string, ThemeMode | undefined>;
  return result[MODE_KEY] || 'system';
}

export async function setThemeMode(mode: ThemeMode): Promise<void> {
  await browser.storage.sync.set({ [MODE_KEY]: mode });
}

export async function getAutoMatchFeedTheme(): Promise<boolean> {
  const result = await browser.storage.sync.get([AUTO_MATCH_KEY]);
  return result[AUTO_MATCH_KEY] !== false; // Default to true
}

export async function setAutoMatchFeedTheme(enabled: boolean): Promise<void> {
  await browser.storage.sync.set({ [AUTO_MATCH_KEY]: enabled });
}

// ============================================================================
// MODE RESOLUTION
// ============================================================================

/**
 * Resolve 'system' mode to actual light/dark based on OS preference.
 */
export function resolveMode(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'system') {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return 'light'; // Default fallback
  }
  return mode;
}

/**
 * Get resolved colors for a theme + mode combination.
 */
export function getResolvedColors(themeId: string, mode: ThemeMode): ThemeColors {
  const resolvedMode = resolveMode(mode);
  return getThemeColors(themeId, resolvedMode);
}

// ============================================================================
// PLATFORM DETECTION
// ============================================================================

/**
 * Detect Twitter's current theme from the page.
 */
export function detectTwitterTheme(): 'lights-out' | 'dim' | 'default' {
  const body = document.body;
  if (!body) return getCachedTwitterVariant() ?? 'lights-out';

  try {
    const bgColor = getComputedStyle(body).backgroundColor;
    const match = bgColor.match(/rgb\((\d+),\s*(\d+),\s*(\d+)\)/);
    if (!match) return getCachedTwitterVariant() ?? 'lights-out';

    const r = parseInt(match[1], 10);
    const g = parseInt(match[2], 10);
    const b = parseInt(match[3], 10);

    // Pure black = Lights Out
    if (r === 0 && g === 0 && b === 0) return 'lights-out';
    // Dark blue-gray = Dim
    if (r < 30 && g < 50 && b < 60 && b > g) return 'dim';
    // Light = Default
    if (r > 240 && g > 240 && b > 240) return 'default';
  } catch {
    // Ignore errors
  }

  return getCachedTwitterVariant() ?? 'lights-out';
}

/**
 * Get Twitter platform theme colors.
 */
export function getTwitterColors(): ThemeColors {
  const variant = detectTwitterTheme();
  return getTwitterTheme(variant);
}

function getCachedTwitterVariant(): 'lights-out' | 'dim' | 'default' | null {
  try {
    const raw = localStorage.getItem(TWITTER_VARIANT_CACHE_KEY);
    if (!raw) return null;
    if (raw === 'lights-out' || raw === 'dim' || raw === 'default') return raw;

    const parsed = JSON.parse(raw) as { variant?: unknown; ts?: unknown } | null;
    const variant = parsed?.variant;
    if (variant !== 'lights-out' && variant !== 'dim' && variant !== 'default') return null;

    const ts = typeof parsed?.ts === 'number' ? parsed.ts : null;
    const maxAgeMs = 7 * 24 * 60 * 60 * 1000;
    if (ts && Date.now() - ts > maxAgeMs) return null;

    return variant;
  } catch {
    return null;
  }
}

// ============================================================================
// THEME APPLICATION
// ============================================================================

/**
 * Apply theme colors to the document via CSS custom properties.
 */
export function applyTheme(colors: ThemeColors): void {
  const root = document.documentElement;
  const mode = isLightMode(colors) ? 'light' : 'dark';

  root.setAttribute('data-theme-type', mode);

  root.style.setProperty('--cocoon-bg', colors.bg);
  root.style.setProperty('--cocoon-surface', colors.surface);
  root.style.setProperty('--cocoon-elevated', colors.elevated);
  root.style.setProperty('--cocoon-text', colors.text);
  root.style.setProperty('--cocoon-muted', colors.muted);
  root.style.setProperty('--cocoon-accent', colors.accent);
  root.style.setProperty('--cocoon-accent-fg', colors.accentFg);
  root.style.setProperty('--cocoon-border', colors.border);
  root.style.setProperty('--cocoon-dim', colors.dim);
}

/**
 * Initialize theme in extension pages (popup, options, welcome, etc.).
 */
export async function initializeTheme(): Promise<ThemeColors> {
  const themeId = await getThemeSetting();
  const mode = await getThemeMode();
  const colors = getResolvedColors(themeId, mode);
  applyTheme(colors);

  // Listen for system theme changes if using system mode
  if (mode === 'system' && typeof window !== 'undefined' && window.matchMedia) {
    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    mediaQuery.addEventListener('change', async () => {
      const newColors = getResolvedColors(themeId, 'system');
      applyTheme(newColors);
    });
  }

  return colors;
}

/**
 * Initialize theme in content script (feed overlay).
 * If autoMatch is enabled, uses platform detection.
 */
export async function initializeContentTheme(platform: string): Promise<ThemeColors> {
  const themeId = await getThemeSetting();
  const mode = await getThemeMode();
  const autoMatch = await getAutoMatchFeedTheme();

  let colors: ThemeColors;

  if (autoMatch && platform === 'twitter') {
    colors = getTwitterColors();
  } else {
    colors = getResolvedColors(themeId, mode);
  }

  applyTheme(colors);
  return colors;
}

// ============================================================================
// CHANGE LISTENERS
// ============================================================================

/**
 * Listen for theme setting changes.
 */
export function onThemeChange(
  callback: (colors: ThemeColors) => void,
  options: { platform?: string; isContentScript?: boolean } = {}
): () => void {
  const { platform, isContentScript = false } = options;

  const listener = async (
    changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
    areaName: string
  ) => {
    if (areaName !== 'sync') return;
    if (!changes[THEME_KEY] && !changes[MODE_KEY] && !changes[AUTO_MATCH_KEY]) return;

    const themeId = await getThemeSetting();
    const mode = await getThemeMode();
    const autoMatch = await getAutoMatchFeedTheme();

    let colors: ThemeColors;

    if (isContentScript && autoMatch && platform === 'twitter') {
      colors = getTwitterColors();
    } else {
      colors = getResolvedColors(themeId, mode);
    }

    callback(colors);
  };

  browser.storage.onChanged.addListener(listener);

  return () => {
    browser.storage.onChanged.removeListener(listener);
  };
}
