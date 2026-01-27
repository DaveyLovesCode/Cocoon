/**
 * Cocoon Content Script
 * Runs after hide-immediate.js to handle filtering logic.
 * Note: hide-immediate.js runs before this to prevent flash.
 */

// Import overlay CSS - gets bundled and injected with content script
import '@/styles/overlay.css';

import { DOMSegmenter, setCosmeticSelectors, type BlockMetadata, type SegmentResult } from '@/lib/segmenter';
import { buildFeedPrompt, parseFilterResponse, type UserProfile } from '@/lib/prompt';
import { WELLNESS_DEFAULTS } from '@/lib/defaults';
import { createLogger } from '@/lib/logger';
import { waitForDomReady } from '@/lib/content-ready';
import {
  renderContent,
  renderFeedItems,
  attachOverlayHandlers,
  injectStyles,
  initOverlayShell,
  updateStatus,
  removeOverlay,
  startScrollObserver,
  setLoadingMore,
  setFeedComplete,
  appendFeedItems,
  getFeedItemCount,
  blocksToFeedItems,
  renderNavInOverlay,
  type FeedItem,
} from '@/lib/feed-overlay';
import { checkQuota } from '@/lib/quota';
import { showQuotaBlocker, showQuotaLimitReached } from '@/lib/quota/ui';
import {
  startObserver as startQuotaObserver,
  stopObserver as stopQuotaObserver,
  observeNewItems as observeNewQuotaItems,
  getCurrentQuotaStatus,
  setCurrentQuotaStatus,
} from '@/lib/quota/observer';
import { getPlatformForUrl, type Platform, type FeedContext } from '@/lib/platforms';
import { ALL_MATCH_PATTERNS } from '@/lib/sites';
import { sleep, waitForCondition } from '@/lib/wait';
import { initializeContentTheme, onThemeChange, applyTheme, getTwitterColors, type ThemeColors } from '@/lib/theme';
import { OVERLAY_ID, READY_ATTR, CONTENT_STYLES_ID, FEED_CACHE_TTL_MS } from '@/lib/constants';
import {
  getFeedCacheKey,
  isBackForwardNavigation,
  captureThemeSnapshot,
  captureOverlayHtml,
  getNavCache,
  getCurrentUsername,
} from '@/lib/cache';
import type { EnabledFeedContexts } from '@/lib/settings';

// Infinite scroll constants
const INCREMENTAL_SCAN_SCREENS = 5;
const INCREMENTAL_BOTTOM_WAIT_MS = 3000;

/** Check if overlay is enabled for the given URL based on settings */
async function isOverlayEnabledForUrl(url: string, platform: Platform): Promise<boolean> {
  const context = platform.context.getFeedContext(url);
  if (!context) return true; // Unknown context - let it through
  if (context === 'home') return true;

  const { enabledFeedContexts, disableProfileFeed } = await browser.storage.sync.get([
    'enabledFeedContexts',
    'disableProfileFeed', // Legacy fallback
  ]);

  // Use new settings if available
  if (enabledFeedContexts) {
    const contexts = enabledFeedContexts as EnabledFeedContexts;
    return contexts[context] !== false;
  }

  // Legacy fallback: only profile could be disabled
  if (context === 'profile' && disableProfileFeed) {
    return false;
  }

  return true;
}

// Infinite scroll state (module-level to persist across function calls)
type InfiniteScrollState = {
  segmenter: DOMSegmenter;
  platform: Platform;
  userProfile: UserProfile;
  seenSignatures: Set<string>;
  lastScrollY: number;
  hasMore: boolean;
  isLoading: boolean;
  allFeedItems: FeedItem[];
  url: string;
  consecutiveEmptyLoads: number;
  scrollContainer: Element | null;
  signal: AbortSignal;
};
let infiniteScrollState: InfiniteScrollState | null = null;
const MAX_CONSECUTIVE_EMPTY_LOADS = 3;

// Theme state
let themeListenerActive = false;

let activeRunController: AbortController | null = null;
function cancelActiveRun(): void {
  if (!activeRunController) return;
  try {
    activeRunController.abort();
  } catch {
    // ignore
  }
  activeRunController = null;
}

function startNewRun(): AbortSignal {
  cancelActiveRun();
  activeRunController = new AbortController();
  return activeRunController.signal;
}

// Platform-specific: only show native Following feed when user explicitly toggles it.
let nativeFollowingEnabled = false;

function setupContentTheme(platformName: string): void {
  void initializeContentTheme(platformName);
  if (!themeListenerActive) {
    themeListenerActive = true;
    onThemeChange(applyTheme, { platform: platformName, isContentScript: true });
  }
}

/**
 * Load more content for infinite scroll.
 */
