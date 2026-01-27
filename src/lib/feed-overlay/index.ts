/**
 * Feed overlay system - unified overlay that evolves from loading to content.
 * Uses the existing #__cocoon_overlay created by hide-immediate.js.
 * Platform-agnostic: delegates item rendering to platform adapters.
 */

import type { BlockMetadata } from '../segmenter';
import type { Platform, FeedItem, NavItem } from '../platforms';
import { createLogger } from '../logger';
import { openLightbox, getLightboxStyles } from '../image-lightbox';
import { createShimmerText } from '../components/shimmer-text';
import { getShellHeaderHtml } from '../components/shell-header';
import {
  getSkeletonItemHtml,
  startInitialSkeletonReveal,
  stopInitialSkeletonReveal,
  getSkeletonCount,
} from '../components/skeleton';
import { escapeAttr } from '../utils/escape';
import {
  OVERLAY_ID,
  SHELL_SPACING,
  SHELL_TOP_INSET,
  SKELETON_HEIGHT,
  MORPH_STAGGER_MS,
  MORPH_DURATION_MS,
} from '../constants';
import {
  getNavCache,
  setNavCache,
  getCurrentUsername,
  getCachedComposeSvg,
} from '../cache';
import { observeNewItems as notifyQuotaObserver, getCurrentQuotaStatus } from '../quota/observer';
import { getQuotaIndicatorHtml } from '../quota/ui';

// Re-export FeedItem for caching
export type { FeedItem } from '../platforms';
// Re-export NavItem for external use
export type { NavItem } from '../platforms';
// Re-export nav cache functions
export { getNavCache, setNavCache, getCachedComposeSvg };
// Re-export skeleton functions
export { getSkeletonCount };

const log = createLogger('FeedOverlay');

// ============================================================================
// STATE
// ============================================================================

// Scroll observation state
let scrollObserverCallback: (() => void) | null = null;
let isLoadingMore = false;
let currentPlatform: Platform | null = null;

// Max fade opacity (0-1)
const FADE_MAX_OPACITY = 1;
// Scroll distance to reach full fade
const FADE_SCROLL_DISTANCE = 60;

// ============================================================================
// FEED CONTEXT MESSAGES
// ============================================================================

type FeedContext = 'home' | 'search' | 'profile' | 'status';

/**
 * Determine feed context from current URL.
 */
function getFeedContext(): FeedContext {
  if (!currentPlatform) return 'home';
  return currentPlatform.context.getFeedContext(window.location.href) || 'home';
}

/**
 * Get empty state content for when no posts are found.
 */
function getEmptyStateHtml(): string {
  const context = getFeedContext();
  const algoName = currentPlatform?.adapter.algorithmName || 'the algorithm';

  let title: string;
  let body: string;

  switch (context) {
    case 'search':
      title = 'All search results were filtered out';
      body = 'Search results are filtered by your interests too. To see content like this, add it to your interests in settings.';
      break;
    case 'home':
    default:
      title = 'Nothing matches your interests';
      body = `Your filters might be too strict, or ${algoName} needs more time to learn what you like. Try refreshing—new content appears frequently.`;
      break;
  }

  return `
    <div class="cocoon-empty-state">
      <div class="cocoon-empty-title">${title}</div>
      <div class="cocoon-empty-body">${body}</div>
    </div>
  `;
}

/**
 * Get end-of-feed message for when user scrolls to the bottom.
 */
function getEndOfFeedMessage(): string | null {
  const context = getFeedContext();

  switch (context) {
    case 'search':
      return null;
    case 'home':
    default:
      const algoName = currentPlatform?.adapter.algorithmName || 'the algorithm';
      return `That's all for now. Keep engaging and ${algoName} will adapt.`;
  }
}

// ============================================================================
// NAVIGATION
// ============================================================================

/**
 * Render nav items as a vertical sidebar in the overlay.
 */
export function renderNavInOverlay(items: NavItem[], platform: Platform): void {
  const overlay = document.getElementById(OVERLAY_ID);
  if (!overlay) return;

  // Find existing sidebar
  let sidebar = overlay.querySelector('.cocoon-sidebar-nav') as HTMLElement | null;
  if (!sidebar) {
    sidebar = document.createElement('aside');
    sidebar.className = 'cocoon-sidebar-nav cocoon-sidebar-hidden';
    overlay.insertBefore(sidebar, overlay.firstChild);
  }

  // Get or create nav element inside sidebar
  let nav = sidebar.querySelector('nav');
  if (!nav) {
    nav = document.createElement('nav');
    sidebar.appendChild(nav);
  }

  // Clear existing nav items
  nav.innerHTML = '';

  // X logo SVG for home
  const xLogoSvg = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>';

  // Render each item as an icon link
  items.forEach(item => {
    const link = document.createElement('a');
    link.href = item.href;
    link.className = 'cocoon-nav-link';
    link.title = item.label;
    link.setAttribute('data-nav-id', item.id);

    const iconWrapper = document.createElement('span');
    iconWrapper.className = 'cocoon-nav-icon';
    iconWrapper.innerHTML = item.id === 'home' ? xLogoSvg : item.svg;

    link.appendChild(iconWrapper);
    nav.appendChild(link);
  });

  // Get compose icon
  const extractedComposeIcon = platform.navigation?.extractComposeIcon() || null;
  const cachedComposeIcon = getCachedComposeSvg();
  const composeIcon = extractedComposeIcon || cachedComposeIcon;

  // Add compose button after nav
  let composeBtn = sidebar.querySelector('.cocoon-compose-btn') as HTMLButtonElement | null;
  if (!composeBtn) {
    composeBtn = document.createElement('button');
    composeBtn.type = 'button';
    composeBtn.className = 'cocoon-compose-btn';
    composeBtn.title = 'Post';
    composeBtn.setAttribute('aria-label', 'Compose new post');
    sidebar.appendChild(composeBtn);
  }

  // Update icon if we have one
  if (composeIcon && !composeBtn.hasAttribute('data-icon-set')) {
    composeBtn.innerHTML = composeIcon;
    composeBtn.setAttribute('data-icon-set', 'true');
  }

  // Attach click handler
  if (!composeBtn.hasAttribute('data-compose-attached') && platform.navigation) {
    const nav = platform.navigation;
    composeBtn.addEventListener('click', (e) => {
      nav.handleComposeClick(e, getCurrentUsername());
    });
    composeBtn.setAttribute('data-compose-attached', 'true');
  }

  // Show sidebar now that it has content
  sidebar.classList.remove('cocoon-sidebar-hidden');

  // Save to cache
  if (items.length > 0) {
    setNavCache(platform.name, items, extractedComposeIcon || cachedComposeIcon || undefined);
    log.debug(`Cached ${items.length} nav items for ${platform.name}`);
  }

  log.debug(`Rendered ${items.length} nav items in sidebar`);
}

