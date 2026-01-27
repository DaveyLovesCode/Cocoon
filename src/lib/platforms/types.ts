/**
 * Platform adapter interfaces for feed-based sites.
 *
 * Architecture:
 * - PlatformAdapter: Core content extraction and rendering
 * - FeedContextProvider: URL parsing and feed context detection
 * - NavigationProvider: Nav bar, tab switching, compose button
 * - PlatformInitProvider: Settings init, theme detection, early hide
 *
 * Each platform implements these as needed. Content scripts call through
 * the Platform interface without knowing which platform they're on.
 */

// ============================================================================
// COMMON TYPES
// ============================================================================

export type FeedContext = 'home' | 'profile' | 'search' | 'status';

export type FeedTab = {
  id: string;
  label: string;
};

export interface ThemeInfo {
  variant: string;
  mode: 'light' | 'dark';
}

export interface NavItem {
  id: string;
  label: string;
  href: string;
  svg: string;
  testId: string;
}

// ============================================================================
// CORE PLATFORM ADAPTER (Content extraction and rendering)
// ============================================================================

export interface PlatformAdapter {
  /** Platform identifier (e.g., 'twitter', 'reddit') */
  name: string;

  /** Human-readable name for the platform's algorithm (e.g., "the X algorithm") */
  algorithmName: string;

  /** Check if URL belongs to this platform */
  matchesSite(url: string): boolean;

  /** Check if element is a feed item on this platform */
  isFeedItem(el: Element): boolean;

  /** Extract content from a feed item element */
  extractContent(el: Element): ExtractedContent;

  /** Expand truncated content (e.g., "Show more" buttons) */
  expandTruncatedContent?(el: Element): Promise<void>;

  /** Extract media URLs from element, separating main vs quoted content */
  extractMediaUrls(el: Element): MediaUrls;

  /** Render a feed item for the overlay UI */
  renderItem(item: FeedItem, index: number): string;

  /** Get CSS styles for rendered items */
  getStyles(): string;

  /** Optional: custom system prompt for this platform */
  getSystemPrompt?(): string;

  /** Optional: return the scroll container element (if not window-level scroll) */
  getScrollContainer?(): Element | null;

  /**
   * Optional: return how many feed items are currently rendered.
   * Used to gate cocooning on slow/infinite-scroll loads.
   */
  getRenderedFeedItemCount?(): number;

  /**
   * Optional: minimum number of feed items required before segmentation is considered successful.
   * (e.g. status pages may only need 1 item).
   */
  getMinExpectedFeedItems?(url: string): number;

  /**
   * Extract search query from URL if on a search page.
   * Returns the search term, or null if not a search page.
   */
  getSearchQuery?(url: string): string | null;

  /** Get scroll strategy for this platform. Overrides generic detection. */
  getScrollStrategy?(): ScrollStrategy;
}

export interface ScrollStrategy {
  /** The scrollable element. Null = window scrolling is safe. */
  container: Element | null;

  /** Whether site uses virtualization (recycles DOM nodes) */
  isVirtualized: boolean;

  /** Whether window scrolling should be attempted as fallback */
  windowScrollable: boolean;
}

export interface ExtractedContent {
  /** Primary text content */
  text: string;

  /** Title if present */
  title?: string;

  /** Author info */
  author?: {
    name?: string;
    handle?: string;
  };

  /** Link to the original content */
  url?: string;

  /** Timestamp string */
  timestamp?: string;

  /** Engagement metrics */
  metrics?: {
    replies?: number;
    likes?: number;
    shares?: number;
    views?: number;
  };

  /** Has video content */
  hasVideo?: boolean;

  /** Video URL for playback (m3u8 or mp4) */
  videoUrl?: string;

  /** Tweet/post status ID for video URL lookup */
  statusId?: string;

  /** HTML with links preserved */
  html?: string;

  /** Quoted/embedded content */
  quote?: {
    text: string;
    url?: string;
    html?: string;
  };
}

export interface MediaUrls {
  main: string[];
  quote: string[];
}

/**
 * Feed item data passed to renderers.
 * Combines extracted content with block metadata.
 */