async function loadMore(): Promise<void> {
  if (!infiniteScrollState || infiniteScrollState.isLoading || !infiniteScrollState.hasMore) {
    return;
  }

  // Check quota before loading more
  try {
    const quotaStatus = await checkQuota();
    if (quotaStatus.enabled && !quotaStatus.allowed) {
      log.info('Quota exhausted - stopping infinite scroll');
      showQuotaLimitReached(quotaStatus);
      infiniteScrollState.hasMore = false;
      return;
    }
    setCurrentQuotaStatus(quotaStatus);
  } catch (e) {
    log.warn('Failed to check quota', e);
  }

  const state = infiniteScrollState;
  if (state.signal.aborted) return;
  state.isLoading = true;
  setLoadingMore(true);

  try {
    log.info(`Loading more: lastScrollY=${state.lastScrollY}, signatures=${state.seenSignatures.size}`);

    // Temporarily unlock body scroll so we can scroll the native feed
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = '';

    // Segment more content
    const result = await state.segmenter.segmentIncremental({
      maxScreens: INCREMENTAL_SCAN_SCREENS,
      startY: state.lastScrollY,
      existingSignatures: state.seenSignatures,
      keepScrollPosition: true,
      bottomWaitMs: INCREMENTAL_BOTTOM_WAIT_MS,
      settleMs: 500,
      scrollContainer: state.scrollContainer,
      signal: state.signal,
    });

    // Restore body scroll lock
    document.body.style.overflow = prevOverflow;

    // Update state
    state.lastScrollY = result.endScrollY;
    state.hasMore = result.hasMore;
    for (const sig of result.signatures) {
      state.seenSignatures.add(sig);
    }

    const newBlocks = result.blocks;
    const newFeedBlocks = newBlocks.filter(b => b.isFeedItem);
    log.info(`Captured ${newBlocks.length} blocks, ${newFeedBlocks.length} feed items`);

    if (newFeedBlocks.length === 0) {
      state.consecutiveEmptyLoads++;
      log.info(`No new feed items found (${state.consecutiveEmptyLoads}/${MAX_CONSECUTIVE_EMPTY_LOADS} empty loads)`);

      if (!result.hasMore || state.consecutiveEmptyLoads >= MAX_CONSECUTIVE_EMPTY_LOADS) {
        state.hasMore = false;
        setFeedComplete();
        log.info('Feed marked complete after consecutive empty loads');
      } else {
        setLoadingMore(false);
      }
      state.isLoading = false;
      return;
    }

    // Reset consecutive empty counter on successful load
    state.consecutiveEmptyLoads = 0;

    // Pre-filter blocks by keywords before AI sees them
    const blockedKeywords = state.userProfile.blockedKeywords || [];
    let filteredBlocks = newBlocks;
    if (blockedKeywords.length > 0) {
      const beforeCount = newBlocks.filter(b => b.isFeedItem).length;
      filteredBlocks = newBlocks.filter(block => {
        if (!block.isFeedItem) return true;
        const text = (block.text || block.primaryText || '').toLowerCase();
        return !blockedKeywords.some(kw => text.includes(kw.toLowerCase()));
      });
      const afterCount = filteredBlocks.filter(b => b.isFeedItem).length;
      if (beforeCount !== afterCount) {
        log.info(`Keyword filter: ${beforeCount - afterCount} posts blocked by keywords`);
      }
    }

    // Build prompt for new items
    const searchQuery = state.platform.adapter.getSearchQuery?.(state.url);
    const { system, user } = buildFeedPrompt(filteredBlocks, state.url, state.userProfile, searchQuery);
    log.info(`Incremental prompt: system=${system.length}, user=${user.length} chars`);

    // Call LLM
    const LLM_TIMEOUT = 30000;
    let response: { result?: string; error?: string } | undefined;
    try {
      response = await Promise.race([
        browser.runtime.sendMessage({
          type: 'FILTER_REQUEST',
          payload: { system, user, url: state.url }
        }) as Promise<{ result?: string; error?: string }>,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('LLM request timeout')), LLM_TIMEOUT)
        )
      ]);
      if (state.signal.aborted) return;
    } catch (e) {
      throw new Error(`LLM call failed: ${e instanceof Error ? e.message : String(e)}`);
    }

    if (!response || response.error) {
      throw new Error(response?.error || 'LLM returned undefined response');
    }

    const filterIds = parseFilterResponse(response.result || '');
    const hideIdSet = new Set(filterIds);

    // Convert to feed items (using filtered blocks)
    let newFeedItems = blocksToFeedItems(filteredBlocks, hideIdSet);
    log.info(`Keeping ${newFeedItems.length} of ${newFeedBlocks.length} new items`);

    // Truncate to quota remaining if needed
    const currentQuota = getCurrentQuotaStatus();
    let quotaExhausted = false;
    if (currentQuota?.enabled && currentQuota.remaining >= 0) {
      if (newFeedItems.length > currentQuota.remaining) {
        log.info(`Truncating ${newFeedItems.length} items to quota remaining: ${currentQuota.remaining}`);
        newFeedItems = newFeedItems.slice(0, currentQuota.remaining);
        quotaExhausted = true;
        state.hasMore = false;
      }
    }

    // Track stats for incremental load
    const incrementalKept = newFeedItems.length;
    const incrementalHidden = newFeedBlocks.length - newFeedItems.length;

    if (newFeedItems.length > 0) {
      const startIndex = state.allFeedItems.length;
      state.allFeedItems.push(...newFeedItems);

      // Append to overlay
      appendFeedItems(newFeedItems, startIndex);

      // Observe new items for quota tracking
      observeNewQuotaItems();

      // Update cache
      setCache(state.url, state.allFeedItems, state.platform.name);
    }

    // Report incremental stats
    try {
      const domain = new URL(state.url).hostname;
      browser.runtime.sendMessage({
        type: 'STATS_UPDATE',
        payload: { domain, elementsHidden: 0, postsKept: incrementalKept, postsHidden: incrementalHidden }
      });
    } catch (e) {
      log.warn('Failed to report incremental stats', e);
    }

    // Show appropriate end state
    if (quotaExhausted && currentQuota) {
      showQuotaLimitReached(currentQuota);
    } else if (!result.hasMore) {
      setFeedComplete();
    } else {
      setLoadingMore(false);
    }
  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    if (state.signal.aborted || errMsg === 'COCOON_ABORT') return;
    log.error(`Load more error: ${errMsg}`);
    // Restore body scroll lock on error
    document.body.style.overflow = 'hidden';
    setLoadingMore(false);
  } finally {
    state.isLoading = false;
  }
}

// Feed cache type for content.ts - extends base with feedItems
type FeedCache = {
  timestamp: number;
  feedItems: FeedItem[];
  platformName: string;
  renderedHtml?: string;
  renderedCss?: string;
  theme?: { mode: 'light' | 'dark'; colors: ThemeColors };
};

function getCache(url: string): FeedCache | null {
  try {
    const key = getFeedCacheKey(url);
    const data = sessionStorage.getItem(key);
    if (!data) return null;

    const cache = JSON.parse(data) as FeedCache;
    if (Date.now() - cache.timestamp > FEED_CACHE_TTL_MS) {
      sessionStorage.removeItem(key);
      return null;
    }
    return cache;
  } catch {
    return null;
  }
}

function setCache(url: string, feedItems: FeedItem[], platformName: string): void {
  try {
    const key = getFeedCacheKey(url);
    const overlayData = captureOverlayHtml();
    if (!overlayData) return;

    const cache: FeedCache = {
      timestamp: Date.now(),
      feedItems,
      platformName,
      renderedHtml: overlayData.html,
      renderedCss: overlayData.css,
      theme: captureThemeSnapshot(),
    };
    sessionStorage.setItem(key, JSON.stringify(cache));
  } catch {
    // Ignore storage errors (quota exceeded, etc.)
  }
}

const log = createLogger('Content');

// Track current URL to detect navigation (lazy-initialized in setupNavigationListener)
let currentUrl = '';
let isProcessing = false;
let navigationSeq = 0;
// Cleanup function for native tab watcher (when showing native feed)
let tabWatcherCleanup: (() => void) | null = null;

/**
 * Clean up state when navigating away from a feed page or re-initializing.
 */
function cleanup(): void {
  log.info('[NAV-CLEANUP] Starting cleanup');

  // Reset infinite scroll state
  const hadScrollState = infiniteScrollState !== null;
  infiniteScrollState = null;
  log.info(`[NAV-CLEANUP] Cleared infinite scroll state (had state: ${hadScrollState})`);

  // Clean up quota observer
  stopQuotaObserver();

  // Remove overlay
  const overlay = document.getElementById(OVERLAY_ID);
  if (overlay) {
    overlay.remove();
    log.info('[NAV-CLEANUP] Removed overlay');
  } else {
    log.info('[NAV-CLEANUP] No overlay to remove');
  }

  // Remove content styles
  const styles = document.getElementById(CONTENT_STYLES_ID);
  if (styles) {
    styles.remove();
    log.info('[NAV-CLEANUP] Removed content styles');
  }

  // Restore body scroll
  document.body.style.overflow = '';
  log.info('[NAV-CLEANUP] Restored body scroll');

  // Remove loading class
  document.documentElement.classList.remove('cocoon-loading');

  // Clean up tab watcher if active
  if (tabWatcherCleanup) {
    tabWatcherCleanup();
    tabWatcherCleanup = null;
  }

  log.info('[NAV-CLEANUP] Cleanup complete');
}

/**
 * Handle SPA navigation - called when URL changes without page reload.
 */
