/**
 * Quota observer - tracks posts visible for 2+ seconds.
 */

import { createLogger } from '../logger';
import { recordViewedPosts, type QuotaStatus } from './index';
import { showApproachingLimitIndicator, removeApproachingLimitIndicator } from './ui';

const log = createLogger('QuotaObserver');

const VIEW_TIME_MS = 2000;
const APPROACHING_LIMIT_THRESHOLD = 10;

let currentPlatform = '';
let currentStatus: QuotaStatus | null = null;
let intersectionObserver: IntersectionObserver | null = null;

// Track state per element
const itemTimers = new Map<Element, ReturnType<typeof setTimeout>>();
const countedItems = new WeakSet<Element>();

// Queue for batching view counts to avoid race conditions
let pendingCount = 0;
let flushScheduled = false;

async function flushPendingViews(): Promise<void> {
  if (pendingCount === 0) return;

  const count = pendingCount;
  pendingCount = 0;
  flushScheduled = false;

  try {
    currentStatus = await recordViewedPosts(count, currentPlatform);
    log.info(`Recorded ${count} view(s). Total: ${currentStatus.viewed}`);

    if (currentStatus.enabled) {
      if (currentStatus.remaining <= APPROACHING_LIMIT_THRESHOLD && currentStatus.remaining > 0) {
        showApproachingLimitIndicator(currentStatus.remaining);
      } else {
        removeApproachingLimitIndicator();
      }
    }
  } catch (e) {
    log.error('Failed to record views', e);
  }
}

function scheduleFlush(): void {
  if (flushScheduled) return;
  flushScheduled = true;
  // Small delay to batch rapid view counts
  setTimeout(() => void flushPendingViews(), 50);
}

function countView(element: Element): void {
  if (countedItems.has(element)) return;
  countedItems.add(element);
  itemTimers.delete(element);

  pendingCount++;
  scheduleFlush();
}

function handleIntersection(entries: IntersectionObserverEntry[]): void {
  for (const entry of entries) {
    const el = entry.target;

    if (countedItems.has(el)) continue;

    if (entry.isIntersecting) {
      // Start timer if not already running
      if (!itemTimers.has(el)) {
        const timer = setTimeout(() => countView(el), VIEW_TIME_MS);
        itemTimers.set(el, timer);
      }
    } else {
      // Cancel timer if running
      const timer = itemTimers.get(el);
      if (timer) {
        clearTimeout(timer);
        itemTimers.delete(el);
      }
    }
  }
}

export function getCurrentQuotaStatus(): QuotaStatus | null {
  return currentStatus;
}

export function setCurrentQuotaStatus(status: QuotaStatus | null): void {
  currentStatus = status;
}

export function startObserver(platformName: string): void {
  stopObserver();
  currentPlatform = platformName;

  intersectionObserver = new IntersectionObserver(handleIntersection, {
    threshold: 0.1,
  });

  log.info('Observer started');
}

/**
 * Call this when new items have been added to the DOM.
 * This should be called by feed-overlay after rendering completes.
 */
export function observeNewItems(): void {
  if (!intersectionObserver) return;

  const overlay = document.getElementById('__cocoon_overlay');
  if (!overlay) return;

  const items = overlay.querySelectorAll('.cocoon-item');
  let newCount = 0;

  items.forEach(item => {
    // Skip already tracked items (use WeakSet check would be ideal but we need to track for observation)
    if (countedItems.has(item)) return;
    if (itemTimers.has(item)) return; // Already being observed

    // Check if already observed by seeing if it's in the observer's internal list
    // We can't easily check this, so we'll use a data attribute
    if ((item as HTMLElement).dataset.quotaTracked) return;
    (item as HTMLElement).dataset.quotaTracked = 'true';

    intersectionObserver!.observe(item);
    newCount++;
  });

  if (newCount > 0) {
    log.info(`Now tracking ${newCount} new item(s)`);
  }
}

export function stopObserver(): void {
  // Clear all timers
  for (const timer of itemTimers.values()) {
    clearTimeout(timer);
  }
  itemTimers.clear();

  // Flush any pending views
  if (pendingCount > 0) {
    void flushPendingViews();
  }

  if (intersectionObserver) {
    intersectionObserver.disconnect();
    intersectionObserver = null;
  }

  currentStatus = null;
  currentPlatform = '';
}
