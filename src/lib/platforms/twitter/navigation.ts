/**
 * Twitter/X navigation provider.
 * Handles nav bar extraction, tab switching, and compose button.
 */

import { createLogger } from '../../logger';
import type { FeedTab, NavItem, NavigationProvider } from '../types';

const log = createLogger('TwitterNav');

// Storage key for pending compose intent
const COMPOSE_PENDING_KEY = '__cocoon_compose_pending';

// Tab definitions
const TABS = {
  forYou: { id: 'forYou', label: 'For you' },
  following: { id: 'following', label: 'Following' },
} as const;

/**
 * Find Twitter's tab element by text content.
 */
function findTab(tabName: string): HTMLElement | null {
  const tabs = document.querySelectorAll('[role="tab"]');
  for (const tab of tabs) {
    const text = tab.textContent?.trim();
    if (text?.toLowerCase().includes(tabName.toLowerCase())) {
      return tab as HTMLElement;
    }
  }
  return null;
}

/**
 * Check if we're on the home feed (For You or Following).
 */
function isHomeFeed(url: string): boolean {
  try {
    const path = new URL(url).pathname;
    return path === '/' || path === '/home' || path === '/following';
  } catch {
    return false;
  }
}

/**
 * Extract Twitter's nav items (icons, labels, hrefs).
 */
function extractNavItems(): NavItem[] {
  const items: NavItem[] = [];

  const homeLink = document.querySelector('[data-testid="AppTabBar_Home_Link"]');
  if (!homeLink) {
    log.debug('AppTabBar_Home_Link not found');
    return items;
  }

  const navContainer = homeLink.closest('nav');
  if (!navContainer) {
    log.debug('No nav container found');
    return items;
  }

  const allLinks = navContainer.querySelectorAll('a[href], [role="link"]');

  allLinks.forEach((link, idx) => {
    const el = link as HTMLElement;
    const testId = el.getAttribute('data-testid') || '';
    const href = el.getAttribute('href') || '';
    const ariaLabel = el.getAttribute('aria-label') || '';

    // Get SVG and clean it
    const svg = el.querySelector('svg');
    let svgHtml = '';
    if (svg) {
      const clone = svg.cloneNode(true) as SVGElement;
      clone.removeAttribute('class');
      clone.querySelectorAll('[class]').forEach(el => el.removeAttribute('class'));
      svgHtml = clone.outerHTML;
    }

    const textSpan = el.querySelector('span');
    const label = textSpan?.textContent?.trim() || ariaLabel || '';

    if (href || testId) {
      let id = '';
      if (testId.includes('Home')) id = 'home';
      else if (testId.includes('Explore')) id = 'explore';
      else if (testId.includes('Notifications')) id = 'notifications';
      else if (testId.includes('DirectMessage')) id = 'messages';
      else if (testId.includes('Grok')) id = 'grok';
      else if (testId.includes('Profile')) id = 'profile';
      else if (testId.includes('premium')) id = 'premium';
      else if (href.includes('/grok')) id = 'grok';
      else if (href.includes('/premium')) id = 'premium';
      else if (href.includes('/bookmarks')) id = 'bookmarks';
      else if (href.includes('/lists')) id = 'lists';
      else if (href.includes('/communities')) id = 'communities';
      else if (href) id = href.replace(/^\//, '').replace(/\//g, '-') || 'unknown';
      else id = `nav-${idx}`;

      const cleanLabel = label === 'Search and explore' ? 'Explore' :
                         label === 'Direct Messages' ? 'Messages' : label;

      items.push({
        id,
        label: cleanLabel || id,
        href: href || '#',
        svg: svgHtml,
        testId,
      });
    }
  });

  log.debug(`Extracted ${items.length} nav items`);
  return items;
}

/**
 * Extract Twitter's compose button SVG icon.
 */
function extractComposeIcon(): string | null {
  const composeBtn = document.querySelector('[data-testid="SideNav_NewTweet_Button"]');
  if (!composeBtn) return null;

  const svg = composeBtn.querySelector('svg');
  if (!svg) return null;

  const clone = svg.cloneNode(true) as SVGElement;
  clone.removeAttribute('class');
  clone.querySelectorAll('[class]').forEach(el => el.removeAttribute('class'));
  return clone.outerHTML;
}

/**
 * Detect which Twitter tab is currently active.
 */
function getActiveFeedTab(): FeedTab | null {
  const selected = document.querySelector('[role="tab"][aria-selected="true"]');
  const selectedText = selected?.textContent?.trim().toLowerCase() || '';

  if (selectedText.includes('following')) return TABS.following;
  if (selectedText.includes('for you') || selectedText.includes('for-you')) return TABS.forYou;

  // Fallback checks
  const followingTab = findTab('Following');
  if (followingTab?.getAttribute('aria-selected') === 'true') {
    return TABS.following;
  }
  const forYouTab = findTab('For you');
  if (forYouTab?.getAttribute('aria-selected') === 'true') {
    return TABS.forYou;
  }

  return null;
}

/**
 * Click a Twitter tab to switch feeds.
 */
function activateFeedTab(tabId: string): boolean {
  const tabName = tabId === 'forYou' ? 'For you' : 'Following';
  log.debug(`Attempting to activate "${tabName}" tab`);

  const tab = findTab(tabName);
  if (tab) {
    tab.click();
    return true;
  }

  log.warn(`Tab "${tabName}" not found`);
  return false;
}

/**
 * Watch for Twitter switching to the For You tab.
 * Used when Cocoon overlay is hidden (Following tab) to detect switch back.
 */
function watchFeedTabChange(onSwitch: (tabId: string) => void): () => void {
  let stopped = false;
  let pollId: ReturnType<typeof setInterval> | null = null;

  const check = () => {
    if (stopped) return;
    const activeTab = getActiveFeedTab();
    if (activeTab?.id === 'forYou') {
      log.info('For You tab became active');
      onSwitch('forYou');
    }
  };

  log.debug('Starting tab change watcher');
  pollId = setInterval(check, 250);
  check();

  return () => {
    stopped = true;
    if (pollId) clearInterval(pollId);
    log.debug('Stopped tab change watcher');
  };
}

/**
 * Check if feed switcher is supported for the current URL.
 */
function supportsFeedSwitcher(url: string): boolean {
  return isHomeFeed(url);
}

/**
 * Get HTML for feed switcher UI.
 */
function getFeedSwitcherHtml(activeTabId: string | null): string {
  const isFollowing = activeTabId === 'following';

  return `
    <div class="cocoon-feed-switcher">
      <button type="button" class="cocoon-feed-switch-btn${!isFollowing ? ' active' : ''}" data-tab="forYou">For You</button>
      <span class="cocoon-feed-switch-divider">/</span>
      <button type="button" class="cocoon-feed-switch-btn${isFollowing ? ' active' : ''}" data-tab="following">Following</button>
    </div>
  `;
}

/**
 * Attach click handlers to feed switcher buttons.
 */
function attachFeedSwitcherHandlers(
  container: HTMLElement,
  onSwitch: (tabId: string) => void
): void {
  const buttons = container.querySelectorAll('.cocoon-feed-switch-btn');

  buttons.forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      const tabId = (btn as HTMLElement).dataset.tab;
      if (!tabId) return;

      log.debug(`Feed switcher clicked: ${tabId}`);

      // Update UI immediately
      const allBtns = container.querySelectorAll('.cocoon-feed-switch-btn');
      allBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');

      // Click the native Twitter tab
      const clicked = activateFeedTab(tabId);
      if (clicked) {
        // Notify after a small delay for Twitter to start loading
        setTimeout(() => onSwitch(tabId), 100);
      }
    });
  });
}