async function handleNavigation(rawNewUrl: string): Promise<void> {
  return handleNavigationWithOptions(rawNewUrl);
}

async function handleNavigationWithOptions(
  rawNewUrl: string,
  options: { force?: boolean; reason?: string } = {}
): Promise<void> {
  const seq = ++navigationSeq;
  const platform = getPlatformForUrl(rawNewUrl);
  const newUrl = platform ? platform.context.normalizeUrl(rawNewUrl) : rawNewUrl;
  const force = options.force === true;

  log.info(`[NAV-HANDLE] handleNavigation called with: ${rawNewUrl}${newUrl !== rawNewUrl ? ` (normalized to ${newUrl})` : ''}`);
  log.info(`[NAV-HANDLE] currentUrl is: ${currentUrl}`);
  log.info(`[NAV-HANDLE] isProcessing: ${isProcessing}`);

  // Skip if URL unchanged (after normalization)
  if (!force && newUrl === currentUrl) {
    log.info('[NAV-HANDLE] URL unchanged, skipping');
    return;
  }

  const previousUrl = currentUrl;
  currentUrl = newUrl;

  log.info(`[NAV-HANDLE] SPA navigation: "${previousUrl}" → "${newUrl}"`);

  const previousPlatform = getPlatformForUrl(previousUrl);
  const wasFeedPage = !!previousPlatform;
  const isFeedPage = !!platform;

  log.info(`[NAV-HANDLE] Previous platform: ${previousPlatform?.name || 'none'} (isFeed: ${wasFeedPage})`);
  log.info(`[NAV-HANDLE] New platform: ${platform?.name || 'none'} (isFeed: ${isFeedPage})`);

  if (!isFeedPage || !platform) {
    log.info('[NAV-HANDLE] New URL is NOT a feed page');
    if (wasFeedPage) {
      cancelActiveRun();
      log.info('[NAV-HANDLE] Was on feed, now leaving - cleaning up');
      cleanup();
      markReady();
      log.info('[NAV-HANDLE] Cleanup done, native content should be visible');
    } else {
      log.info('[NAV-HANDLE] Was not on feed either, nothing to do');
    }
    return;
  }

  // Check if navigating to own profile - show raw feed
  const currentUsername = getCurrentUsername();
  if (platform.context.isOwnProfileUrl(newUrl, currentUsername)) {
    log.info('[NAV-HANDLE] Own profile - showing raw feed');
    cancelActiveRun();
    if (wasFeedPage) cleanup();
    markReady();
    platform.navigation?.checkPendingCompose();
    return;
  }

  // Check if overlay is disabled for this feed context
  const overlayEnabled = await isOverlayEnabledForUrl(newUrl, platform);
  if (seq !== navigationSeq) return;
  if (!overlayEnabled) {
    log.info('[NAV-HANDLE] Overlay disabled for this feed context - showing raw feed');
    cancelActiveRun();
    if (wasFeedPage) cleanup();
    markReady();
    return;
  }

  log.info('[NAV-HANDLE] New URL IS a feed page');

  if (platform.context.getFeedContext(newUrl) === 'home') {
    nativeFollowingEnabled = false;
  }

  // Navigating to a feed page - re-initialize
  log.info('[NAV-HANDLE] Navigating to feed page, starting re-initialization');

  const signal = startNewRun();

  // Clean up previous state
  log.info('[NAV-HANDLE] Calling cleanup()');
  cleanup();

  // Apply theme immediately to avoid flash
  log.info('[NAV-HANDLE] Applying theme early');
  const themeInfo = platform.init?.detectTheme();
  if (themeInfo) {
    const colors = getTwitterColors(); // TODO: Make this platform-generic
    applyTheme(colors);
  }
  setupContentTheme(platform.name);

  // Hide page immediately to prevent flash
  log.info('[NAV-HANDLE] Adding cocoon-loading class');
  document.documentElement.classList.add('cocoon-loading');

  // Show loading overlay
  log.info('[NAV-HANDLE] Calling showOverlay()');
  showOverlay();

  // Populate nav from cache immediately
  log.info('[NAV-HANDLE] Loading nav from cache');
  const cachedNav = getNavCache(platform.name);
  if (cachedNav && cachedNav.length > 0) {
    log.info(`[NAV-HANDLE] Rendering ${cachedNav.length} cached nav items`);
    renderNavInOverlay(cachedNav, platform);
  } else {
    log.info('[NAV-HANDLE] No cached nav available');
  }

  // Re-initialize with new URL
  log.info('[NAV-HANDLE] Setting isProcessing = true, calling init()');
  isProcessing = true;
  try {
    await init(newUrl, { signal });
    if (seq !== navigationSeq) return;
    log.info('[NAV-HANDLE] init() completed successfully');
  } catch (error) {
    if (signal.aborted || (error instanceof Error && error.message === 'COCOON_ABORT')) return;
    log.error('[NAV-HANDLE] init() threw error:', error);
  } finally {
    isProcessing = false;
    log.info('[NAV-HANDLE] isProcessing = false');
  }
}

/**
 * Handle feed switcher tab change (For You / Following).
 * - For You: Show Cocoon's curated feed
 * - Following: Show native chronological feed (no curation)
 */
