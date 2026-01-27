/**
 * Platform registry - central place to register and retrieve platforms.
 */

import type { Platform, PlatformAdapter } from './types';

const platforms: Platform[] = [];

/**
 * Register a platform.
 * Call this from each platform's module to make it available.
 */
export function registerPlatform(platform: Platform): void {
  // Avoid duplicates
  const existing = platforms.findIndex(p => p.name === platform.name);
  if (existing >= 0) {
    platforms[existing] = platform;
  } else {
    platforms.push(platform);
  }
}

/**
 * Get the complete platform for a URL, or null if no platform matches.
 */
export function getPlatformForUrl(url: string): Platform | null {
  for (const platform of platforms) {
    if (platform.adapter.matchesSite(url)) {
      return platform;
    }
  }
  return null;
}

/**
 * Get just the adapter for a URL (legacy compatibility).
 * Prefer getPlatformForUrl for new code.
 */
export function getAdapterForUrl(url: string): PlatformAdapter | null {
  const platform = getPlatformForUrl(url);
  return platform?.adapter ?? null;
}

/**
 * Check if a URL is a feed site (has a registered platform).
 */
export function isFeedSite(url: string): boolean {
  return getPlatformForUrl(url) !== null;
}

/**
 * Get all registered platforms.
 */
export function getRegisteredPlatforms(): readonly Platform[] {
  return platforms;
}
