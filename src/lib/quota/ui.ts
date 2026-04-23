/**
 * Quota UI components - blocker, limit reached message, approaching indicator.
 */

import { OVERLAY_ID } from '../constants';
import { stopInitialSkeletonReveal } from '../components/skeleton';
import type { QuotaStatus } from './index';

const APPROACHING_LIMIT_THRESHOLD = 10;
const QUOTA_WARNING_CLASS = 'cocoon-quota-warning-item';
let lastWarningStatus: { enabled: boolean; remaining: number } | null = null;
let warningRetryAttached = false;
let warningRetryRaf = 0;

function attachWarningRetryHandlers(): void {
  if (warningRetryAttached) return;
  warningRetryAttached = true;

  const schedule = () => {
    if (warningRetryRaf) return;
    warningRetryRaf = requestAnimationFrame(() => {
      warningRetryRaf = 0;

      if (!lastWarningStatus) return;
      const overlay = document.getElementById(OVERLAY_ID);
      if (!overlay) return;
      const feedContainer = overlay.querySelector('.cocoon-feed-container');
      if (!feedContainer) return;
      if (feedContainer.querySelector(`.${QUOTA_WARNING_CLASS}`)) return;

      upsertQuotaWarningInFeed(lastWarningStatus);
    });
  };

  document.addEventListener('scroll', schedule, { passive: true, capture: true });
  window.addEventListener('resize', schedule, { passive: true });
}

/**
 * Format time remaining for quota reset.
 */
