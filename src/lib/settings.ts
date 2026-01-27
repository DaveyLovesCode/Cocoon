/**
 * Settings export/import utilities.
 * Handles serialization and deserialization of user settings.
 *
 * Excludes API key from export (encrypted with extension ID, device-bound).
 */

import type { ThemeMode } from './theme';

const SETTINGS_VERSION = 3;

export interface EnabledFeedContexts {
  home: boolean;
  profile: boolean;
  search: boolean;
  status: boolean;
}

export interface ShowMetrics {
  likes: boolean;
  retweets: boolean;
  views: boolean;
}

export interface QuotaSettings {
  enabled: boolean;
  limit: number;
  period: 'day' | 'week' | 'month';
}

export interface ExportedSettings {
  version: number;
  exportedAt: string;
  userProfile: {
    interests: string[];
    hardBlocks: string[];
    blockedKeywords: string[];
  };
  whitelist: string[];
  theme: string;
  themeMode: ThemeMode;
  autoMatchFeedTheme: boolean;
  // v2 settings
  enabledFeedContexts: EnabledFeedContexts;
  alwaysExpandTweets: boolean;
  showMetrics: ShowMetrics;
  autoUnmuteAfterInteraction: boolean;
  // v3 settings
  quotaSettings: QuotaSettings;
}

const DEFAULT_FEED_CONTEXTS: EnabledFeedContexts = {
  home: true,
  profile: true,
  search: true,
  status: true,
};

const DEFAULT_SHOW_METRICS: ShowMetrics = {
  likes: true,
  retweets: true,
  views: false,
};

const DEFAULT_QUOTA_SETTINGS: QuotaSettings = {
  enabled: false,
  limit: 50,
  period: 'day',
};

export async function exportSettings(): Promise<ExportedSettings> {
  const data = await browser.storage.sync.get([
    'userProfile',
    'whitelist',
    'theme',
    'themeMode',
    'autoMatchFeedTheme',
    'enabledFeedContexts',
    'alwaysExpandTweets',
    'showMetrics',
    'autoUnmuteAfterInteraction',
    'quotaSettings',
    // Legacy key for migration
    'disableProfileFeed',
  ]);

  const userProfile = (data.userProfile as { interests?: string[]; hardBlocks?: string[]; blockedKeywords?: string[] }) || {};

  // Migrate legacy disableProfileFeed to enabledFeedContexts
  let feedContexts = data.enabledFeedContexts as EnabledFeedContexts | undefined;
  if (!feedContexts) {
    feedContexts = { ...DEFAULT_FEED_CONTEXTS };
    if (data.disableProfileFeed === true) {
      feedContexts.profile = false;
    }
  }

  return {
    version: SETTINGS_VERSION,
    exportedAt: new Date().toISOString(),
    userProfile: {
      interests: userProfile.interests || [],
      hardBlocks: userProfile.hardBlocks || [],
      blockedKeywords: userProfile.blockedKeywords || [],
    },
    whitelist: (data.whitelist as string[]) || [],
    theme: (data.theme as string) || 'cocoon',
    themeMode: (data.themeMode as ThemeMode) || 'system',
    autoMatchFeedTheme: data.autoMatchFeedTheme !== false,
    enabledFeedContexts: feedContexts,
    alwaysExpandTweets: !!data.alwaysExpandTweets,
    showMetrics: (data.showMetrics as ShowMetrics) || DEFAULT_SHOW_METRICS,
    autoUnmuteAfterInteraction: !!data.autoUnmuteAfterInteraction,
    quotaSettings: (data.quotaSettings as QuotaSettings) || DEFAULT_QUOTA_SETTINGS,
  };
}

export interface ImportResult {
  success: boolean;
  error?: string;
}