async function handleFeedSwitch(tabId: string): Promise<void> {
  log.info(`[FEED-SWITCH] Handling switch to: ${tabId}`);

  const url = window.location.href;
  const platform = getPlatformForUrl(url);

  if (!platform) {
    log.info('[FEED-SWITCH] Not on a feed page, ignoring');
    return;
  }

  // Following tab: remove overlay and show native feed
  if (tabId === 'following') {
    log.info('[FEED-SWITCH] Switching to Following - removing overlay');
    cancelActiveRun();
    nativeFollowingEnabled = true;
    cleanup();
    document.documentElement.classList.remove('cocoon-loading');
    document.body.style.overflow = '';
    markReady();

    // Watch for clicks on native "For You" tab to switch back
    if (platform.navigation) {
      const nav = platform.navigation;
      setTimeout(() => {
        if (nav.getActiveFeedTab() !== null) {
          tabWatcherCleanup = nav.watchFeedTabChange((newTabId) => {
            if (newTabId === 'forYou') {
              log.info('[FEED-SWITCH] For You tab became active - showing loading overlay');
              // Show blocking overlay to hide raw feed
              if (!document.getElementById('__cocoon_tab_switch_blocker')) {
                const blocker = document.createElement('div');
                blocker.id = '__cocoon_tab_switch_blocker';
                blocker.style.cssText = `
                  position: fixed;
                  inset: 0;
                  z-index: 999999;
                  background: var(--cocoon-bg, #000);
                  display: flex;
                  align-items: center;
                  justify-content: center;
                `;
                blocker.innerHTML = `
                  <div style="width: 48px; height: 48px; border: 3px solid rgba(255,255,255,0.1); border-top-color: rgba(255,255,255,0.4); border-radius: 50%; animation: cocoon-blocker-spin 1s linear infinite;"></div>
                  <style>@keyframes cocoon-blocker-spin { to { transform: rotate(360deg); } }</style>
                `;
                document.body.appendChild(blocker);
              }
              // Reload page to reinitialize
              setTimeout(() => {
                window.location.reload();
              }, 300);
            }
          });
        }
      }, 200);
    }

    return;
  }

  // Clean up tab watcher if switching back to For You
  if (tabWatcherCleanup) {
    tabWatcherCleanup();
    tabWatcherCleanup = null;
  }

  nativeFollowingEnabled = false;

  // For You tab: show Cocoon's curated feed
  const overlayEnabled = await isOverlayEnabledForUrl(url, platform);
  if (!overlayEnabled) {
    log.info('[FEED-SWITCH] Overlay disabled for home context - showing raw feed');
    cancelActiveRun();
    cleanup();
    markReady();
    return;
  }

  const signal = startNewRun();

  // Clean up current state
  log.info('[FEED-SWITCH] Cleaning up current state');
  cleanup();

  // Apply theme immediately
  const themeInfo = platform.init?.detectTheme();
  if (themeInfo) {
    const colors = getTwitterColors();
    applyTheme(colors);
  }
  setupContentTheme(platform.name);

  // Hide page and show loading
  document.documentElement.classList.add('cocoon-loading');
  showOverlay();

  // Inject platform styles early
  injectStyles(platform);

  // Load nav from cache
  const cachedNav = getNavCache(platform.name);
  if (cachedNav && cachedNav.length > 0) {
    renderNavInOverlay(cachedNav, platform);
  }

  // Wait for native feed to load new content after tab switch
  log.info('[FEED-SWITCH] Waiting for feed to load new content...');
  await sleep(300);
  if (signal.aborted) return;

  // Wait until platform has rendered enough items in the new tab
  const minItems = platform.adapter.getMinExpectedFeedItems?.(url) ?? 3;
  const waitStart = Date.now();
  const maxWait = 10000;

  while (Date.now() - waitStart < maxWait) {
    if (signal.aborted) return;
    const count = platform.adapter.getRenderedFeedItemCount?.() ?? 0;
    if (count >= minItems) {
      log.info(`[FEED-SWITCH] Feed rendered ${count} items, proceeding`);
      break;
    }
    await sleep(200);
  }

  // Extra settle time for DOM to stabilize
  await sleep(400);
  if (signal.aborted) return;

  // Re-initialize feed processing
  log.info('[FEED-SWITCH] Re-initializing feed');
  isProcessing = true;
  try {
    await init(url, { signal });
  } catch (error) {
    if (signal.aborted || (error instanceof Error && error.message === 'COCOON_ABORT')) return;
    log.error('[FEED-SWITCH] init() error:', error);
  } finally {
    isProcessing = false;
  }
}

/**
 * Set up SPA navigation detection.
 */
function setupNavigationListener(): void {
  log.info('[NAV-SETUP] setupNavigationListener called');

  // Initialize current URL tracking
  const platform = getPlatformForUrl(window.location.href);
  currentUrl = platform ? platform.context.normalizeUrl(window.location.href) : window.location.href;
  log.info(`[NAV-SETUP] Initial currentUrl set to: ${currentUrl}`);

  // Check if already set up
  if (document.documentElement.hasAttribute('data-cocoon-nav-listener')) {
    log.info('[NAV-SETUP] Already set up, skipping');
    return;
  }
  document.documentElement.setAttribute('data-cocoon-nav-listener', 'true');

  // Listen for custom navigation events from nav-hook.content.ts
  log.info('[NAV-SETUP] Adding cocoon-navigation event listener');
  window.addEventListener('cocoon-navigation', ((event: CustomEvent<{ url: string; type: string }>) => {
    const { url, type } = event.detail;
    log.info(`[NAV-HOOK] cocoon-navigation event received: type=${type}, url=${url}`);
    void handleNavigation(url);
  }) as EventListener);

  // Listen for popstate (back/forward navigation)
  log.info('[NAV-SETUP] Adding popstate listener');
  window.addEventListener('popstate', () => {
    const url = window.location.href;
    log.info(`[NAV-HOOK] popstate fired, URL: ${url}`);
    void handleNavigation(url);
  });

  // Listen for feed switcher events
  log.info('[NAV-SETUP] Adding cocoon:feedswitch listener');
  window.addEventListener('cocoon:feedswitch', ((event: CustomEvent<{ tab: string }>) => {
    const { tab } = event.detail;
    log.info(`[FEED-SWITCH] Received feed switch event: ${tab}`);
    void handleFeedSwitch(tab);
  }) as EventListener);

  // Capture nav clicks that may not trigger history events
  document.addEventListener('click', (e: MouseEvent) => {
    try {
      if (e.defaultPrevented) return;
      if (e.button !== 0) return;
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;

      const target = e.target;
      if (!(target instanceof Element)) return;
      if (target.closest(`#${OVERLAY_ID}`)) return;

      const platform = getPlatformForUrl(window.location.href);
      if (!platform?.navigation) return;

      const testIdEl = target.closest('[data-testid]') as HTMLElement | null;
      const testId = testIdEl?.getAttribute('data-testid') || '';
      const anchor = target.closest('a[href]') as HTMLAnchorElement | null;
      const href = anchor?.getAttribute('href') || '';
      const ariaLabel = anchor?.getAttribute('aria-label') || '';

      // Platform-agnostic home detection
      const isHomeTestId = testId.includes('Home_Link') || testId.includes('AppTabBar_Home');
      const isLikelyLogo =
        ariaLabel.trim().toLowerCase() === 'x' ||
        ariaLabel.trim().toLowerCase() === 'twitter' ||
        testId.includes('Logo') ||
        testId.includes('X_Link') ||
        testId.includes('TopNav');
      const isHomeHref = href === '/home' || href === '/' || href.startsWith('/home?') || href.startsWith('/?');

      const isLogoTarget = isLikelyLogo && (isHomeHref || !anchor);
      if (!isHomeTestId && !isLogoTarget) return;

      const homeUrl = new URL('/home', window.location.origin).href;
      const currentNormalized = platform.context.normalizeUrl(window.location.href);
      const homeNormalized = platform.context.normalizeUrl(homeUrl);

      // If navigating to /home from a different page, let the platform handle it
      if (currentNormalized !== homeNormalized) return;

      // If user is on native Following mode, switch to For You first
      if (nativeFollowingEnabled && platform.navigation) {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation?.();
        const clicked = platform.navigation.activateFeedTab('forYou');
        if (clicked) {
          setTimeout(() => {
            window.dispatchEvent(new CustomEvent('cocoon:feedswitch', { detail: { tab: 'forYou' } }));
          }, 150);
          return;
        }
      }

      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation?.();

      void handleNavigationWithOptions(homeUrl, { force: true, reason: 'home-click' });
    } catch {
      // ignore
    }
  }, true);

  log.info('[NAV-SETUP] Navigation listener installation complete');
}

/**
 * Refresh nav cache in background once platform's nav becomes available.
 */
