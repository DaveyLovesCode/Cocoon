/**
 * Twitter/X feed context provider.
 * Handles URL parsing, normalization, and feed context detection.
 */

import type { FeedContext, FeedContextProvider } from '../types';

// Scan depths by page type
const INITIAL_SCAN_SCREENS = 10; // Main feed: full sweep
const PROFILE_SCAN_SCREENS = 3;  // Profile: header + bio + first tweets
const STATUS_SCAN_SCREENS = 2;   // Tweet detail: header + replies

/**
 * Normalize Twitter URLs.
 * x.com/ always redirects to /home, so treat it as /home from the start.
 */
function normalizeUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '');
    if ((host === 'x.com' || host === 'twitter.com') && parsed.pathname === '/') {
      parsed.pathname = '/home';
      return parsed.href;
    }
  } catch {
    // ignore
  }
  return url;
}

/**
 * Determine feed context from URL.
 */
function getFeedContext(url: string): FeedContext | null {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '');
    if (host !== 'x.com' && host !== 'twitter.com') return null;

    const path = parsed.pathname;
    if (path === '/' || path === '/home' || path === '/following') return 'home';
    if (path === '/search' || path.startsWith('/search')) return 'search';
    if (/^\/[^/]+\/status\/\d+/.test(path)) return 'status';
    if (/^\/[a-zA-Z0-9_]{1,15}$/.test(path)) return 'profile';
    return null;
  } catch {
    return null;
  }
}

/**
 * Check if URL is the current user's own profile.
 */
function isOwnProfileUrl(url: string, currentUsername: string | null): boolean {
  if (!currentUsername) return false;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '');
    if (host !== 'x.com' && host !== 'twitter.com') return false;

    const profileMatch = parsed.pathname.match(/^\/([a-zA-Z0-9_]{1,15})$/);
    if (!profileMatch) return false;

    return profileMatch[1].toLowerCase() === currentUsername.toLowerCase();
  } catch {
    return false;
  }
}

/**
 * Get initial scan screens based on page type.
 */
function getInitialScanScreens(url: string): number {
  try {
    const pathname = new URL(url).pathname;
    if (pathname === '/' || pathname === '/home') return INITIAL_SCAN_SCREENS;
    if (/^\/[^/]+\/status\/\d+/.test(pathname)) return STATUS_SCAN_SCREENS;
    return PROFILE_SCAN_SCREENS;
  } catch {
    return INITIAL_SCAN_SCREENS;
  }
}

/**
 * Twitter feed context provider.
 */
export const twitterContext: FeedContextProvider = {
  normalizeUrl,
  getFeedContext,
  isOwnProfileUrl,
  getInitialScanScreens,
};
