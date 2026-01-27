/**
 * Unified caching utilities for feed and navigation data.
 * Used by both hide-immediate (early restore) and content script (write cache).
 */

import {
  FEED_CACHE_PREFIX,
  FEED_CACHE_TTL_MS,
  NAV_CACHE_KEY,
  NAV_CACHE_TTL_MS,
  OVERLAY_ID,
  CONTENT_STYLES_ID,
} from '@/lib/constants';
import { type ThemeColors, isLightMode } from '@/lib/theme/themes';
import type { NavItem } from '@/lib/platforms/types';

// Re-export NavItem for cache consumers
export type { NavItem };

/** Cached navigation data */
export type NavCache = {
  timestamp: number;
  platform: string;
  items: NavItem[];
  composeSvg?: string;
};

/** Theme snapshot for cache */
export type ThemeSnapshot = {
  mode: 'light' | 'dark';
  colors: ThemeColors;
};

/** Feed cache structure - minimal type for reading (hide-immediate) */
export type FeedCacheBase = {
  timestamp: number;
  platformName: string;
  renderedHtml?: string;
  renderedCss?: string;
  theme?: ThemeSnapshot;
};

// ============================================================================
// NAVIGATION TYPE DETECTION
// ============================================================================

/**
 * Get the navigation type (navigate, reload, back_forward).
 */
export function getNavigationType(): string | null {
  try {
    const entries = performance.getEntriesByType('navigation') as PerformanceNavigationTiming[];
    if (entries.length > 0 && entries[0]?.type) {
      return entries[0].type;
    }
    // Fallback to deprecated API
    const perfNav = performance.navigation;
    if (perfNav) {
      return perfNav.type === 2 ? 'back_forward' : (perfNav.type === 1 ? 'reload' : 'navigate');
    }
  } catch { /* ignore */ }
  return null;
}

/**
 * Check if current navigation is back/forward.
 */
export function isBackForwardNavigation(): boolean {
  return getNavigationType() === 'back_forward';
}

// ============================================================================
// FEED CACHE - KEYS
// ============================================================================

/**
 * Generate cache key for a URL.
 */
export function getFeedCacheKey(url: string): string {
  try {
    const parsed = new URL(url);
    return FEED_CACHE_PREFIX + parsed.hostname + parsed.pathname;
  } catch {
    return FEED_CACHE_PREFIX + url;
  }
}

// ============================================================================
// FEED CACHE - READ (for hide-immediate)
// ============================================================================

/**
 * Get cached feed data if available and not expired.
 * Returns only base fields needed for restore.
 */
export function getFeedCache(url: string): FeedCacheBase | null {
  try {
    const key = getFeedCacheKey(url);
    const data = sessionStorage.getItem(key);
    if (!data) return null;

    const cache = JSON.parse(data) as FeedCacheBase;
    if (Date.now() - cache.timestamp > FEED_CACHE_TTL_MS) {
      sessionStorage.removeItem(key);
      return null;
    }
    return cache;
  } catch {
    return null;
  }
}

/**
 * Get feed cache specifically for back/forward navigation.
 * Returns cache info with navigation context.
 */
export function getBackForwardFeedCache(url: string): {
  navType: string | null;
  cache: FeedCacheBase | null;
  age: number | null;
} {
  const navType = getNavigationType();
  const result = { navType, cache: null as FeedCacheBase | null, age: null as number | null };

  if (navType !== 'back_forward') return result;

  try {
    const cache = getFeedCache(url);
    if (cache) {
      result.cache = cache;
      result.age = Date.now() - cache.timestamp;
    }
  } catch { /* ignore */ }

  return result;
}

// ============================================================================
// FEED CACHE - WRITE (for content script)
// ============================================================================

/**
 * Capture current theme as a snapshot for caching.
 */
export function captureThemeSnapshot(): ThemeSnapshot | undefined {
  const root = document.documentElement;
  const computed = getComputedStyle(root);
  const read = (name: string): string =>
    (root.style.getPropertyValue(name) || computed.getPropertyValue(name)).trim();

  const colors: ThemeColors = {
    bg: read('--cocoon-bg'),
    surface: read('--cocoon-surface'),
    elevated: read('--cocoon-elevated'),
    text: read('--cocoon-text'),
    muted: read('--cocoon-muted'),
    accent: read('--cocoon-accent'),
    accentFg: read('--cocoon-accent-fg'),
    border: read('--cocoon-border'),
    dim: read('--cocoon-dim'),
  };

  // If theme hasn't been applied yet, don't write garbage into cache.
  if (!colors.bg || !colors.text || !colors.surface) return;

  const attrMode = root.getAttribute('data-theme-type');
  const mode =
    attrMode === 'light' ? 'light' :
    attrMode === 'dark' ? 'dark' :
    (isLightMode(colors) ? 'light' : 'dark');

  return { mode, colors };
}

/**
 * Capture overlay HTML for caching.
 * Strips handler-state attributes that don't survive innerHTML restore.
 */
export function captureOverlayHtml(): { html: string; css: string } | null {
  const overlay = document.getElementById(OVERLAY_ID);
  if (!overlay) return null;

  // Clone and strip handler-state attributes
  const overlayClone = overlay.cloneNode(true) as HTMLElement;
  overlayClone.querySelectorAll('[data-click-attached]').forEach(el => el.removeAttribute('data-click-attached'));
  overlayClone.querySelectorAll('[data-lightbox-attached]').forEach(el => el.removeAttribute('data-lightbox-attached'));

  const styleEl = document.getElementById(CONTENT_STYLES_ID);

  return {
    html: overlayClone.innerHTML,
    css: styleEl?.textContent || '',
  };
}

// ============================================================================
// NAV CACHE
// ============================================================================

/**
 * Get cached nav items if available and not expired.
 */
export function getNavCache(platform: string): NavItem[] | null {
  try {
    const data = localStorage.getItem(NAV_CACHE_KEY);
    if (!data) return null;

    const cache = JSON.parse(data) as NavCache;
    if (cache.platform !== platform) return null;
    if (Date.now() - cache.timestamp > NAV_CACHE_TTL_MS) return null;

    return cache.items;
  } catch {
    return null;
  }
}

/**
 * Save nav items to cache.
 */
export function setNavCache(platform: string, items: NavItem[], composeSvg?: string): void {
  try {
    const cache: NavCache = {
      timestamp: Date.now(),
      platform,
      items,
      composeSvg,
    };
    localStorage.setItem(NAV_CACHE_KEY, JSON.stringify(cache));
  } catch { /* ignore */ }
}

/**
 * Get cached compose button SVG.
 */
export function getCachedComposeSvg(): string | null {
  try {
    const data = localStorage.getItem(NAV_CACHE_KEY);
    if (!data) return null;
    const cache = JSON.parse(data) as NavCache;
    return cache.composeSvg || null;
  } catch {
    return null;
  }
}

/**
 * Get current username from nav cache (profile link href).
 * Returns lowercase username without leading slash, or null if unavailable.
 */
export function getCurrentUsername(): string | null {
  try {
    const data = localStorage.getItem(NAV_CACHE_KEY);
    if (!data) return null;
    const cache = JSON.parse(data) as NavCache;
    const profileItem = cache.items?.find(item => item.id === 'profile');
    if (!profileItem?.href) return null;
    return profileItem.href.replace(/^\//, '').toLowerCase();
  } catch {
    return null;
  }
}
