/**
 * Twitter/X initialization provider.
 * Handles render settings, theme detection, early hiding, and video players.
 */

import { createLogger } from '../../logger';
import { setupVideoPlayer, getVideoPlayerHtml } from '../../video-player';
import { TWITTER_VARIANT_CACHE_KEY } from '../../constants';
import { waitForCondition } from '../../wait';
import type { PlatformInitProvider, ThemeInfo } from '../types';
import type { ShowMetrics } from '../../settings';

const log = createLogger('TwitterInit');

// ============================================================================
// RENDER SETTINGS
// ============================================================================

// Render settings cache (loaded once per page, changes require refresh)
let renderSettings = {
  alwaysExpandTweets: false,
  showMetrics: { likes: true, retweets: true, views: false } as ShowMetrics,
  autoUnmuteAfterInteraction: false,
};

/**
 * Get current render settings.
 */
export function getRenderSettings() {
  return renderSettings;
}

/**
 * Initialize render settings from storage.
 */
async function initRenderSettings(): Promise<void> {
  try {
    const data = await browser.storage.sync.get(['alwaysExpandTweets', 'showMetrics', 'autoUnmuteAfterInteraction']);
    renderSettings = {
      alwaysExpandTweets: !!data.alwaysExpandTweets,
      showMetrics: (data.showMetrics as ShowMetrics) || { likes: true, retweets: true, views: false },
      autoUnmuteAfterInteraction: !!data.autoUnmuteAfterInteraction,
    };
    log.debug('Render settings loaded', renderSettings);
  } catch (e) {
    log.warn('Failed to load render settings, using defaults', e);
  }
}

// ============================================================================
// THEME DETECTION
// ============================================================================

type TwitterVariant = 'lights-out' | 'dim' | 'default';

/**
 * Detect Twitter's current theme variant.
 */
function detectTwitterTheme(): TwitterVariant {
  const bg = getComputedStyle(document.body).backgroundColor || '';
  const rgb = bg.match(/\d+/g)?.map(Number);
  if (!rgb || rgb.length < 3) return 'lights-out';

  const [r, g, b] = rgb;
  const brightness = (r + g + b) / 3;

  if (brightness > 200) return 'default';
  if (brightness > 30) return 'dim';
  return 'lights-out';
}

/**
 * Detect current theme from Twitter's UI.
 */
function detectTheme(): ThemeInfo | null {
  const variant = detectTwitterTheme();
  return {
    variant,
    mode: variant === 'default' ? 'light' : 'dark',
  };
}

/**
 * Refresh theme cache for fast subsequent loads.
 */
function refreshThemeCache(): void {
  try {
    const variant = detectTwitterTheme();
    localStorage.setItem(TWITTER_VARIANT_CACHE_KEY, JSON.stringify({ v: 1, variant, ts: Date.now() }));
  } catch {
    // ignore
  }
}

// ============================================================================
// EARLY HIDE STYLES
// ============================================================================

/**
 * Get CSS for early page hiding.
 * Hides "What's happening" and "Who to follow" sidebar widgets.
 */
function getEarlyHideStyles(): string {
  return `
    /* Hide the card container that wraps "Who to follow" */
    div:has(> div > aside[aria-label="Who to follow"]) { display: none !important; }
    /* Hide the card container that wraps "What's happening" / trending */
    div:has(> section [aria-label="Timeline: Trending now"]) { display: none !important; }
    /* Fallback: hide the inner elements too */
    aside[aria-label="Who to follow"],
    [aria-label="Timeline: Trending now"],
    [data-testid="trend"],
    [data-testid="UserCell"] { display: none !important; }
  `;
}

// ============================================================================
// FEED READINESS
// ============================================================================

/**
 * Wait for Twitter's feed to be ready before processing.
 */
async function waitForFeedReady(url: string, signal: AbortSignal): Promise<void> {
  let path: string | null = null;
  try {
    path = new URL(url).pathname;
  } catch {
    return;
  }

  // For home feed, wait for tab bar to appear
  if (path === '/' || path === '/home') {
    const ok = await waitForCondition(() => {
      const tabs = Array.from(document.querySelectorAll('[role="tab"]')) as HTMLElement[];
      const texts = tabs.map(t => (t.textContent || '').trim().toLowerCase());
      const hasForYou = texts.some(t => t.includes('for you') || t.includes('for-you'));
      const hasFollowing = texts.some(t => t.includes('following'));
      return hasForYou && hasFollowing;
    }, { timeoutMs: 15_000, pollIntervalMs: 150, signal });

    if (!ok && !signal.aborted) {
      throw new Error('Timed out waiting for Twitter Home tabs');
    }
  }
}

// ============================================================================
// VIDEO PLAYERS
// ============================================================================

// Video preloading state
let upgradeObserver: IntersectionObserver | null = null;
let hlsModule: any = null;

const prefetchState = new Map<string, {
  url: string | null;
  urlPromise: Promise<string | null> | null;
}>();

// Cache for video URLs
const videoUrlCache = new Map<string, string | null>();

/**
 * Extract status ID from a tweet URL path.
 */