async function refreshNavCacheWhenReady(platform: Platform): Promise<void> {
  if (!platform.navigation) return;

  const maxWait = 30_000;
  const pollInterval = 500;
  const start = Date.now();

  while (Date.now() - start < maxWait) {
    const navItems = platform.navigation.extractNavItems();
    if (navItems.length > 0) {
      renderNavInOverlay(navItems, platform);
      log.debug(`Refreshed nav cache with ${navItems.length} items`);
      return;
    }
    await sleep(pollInterval);
  }
  log.debug('Nav cache refresh timed out - nav not found');
}

export default defineContentScript({
  matches: ALL_MATCH_PATTERNS,
  runAt: 'document_end',
  async main() {
    const rawUrl = window.location.href;
    const platform = getPlatformForUrl(rawUrl);
    const url = platform ? platform.context.normalizeUrl(rawUrl) : rawUrl;

    if (url !== rawUrl) {
      log.info(`[MAIN] Normalized URL: ${rawUrl} -> ${url}`);
    }
    log.info(`[MAIN] Content script main() called, URL: ${url}`);

    // Set up SPA navigation detection
    log.info('[MAIN] About to call setupNavigationListener()');
    setupNavigationListener();
    log.info('[MAIN] setupNavigationListener() returned');

    // Listen for debug capture requests from popup (dev only)
    if (import.meta.env.MODE === 'development') {
      browser.runtime.onMessage.addListener((rawMessage: unknown, _sender, sendResponse) => {
        const message = rawMessage as { type?: string };
        if (message.type === 'DEBUG_CAPTURE') {
          captureDebugData()
            .then(data => sendResponse({ data }))
            .catch(e => sendResponse({ data: `DEBUG_CAPTURE error: ${e instanceof Error ? e.message : String(e)}` }));
          return true;
        }
        return true;
      });
    }

    const signal = startNewRun();
    await init(url, { signal });
  }
});

