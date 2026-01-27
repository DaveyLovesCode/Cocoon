/**
 * Single source of truth for supported sites.
 * Add a new platform here and everything else picks it up.
 */

export type SiteDefinition = {
  id: string;
  name: string;
  domains: string[];
  /** Paths that ARE feeds (regex patterns) */
  feedPaths: RegExp[];
  /** Paths that are NOT feeds - checked first (regex patterns) */
  excludedPaths?: RegExp[];
  /** Reserved path segments that aren't usernames (for profile detection) */
  reservedPaths?: Set<string>;
};

export const SITES: Record<string, SiteDefinition> = {
  twitter: {
    id: 'twitter',
    name: 'Twitter/X',
    domains: ['twitter.com', 'x.com'],
    feedPaths: [
      /^\/$/,                          // Home feed
      /^\/home$/,                      // Explicit home
      /^\/following$/,                 // Some variants use /following for chronological feed
      /^\/search/,                     // Search results
      /^\/[^/]+\/status\/\d+/,         // Tweet detail
      /^\/([a-zA-Z0-9_]{1,15})$/,      // Profile (validated against reservedPaths)
    ],
    reservedPaths: new Set([
      'home', 'explore', 'search', 'messages', 'notifications', 'compose',
      'settings', 'login', 'logout', 'i', 'tos', 'privacy', 'about',
      'following',
    ]),
  },

  // STUBBED: Uncomment when ready to launch Reddit
  // reddit: {
  //   id: 'reddit',
  //   name: 'Reddit',
  //   domains: ['reddit.com', 'old.reddit.com', 'new.reddit.com'],
  //   feedPaths: [
  //     /^\/$/,
  //     /^\/home/,
  //     /^\/r\/[^/]+/,
  //     /^\/user\/[^/]+/,
  //     /^\/u\/[^/]+/,
  //     /^\/search/,
  //     /^\/best/,
  //     /^\/hot/,
  //     /^\/new/,
  //     /^\/top/,
  //     /^\/rising/,
  //   ],
  //   excludedPaths: [
  //     /^\/settings/,
  //     /^\/prefs/,
  //     /^\/admin/,
  //     /^\/mod/,
  //     /^\/message/,
  //     /^\/chat/,
  //     /^\/coins/,
  //     /^\/premium/,
  //     /^\/login/,
  //     /^\/register/,
  //     /^\/account/,
  //   ],
  // },
};

/** All domains across all enabled sites */
export const ALL_DOMAINS: string[] = Object.values(SITES).flatMap(s => s.domains);

/** Content script match patterns for all enabled sites */
export const ALL_MATCH_PATTERNS: string[] = ALL_DOMAINS.flatMap(d => [
  `*://${d}/*`,
  `*://www.${d}/*`,
]);

/**
 * Check if a URL is a supported feed page.
 * Used by content scripts for runtime validation.
 */
export function isSupportedFeedUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '');
    const path = parsed.pathname;

    for (const site of Object.values(SITES)) {
      // Check domain
      if (!site.domains.some(d => host === d || host.endsWith('.' + d))) continue;

      // Check excluded paths first
      if (site.excludedPaths?.some(p => p.test(path))) return false;

      // Check feed paths
      for (const pattern of site.feedPaths) {
        const match = path.match(pattern);
        if (match) {
          // Profile pattern captures username - validate against reserved paths
          if (match[1] && site.reservedPaths?.has(match[1].toLowerCase())) {
            continue;
          }
          return true;
        }
      }
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Get the site definition for a URL, or null if not supported.
 */
export function getSiteForUrl(url: string): SiteDefinition | null {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    for (const site of Object.values(SITES)) {
      if (site.domains.some(d => host === d || host.endsWith('.' + d))) {
        return site;
      }
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Check if URL is a profile page (any user, not home/search/status).
 */
export function isProfileUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '');
    if (host !== 'x.com' && host !== 'twitter.com') return false;

    const path = parsed.pathname;
    const profileMatch = path.match(/^\/([a-zA-Z0-9_]{1,15})$/);
    if (!profileMatch) return false;

    // Exclude reserved paths
    const site = SITES.twitter;
    if (site.reservedPaths?.has(profileMatch[1].toLowerCase())) return false;

    return true;
  } catch {
    return false;
  }
}

/**
 * Check if URL is the current user's own profile.
 * Used to skip overlay on own profile (show raw X.com).
 */
export function isOwnProfileUrl(url: string, currentUsername: string | null): boolean {
  if (!currentUsername) return false;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.replace(/^www\./, '');
    if (host !== 'x.com' && host !== 'twitter.com') return false;

    const path = parsed.pathname;
    // Match profile URL pattern: /username (1-15 chars, alphanumeric + underscore)
    const profileMatch = path.match(/^\/([a-zA-Z0-9_]{1,15})$/);
    if (!profileMatch) return false;

    return profileMatch[1].toLowerCase() === currentUsername;
  } catch {
    return false;
  }
}