function formatTimeRemaining(resetsAt: Date): string {
  const diff = resetsAt.getTime() - Date.now();
  if (diff <= 0) return 'soon';

  const hours = Math.floor(diff / (1000 * 60 * 60));
  const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

  if (hours > 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  }
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

/**
 * Show the quota exceeded blocker - full screen, no feed access.
 */
export function showQuotaBlocker(status: QuotaStatus): void {
  const overlay = document.getElementById(OVERLAY_ID);
  if (!overlay) return;

  stopInitialSkeletonReveal();
  overlay.classList.add('cocoon-content-mode');
  upsertQuotaWarningInFeed(null);

  const timeRemaining = formatTimeRemaining(status.resetsAt);

  let mainContent = overlay.querySelector('.cocoon-main-content');
  if (!mainContent) {
    mainContent = document.createElement('div');
    mainContent.className = 'cocoon-main-content';
    overlay.appendChild(mainContent);
  }

  mainContent.innerHTML = `
    <div class="cocoon-quota-blocker">
      <div class="cocoon-quota-blocker-content">
        <div class="cocoon-quota-title">That's your ${status.limit} for today</div>
        <div class="cocoon-quota-body">
          Your feed will be here tomorrow.
        </div>
        <button type="button" class="cocoon-quota-btn" data-action="close-tab">
          Close tab
        </button>
        <div class="cocoon-quota-reset">
          <span class="cocoon-quota-reset-dot"></span>
          Resets in ${timeRemaining}
        </div>
      </div>
    </div>
  `;

  const btn = mainContent.querySelector('[data-action="close-tab"]');
  btn?.addEventListener('click', () => window.close());

  document.body.style.overflow = 'hidden';
  injectStyles();
}

/**
 * Show the quota limit reached message at end of feed.
 */
export function showQuotaLimitReached(status: QuotaStatus): void {
  const overlay = document.getElementById(OVERLAY_ID);
  if (!overlay) return;

  const footer = overlay.querySelector('.cocoon-feed-footer');
  if (!footer) return;

  upsertQuotaWarningInFeed(null);

  const timeRemaining = formatTimeRemaining(status.resetsAt);

  footer.innerHTML = `
    <div class="cocoon-quota-end">
      <div class="cocoon-quota-end-title">That's your ${status.limit} for today</div>
      <div class="cocoon-quota-end-body">
        Your feed will be here tomorrow.
      </div>
      <button type="button" class="cocoon-quota-btn" data-action="close-tab">
        Close tab
      </button>
      <div class="cocoon-quota-reset">
        <span class="cocoon-quota-reset-dot"></span>
        Resets in ${timeRemaining}
      </div>
    </div>
  `;

  const btn = footer.querySelector('[data-action="close-tab"]');
  btn?.addEventListener('click', () => window.close());

  injectStyles();
}

/**
 * Get indicator inner HTML for a given remaining count.
 */
function getIndicatorInnerHtml(remaining: number): string {
  return `
    <div class="cocoon-quota-indicator-dot"></div>
    <span>${remaining} post${remaining === 1 ? '' : 's'} remaining today</span>
  `;
}

/**
 * Get the full indicator HTML for rendering inline in the feed.
 * Returns empty string if quota is disabled or not in the approaching range.
 */
export function getQuotaIndicatorHtml(status: { enabled: boolean; remaining: number } | null): string {
  if (!status?.enabled) return '';
  if (status.remaining <= 0 || status.remaining > APPROACHING_LIMIT_THRESHOLD) return '';

  return `<div class="cocoon-quota-indicator ${QUOTA_WARNING_CLASS}" data-cocoon-system="quota-warning" data-quota-exempt="true">${getIndicatorInnerHtml(status.remaining)}</div>`;
}

/**
 * Ensure the approaching-limit warning exists in the feed and is updated.
 * Inserts below the fold so it doesn't shift what the user is currently reading.
 */
export function upsertQuotaWarningInFeed(status: { enabled: boolean; remaining: number } | null): void {
  const overlay = document.getElementById(OVERLAY_ID);
  if (!overlay) return;

  const feedContainer = overlay.querySelector('.cocoon-feed-container');
  if (!feedContainer) return;

  const shouldShow = !!status?.enabled
    && status.remaining > 0
    && status.remaining <= APPROACHING_LIMIT_THRESHOLD;

  const existing = feedContainer.querySelector(`.${QUOTA_WARNING_CLASS}`) as HTMLElement | null;

  if (!shouldShow) {
    lastWarningStatus = null;
    existing?.remove();
    return;
  }

  lastWarningStatus = status;
  attachWarningRetryHandlers();

  const remaining = status.remaining;

  if (existing) {
    existing.innerHTML = getIndicatorInnerHtml(remaining);
    injectStyles();
    return;
  }

  const el = document.createElement('div');
  el.className = `cocoon-quota-indicator ${QUOTA_WARNING_CLASS}`;
  el.dataset.cocoonSystem = 'quota-warning';
  el.dataset.quotaExempt = 'true';
  el.innerHTML = getIndicatorInnerHtml(remaining);

  // Anchor insertion below the fold so it doesn't shift what the user is currently reading.
  const scrollContainer = (overlay.querySelector('.cocoon-main-content') as HTMLElement | null) || overlay;
  const viewport = scrollContainer.getBoundingClientRect();
  const candidates = Array.from(
    feedContainer.querySelectorAll('.cocoon-item:not(.cocoon-skeleton)')
  ) as HTMLElement[];

  const belowFold = candidates.filter(item => item.getBoundingClientRect().top >= viewport.bottom + 16);

  // Prefer an item that hasn't been counted as viewed yet (not brought into the fold long enough to count).
  const uncountedBelowFold = belowFold.find(item => !item.hasAttribute('data-quota-counted'));
  const anchor = uncountedBelowFold || belowFold[0] || null;

  if (!anchor || anchor.parentElement !== feedContainer) return;
  anchor.insertAdjacentElement('afterend', el);

  injectStyles();
}

/**
 * Backwards-compatible wrapper: update the warning based on remaining count.
 */
export function showApproachingLimitIndicator(remaining: number): void {
  upsertQuotaWarningInFeed({ enabled: true, remaining });
}

/**
 * Clear the warning from the feed.
 */
export function removeApproachingLimitIndicator(): void {
  upsertQuotaWarningInFeed(null);
}

/**
 * Inject quota-specific styles.
 */
function injectStyles(): void {
  if (document.getElementById('__cocoon_quota_styles')) return;

  const style = document.createElement('style');
  style.id = '__cocoon_quota_styles';
  style.textContent = `
    .cocoon-quota-blocker {
      display: flex;
      align-items: center;
      justify-content: center;
      min-height: 100%;
      padding: 40px 24px;
    }

    .cocoon-quota-blocker-content {
      background: var(--cocoon-surface);
      border: 1px solid var(--cocoon-border);
      border-radius: 20px;
      padding: 48px 40px 40px;
      max-width: 400px;
      width: 100%;
      text-align: center;
    }

    .cocoon-quota-title {
      font-size: 22px;
      font-weight: 600;
      color: var(--cocoon-text);
      margin-bottom: 12px;
      line-height: 1.3;
    }

    .cocoon-quota-body {
      font-size: 15px;
      line-height: 1.6;
      color: var(--cocoon-muted);
      margin-bottom: 28px;
    }

    .cocoon-quota-btn {
      appearance: none;
      background: var(--cocoon-accent);
      color: var(--cocoon-accent-fg);
      border: none;
      padding: 14px 28px;
      border-radius: 9999px;
      font-size: 15px;
      font-weight: 600;
      cursor: pointer;
      transition: transform 0.15s ease, opacity 0.15s ease;
      margin-bottom: 28px;
    }

    .cocoon-quota-btn:hover {
      opacity: 0.9;
    }

    .cocoon-quota-btn:active {
      transform: scale(0.98);
    }

    .cocoon-quota-reset {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      font-size: 13px;
      color: var(--cocoon-muted);
      opacity: 0.6;
    }

    .cocoon-quota-reset-dot {
      width: 5px;
      height: 5px;
      background: currentColor;
      border-radius: 50%;
    }

    .cocoon-quota-end {
      text-align: center;
      padding: 40px 32px 32px;
      margin-top: 16px;
      background: var(--cocoon-surface);
      border: 1px solid var(--cocoon-border);
      border-radius: 20px;
    }

    .cocoon-quota-end-title {
      font-size: 18px;
      font-weight: 600;
      color: var(--cocoon-text);
      margin-bottom: 10px;
      line-height: 1.3;
    }

    .cocoon-quota-end-body {
      font-size: 14px;
      line-height: 1.6;
      color: var(--cocoon-muted);
      margin-bottom: 24px;
    }

    .cocoon-quota-end .cocoon-quota-btn {
      margin-bottom: 24px;
    }

    .cocoon-quota-indicator {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      padding: 14px 16px;
      margin: 8px 0;
      background: color-mix(in srgb, var(--cocoon-accent) 8%, var(--cocoon-surface));
      border: 1px solid color-mix(in srgb, var(--cocoon-accent) 20%, var(--cocoon-border));
      border-radius: 12px;
      font-size: 13px;
      font-weight: 500;
      color: var(--cocoon-accent);
    }

    .cocoon-quota-indicator-dot {
      width: 6px;
      height: 6px;
      background: var(--cocoon-accent);
      border-radius: 50%;
      animation: cocoon-quota-pulse 2s ease-in-out infinite;
    }

    @keyframes cocoon-quota-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }
  `;
  document.head.appendChild(style);
}