export function extractStatusId(urlPath: string | undefined): string | undefined {
  if (!urlPath) return undefined;
  const match = urlPath.match(/\/status\/(\d+)/);
  return match ? match[1] : undefined;
}

/**
 * Fetch HLS video URL via background script (avoids CORS).
 */
export async function fetchVideoUrl(statusId: string): Promise<string | null> {
  if (videoUrlCache.has(statusId)) {
    return videoUrlCache.get(statusId) || null;
  }

  try {
    const response = await browser.runtime.sendMessage({
      type: 'FETCH_VIDEO_URL',
      payload: { statusId },
    }) as { result?: { url?: string } } | undefined;

    const url = response?.result?.url || null;
    videoUrlCache.set(statusId, url);
    return url;
  } catch {
    videoUrlCache.set(statusId, null);
    return null;
  }
}

function prefetchVideoUrl(statusId: string): void {
  if (prefetchState.has(statusId)) return;

  const state = { url: null as string | null, urlPromise: null as Promise<string | null> | null };
  prefetchState.set(statusId, state);

  state.urlPromise = fetchVideoUrl(statusId).then(url => {
    state.url = url;
    state.urlPromise = null;
    return url;
  });
}

async function getPrefetchedVideoUrl(statusId: string): Promise<string | null> {
  const state = prefetchState.get(statusId);
  if (!state) {
    return fetchVideoUrl(statusId);
  }
  if (state.url !== null) return state.url;
  if (state.urlPromise) return state.urlPromise;
  return null;
}

async function upgradeToVideoPlayer(container: HTMLElement): Promise<void> {
  if (container.dataset.upgraded === 'true') return;

  const wrapper = container.closest('.cocoon-item') as HTMLElement;
  if (!wrapper) {
    log.debug('Video upgrade skipped: no parent .cocoon-item');
    return;
  }

  const statusId = wrapper.dataset.statusId;
  if (!statusId) {
    log.debug('Video upgrade skipped: no status ID');
    return;
  }

  container.dataset.upgraded = 'true';

  const videoUrl = await getPrefetchedVideoUrl(statusId);
  if (!videoUrl) {
    log.warn(`Video ${statusId}: no URL found`);
    return;
  }

  const img = container.querySelector('img') as HTMLImageElement;
  const posterUrl = img?.src || '';

  container.innerHTML = getVideoPlayerHtml(posterUrl);
  container.classList.remove('cocoon-has-video');
  container.classList.add('cocoon-video-player-container');
  container.dataset.mode = 'initial';
  container.dataset.muted = 'true';
  container.dataset.playing = 'false';

  const video = container.querySelector('video') as HTMLVideoElement;
  setupVideoPlayer(video, videoUrl, hlsModule!, { autoUnmuteAfterInteraction: renderSettings.autoUnmuteAfterInteraction });
  log.debug(`Video ${statusId}: ready`);
}

/**
 * Initialize video players for rendered content.
 */
async function initializeVideoPlayers(): Promise<void> {
  const videoContainers = document.querySelectorAll('.cocoon-video-player, .cocoon-has-video');
  log.debug(`Initializing video players: ${videoContainers.length} containers found`);
  if (videoContainers.length === 0) return;

  if (!hlsModule) {
    hlsModule = (await import('hls.js')).default;
  }

  // Prefetch video URLs for all video items
  for (const container of videoContainers) {
    if (!container.classList.contains('cocoon-has-video')) continue;
    const wrapper = container.closest('.cocoon-item') as HTMLElement;
    const statusId = wrapper?.dataset.statusId;
    if (statusId) {
      prefetchVideoUrl(statusId);
    }
  }

  // Set up upgrade observer
  if (!upgradeObserver) {
    upgradeObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const container = entry.target as HTMLElement;
            upgradeObserver?.unobserve(container);
            upgradeToVideoPlayer(container);
          }
        }
      },
      { rootMargin: '1200px' }
    );
  }

  for (const container of videoContainers) {
    if (container.classList.contains('cocoon-video-player')) {
      const video = container as HTMLVideoElement;
      if (video.dataset.initialized === 'true') continue;

      let videoUrl: string | undefined = video.dataset.videoUrl;

      if (!videoUrl && video.dataset.statusId) {
        const fetchedUrl = await fetchVideoUrl(video.dataset.statusId);
        if (fetchedUrl) {
          videoUrl = fetchedUrl;
          video.dataset.videoUrl = fetchedUrl;
        }
      }

      if (!videoUrl) continue;

      video.dataset.initialized = 'true';
      setupVideoPlayer(video, videoUrl, hlsModule, { autoUnmuteAfterInteraction: renderSettings.autoUnmuteAfterInteraction });
      continue;
    }

    if (container.classList.contains('cocoon-has-video')) {
      if ((container as HTMLElement).dataset.upgraded !== 'true') {
        upgradeObserver.observe(container);
      }
    }
  }
}

/**
 * Twitter initialization provider.
 */
export const twitterInit: PlatformInitProvider = {
  initRenderSettings,
  detectTheme,
  refreshThemeCache,
  getEarlyHideStyles,
  waitForFeedReady,
  initializeVideoPlayers,
};