// ============================================================================
// FEED SWITCHER
// ============================================================================

/**
 * Get feed switcher HTML using platform's navigation provider.
 */
function getFeedSwitcherHtml(platform: Platform): string {
  if (!platform.navigation?.supportsFeedSwitcher(window.location.href)) {
    return '';
  }

  const activeTab = platform.navigation.getActiveFeedTab();
  return platform.navigation.getFeedSwitcherHtml(activeTab?.id || null);
}

/**
 * Attach feed switcher handlers using platform's navigation provider.
 */
function attachFeedSwitcherHandlers(container: HTMLElement, platform: Platform): void {
  if (!platform.navigation) return;

  platform.navigation.attachFeedSwitcherHandlers(container, (tabId) => {
    // Dispatch event to content.ts for processing
    window.dispatchEvent(new CustomEvent('cocoon:feedswitch', {
      detail: { tab: tabId }
    }));
  });
}

// ============================================================================
// SKELETONS
// ============================================================================

/**
 * Render skeleton items in the overlay main content area.
 */
export function renderSkeletons(): boolean {
  const overlay = document.getElementById(OVERLAY_ID);
  if (!overlay) return false;

  const existingContent = overlay.querySelector('.cocoon-feed-container .cocoon-item:not(.cocoon-skeleton)');
  if (existingContent) {
    log.debug('Skipping skeletons - content already present');
    return false;
  }

  const existingSkeletons = overlay.querySelector('.cocoon-feed-container .cocoon-skeleton');
  if (existingSkeletons) {
    log.debug('Skipping skeletons - already rendered');
    return true;
  }

  const count = getSkeletonCount();
  log.debug(`Rendering ${count} skeleton items`);

  let mainContent = overlay.querySelector('.cocoon-main-content');
  if (!mainContent) {
    mainContent = document.createElement('div');
    mainContent.className = 'cocoon-main-content';
    overlay.appendChild(mainContent);
  }

  const skeletonHtml = Array.from({ length: count }, (_, i) => getSkeletonItemHtml(i)).join('');

  mainContent.innerHTML = `
    <div class="flex justify-center p-4 px-5 w-full">
      <div class="relative w-full max-w-[600px]">
        <div class="w-full">
          <div class="cocoon-feed-container flex flex-col gap-3">
            ${skeletonHtml}
          </div>
        </div>
      </div>
    </div>
  `;

  return true;
}

/**
 * Check if skeletons are currently rendered.
 */
export function hasSkeletons(): boolean {
  const overlay = document.getElementById(OVERLAY_ID);
  if (!overlay) return false;
  return overlay.querySelector('.cocoon-skeleton') !== null;
}

function getFeedStatusInnerHtml(message: string): string {
  return `
    <div class="cocoon-feed-status-inner">
      <div class="loader" aria-hidden="true"></div>
      <div class="shimmer-text">${createShimmerText(message)}</div>
    </div>
  `;
}

// ============================================================================
// SKELETON MORPHING
// ============================================================================

/**
 * Morph skeleton items into actual content with smooth height animation.
 */