/**
 * Handle compose button click.
 * Navigates to user's profile first (unfiltered), then opens compose modal.
 */
function handleComposeClick(e: Event, currentUsername: string | null): void {
  e.preventDefault();

  if (!currentUsername) {
    window.location.href = 'https://x.com/compose/post';
    return;
  }

  const profileUrl = `https://x.com/${currentUsername}`;
  log.debug(`Compose: navigating to profile first (${profileUrl})`);

  // Store intent to open compose after profile loads
  try {
    sessionStorage.setItem(COMPOSE_PENDING_KEY, Date.now().toString());
  } catch {
    // ignore
  }

  window.location.href = profileUrl;
}

/**
 * Check for pending compose intent and trigger compose modal.
 */
function checkPendingCompose(): void {
  try {
    const pending = sessionStorage.getItem(COMPOSE_PENDING_KEY);
    if (!pending) return;

    sessionStorage.removeItem(COMPOSE_PENDING_KEY);

    // Check if it's recent (within 10 seconds)
    const timestamp = parseInt(pending, 10);
    if (Date.now() - timestamp > 10000) {
      log.debug('Compose pending too old, ignoring');
      return;
    }

    log.debug('Pending compose detected, waiting for Twitter to be ready');

    const waitForTwitterReady = (): Promise<void> => {
      return new Promise((resolve) => {
        const maxWait = 5000;
        const start = Date.now();

        const check = () => {
          const composeBtn = document.querySelector('[data-testid="SideNav_NewTweet_Button"]');
          const primaryCol = document.querySelector('[data-testid="primaryColumn"]');
          const reactRoot = document.getElementById('react-root');
          const hasReactContent = reactRoot && reactRoot.children.length > 0 &&
                                  reactRoot.querySelector('[data-testid]');

          if ((composeBtn || primaryCol) && hasReactContent) {
            log.debug('Twitter app ready, opening compose');
            resolve();
            return;
          }

          if (Date.now() - start > maxWait) {
            log.debug('Twitter ready timeout, attempting compose anyway');
            resolve();
            return;
          }

          requestAnimationFrame(check);
        };

        check();
      });
    };

    waitForTwitterReady().then(() => {
      setTimeout(() => {
        const twitterComposeBtn = document.querySelector('[data-testid="SideNav_NewTweet_Button"]') as HTMLElement;
        if (twitterComposeBtn) {
          log.debug('Clicking Twitter compose button');
          twitterComposeBtn.click();
        } else {
          log.debug('Navigating to compose URL');
          window.location.href = 'https://x.com/compose/post';
        }
      }, 100);
    });
  } catch {
    // ignore
  }
}

/**
 * Twitter navigation provider.
 */
export const twitterNavigation: NavigationProvider = {
  extractNavItems,
  extractComposeIcon,
  getActiveFeedTab,
  activateFeedTab,
  watchFeedTabChange,
  supportsFeedSwitcher,
  getFeedSwitcherHtml,
  attachFeedSwitcherHandlers,
  handleComposeClick,
  checkPendingCompose,
};
