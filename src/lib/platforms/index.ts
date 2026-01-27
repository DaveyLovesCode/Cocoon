/**
 * Platform adapters for feed-based sites.
 *
 * Each platform provides:
 * - adapter: Content extraction and UI rendering
 * - context: URL parsing and feed context detection
 * - navigation: Nav bar, tabs, compose button (optional)
 * - init: Settings, theme, early hide, video players (optional)
 */

// Types
export type {
  Platform,
  PlatformAdapter,
  FeedContextProvider,
  NavigationProvider,
  PlatformInitProvider,
  ExtractedContent,
  MediaUrls,
  FeedItem,
  ScrollStrategy,
  FeedContext,
  FeedTab,
  ThemeInfo,
  NavItem,
} from './types';

// Registry
export {
  registerPlatform,
  getPlatformForUrl,
  getAdapterForUrl,
  isFeedSite,
  getRegisteredPlatforms,
} from './registry';

// Load all platform adapters (they self-register on import)
import './twitter';
// STUBBED: Reddit disabled for Twitter-only launch. To re-enable: uncomment and enable registration in reddit.ts
// import './reddit';