export async function morphSkeletonsToContent(
  feedItems: FeedItem[],
  platform: Platform
): Promise<void> {
  const overlay = document.getElementById(OVERLAY_ID);
  if (!overlay) return;

  hideLoadingOverlay();

  const feedContainer = overlay.querySelector('.cocoon-feed-container');
  if (!feedContainer) {
    log.warn('Feed container not found for morphing');
    return;
  }

  // Add feed switcher if supported and not already present
  if (!overlay.querySelector('.cocoon-feed-switcher')) {
    const switcherHtml = getFeedSwitcherHtml(platform);
    if (switcherHtml) {
      feedContainer.insertAdjacentHTML('beforebegin', switcherHtml);
      const switcher = overlay.querySelector('.cocoon-feed-switcher');
      if (switcher) attachFeedSwitcherHandlers(switcher as HTMLElement, platform);
    }
  }

  const skeletons = Array.from(feedContainer.querySelectorAll('.cocoon-skeleton')) as HTMLElement[];

  if (skeletons.length === 0) {
    log.debug('No skeletons to morph, rendering directly');
    renderFeedItemsDirectly(feedItems, platform, overlay);
    return;
  }

  log.debug(`Morphing ${skeletons.length} skeletons into ${feedItems.length} items`);

  currentPlatform = platform;
  injectStyles(platform);

  const morphPromises: Promise<void>[] = [];

  for (let i = 0; i < Math.max(skeletons.length, feedItems.length); i++) {
    const skeleton = skeletons[i];
    const item = feedItems[i];
    const staggerDelay = i * MORPH_STAGGER_MS;

    if (skeleton && item) {
      morphPromises.push(morphSingleSkeleton(skeleton, item, platform, i, staggerDelay));
    } else if (skeleton && !item) {
      morphPromises.push(collapseSkeleton(skeleton, staggerDelay));
    }
  }

  await Promise.all(morphPromises);

  // Append extra content items beyond skeleton count
  if (feedItems.length > skeletons.length) {
    const extraItems = feedItems.slice(skeletons.length);
    const startIndex = skeletons.length;

    for (let i = 0; i < extraItems.length; i++) {
      const item = extraItems[i];
      const itemHtml = platform.adapter.renderItem(item, startIndex + i);
      const temp = document.createElement('div');
      temp.innerHTML = itemHtml;
      const itemEl = temp.firstElementChild as HTMLElement;
      if (itemEl) {
        itemEl.style.opacity = '0';
        itemEl.style.transform = 'translateY(8px)';
        feedContainer.appendChild(itemEl);

        setTimeout(() => {
          itemEl.style.transition = 'opacity 300ms ease-out, transform 300ms ease-out';
          itemEl.style.opacity = '1';
          itemEl.style.transform = 'translateY(0)';
        }, (skeletons.length + i) * MORPH_STAGGER_MS);
      }
    }
  }

  // Add indicator slot and footer
  const parent = feedContainer.parentElement;
  if (parent) {
    if (!parent.querySelector('.cocoon-quota-indicator-slot')) {
      const slot = document.createElement('div');
      slot.className = 'cocoon-quota-indicator-slot';
      const quotaStatus = getCurrentQuotaStatus();
      slot.innerHTML = getQuotaIndicatorHtml(quotaStatus);
      parent.appendChild(slot);
    }
    if (!parent.querySelector('.cocoon-feed-footer')) {
      const footer = document.createElement('div');
      footer.className = 'cocoon-feed-footer';
      parent.appendChild(footer);
    }
  }

  attachOverlayHandlers(overlay);
  platform.init?.initializeVideoPlayers().catch(err => {
    log.warn('Failed to initialize video players:', err);
  });

  ensureFadeOverlays();
  const mainContent = overlay.querySelector('.cocoon-main-content');
  if (mainContent) {
    requestAnimationFrame(() => {
      updateFadeVisibility(mainContent);
    });
    if (!mainContent.hasAttribute('data-fade-listener')) {
      mainContent.setAttribute('data-fade-listener', 'true');
      mainContent.addEventListener('scroll', () => updateFadeVisibility(mainContent), { passive: true });
    }
  }

  document.body.style.overflow = 'hidden';

  log.debug('Skeleton morphing complete');

  // Notify quota observer that items are now in DOM
  notifyQuotaObserver();
}

/**
 * Morph a single skeleton into its corresponding content item.
 */
async function morphSingleSkeleton(
  skeleton: HTMLElement,
  item: FeedItem,
  platform: Platform,
  index: number,
  delay: number
): Promise<void> {
  return new Promise(resolve => {
    setTimeout(() => {
      skeleton.classList.remove('cocoon-skeleton-enter');

      const contentContainer = skeleton.querySelector('.skeleton-content') as HTMLElement;
      if (!contentContainer) {
        resolve();
        return;
      }

      const itemHtml = platform.adapter.renderItem(item, index);
      const temp = document.createElement('div');
      temp.innerHTML = itemHtml;
      const renderedItem = temp.firstElementChild as HTMLElement;
      if (!renderedItem) {
        resolve();
        return;
      }

      contentContainer.innerHTML = renderedItem.innerHTML;
      skeleton.className = renderedItem.className + ' cocoon-skeleton morphing';

      Array.from(renderedItem.attributes).forEach(attr => {
        if (attr.name.startsWith('data-') || attr.name === 'id') {
          skeleton.setAttribute(attr.name, attr.value);
        }
      });

      contentContainer.style.position = 'static';
      contentContainer.style.visibility = 'visible';

      const currentHeight = Math.max(skeleton.getBoundingClientRect().height, SKELETON_HEIGHT, 1);
      skeleton.style.height = `${currentHeight}px`;
      void skeleton.offsetHeight;

      const targetHeight = Math.max(skeleton.scrollHeight, 1);
      skeleton.style.height = `${targetHeight}px`;

      setTimeout(() => {
        skeleton.classList.remove('cocoon-skeleton', 'morphing');
        skeleton.style.height = '';

        const skeletonInner = skeleton.querySelector('.skeleton-inner');
        skeletonInner?.remove();

        const finalContentContainer = skeleton.querySelector('.skeleton-content') as HTMLElement | null;
        if (finalContentContainer) {
          while (finalContentContainer.firstChild) {
            skeleton.appendChild(finalContentContainer.firstChild);
          }
          finalContentContainer.remove();
        }

        resolve();
      }, MORPH_DURATION_MS);
    }, delay);
  });
}

/**
 * Collapse an extra skeleton (no corresponding content).
 */
async function collapseSkeleton(skeleton: HTMLElement, delay: number): Promise<void> {
  return new Promise(resolve => {
    setTimeout(() => {
      skeleton.classList.remove('cocoon-skeleton-enter');
      skeleton.classList.add('collapsing');

      setTimeout(() => {
        skeleton.remove();
        resolve();
      }, MORPH_DURATION_MS);
    }, delay);
  });
}

/**
 * Direct rendering without skeleton morphing (fallback).
 */