export interface FeedItem {
  id: string;
  text: string;
  title?: string;
  author?: {
    name?: string;
    handle?: string;
  };
  url?: string;
  timestamp?: string;
  metrics?: {
    replies?: number;
    likes?: number;
    shares?: number;
    views?: number;
  };
  hasVideo?: boolean;
  videoUrl?: string;
  statusId?: string;
  html?: string;
  quote?: {
    text: string;
    url?: string;
    html?: string;
  };
  mediaUrls: string[];
  quoteMediaUrls: string[];
}

// ============================================================================
// FEED CONTEXT PROVIDER (URL parsing, context detection)
// ============================================================================

export interface FeedContextProvider {
  /**
   * Normalize a URL (e.g., x.com/ → x.com/home).
   * Returns the URL unchanged if no normalization needed.
   */
  normalizeUrl(url: string): string;

  /**
   * Determine feed context from URL.
   * Returns null if URL is not a recognized feed page.
   */
  getFeedContext(url: string): FeedContext | null;

  /**
   * Check if URL is the current user's own profile.
   * Own profiles are shown unfiltered.
   */
  isOwnProfileUrl(url: string, username: string | null): boolean;

  /**
   * Get the number of viewport screens to scan for initial load.
   * Different page types may need different amounts.
   */
  getInitialScanScreens(url: string): number;
}

// ============================================================================
// NAVIGATION PROVIDER (Nav bar, tabs, compose)
// ============================================================================

export interface NavigationProvider {
  /**
   * Extract navigation items from the page.
   * Returns empty array if nav not found.
   */
  extractNavItems(): NavItem[];

  /**
   * Extract compose button icon SVG.
   * Returns null if not found.
   */
  extractComposeIcon(): string | null;

  /**
   * Get the currently active feed tab (e.g., 'forYou' or 'following').
   * Returns null if tabs not found or not on a tabbed feed.
   */
  getActiveFeedTab(): FeedTab | null;

  /**
   * Activate a feed tab by clicking it.
   * Returns true if successful.
   */
  activateFeedTab(tabId: string): boolean;

  /**
   * Watch for native tab changes (when overlay is hidden).
   * Returns cleanup function.
   */
  watchFeedTabChange(onSwitch: (tabId: string) => void): () => void;

  /**
   * Check if feed switcher is supported for the current URL.
   */
  supportsFeedSwitcher(url: string): boolean;

  /**
   * Get HTML for feed switcher UI.
   */
  getFeedSwitcherHtml(activeTabId: string | null): string;

  /**
   * Attach event handlers to feed switcher.
   * onSwitch is called when user clicks a tab.
   */
  attachFeedSwitcherHandlers(
    container: HTMLElement,
    onSwitch: (tabId: string) => void
  ): void;

  /**
   * Handle compose button click.
   * May navigate to a page or open a modal.
   */
  handleComposeClick(e: Event, currentUsername: string | null): void;

  /**
   * Check for and execute pending compose intent.
   * Called when landing on a page that should trigger compose.
   */
  checkPendingCompose(): void;
}

// ============================================================================
// PLATFORM INIT PROVIDER (Settings, theme, early hide)
// ============================================================================

export interface PlatformInitProvider {
  /**
   * Initialize render settings from storage.
   * Called once during page init.
   */
  initRenderSettings(): Promise<void>;

  /**
   * Detect current theme from the platform's UI.
   * Returns null if detection not supported.
   */
  detectTheme(): ThemeInfo | null;

  /**
   * Refresh theme cache (for fast subsequent loads).
   */
  refreshThemeCache(): void;

  /**
   * Get CSS for early page hiding (injected by hide-immediate.js).
   * Used to hide platform-specific elements before content script runs.
   */
  getEarlyHideStyles(): string;

  /**
   * Wait for the feed to be ready before processing.
   * Resolves when platform-specific elements are present.
   */
  waitForFeedReady(url: string, signal: AbortSignal): Promise<void>;

  /**
   * Initialize video players for rendered content.
   */
  initializeVideoPlayers(): Promise<void>;
}

// ============================================================================
// COMBINED PLATFORM INTERFACE
// ============================================================================

/**
 * Complete platform definition.
 * All platform-specific code is accessed through this interface.
 */
export interface Platform {
  /** Platform identifier */
  name: string;

  /** Core content adapter */
  adapter: PlatformAdapter;

  /** URL and context handling */
  context: FeedContextProvider;

  /** Navigation UI (optional - some platforms may not have nav) */
  navigation?: NavigationProvider;

  /** Initialization hooks (optional) */
  init?: PlatformInitProvider;
}