async function init(url: string, options: { signal: AbortSignal }) {
  const { signal } = options;
  if (signal.aborted) return;

  // Check if hide-immediate.js already restored FEED content from cache
  const overlay = document.getElementById('__cocoon_overlay');
  const hasCachedFeed = overlay?.querySelector('.cocoon-feed-container .cocoon-item:not(.cocoon-skeleton)');
  if (hasCachedFeed) {
    log.info('Feed cache already restored by hide-immediate.js, skipping');
    const platform = getPlatformForUrl(url);
    if (platform) {
      injectStyles(platform);
      setupContentTheme(platform.name);
      if (overlay) attachOverlayHandlers(overlay);
      platform.init?.initializeVideoPlayers().catch(() => {});
      document.body.style.overflow = 'hidden';
      refreshNavCacheWhenReady(platform);
      platform.init?.refreshThemeCache();
    }
    return;
  }

  // Check settings for fresh processing
  let settings = await browser.storage.sync.get(['whitelist', 'userProfile', 'apiKey']);
  if (signal.aborted) return;

  // Only process supported feed platforms
  const platform = getPlatformForUrl(url);
  if (!platform) {
    log.debug('Not a supported feed site, skipping');
    revealInstant();
    return;
  }

  // Initialize render settings for the platform
  if (platform.init) {
    await platform.init.initRenderSettings();
    if (signal.aborted) return;
  }

  // Skip overlay for user's own profile
  const currentUsername = getCurrentUsername();
  if (platform.context.isOwnProfileUrl(url, currentUsername)) {
    log.info('Own profile - showing raw feed');
    revealInstant();
    platform.navigation?.checkPendingCompose();
    return;
  }

  // Skip overlay if disabled for this feed context
  const overlayEnabled = await isOverlayEnabledForUrl(url, platform);
  if (signal.aborted) return;
  if (!overlayEnabled) {
    log.info('Overlay disabled for this feed context - showing raw feed');
    revealInstant();
    return;
  }

  // Check whitelist
  const whitelist: string[] = Array.isArray(settings.whitelist) ? settings.whitelist : [];
  try {
    const hostname = new URL(url).hostname;
    if (whitelist.some(domain => hostname === domain || hostname.endsWith('.' + domain))) {
      log.debug('Whitelisted domain', hostname);
      revealInstant();
      return;
    }
  } catch {
    revealInstant();
    return;
  }

  // Require an API key when filtering is enabled
  if (!settings.apiKey) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      await sleep(200 * attempt);
      if (signal.aborted) return;
      settings = await browser.storage.sync.get(['whitelist', 'userProfile', 'apiKey']);
      if (signal.aborted) return;
      if (settings.apiKey) break;
    }
  }
  if (!settings.apiKey) {
    log.info('No API key configured - showing setup prompt');
    showBlockingError('Missing API key', 'Set your API key in the Cocoon extension settings to enable filtering.', true);
    return;
  }

  // Check quota before processing feed
  try {
    const quotaStatus = await checkQuota();
    if (signal.aborted) return;
    setCurrentQuotaStatus(quotaStatus);

    if (quotaStatus.enabled && !quotaStatus.allowed) {
      log.info('Quota exhausted - showing blocker');
      showOverlay();
      injectStyles(platform);
      setupContentTheme(platform.name);
      showQuotaBlocker(quotaStatus);
      return;
    }
  } catch (e) {
    log.warn('Failed to check quota', e);
  }

  // Fallback: check cache for back/forward navigation
  if (isBackForwardNavigation()) {
    const cache = getCache(url);
    if (cache && cache.platformName === platform.name) {
      const age = Math.round((Date.now() - cache.timestamp) / 1000);
      log.info(`Restoring ${cache.feedItems.length} cached items (${age}s old)`);
      if (!document.getElementById(OVERLAY_ID)) showOverlay();
      renderFeedItems(cache.feedItems, platform);
      setupContentTheme(platform.name);
      // Set up viewport observer for quota tracking on cached feed
      startQuotaObserver(platform.name);
      observeNewQuotaItems();
      refreshNavCacheWhenReady(platform);
      platform.init?.refreshThemeCache();
      return;
    }
  }

  // Show loading overlay for fresh processing
  showOverlay();

  const storedProfile = settings.userProfile as Partial<UserProfile> | undefined;
  const userProfile: UserProfile = {
    interests: Array.isArray(storedProfile?.interests) && storedProfile.interests.length > 0
      ? storedProfile.interests
      : WELLNESS_DEFAULTS.interests,
    hardBlocks: Array.isArray(storedProfile?.hardBlocks) && storedProfile.hardBlocks.length > 0
      ? storedProfile.hardBlocks
      : WELLNESS_DEFAULTS.hardBlocks,
  };

  log.info('Intercepting page', url);

  // Hide the page immediately
  document.documentElement.classList.add('cocoon-loading');

  // Wait for DOM to be interactive first
  await waitForDomReady();
  if (signal.aborted) return;

  const processStart = Date.now();
  let segmentDuration = 0;
  let llmDuration = 0;

  try {
    // Wait for platform-specific feed readiness
    if (platform.init) {
      updateStatus('Waiting for feed');
      await platform.init.waitForFeedReady(url, signal);
      if (signal.aborted) return;
    }

    // Check if user toggled to native Following mode
    const feedContext = platform.context.getFeedContext(url);
    if (feedContext === 'home' && nativeFollowingEnabled && platform.navigation) {
      log.info('Following tab active - showing native feed');
      revealInstant();
      if (platform.navigation.getActiveFeedTab() !== null) {
        tabWatcherCleanup = platform.navigation.watchFeedTabChange((tabId) => {
          if (tabId === 'forYou') {
            window.location.reload();
          }
        });
      }
      return;
    }

    // Wait for platform content to appear
    log.info('Waiting for feed content to appear...');
    updateStatus('Waiting for feed');
    await waitForPlatformContent(platform, url, signal);
    if (signal.aborted) return;
    log.info(`Detected feed site: ${platform.name}, using overlay mode`);

    // Request cosmetic filters from service worker
    log.info('Loading cosmetic filters...');
    const filterStart = Date.now();
    try {
      const response = await browser.runtime.sendMessage({
        type: 'COSMETIC_FILTERS',
        payload: { url }
      }) as { styles?: string; selectors?: string[] } | undefined;
      if (signal.aborted) return;

      if (response?.styles) {
        const styleEl = document.createElement('style');
        styleEl.id = '__cocoon_cosmetic';
        styleEl.textContent = response.styles;
        (document.head || document.documentElement).appendChild(styleEl);
        log.info(`Injected ${response.styles.length} chars of cosmetic CSS`);
      }

      if (response?.selectors?.length && response.selectors.length > 0) {
        setCosmeticSelectors(response.selectors);
        log.info(`Cosmetic filters loaded in ${Date.now() - filterStart}ms (${response.selectors.length} selectors)`);
      }
    } catch (e) {
      log.warn('Failed to load cosmetic filters', e);
    }

    // Segment the DOM
    log.info('Segmenting DOM...');
    updateStatus('Scanning feed');
    const segmentStart = Date.now();
    const segmenter = new DOMSegmenter();
    const initialScreens = platform.context.getInitialScanScreens(url);
    const segmentResult = await segmentWithRetries(segmenter, platform, url, initialScreens, undefined, undefined, signal);
    if (signal.aborted) return;
    const blocks = segmentResult.blocks;
    segmentDuration = Date.now() - segmentStart;

    // Calculate block stats
    const totalBlocks = countBlocks(blocks);
    const totalTextLen = sumTextLength(blocks);

    log.info(`Segmented: ${blocks.length} top-level, ${totalBlocks} total, ${totalTextLen} chars in ${segmentDuration}ms`);

    // Pre-filter blocks by keywords before AI sees them
    const blockedKeywords = userProfile.blockedKeywords || [];
    let filteredBlocks = blocks;
    if (blockedKeywords.length > 0) {
      const beforeCount = blocks.filter(b => b.isFeedItem).length;
      filteredBlocks = blocks.filter(block => {
        if (!block.isFeedItem) return true;
        const text = (block.text || block.primaryText || '').toLowerCase();
        return !blockedKeywords.some(kw => text.includes(kw.toLowerCase()));
      });
      const afterCount = filteredBlocks.filter(b => b.isFeedItem).length;
      if (beforeCount !== afterCount) {
        log.info(`Keyword filter: ${beforeCount - afterCount} posts blocked by keywords`);
      }
    }

    // If no content captured, show friendly empty state
    const feedBlocks = filteredBlocks.filter(b => b.isFeedItem);
    if (feedBlocks.length === 0) {
      log.info('No feed items captured, showing filtering message');
      injectStyles(platform);
      initOverlayShell(platform);
      if (platform.navigation) {
        const navItems = platform.navigation.extractNavItems();
        renderNavInOverlay(navItems, platform);
      }
      setupContentTheme(platform.name);
      platform.init?.refreshThemeCache();
      setFeedComplete();
      return;
    }

    // Build prompt
    const searchQuery = platform.adapter.getSearchQuery?.(url);
    const { system, user } = buildFeedPrompt(filteredBlocks, url, userProfile, searchQuery);
    if (signal.aborted) return;

    log.info(`Prompt sizes: system=${system.length} chars, user=${user.length} chars`);
    log.debug('System prompt', system);
    log.debug('User prompt', user.length > 50000 ? user.substring(0, 50000) + `\n... (truncated ${user.length - 50000} chars)` : user);

    // Call LLM via service worker
    log.info('Calling LLM...');
    const llmStart = Date.now();
    updateStatus('Curating content');

    let response: { result?: string; error?: string } | undefined;
    try {
      const LLM_TIMEOUT = 30000;
      response = await Promise.race([
        browser.runtime.sendMessage({
          type: 'FILTER_REQUEST',
          payload: { system, user, url }
        }) as Promise<{ result?: string; error?: string }>,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('LLM request timeout')), LLM_TIMEOUT)
        )
      ]);
      if (signal.aborted) return;
    } catch (e) {
      const errMsg = e instanceof Error ? e.message : String(e);
      log.error(`LLM call failed: ${errMsg}`);
      throw new Error(`LLM call failed: ${errMsg}`);
    }

    llmDuration = Date.now() - llmStart;
    log.info(`LLM call completed in ${llmDuration}ms`);

    if (!response) {
      log.error('LLM returned undefined response');
      throw new Error('LLM returned undefined response');
    }

    if (response.error) {
      log.error('LLM error', response.error);
      throw new Error(`LLM error: ${response.error}`);
    }

    const result = response.result || '';
    log.info(`LLM response (${llmDuration}ms): ${result}`);

    // Parse and apply filter
    const filterIds = parseFilterResponse(result);
    const hideIdSet = new Set(filterIds);
    let hiddenCount = filterIds.length;

    // Render kept items in the overlay
    const keptBlocks = feedBlocks.filter(b => !hideIdSet.has(b.id));
    let postsKept = keptBlocks.length;
    const postsHidden = feedBlocks.length - keptBlocks.length;
    log.info(`${postsHidden} hidden, ${postsKept} kept feed items`);

    // Summary log
    const summary = keptBlocks.map(b => {
      const text = (b.text || b.primaryText || '').replace(/\s+/g, ' ');
      return `[${b.id}] ${text}`;
    }).join('\n\n');
    log.debug('=== KEPT ITEMS (what user sees) ===\n' + summary);

    // Check quota and truncate initial items if needed
    const initialQuotaStatus = getCurrentQuotaStatus();
    let initialQuotaExhausted = false;
    if (initialQuotaStatus?.enabled && initialQuotaStatus.remaining >= 0 && postsKept > initialQuotaStatus.remaining) {
      log.info(`Truncating initial ${postsKept} items to quota remaining: ${initialQuotaStatus.remaining}`);
      // Add extra IDs to hideIdSet to truncate
      const idsToHide = keptBlocks.slice(initialQuotaStatus.remaining).map(b => b.id);
      idsToHide.forEach(id => hideIdSet.add(id));
      postsKept = initialQuotaStatus.remaining;
      initialQuotaExhausted = true;
    }

    const feedItems = renderContent(filteredBlocks, hideIdSet, platform);
    setupContentTheme(platform.name);
    platform.init?.refreshThemeCache();

    // Extract and render nav in overlay
    if (platform.navigation) {
      const navItems = platform.navigation.extractNavItems();
      if (navItems.length > 0) {
        renderNavInOverlay(navItems, platform);
      }
    }

    // Cache for back button restoration
    setCache(url, feedItems, platform.name);

    // Set up infinite scroll state
    infiniteScrollState = {
      segmenter,
      platform,
      userProfile,
      seenSignatures: segmentResult.signatures,
      lastScrollY: segmentResult.endScrollY,
      hasMore: segmentResult.hasMore,
      isLoading: false,
      allFeedItems: feedItems,
      url,
      consecutiveEmptyLoads: 0,
      scrollContainer: segmentResult.scrollContainer,
      signal,
    };
    log.info(`Cached scroll container: ${segmentResult.scrollContainer?.tagName || 'null'}, endScrollY: ${segmentResult.endScrollY}`);

    // Set up viewport observer for quota tracking
    startQuotaObserver(platform.name);
    observeNewQuotaItems();

    // Start scroll observer for infinite loading (unless quota exhausted)
    if (initialQuotaExhausted && initialQuotaStatus) {
      showQuotaLimitReached(initialQuotaStatus);
      log.info('Quota exhausted on initial load');
    } else if (segmentResult.hasMore && postsKept > 0) {
      startScrollObserver(loadMore);
      log.info('Infinite scroll enabled');
    } else {
      setFeedComplete();
      log.info(`Feed complete (${postsKept} posts kept)`);
    }

    // Report stats to service worker
    try {
      const domain = new URL(url).hostname;
      browser.runtime.sendMessage({
        type: 'STATS_UPDATE',
        payload: { domain, elementsHidden: hiddenCount, postsKept, postsHidden }
      });
    } catch (e) {
      log.warn('Failed to report stats', e);
    }

    // Final timing summary
    const totalDuration = Date.now() - processStart;
    log.info(`=== COMPLETE === Total: ${totalDuration}ms | Segment: ${segmentDuration}ms | LLM: ${llmDuration}ms`);

  } catch (error) {
    const errMsg = error instanceof Error ? error.message : String(error);
    if (signal.aborted || errMsg === 'COCOON_ABORT') return;
    const errStack = error instanceof Error ? error.stack : '';
    log.error(`Error: ${errMsg}`, errStack);

    // Handle specific error types with user-friendly messaging
    if (errMsg.includes('API_KEY_MISSING')) {
      showBlockingError('API key needed', 'Add your OpenRouter API key in settings to start filtering.', 'settings');
    } else if (errMsg.includes('API_KEY_DECRYPT_FAILED')) {
      showBlockingError('API key needs to be re-entered', 'Your saved key couldn\'t be read. Please re-enter it in settings.', 'settings');
    } else if (errMsg.includes('API key not recognized')) {
      showBlockingError('API key not recognized', 'Double-check your OpenRouter key in settings.', 'settings');
    } else if (errMsg.includes('Out of credits')) {
      showBlockingError('Out of credits', 'Add funds to your OpenRouter account to continue filtering.', 'credits');
    } else if (errMsg.includes('Spending limit reached')) {
      showBlockingError('Spending limit reached', 'Increase your limit in OpenRouter settings to continue.', 'spending');
    } else if (errMsg.includes('Rate limit') || errMsg.includes('429')) {
      showBlockingError('Too many requests', 'Give it a few seconds and refresh. This happens when there\'s a lot of traffic.', 'retry');
    } else if (errMsg.includes('Service temporarily unavailable') || errMsg.includes('Connection failed') || errMsg.includes('timeout')) {
      showBlockingError('Couldn\'t reach the AI service', 'The service might be busy or your connection dropped. Try refreshing in a moment.', 'retry');
    } else if (errMsg.includes('Home tabs')) {
      try {
        const key = 'cocoon_home_tabs_reload_ts';
        const prev = sessionStorage.getItem(key);
        const prevTs = prev ? parseInt(prev, 10) : 0;
        if (!prevTs || (Date.now() - prevTs) > 30_000) {
          sessionStorage.setItem(key, String(Date.now()));
          window.location.reload();
          return;
        }
      } catch {
        // ignore
      }
      showBlockingError('Feed still loading', 'Cocoon couldn\'t detect the Home feed UI. Try refreshing.', 'retry');
    } else {
      showBlockingError('Something went wrong', 'Cocoon ran into an issue. Try refreshing the page.', 'retry');
    }
  }
}