function renderFeedItemsDirectly(
  feedItems: FeedItem[],
  platform: Platform,
  overlay: HTMLElement
): void {
  hideLoadingOverlay();

  const isEmpty = feedItems.length === 0;
  const contentHtml = isEmpty
    ? getEmptyStateHtml()
    : feedItems.map((item, i) => platform.adapter.renderItem(item, i)).join('');

  const quotaStatus = getCurrentQuotaStatus();
  const indicatorHtml = getQuotaIndicatorHtml(quotaStatus);
  const footerHtml = isEmpty ? '' : '<div class="cocoon-feed-footer"></div>';

  injectStyles(platform);
  overlay.classList.add('cocoon-content-mode');

  let mainContent = overlay.querySelector('.cocoon-main-content');
  if (!mainContent) {
    mainContent = document.createElement('div');
    mainContent.className = 'cocoon-main-content';
    overlay.appendChild(mainContent);
  }

  const switcherHtml = getFeedSwitcherHtml(platform);
  mainContent.innerHTML = `
    <div class="flex justify-center p-4 px-5 w-full">
      <div class="relative w-full max-w-[600px]">
        ${switcherHtml}
        <div class="w-full">
          <div class="cocoon-feed-container flex flex-col gap-3">
            ${contentHtml}
          </div>
          <div class="cocoon-quota-indicator-slot">${indicatorHtml}</div>
          ${footerHtml}
        </div>
      </div>
    </div>
  `;

  attachOverlayHandlers(overlay);
  platform.init?.initializeVideoPlayers().catch(() => {});
  ensureFadeOverlays();

  const switcher = overlay.querySelector('.cocoon-feed-switcher');
  if (switcher) attachFeedSwitcherHandlers(switcher as HTMLElement, platform);

  if (mainContent) {
    requestAnimationFrame(() => updateFadeVisibility(mainContent));
    if (!mainContent.hasAttribute('data-fade-listener')) {
      mainContent.setAttribute('data-fade-listener', 'true');
      mainContent.addEventListener('scroll', () => updateFadeVisibility(mainContent), { passive: true });
    }
  }

  document.body.style.overflow = 'hidden';

  // Notify quota observer that items are now in DOM
  notifyQuotaObserver();
}

// ============================================================================
// OVERLAY SHELL
// ============================================================================

/**
 * Initialize the overlay shell with the unified layout structure.
 */
export function initOverlayShell(platform?: Platform): void {
  const overlay = document.getElementById(OVERLAY_ID);
  if (!overlay) return;

  const shellExists = overlay.querySelector('.cocoon-shell-header');
  const switcherHtml = platform ? getFeedSwitcherHtml(platform) : '';

  if (!shellExists) {
    overlay.innerHTML = `
      ${getShellHeaderHtml()}
      <aside class="cocoon-sidebar-nav"><nav></nav></aside>
      <div class="cocoon-main-content">
        <div class="cocoon-skeleton-container">
          ${switcherHtml}
          <div class="cocoon-feed-container"></div>
          <div class="cocoon-feed-status cocoon-feed-status-enter">${getFeedStatusInnerHtml('Waiting for feed')}</div>
        </div>
      </div>
    `;
    overlay.classList.add('cocoon-content-mode');
    startInitialSkeletonReveal(overlay);
  } else {
    const hasContent = !!overlay.querySelector('.cocoon-item:not(.cocoon-skeleton)');

    let feedContainer = overlay.querySelector('.cocoon-feed-container') as HTMLElement | null;
    let feedStatus = overlay.querySelector('.cocoon-feed-status') as HTMLElement | null;
    const mainContent = overlay.querySelector('.cocoon-main-content') as HTMLElement | null;

    if (!hasContent && (!feedContainer || !feedStatus) && mainContent) {
      mainContent.innerHTML = `
        <div class="cocoon-skeleton-container">
          ${switcherHtml}
          <div class="cocoon-feed-container"></div>
          <div class="cocoon-feed-status cocoon-feed-status-enter">${getFeedStatusInnerHtml('Waiting for feed')}</div>
        </div>
      `;
      feedContainer = overlay.querySelector('.cocoon-feed-container') as HTMLElement | null;
      feedStatus = overlay.querySelector('.cocoon-feed-status') as HTMLElement | null;
    }

    if (feedStatus && !feedStatus.querySelector('.cocoon-feed-status-inner')) {
      feedStatus.innerHTML = getFeedStatusInnerHtml('Waiting for feed');
    }

    if (!hasContent && feedContainer && !feedContainer.querySelector('.cocoon-skeleton')) {
      startInitialSkeletonReveal(overlay);
    }

    // Add switcher if supported and not already present
    if (switcherHtml && !overlay.querySelector('.cocoon-feed-switcher')) {
      const skeletonContainer = overlay.querySelector('.cocoon-skeleton-container');
      if (skeletonContainer && feedContainer) {
        feedContainer.insertAdjacentHTML('beforebegin', switcherHtml);
      }
    }
  }

  // Attach header handlers if not already attached
  if (!overlay.dataset.headerHandlersAttached) {
    attachHeaderHandlers(overlay);
    overlay.dataset.headerHandlersAttached = 'true';
  }

  // Attach feed switcher handlers if present and platform available
  if (platform) {
    const switcher = overlay.querySelector('.cocoon-feed-switcher');
    if (switcher) attachFeedSwitcherHandlers(switcher as HTMLElement, platform);
  }

  injectShellStyles();

  log.debug('Overlay shell initialized');
}

/**
 * Inject CSS for the shell layout.
 */
