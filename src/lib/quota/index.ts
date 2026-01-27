/**
 * Dopamine Budget - quota tracking for feed consumption.
 * Tracks viewed posts for both limit enforcement and future statistics.
 */

export interface QuotaSettings {
  enabled: boolean;
  limit: number;
  period: 'day' | 'week' | 'month';
}

export interface ViewedPost {
  timestamp: number;
  platform: string;
}

export interface QuotaUsage {
  /** Posts viewed in current period (for quick limit checks) */
  periodCount: number;
  /** Start of current period */
  periodStart: number;
  /** Period type when this was set (to detect settings changes) */
  periodType: 'day' | 'week' | 'month';
  /** All viewed posts with timestamps (for stats) */
  history: ViewedPost[];
}

export interface QuotaStatus {
  allowed: boolean;
  remaining: number;
  viewed: number;
  limit: number;
  resetsAt: Date;
  enabled: boolean;
}

const DEFAULT_SETTINGS: QuotaSettings = {
  enabled: false,
  limit: 50,
  period: 'day',
};

const HISTORY_RETENTION_DAYS = 90;

/**
 * Get quota settings from storage.
 */
export async function getQuotaSettings(): Promise<QuotaSettings> {
  const data = await browser.storage.sync.get(['quotaSettings']);
  return (data.quotaSettings as QuotaSettings) || DEFAULT_SETTINGS;
}

/**
 * Save quota settings to storage.
 */
export async function saveQuotaSettings(settings: QuotaSettings): Promise<void> {
  await browser.storage.sync.set({ quotaSettings: settings });
}

/**
 * Get quota usage from local storage.
 */
export async function getQuotaUsage(): Promise<QuotaUsage> {
  const data = await browser.storage.local.get(['quotaUsage']);
  return (data.quotaUsage as QuotaUsage) || {
    periodCount: 0,
    periodStart: Date.now(),
    periodType: 'day',
    history: [],
  };
}

/**
 * Save quota usage to local storage.
 */
async function saveQuotaUsage(usage: QuotaUsage): Promise<void> {
  await browser.storage.local.set({ quotaUsage: usage });
}

/**
 * Get the start of the current period.
 */
function getPeriodStart(period: 'day' | 'week' | 'month'): number {
  const now = new Date();

  if (period === 'day') {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  }

  if (period === 'week') {
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1); // Monday start
    return new Date(now.getFullYear(), now.getMonth(), diff).getTime();
  }

  // month
  return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
}

/**
 * Get when the current period resets.
 */
function getPeriodEnd(period: 'day' | 'week' | 'month'): Date {
  const now = new Date();

  if (period === 'day') {
    return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  }

  if (period === 'week') {
    const day = now.getDay();
    const diff = now.getDate() - day + (day === 0 ? -6 : 1) + 7;
    return new Date(now.getFullYear(), now.getMonth(), diff);
  }

  // month
  return new Date(now.getFullYear(), now.getMonth() + 1, 1);
}

/**
 * Count posts in history within a time range.
 */
function countPostsInRange(history: ViewedPost[], start: number, end: number = Date.now()): number {
  return history.filter(p => p.timestamp >= start && p.timestamp <= end).length;
}

/**
 * Prune old history entries beyond retention period.
 */
function pruneHistory(history: ViewedPost[]): ViewedPost[] {
  const cutoff = Date.now() - (HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  return history.filter(p => p.timestamp >= cutoff);
}

/**
 * Check quota status and reset period if needed.
 */
export async function checkQuota(): Promise<QuotaStatus> {
  const settings = await getQuotaSettings();
  let usage = await getQuotaUsage();

  const currentPeriodStart = getPeriodStart(settings.period);
  const resetsAt = getPeriodEnd(settings.period);

  // Check if period changed or rolled over
  const periodChanged = usage.periodType !== settings.period;
  const periodExpired = usage.periodStart < currentPeriodStart;

  if (periodChanged || periodExpired) {
    // Recalculate count from history for new period
    usage = {
      ...usage,
      periodCount: countPostsInRange(usage.history, currentPeriodStart),
      periodStart: currentPeriodStart,
      periodType: settings.period,
      history: pruneHistory(usage.history),
    };
    await saveQuotaUsage(usage);
  }

  const viewed = usage.periodCount;
  const remaining = Math.max(0, settings.limit - viewed);
  const allowed = !settings.enabled || remaining > 0;

  return {
    allowed,
    remaining,
    viewed,
    limit: settings.limit,
    resetsAt,
    enabled: settings.enabled,
  };
}

/**
 * Record viewed posts. Called when posts enter viewport.
 * Always tracks for stats, even if quota is disabled.
 */
export async function recordViewedPosts(count: number, platform: string): Promise<QuotaStatus> {
  const settings = await getQuotaSettings();
  let usage = await getQuotaUsage();

  const now = Date.now();
  const currentPeriodStart = getPeriodStart(settings.period);

  // Check if period rolled over
  if (usage.periodStart < currentPeriodStart || usage.periodType !== settings.period) {
    usage = {
      ...usage,
      periodCount: countPostsInRange(usage.history, currentPeriodStart),
      periodStart: currentPeriodStart,
      periodType: settings.period,
      history: pruneHistory(usage.history),
    };
  }

  // Add new posts to history
  const newPosts: ViewedPost[] = Array.from({ length: count }, () => ({
    timestamp: now,
    platform,
  }));

  usage = {
    ...usage,
    periodCount: usage.periodCount + count,
    history: [...usage.history, ...newPosts],
  };

  await saveQuotaUsage(usage);

  const resetsAt = getPeriodEnd(settings.period);
  const remaining = Math.max(0, settings.limit - usage.periodCount);

  return {
    allowed: !settings.enabled || remaining > 0,
    remaining,
    viewed: usage.periodCount,
    limit: settings.limit,
    resetsAt,
    enabled: settings.enabled,
  };
}

/**
 * Get today's view count (for settings display).
 */
export async function getTodayViewCount(): Promise<number> {
  const usage = await getQuotaUsage();
  const todayStart = getPeriodStart('day');
  return countPostsInRange(usage.history, todayStart);
}

/**
 * Get stats for a given period (for future stats feature).
 */
export async function getViewStats(period: 'day' | 'week' | 'month'): Promise<{
  current: number;
  previous: number;
  periodStart: Date;
}> {
  const usage = await getQuotaUsage();
  const currentStart = getPeriodStart(period);

  let previousStart: number;
  if (period === 'day') {
    previousStart = currentStart - (24 * 60 * 60 * 1000);
  } else if (period === 'week') {
    previousStart = currentStart - (7 * 24 * 60 * 60 * 1000);
  } else {
    const d = new Date(currentStart);
    d.setMonth(d.getMonth() - 1);
    previousStart = d.getTime();
  }

  return {
    current: countPostsInRange(usage.history, currentStart),
    previous: countPostsInRange(usage.history, previousStart, currentStart),
    periodStart: new Date(currentStart),
  };
}

/**
 * Format time remaining until reset.
 */
export function formatTimeRemaining(resetsAt: Date): string {
  const now = Date.now();
  const diff = resetsAt.getTime() - now;

  if (diff <= 0) return 'now';

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (hours > 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  }

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }

  return `${minutes}m`;
}

/**
 * Get period label for display.
 */
export function getPeriodLabel(period: 'day' | 'week' | 'month'): string {
  switch (period) {
    case 'day': return 'today';
    case 'week': return 'this week';
    case 'month': return 'this month';
  }
}