function countBlocks(blocks: BlockMetadata[]): number {
  let count = 0;
  const countRecursive = (list: BlockMetadata[]) => {
    for (const block of list) {
      count++;
      if (block.children.length > 0) {
        countRecursive(block.children);
      }
    }
  };
  countRecursive(blocks);
  return count;
}

function sumTextLength(blocks: BlockMetadata[]): number {
  let sum = 0;
  const sumRecursive = (list: BlockMetadata[]) => {
    for (const block of list) {
      sum += block.text.length;
      if (block.children.length > 0) {
        sumRecursive(block.children);
      }
    }
  };
  sumRecursive(blocks);
  return sum;
}

function showOverlay() {
  let overlay = document.getElementById(OVERLAY_ID);
  if (overlay) {
    if (document.body && overlay.parentElement !== document.body) {
      document.body.insertBefore(overlay, document.body.firstChild);
    }
    initOverlayShell();
    return;
  }

  overlay = document.createElement('div');
  overlay.id = OVERLAY_ID;

  if (document.body) {
    document.body.insertBefore(overlay, document.body.firstChild);
  } else {
    document.documentElement.appendChild(overlay);
  }

  initOverlayShell();
}

type ErrorAction = 'settings' | 'credits' | 'spending' | 'retry';

function showBlockingError(title: string, message: string, action: ErrorAction | boolean = 'retry'): void {
  showOverlay();
  const overlay = document.getElementById(OVERLAY_ID) as HTMLElement | null;
  if (!overlay) return;

  overlay.classList.remove('cocoon-content-mode', 'fading-out');

  const mainContent = overlay.querySelector('.cocoon-main-content');
  if (!mainContent) {
    overlay.innerHTML = '';
    const brandEl = document.createElement('div');
    brandEl.className = 'cocoon-brand';
    brandEl.textContent = 'Cocoon';
    overlay.append(brandEl);
  }

  const errorContent = document.createElement('div');
  errorContent.className = 'flex flex-col items-center justify-center h-full min-h-[400px] text-center px-5';

  const titleEl = document.createElement('div');
  titleEl.className = 'cocoon-error-title text-sm font-semibold text-cocoon-text';
  titleEl.textContent = title;

  const msgEl = document.createElement('div');
  msgEl.className = 'cocoon-error-message mt-2.5 max-w-[560px] text-[13px] leading-relaxed text-cocoon-muted whitespace-pre-wrap';
  msgEl.textContent = message.length > 500 ? message.slice(0, 500) + '…' : message;

  const actions = document.createElement('div');
  actions.className = 'cocoon-actions flex gap-3 mt-4';

  const actionType: ErrorAction = action === true ? 'settings' : (action === false ? 'retry' : action);

  const primaryBtnClass = 'cocoon-btn appearance-none border border-cocoon-accent bg-cocoon-accent text-cocoon-accent-fg px-3.5 py-2.5 rounded-[10px] text-[13px] font-medium cursor-pointer hover:opacity-90 transition-opacity';
  const secondaryBtnClass = 'cocoon-btn appearance-none border border-cocoon-border bg-cocoon-surface text-cocoon-text px-3.5 py-2.5 rounded-[10px] text-[13px] font-medium cursor-pointer hover:bg-cocoon-elevated transition-colors';

  if (actionType === 'settings') {
    const settingsBtn = document.createElement('button');
    settingsBtn.type = 'button';
    settingsBtn.className = primaryBtnClass;
    settingsBtn.textContent = 'Open Settings';
    settingsBtn.onclick = () => {
      browser.runtime.sendMessage({ type: 'OPEN_OPTIONS', payload: { highlight: 'api' } })
        .catch((e) => log.error('Failed to open settings:', e));
    };
    actions.append(settingsBtn);
  } else if (actionType === 'credits') {
    const creditsBtn = document.createElement('a');
    creditsBtn.href = 'https://openrouter.ai/credits';
    creditsBtn.target = '_blank';
    creditsBtn.rel = 'noopener';
    creditsBtn.className = primaryBtnClass;
    creditsBtn.textContent = 'Add Credits';
    actions.append(creditsBtn);

    const retryBtn = document.createElement('button');
    retryBtn.type = 'button';
    retryBtn.className = secondaryBtnClass;
    retryBtn.textContent = 'Refresh';
    retryBtn.addEventListener('click', () => window.location.reload());
    actions.append(retryBtn);
  } else if (actionType === 'spending') {
    const limitBtn = document.createElement('a');
    limitBtn.href = 'https://openrouter.ai/settings/limits';
    limitBtn.target = '_blank';
    limitBtn.rel = 'noopener';
    limitBtn.className = primaryBtnClass;
    limitBtn.textContent = 'Update Limit';
    actions.append(limitBtn);

    const retryBtn = document.createElement('button');
    retryBtn.type = 'button';
    retryBtn.className = secondaryBtnClass;
    retryBtn.textContent = 'Refresh';
    retryBtn.addEventListener('click', () => window.location.reload());
    actions.append(retryBtn);
  } else {
    const retryBtn = document.createElement('button');
    retryBtn.type = 'button';
    retryBtn.className = primaryBtnClass;
    retryBtn.textContent = 'Refresh';
    retryBtn.addEventListener('click', () => window.location.reload());
    actions.append(retryBtn);
  }

  errorContent.append(titleEl, msgEl, actions);

  if (mainContent) {
    mainContent.innerHTML = '';
    mainContent.appendChild(errorContent);
  } else {
    overlay.appendChild(errorContent);
  }
}