function injectShellStyles(): void {
  if (document.getElementById('__cocoon_shell_styles')) return;

  const style = document.createElement('style');
  style.id = '__cocoon_shell_styles';
  style.textContent = `
    /* Shell content mode - flex layout */
    #${OVERLAY_ID}.cocoon-content-mode {
      overflow: hidden !important;
      display: flex;
      flex-direction: column;
    }

    /* Left sidebar nav - floating bubble */
    .cocoon-sidebar-nav {
      position: fixed;
      left: ${SHELL_SPACING}px;
      top: 50%;
      transform: translateY(-50%);
      width: 64px;
      background: var(--cocoon-surface);
      border: 1px solid var(--cocoon-border);
      border-radius: 32px;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 8px 0;
      box-shadow: 0 4px 16px rgba(0, 0, 0, 0.2);
      z-index: 100;
    }

    .cocoon-nav-link {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 48px;
      height: 48px;
      border-radius: 50%;
      color: var(--cocoon-text);
      transition: all 0.2s ease;
    }

    .cocoon-nav-link:hover {
      background: var(--cocoon-elevated);
      transform: scale(1.08);
    }

    .cocoon-nav-icon {
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .cocoon-nav-icon svg {
      width: 24px;
      height: 24px;
    }

    .cocoon-nav-icon svg,
    .cocoon-nav-icon svg path,
    .cocoon-nav-icon svg circle,
    .cocoon-nav-icon svg rect,
    .cocoon-nav-icon svg polygon {
      fill: var(--cocoon-text) !important;
    }

    /* Compose button - accent colored */
    .cocoon-compose-btn {
      display: flex;
      align-items: center;
      justify-content: center;
      width: 48px;
      height: 48px;
      border-radius: 50%;
      border: none;
      background: var(--cocoon-accent);
      color: var(--cocoon-accent-fg);
      cursor: pointer;
      transition: all 0.2s ease;
    }

    .cocoon-compose-btn:hover {
      transform: scale(1.08);
      filter: brightness(1.1);
    }

    .cocoon-compose-btn:active {
      transform: scale(0.95);
    }

    .cocoon-compose-btn svg {
      width: 22px;
      height: 22px;
    }

    .cocoon-compose-btn svg,
    .cocoon-compose-btn svg path,
    .cocoon-compose-btn svg g {
      fill: var(--cocoon-accent-fg) !important;
      stroke: none !important;
    }

    /* Main content area - scrollable */
    .cocoon-main-content {
      flex: 1;
      overflow-y: auto;
      height: 100%;
      padding-left: ${SHELL_SPACING + 64 + SHELL_SPACING}px;
      padding-top: ${SHELL_TOP_INSET}px;
    }

    @supports (scrollbar-gutter: stable) {
      .cocoon-main-content {
        scrollbar-gutter: stable;
      }
    }

    /* Loading spinner in shell */
    .cocoon-loading-state .loader {
      position: relative;
      width: 48px;
      height: 48px;
    }

    .cocoon-loading-state .loader::before {
      content: "";
      position: absolute;
      inset: 0;
      border-radius: 50%;
      border: 2px solid transparent;
      border-top-color: var(--cocoon-accent);
      animation: cocoon-spin 1s linear infinite;
    }

    .cocoon-loading-state .loader::after {
      content: "";
      position: absolute;
      inset: 6px;
      border-radius: 50%;
      border: 2px solid transparent;
      border-top-color: var(--cocoon-border);
      animation: cocoon-spin 0.6s linear infinite reverse;
    }

    @keyframes cocoon-spin {
      to { transform: rotate(360deg); }
    }

    /* Empty state */
    .cocoon-empty-state {
      text-align: center;
      padding: 60px 24px;
      max-width: 400px;
      margin: 0 auto;
    }

    .cocoon-empty-title {
      font-size: 18px;
      font-weight: 500;
      color: var(--cocoon-text);
      margin-bottom: 12px;
    }

    .cocoon-empty-body {
      font-size: 14px;
      line-height: 1.5;
      color: var(--cocoon-muted);
    }

    /* End-of-feed hint */
    .cocoon-feed-hint {
      text-align: center;
      padding: 32px 24px;
      margin-top: 12px;
      font-size: 13px;
      line-height: 1.5;
      color: var(--cocoon-muted);
      background: var(--cocoon-surface);
      border: 1px solid var(--cocoon-border);
      border-radius: 16px;
    }

    /* Feed switcher */
    .cocoon-feed-switcher {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 8px;
      margin-bottom: 16px;
      font-size: 15px;
    }

    .cocoon-feed-switch-btn {
      appearance: none;
      background: none;
      border: none;
      font: inherit;
      color: var(--cocoon-muted);
      padding: 4px 0;
      position: relative;
      cursor: pointer;
      transition: color 0.15s ease;
    }

    .cocoon-feed-switch-btn:hover {
      color: var(--cocoon-text);
    }

    .cocoon-feed-switch-btn.active {
      color: var(--cocoon-text);
      font-weight: 600;
    }

    .cocoon-feed-switch-btn.active::after {
      content: '';
      position: absolute;
      bottom: 0;
      left: 0;
      right: 0;
      height: 2px;
      background: var(--cocoon-text);
      border-radius: 1px;
    }

    .cocoon-feed-switch-divider {
      color: var(--cocoon-border);
      font-weight: 300;
    }
  `;
  document.head.appendChild(style);
}

/**
 * Attach event handlers to header elements.
 */
function attachHeaderHandlers(overlay: HTMLElement): void {
  const searchWrapper = overlay.querySelector('.cocoon-search-wrapper');
  const searchToggle = overlay.querySelector('.cocoon-search-toggle');

  let searchForm = overlay.querySelector('.cocoon-search-form') as HTMLFormElement | null;
  if (searchWrapper && !searchForm) {
    searchForm = document.createElement('form');
    searchForm.action = '/search';
    searchForm.method = 'get';
    searchForm.className = 'cocoon-search-form';
    searchForm.innerHTML = `
      <input
        type="text"
        name="q"
        class="cocoon-search-input"
        placeholder="Search"
        value=""
        autocomplete="off"
      />
      <input type="hidden" name="src" value="typed_query" />
    `;
    searchWrapper.appendChild(searchForm);
  }

  const searchInput = overlay.querySelector('.cocoon-search-input') as HTMLInputElement | null;

  const closeSearch = () => {
    if (!searchForm || !searchToggle) return;
    searchForm.classList.remove('cocoon-search-open');
    (searchToggle as HTMLElement).style.opacity = '1';
    (searchToggle as HTMLElement).style.pointerEvents = 'auto';
  };

  const openSearch = () => {
    if (!searchForm || !searchToggle) return;
    searchForm.classList.add('cocoon-search-open');
    (searchToggle as HTMLElement).style.opacity = '0';
    (searchToggle as HTMLElement).style.pointerEvents = 'none';
    searchInput?.focus();
  };

  if (searchToggle) {
    searchToggle.addEventListener('click', openSearch);
  }

  document.addEventListener('click', (e) => {
    if (!searchWrapper?.contains(e.target as Node)) {
      closeSearch();
    }
  });

  searchInput?.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeSearch();
    }
  });

  const settingsBtn = overlay.querySelector('.cocoon-settings-btn');
  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      browser.runtime.sendMessage({ type: 'OPEN_OPTIONS' })
        .catch((e) => log.error('Settings message failed:', e));
    });
  }
}

