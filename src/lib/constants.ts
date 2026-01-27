/**
 * Shared constants used across the extension.
 * Single source of truth for IDs, keys, and magic values.
 */

// DOM element IDs
export const OVERLAY_ID = '__cocoon_overlay';
export const PREHIDE_STYLE_ID = '__cocoon_prehide_style';
export const CONTENT_STYLES_ID = '__cocoon_content_styles';
export const SHELL_STYLES_ID = '__cocoon_shell_styles';
export const COSMETIC_STYLES_ID = '__cocoon_cosmetic';

// Data attributes
export const READY_ATTR = 'data-cocoon-ready';
export const PREV_VIS_ATTR = 'data-cocoon-prev-visibility';
export const SKELETON_REVEAL_ATTR = 'data-cocoon-skeleton-reveal';

// Cache keys
export const FEED_CACHE_PREFIX = 'cocoon_feed_cache_';
export const NAV_CACHE_KEY = 'cocoon_nav_cache';
export const TWITTER_VARIANT_CACHE_KEY = 'cocoon_twitter_theme_variant';

// Cache TTLs
export const FEED_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes
export const NAV_CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// Layout constants
export const SHELL_SPACING = 20; // Consistent left/right spacing in pixels
export const SHELL_TOP_INSET = 56; // Breathing room below floating header
export const SKELETON_HEIGHT = 160; // Approximate height of each skeleton item
export const SKELETON_GAP = 12; // Gap between skeleton items

// Animation timing
export const MORPH_STAGGER_MS = 70; // Delay between each item's morph animation
export const MORPH_DURATION_MS = 520; // Duration of morph animation
export const INITIAL_SKELETON_MAX = 3; // Max skeletons shown during initial load