function revealInstant() {
  const overlay = document.getElementById(OVERLAY_ID);
  if (overlay) overlay.remove();

  document.documentElement.classList.remove('cocoon-loading');
  markReady();
}

function markReady() {
  const html = document.documentElement;

  html.setAttribute(READY_ATTR, 'true');

  const prevVisibility = html.getAttribute('data-cocoon-prev-visibility');
  if (prevVisibility !== null) {
    if (html.style.getPropertyValue('visibility') === 'hidden') {
      if (prevVisibility) html.style.visibility = prevVisibility;
      else html.style.removeProperty('visibility');
    }
    html.removeAttribute('data-cocoon-prev-visibility');
  } else {
    html.style.removeProperty('visibility');
  }
}

async function waitForPlatformContent(platform: Platform, url: string, signal?: AbortSignal): Promise<void> {
  if (!platform.adapter.getRenderedFeedItemCount) return;

  const minItems = platform.adapter.getMinExpectedFeedItems?.(url) ?? 1;
  const timeoutMs = 120_000;
  const ok = await waitForCondition(() => platform.adapter.getRenderedFeedItemCount!() >= minItems, { timeoutMs, signal });

  if (!ok) {
    if (signal?.aborted) throw new Error('COCOON_ABORT');
    throw new Error(`Timed out waiting for ${platform.name} to render (${minItems}+ items)`);
  }
}

async function segmentWithRetries(
  segmenter: DOMSegmenter,
  platform: Platform,
  url: string,
  maxScreens: number,
  startY?: number,
  existingSignatures?: Set<string>,
  signal?: AbortSignal
): Promise<SegmentResult> {
  const minFeedItems = platform.adapter.getMinExpectedFeedItems?.(url) ?? 1;
  const maxAttempts = 3;
  const settleMsByAttempt = [300, 600, 1200];
  const bottomWaitMsByAttempt = [3000, 2000, 1500];

  let lastResult: SegmentResult = { blocks: [], endScrollY: 0, hasMore: true, signatures: new Set(), scrollContainer: null };
  let lastFeedItemCount = 0;
  let lastRenderedCount = platform.adapter.getRenderedFeedItemCount?.() ?? 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (signal?.aborted) throw new Error('COCOON_ABORT');
    const settleMs = settleMsByAttempt[Math.min(attempt - 1, settleMsByAttempt.length - 1)];
    const bottomWaitMs = bottomWaitMsByAttempt[Math.min(attempt - 1, bottomWaitMsByAttempt.length - 1)];
    const result = await segmenter.segmentIncremental({
      settleMs,
      maxScreens,
      startY,
      existingSignatures,
      keepScrollPosition: true,
      bottomWaitMs,
      signal,
    });
    lastResult = result;

    lastFeedItemCount = result.blocks.filter(b => b.isFeedItem).length;
    log.info(`Segmentation attempt ${attempt}/${maxAttempts}: ${result.blocks.length} blocks, ${lastFeedItemCount} feed items`);

    if (lastFeedItemCount >= minFeedItems) return result;
    if (attempt >= maxAttempts) break;

    // Wait for more content to render before retrying
    if (platform.adapter.getRenderedFeedItemCount) {
      const target = Math.max(minFeedItems, lastRenderedCount + 1);
      const ok = await waitForCondition(() => platform.adapter.getRenderedFeedItemCount!() >= target, { timeoutMs: 30_000, signal });
      if (!ok && signal?.aborted) throw new Error('COCOON_ABORT');
      lastRenderedCount = platform.adapter.getRenderedFeedItemCount();
    } else {
      await sleep(500 + attempt * 250);
    }
    await sleep(250 + attempt * 150);
  }

  log.info(`Returning ${lastFeedItemCount} feed items (wanted ${minFeedItems})`);
  return lastResult;
}

async function captureDebugData(): Promise<string> {
  const url = window.location.href;
  const parts: string[] = [];

  parts.push(`URL: ${url}`);
  parts.push(`Time: ${new Date().toISOString()}`);
  parts.push('');

  parts.push('=== DOM Stats ===');
  parts.push(`Total elements: ${document.querySelectorAll('*').length}`);

  const semanticCounts: Record<string, number> = {};
  ['article', 'section', 'aside', 'nav', 'main', 'header', 'footer'].forEach(tag => {
    const count = document.querySelectorAll(tag).length;
    if (count > 0) semanticCounts[tag] = count;
  });
  parts.push(`Semantic elements: ${Object.entries(semanticCounts).map(([k, v]) => `${k}:${v}`).join(', ') || 'none'}`);

  return parts.join('\n');
}