// ============================================================================
// FADE OVERLAYS
// ============================================================================

/**
 * Update fade overlay opacity based on scroll position.
 */
function updateFadeVisibility(scrollContainer: Element): void {
  const overlay = document.getElementById(OVERLAY_ID);
  if (!overlay) return;

  const fadeTop = overlay.querySelector('.cocoon-fade-top') as HTMLElement | null;
  const fadeBottom = overlay.querySelector('.cocoon-fade-bottom') as HTMLElement | null;
  if (!fadeTop || !fadeBottom) return;

  const scrollTop = scrollContainer.scrollTop;
  const scrollHeight = scrollContainer.scrollHeight;
  const clientHeight = scrollContainer.clientHeight;
  const distanceFromBottom = scrollHeight - scrollTop - clientHeight;

  const topOpacity = Math.min(scrollTop, FADE_SCROLL_DISTANCE) / FADE_SCROLL_DISTANCE * FADE_MAX_OPACITY;
  fadeTop.style.opacity = String(topOpacity);

  const bottomOpacity = Math.min(distanceFromBottom, FADE_SCROLL_DISTANCE) / FADE_SCROLL_DISTANCE * FADE_MAX_OPACITY;
  fadeBottom.style.opacity = String(bottomOpacity);
}

/**
 * Create fade overlay elements if they don't exist.
 */
function ensureFadeOverlays(): void {
  const overlay = document.getElementById(OVERLAY_ID);
  if (!overlay) return;

  if (!overlay.querySelector('.cocoon-fade-top')) {
    const fadeTop = document.createElement('div');
    fadeTop.className = 'cocoon-fade-top';
    overlay.appendChild(fadeTop);
  }

  if (!overlay.querySelector('.cocoon-fade-bottom')) {
    const fadeBottom = document.createElement('div');
    fadeBottom.className = 'cocoon-fade-bottom';
    overlay.appendChild(fadeBottom);
  }
}

// ============================================================================
// STATUS UPDATES
// ============================================================================

/**
 * Update the overlay status message.
 */
export function updateStatus(message: string): void {
  const overlay = document.getElementById(OVERLAY_ID);
  if (!overlay) return;

  let feedStatus = overlay.querySelector('.cocoon-feed-status');
  if (feedStatus) {
    const shimmerEl = feedStatus.querySelector('.shimmer-text') as HTMLElement | null;
    if (!shimmerEl) {
      (feedStatus as HTMLElement).innerHTML = getFeedStatusInnerHtml(message);
      return;
    }
    shimmerEl.innerHTML = createShimmerText(message);
    return;
  }

  const legacyTextEl = overlay.querySelector('.cocoon-loading-state .text');
  if (legacyTextEl) {
    const shimmerEl = document.createElement('div');
    shimmerEl.className = 'shimmer-text';
    shimmerEl.innerHTML = createShimmerText(message);
    legacyTextEl.replaceWith(shimmerEl);
  }
}

/**
 * Hide the feed status (called when content is ready).
 */
export function hideLoadingOverlay(): void {
  const overlay = document.getElementById(OVERLAY_ID);
  if (!overlay) return;

  stopInitialSkeletonReveal();

  const feedStatus = overlay.querySelector('.cocoon-feed-status') as HTMLElement | null;
  if (feedStatus) {
    const height = feedStatus.offsetHeight;
    feedStatus.style.height = `${height}px`;
    feedStatus.style.overflow = 'hidden';
    feedStatus.style.transition = 'opacity 200ms ease-out, height 320ms ease-out, padding 320ms ease-out';
    requestAnimationFrame(() => {
      feedStatus.style.opacity = '0';
      feedStatus.style.height = '0';
      feedStatus.style.padding = '0';
    });
    setTimeout(() => feedStatus.remove(), 340);
  }

  const loadingOverlay = overlay.querySelector('.cocoon-loading-overlay') as HTMLElement;
  if (loadingOverlay) {
    loadingOverlay.remove();
  }
}

// ============================================================================
// FEED ITEMS
// ============================================================================

/**
 * Convert blocks to FeedItems, filtering out hidden items.
 */
export function blocksToFeedItems(
  allBlocks: BlockMetadata[],
  hideIds: Set<string>
): FeedItem[] {
  const keepBlocks = allBlocks.filter(b => !hideIds.has(b.id) && b.isFeedItem);
  return keepBlocks.map(block => ({
    id: block.id,
    text: block.text || block.primaryText || '',
    title: block.title,
    author: block.author,
    url: block.url,
    timestamp: block.timestamp,
    metrics: block.metrics,
    hasVideo: block.hasVideo,
    videoUrl: block.videoUrl,
    statusId: block.statusId,
    html: block.html,
    quote: block.quote,
    mediaUrls: block.mediaUrls || [],
    quoteMediaUrls: block.quoteMediaUrls || [],
  }));
}

/**
 * Render feed items directly into the overlay.
 */