export async function importSettings(json: string): Promise<ImportResult> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(json);
  } catch {
    return { success: false, error: 'Invalid JSON format' };
  }

  if (!parsed || typeof parsed !== 'object') {
    return { success: false, error: 'Invalid settings format' };
  }

  const data = parsed as Record<string, unknown>;

  if (typeof data.version !== 'number' || data.version > SETTINGS_VERSION) {
    return { success: false, error: 'Unsupported settings version' };
  }

  // Validate and extract fields
  const userProfile = data.userProfile as { interests?: unknown; hardBlocks?: unknown; blockedKeywords?: unknown } | undefined;
  const interests = Array.isArray(userProfile?.interests)
    ? userProfile.interests.filter((x): x is string => typeof x === 'string')
    : [];
  const hardBlocks = Array.isArray(userProfile?.hardBlocks)
    ? userProfile.hardBlocks.filter((x): x is string => typeof x === 'string')
    : [];
  const blockedKeywords = Array.isArray(userProfile?.blockedKeywords)
    ? userProfile.blockedKeywords.filter((x): x is string => typeof x === 'string')
    : [];

  const whitelist = Array.isArray(data.whitelist)
    ? (data.whitelist as unknown[]).filter((x): x is string => typeof x === 'string')
    : [];

  const theme = typeof data.theme === 'string' ? data.theme : 'cocoon';
  const themeMode = isValidThemeMode(data.themeMode) ? data.themeMode : 'system';
  const autoMatchFeedTheme = typeof data.autoMatchFeedTheme === 'boolean'
    ? data.autoMatchFeedTheme
    : true;

  // v2 settings with migration from legacy disableProfileFeed
  let enabledFeedContexts: EnabledFeedContexts;
  const rawFeedContexts = data.enabledFeedContexts as Partial<EnabledFeedContexts> | undefined;
  if (rawFeedContexts && typeof rawFeedContexts === 'object') {
    enabledFeedContexts = {
      home: rawFeedContexts.home !== false,
      profile: rawFeedContexts.profile !== false,
      search: rawFeedContexts.search !== false,
      status: rawFeedContexts.status !== false,
    };
  } else {
    // Migrate from v1 disableProfileFeed
    enabledFeedContexts = { ...DEFAULT_FEED_CONTEXTS };
    if (data.disableProfileFeed === true) {
      enabledFeedContexts.profile = false;
    }
  }

  const alwaysExpandTweets = typeof data.alwaysExpandTweets === 'boolean'
    ? data.alwaysExpandTweets
    : false;

  const rawShowMetrics = data.showMetrics as Partial<ShowMetrics> | undefined;
  const showMetrics: ShowMetrics = rawShowMetrics && typeof rawShowMetrics === 'object'
    ? {
        likes: rawShowMetrics.likes !== false,
        retweets: rawShowMetrics.retweets !== false,
        views: rawShowMetrics.views === true,
      }
    : DEFAULT_SHOW_METRICS;

  const autoUnmuteAfterInteraction = typeof data.autoUnmuteAfterInteraction === 'boolean'
    ? data.autoUnmuteAfterInteraction
    : false;

  const rawQuotaSettings = data.quotaSettings as Partial<QuotaSettings> | undefined;
  const quotaSettings: QuotaSettings = rawQuotaSettings && typeof rawQuotaSettings === 'object'
    ? {
        enabled: rawQuotaSettings.enabled === true,
        limit: typeof rawQuotaSettings.limit === 'number' ? rawQuotaSettings.limit : 50,
        period: ['day', 'week', 'month'].includes(rawQuotaSettings.period as string)
          ? rawQuotaSettings.period as 'day' | 'week' | 'month'
          : 'day',
      }
    : DEFAULT_QUOTA_SETTINGS;

  await browser.storage.sync.set({
    userProfile: { interests, hardBlocks, blockedKeywords },
    whitelist,
    theme,
    themeMode,
    autoMatchFeedTheme,
    enabledFeedContexts,
    alwaysExpandTweets,
    showMetrics,
    autoUnmuteAfterInteraction,
    quotaSettings,
  });

  // Clean up legacy key
  await browser.storage.sync.remove('disableProfileFeed');

  return { success: true };
}

function isValidThemeMode(value: unknown): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system';
}