export function renderFeedItems(
  feedItems: FeedItem[],
  platform: Platform
): void {
  const overlay = document.getElementById(OVERLAY_ID);
  if (!overlay) {
    log.error('Overlay not found');
    return;
  }

  hideLoadingOverlay();
  currentPlatform = platform;

  log.debug(`Rendering ${feedItems.length} feed items`);

  injectStyles(platform);
  overlay.classList.add('cocoon-content-mode');

  // Check if we have skeletons to morph
  const feedContainer = overlay.querySelector('.cocoon-feed-container');
  const skeletons = feedContainer ? Array.from(feedContainer.querySelectorAll('.cocoon-skeleton')) as HTMLElement[] : [];

  if (skeletons.length > 0 && feedItems.length > 0) {
    log.debug(`Morphing ${skeletons.length} skeletons into ${feedItems.length} items`);
    void morphSkeletonsToContent(feedItems, platform);
    return;
  }

  // No skeletons - do direct replacement
  const isEmpty = feedItems.length === 0;
  const contentHtml = isEmpty
    ? getEmptyStateHtml()
    : feedItems.map((item, i) => platform.adapter.renderItem(item, i)).join('');

  const quotaStatus = getCurrentQuotaStatus();
  const indicatorHtml = getQuotaIndicatorHtml(quotaStatus);
  const footerHtml = isEmpty ? '' : '<div class="cocoon-feed-footer"></div>';

  let mainContent = overlay.querySelector('.cocoon-main-content');
  if (!mainContent) {
    mainContent = document.createElement('div');
    mainContent.className = 'cocoon-main-content';
    overlay.appendChild(mainContent);
  }

  const switcherHtml = getFeedSwitcherHtml(platform);
  mainContent.innerHTML = `
    <div class="flex justify-center p-4 px-5 w-full">
      <div class="relative w-full max-w-[600px]">
        ${switcherHtml}
        <div class="w-full">
          <div class="cocoon-feed-container flex flex-col gap-3">
            ${contentHtml}
          </div>
          <div class="cocoon-quota-indicator-slot">${indicatorHtml}</div>
          ${footerHtml}
        </div>
      </div>
    </div>
  `;

  attachOverlayHandlers(overlay);

  const switcher = overlay.querySelector('.cocoon-feed-switcher');
  if (switcher) attachFeedSwitcherHandlers(switcher as HTMLElement, platform);

  platform.init?.initializeVideoPlayers().catch(err => {
    log.warn('Failed to initialize video players:', err);
  });

  ensureFadeOverlays();
  if (mainContent) {
    requestAnimationFrame(() => {
      updateFadeVisibility(mainContent);
    });

    if (!mainContent.hasAttribute('data-fade-listener')) {
      mainContent.setAttribute('data-fade-listener', 'true');
      mainContent.addEventListener('scroll', () => updateFadeVisibility(mainContent), { passive: true });
    }
  }

  document.body.style.overflow = 'hidden';

  // Notify quota observer that items are now in DOM
  notifyQuotaObserver();
}

/**
 * Render curated content from blocks into the overlay.
 */
export function renderContent(
  allBlocks: BlockMetadata[],
  hideIds: Set<string>,
  platform: Platform
): FeedItem[] {
  const feedItems = blocksToFeedItems(allBlocks, hideIds);
  log.debug(`Rendering ${feedItems.length} curated items from ${allBlocks.length} total blocks`);
  renderFeedItems(feedItems, platform);
  return feedItems;
}

export function injectStyles(platform: Platform): void {
  if (document.getElementById('__cocoon_content_styles')) return;

  injectShellStyles();

  const style = document.createElement('style');
  style.id = '__cocoon_content_styles';
  style.textContent = `
    /* Platform-specific styles */
    ${platform.adapter.getStyles()}

    /* Lightbox styles */
    ${getLightboxStyles()}
  `;
  document.head.appendChild(style);
}

export function removeOverlay(): void {
  const overlay = document.getElementById(OVERLAY_ID);
  if (overlay) overlay.remove();
  document.body.style.overflow = '';
  stopScrollObserver();
}

// ============================================================================
// SCROLL OBSERVER
// ============================================================================

/**
 * Start observing scroll position to trigger infinite loading.
 */
export function startScrollObserver(onNearBottom: () => void): void {
  scrollObserverCallback = onNearBottom;
  const overlay = document.getElementById(OVERLAY_ID);
  if (!overlay) return;

  const scrollContainer = overlay.querySelector('.cocoon-main-content') || overlay;

  const handleScroll = () => {
    if (isLoadingMore || !scrollObserverCallback) return;

    const scrollTop = scrollContainer.scrollTop;
    const scrollHeight = scrollContainer.scrollHeight;
    const clientHeight = scrollContainer.clientHeight;
    const scrollPercent = (scrollTop + clientHeight) / scrollHeight;

    if (scrollPercent > 0.8) {
      scrollObserverCallback();
    }
  };

  scrollContainer.addEventListener('scroll', handleScroll, { passive: true });
  log.debug('Scroll observer started');
}

/**
 * Stop the scroll observer.
 */
export function stopScrollObserver(): void {
  scrollObserverCallback = null;
}

/**
 * Set loading state for infinite scroll.
 */
export function setLoadingMore(loading: boolean, message?: string): void {
  isLoadingMore = loading;
  const overlay = document.getElementById(OVERLAY_ID);
  if (!overlay) return;

  const footer = overlay.querySelector('.cocoon-feed-footer');
  if (!footer) return;

  if (loading) {
    const text = message || 'Loading more';
    footer.innerHTML = `<div class="cocoon-feed-status">${getFeedStatusInnerHtml(text)}</div>`;
  } else {
    footer.innerHTML = '';
  }
}

/**
 * Mark feed as complete (no more content to load).
 */
export function setFeedComplete(): void {
  isLoadingMore = false;
  scrollObserverCallback = null;

  const overlay = document.getElementById(OVERLAY_ID);
  if (!overlay) return;

  const footer = overlay.querySelector('.cocoon-feed-footer');
  if (footer) {
    const message = getEndOfFeedMessage();
    if (message) {
      footer.innerHTML = `<div class="cocoon-feed-hint">${message}</div>`;
    } else {
      footer.innerHTML = '';
    }
  }
}

/**
 * Append new feed items to the existing overlay.
 */
export function appendFeedItems(newItems: FeedItem[], startIndex: number): void {
  if (!currentPlatform || newItems.length === 0) return;

  const overlay = document.getElementById(OVERLAY_ID);
  if (!overlay) return;

  const feedContainer = overlay.querySelector('.cocoon-feed-container');
  if (!feedContainer) {
    log.warn('Feed container not found for appending');
    return;
  }

  const newHtml = newItems.map((item, i) =>
    currentPlatform!.adapter.renderItem(item, startIndex + i)
  ).join('');

  const temp = document.createElement('div');
  temp.innerHTML = newHtml;

  while (temp.firstChild) {
    feedContainer.appendChild(temp.firstChild);
  }

  attachOverlayHandlers(overlay);

  currentPlatform.init?.initializeVideoPlayers().catch(err => {
    log.warn('Failed to initialize video players for new items:', err);
  });

  log.debug(`Appended ${newItems.length} items (total now: ${startIndex + newItems.length})`);

  // Notify quota observer about new items
  notifyQuotaObserver();
}

/**
 * Get current feed item count.
 */
export function getFeedItemCount(): number {
  const overlay = document.getElementById(OVERLAY_ID);
  if (!overlay) return 0;
  return overlay.querySelectorAll('.cocoon-item').length;
}

// ============================================================================
// OVERLAY HANDLERS
// ============================================================================

/**
 * Attach click/interaction handlers to overlay elements.
 */
export function attachOverlayHandlers(overlay: HTMLElement): void {
  if (!overlay.dataset.headerHandlersAttached) {
    attachHeaderHandlers(overlay);
    overlay.dataset.headerHandlersAttached = 'true';
  }

  // Show more/less handlers
  overlay.querySelectorAll('.cocoon-show-more:not([data-click-attached])').forEach(btn => {
    (btn as HTMLElement).dataset.clickAttached = 'true';
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const button = e.target as HTMLButtonElement;
      const targetId = button.dataset.target;
      const item = document.getElementById(targetId || '');
      const textEl = item?.querySelector('.cocoon-item-text');

      if (!textEl) return;

      const isExpanded = !textEl.classList.contains('cocoon-text-truncated');
      if (isExpanded) {
        textEl.classList.add('cocoon-text-truncated');
        button.textContent = 'Show more';
      } else {
        textEl.classList.remove('cocoon-text-truncated');
        button.textContent = 'Show less';
      }
    });
  });

  // Quote click handlers
  overlay.querySelectorAll('.cocoon-quote-clickable:not([data-click-attached])').forEach(quote => {
    (quote as HTMLElement).dataset.clickAttached = 'true';
    const getQuoteUrl = () => (quote as HTMLElement).dataset.quoteUrl;

    quote.addEventListener('click', (e) => {
      e.stopPropagation();
      const target = e.target as HTMLElement;
      if (target.tagName === 'A' || target.tagName === 'BUTTON' || target.closest('a, button')) return;

      const selection = window.getSelection();
      if (selection && selection.toString().trim().length > 0) return;

      const quoteUrl = getQuoteUrl();
      if (!quoteUrl) return;

      const mouseEvent = e as MouseEvent;
      if (mouseEvent.ctrlKey || mouseEvent.metaKey) {
        window.open(quoteUrl, '_blank', 'noopener');
      } else {
        window.location.href = quoteUrl;
      }
    });

    quote.addEventListener('auxclick', (e) => {
      e.stopPropagation();
      const mouseEvent = e as MouseEvent;
      if (mouseEvent.button !== 1) return;

      const target = e.target as HTMLElement;
      if (target.tagName === 'A' || target.tagName === 'BUTTON' || target.closest('a, button')) return;

      const quoteUrl = getQuoteUrl();
      if (quoteUrl) {
        window.open(quoteUrl, '_blank', 'noopener');
      }
    });
  });

  // Item click handlers
  const isOnStatusPage = /^\/[^/]+\/status\/\d+/.test(window.location.pathname);

  overlay.querySelectorAll('.cocoon-item[data-tweet-url]:not([data-click-attached])').forEach(item => {
    (item as HTMLElement).dataset.clickAttached = 'true';
    const getItemUrl = () => {
      const el = item as HTMLElement;
      return el.dataset.tweetUrl || el.dataset.postUrl || el.dataset.itemUrl;
    };

    const itemUrl = getItemUrl();
    const isCurrentPost = isOnStatusPage && itemUrl && new URL(itemUrl, window.location.origin).pathname === window.location.pathname;

    if (isCurrentPost) return;

    item.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.tagName === 'A' || target.tagName === 'BUTTON' || target.closest('a, button, .cocoon-item-quote, .cocoon-video-player-container')) return;

      const selection = window.getSelection();
      if (selection && selection.toString().trim().length > 0) return;

      const url = getItemUrl();
      if (!url) return;

      const mouseEvent = e as MouseEvent;
      if (mouseEvent.ctrlKey || mouseEvent.metaKey) {
        window.open(url, '_blank', 'noopener');
      } else {
        window.location.href = url;
      }
    });

    item.addEventListener('auxclick', (e) => {
      const mouseEvent = e as MouseEvent;
      if (mouseEvent.button !== 1) return;

      const target = e.target as HTMLElement;
      if (target.tagName === 'A' || target.tagName === 'BUTTON' || target.closest('a, button, .cocoon-item-quote, .cocoon-video-player-container')) return;

      const url = getItemUrl();
      if (url) {
        window.open(url, '_blank', 'noopener');
      }
    });
  });

  // Media lightbox handlers
  const mediaImages = overlay.querySelectorAll('.cocoon-media-image:not([data-lightbox-attached])');
  mediaImages.forEach(img => {
    (img as HTMLElement).dataset.lightboxAttached = 'true';
    img.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      const target = e.currentTarget as HTMLImageElement;
      const grid = target.closest('.cocoon-media-grid') as HTMLElement;
      if (!grid) return;

      const imagesData = grid.dataset.images;
      if (!imagesData) return;

      try {
        const images = JSON.parse(decodeURIComponent(imagesData)) as string[];
        const index = parseInt(target.dataset.index || '0', 10);
        openLightbox(images, index);
      } catch {
        openLightbox([target.src], 0);
      }
    });
  });
}
