/**
 * Reddit platform adapter.
 * Handles detection, content extraction, and UI rendering for Reddit feeds.
 */

import { registerPlatform } from './registry';
import { escapeHtml, escapeAttr } from '../utils/escape';
import type { PlatformAdapter, ExtractedContent, MediaUrls, FeedItem } from './types';

const HOSTS = ['reddit.com', 'old.reddit.com', 'new.reddit.com'];

// Paths that are NOT feeds (settings, admin, etc.)
const EXCLUDED_PATHS = [
  /^\/settings/,
  /^\/prefs/,
  /^\/admin/,
  /^\/mod/,
  /^\/message/,
  /^\/chat/,
  /^\/coins/,
  /^\/premium/,
  /^\/login/,
  /^\/register/,
  /^\/account/,
];

// Paths that ARE feeds
const FEED_PATHS = [
  /^\/$/,                          // Home
  /^\/home/,                       // Home explicit
  /^\/r\/[^/]+/,                   // Any subreddit path (hot, new, top, etc.)
  /^\/user\/[^/]+/,                // User profiles
  /^\/u\/[^/]+/,                   // User profiles (alt)
  /^\/search/,                     // Search results
  /^\/best/,
  /^\/hot/,
  /^\/new/,
  /^\/top/,
  /^\/rising/,
];

function normalizeWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

function formatNumber(n: number): string {
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return n.toString();
}

function extractCommentContent(el: Element): ExtractedContent {
  // Comment text is the main content
  const text = normalizeWhitespace(el.textContent || '');

  // Try to find author from nearby elements or parent comment structure
  let authorHandle: string | undefined;
  const parent = el.closest('shreddit-comment');
  if (parent) {
    const authorAttr = parent.getAttribute('author');
    if (authorAttr) authorHandle = `u/${authorAttr}`;
  }

  return {
    text,
    author: authorHandle ? { handle: authorHandle } : undefined,
  };
}

const redditPlatform: PlatformAdapter = {
  name: 'reddit',
  algorithmName: 'Reddit\'s algorithm',

  getScrollContainer(): Element | null {
    // Reddit uses a scrollable container for the feed
    // Try common selectors for Reddit's scroll container
    const selectors = [
      'shreddit-app',                           // New Reddit app shell
      '[data-scroller-first]',                  // Reddit's virtual scroller
      'main#main-content',                      // Main content area
      '#SHORTCUT_FOCUSABLE_DIV > div:first-child', // Old fallback
    ];

    for (const sel of selectors) {
      const el = document.querySelector(sel);
      if (el && el.scrollHeight > el.clientHeight) {
        return el;
      }
    }

    // Fallback: find the element containing articles that's scrollable
    const main = document.querySelector('main');
    if (main) {
      let current: Element | null = main;
      while (current) {
        if (current.scrollHeight > current.clientHeight) {
          const style = getComputedStyle(current);
          if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
            return current;
          }
        }
        current = current.parentElement;
      }
    }

    return null;
  },

  matchesSite(url: string): boolean {
    try {
      const parsed = new URL(url);
      const host = parsed.hostname.replace(/^www\./, '');
      const path = parsed.pathname;

      if (!HOSTS.some(h => host === h || host.endsWith('.' + h))) return false;
      if (EXCLUDED_PATHS.some(p => p.test(path))) return false;
      if (!FEED_PATHS.some(p => p.test(path))) return false;
      return true;
    } catch {
      return false;
    }
  },

  isFeedItem(el: Element): boolean {
    // Reddit uses <article> elements or shreddit-post custom elements for posts
    if (el.tagName === 'ARTICLE') return true;
    if (el.tagName === 'SHREDDIT-POST') return true;

    // Comments have IDs like "t1_abc123-comment-rtjson-content"
    // Must match the specific comment content div, not containers
    if (el.id && /^t1_\w+-comment-rtjson-content$/.test(el.id)) return true;

    // Individual comment elements
    if (el.tagName === 'SHREDDIT-COMMENT') return true;

    return false;
  },

  extractContent(el: Element): ExtractedContent {
    // Check if this is a comment
    const isComment = el.id?.includes('-comment') ||
                      el.tagName === 'SHREDDIT-COMMENT' ||
                      el.querySelector('shreddit-comment') !== null;

    if (isComment) {
      return extractCommentContent(el);
    }

    // Get the shreddit-post element if we're on the article wrapper
    const post = el.tagName === 'SHREDDIT-POST' ? el : el.querySelector('shreddit-post') || el;

    // Title - from the title link
    const titleLink = post.querySelector('a.block.m-0, a[slot="title"], [slot="title"] a');
    const title = titleLink ? normalizeWhitespace(titleLink.textContent || '') : '';

    // Post URL
    let postUrl: string | undefined;
    const links = post.querySelectorAll('a[href*="/comments/"]');
    for (const link of links) {
      const href = link.getAttribute('href');
      if (href && href.includes('/r/') && href.includes('/comments/')) {
        postUrl = href.startsWith('/') ? href : new URL(href).pathname;
        break;
      }
    }

    // Subreddit
    const subredditLink = post.querySelector('a[data-testid="subreddit-name"], a[href^="/r/"]');
    let subreddit: string | undefined;
    if (subredditLink) {
      const text = subredditLink.textContent || '';
      subreddit = text.startsWith('r/') ? text : undefined;
      if (!subreddit) {
        const href = subredditLink.getAttribute('href');
        const match = href?.match(/\/r\/([^/]+)/);
        if (match) subreddit = `r/${match[1]}`;
      }
    }

    // Post body text (if text post)
    let bodyText = '';
    const textBody = post.querySelector('shreddit-post-text-body, [slot="text-body"]');
    if (textBody) {
      bodyText = normalizeWhitespace(textBody.textContent || '');
    }

    // Timestamp
    let timestamp: string | undefined;
    const timeText = post.textContent?.match(/(\d+\s*(?:min|hour|day|week|month|year)s?\s*ago)/i);
    if (timeText) {
      timestamp = timeText[1];
    }

    // Check for media
    const hasVideo = post.querySelector('video, shreddit-player, [data-testid="video-player"]') !== null;
    const hasImage = post.querySelector('img[alt*="- "]') !== null; // Post images have "subreddit - title" alt

    // Build text output
    const parts: string[] = [];
    if (title) parts.push(title);
    if (bodyText) parts.push(bodyText);
    if (hasVideo) parts.push('[video]');
    if (hasImage && !hasVideo) parts.push('[image]');

    return {
      text: parts.join(' '),
      title,
      author: subreddit ? { handle: subreddit } : undefined,
      url: postUrl,
      timestamp,
      hasVideo,
    };
  },

  extractMediaUrls(el: Element): MediaUrls {
    // Comments don't have media attachments
    const isComment = el.id?.includes('-comment') || el.tagName === 'SHREDDIT-COMMENT';
    if (isComment) {
      return { main: [], quote: [] };
    }

    const mainMedia: string[] = [];

    // Only extract from actual post elements, not containers
    const post = el.tagName === 'SHREDDIT-POST' ? el :
                 el.tagName === 'ARTICLE' ? el.querySelector('shreddit-post') || el :
                 null;

    if (!post) {
      return { main: [], quote: [] };
    }

    // Find post images (not icons/avatars/ads)
    const images = post.querySelectorAll('img');
    for (const img of images) {
      const src = (img as HTMLImageElement).src;
      const alt = (img as HTMLImageElement).alt || '';

      // Skip subreddit icons and banners
      if (alt.includes('icon') || alt.includes('banner') || alt === '') continue;
      if (src.includes('styles.redditmedia.com')) continue;
      if (src.includes('avatar')) continue;

      // Skip ad-related images
      if (src.includes('redditmedia.com/ads')) continue;
      if (src.includes('redditstatic.com')) continue;

      // Post images typically have "subreddit - title" in alt or are from reddit's CDN
      if (alt.includes(' - ') || src.includes('preview.redd.it') || src.includes('i.redd.it')) {
        if (!mainMedia.includes(src)) mainMedia.push(src);
      }
    }

    // Video poster
    const videos = post.querySelectorAll('video[poster]');
    for (const video of videos) {
      const poster = (video as HTMLVideoElement).poster;
      if (poster && !mainMedia.includes(poster)) {
        mainMedia.push(poster);
      }
    }

    return {
      main: mainMedia.slice(0, 4),
      quote: [],
    };
  },

  renderItem(item: FeedItem, index: number): string {
    const itemId = `cocoon-item-${index}`;
    const postUrl = item.url ? `https://reddit.com${item.url}` : '';

    // Header with subreddit and timestamp
    const headerParts: string[] = [];
    if (item.author?.handle) {
      headerParts.push(`<a class="cocoon-subreddit" href="https://reddit.com/${item.author.handle}" target="_blank" rel="noopener">${escapeHtml(item.author.handle)}</a>`);
    }
    if (item.timestamp) {
      headerParts.push(`<span class="cocoon-timestamp">${escapeHtml(item.timestamp)}</span>`);
    }
    const headerHtml = headerParts.length > 0
      ? `<div class="cocoon-item-header">${headerParts.join('<span class="cocoon-separator">·</span>')}</div>`
      : '';

    // Title
    const titleHtml = item.title
      ? `<div class="cocoon-item-title">${escapeHtml(item.title)}</div>`
      : '';

    // Body text (excluding title)
    const bodyText = item.text.replace(item.title || '', '').replace(/^\s*/, '');
    const cleanBody = bodyText.replace(/\s*\[(video|image)\]\s*/g, '').trim();

    // Truncation for long posts
    const truncateThreshold = 300;
    const needsTruncation = cleanBody.length > truncateThreshold;
    const truncatedBody = needsTruncation
      ? cleanBody.substring(0, truncateThreshold).replace(/\s+\S*$/, '') + '...'
      : cleanBody;

    const bodyHtml = cleanBody
      ? `<div class="cocoon-item-text">${escapeHtml(needsTruncation ? truncatedBody : cleanBody)}</div>`
      : '';

    const showMoreBtn = needsTruncation
      ? `<button class="cocoon-show-more" data-target="${itemId}" data-full="${escapeAttr(escapeHtml(cleanBody))}" data-short="${escapeAttr(escapeHtml(truncatedBody))}">Show more</button>`
      : '';

    // Media
    const hasVideo = item.hasVideo || false;
    const mediaHtml = item.mediaUrls.length > 0
      ? `<div class="cocoon-item-media${hasVideo ? ' cocoon-has-video' : ''}">${item.mediaUrls.map(url =>
          `<img src="${escapeHtml(url)}" loading="lazy" alt="" />`
        ).join('')}${hasVideo ? '<div class="cocoon-video-indicator">▶</div>' : ''}</div>`
      : '';

    // Metrics (if available)
    let metricsHtml = '';
    if (item.metrics && (item.metrics.likes || item.metrics.replies)) {
      const parts: string[] = [];
      if (item.metrics.likes) parts.push(`<span class="cocoon-metric">↑ ${formatNumber(item.metrics.likes)}</span>`);
      if (item.metrics.replies) parts.push(`<span class="cocoon-metric">💬 ${formatNumber(item.metrics.replies)}</span>`);
      metricsHtml = `<div class="cocoon-metrics">${parts.join('')}</div>`;
    }

    return `
      <div class="cocoon-item${postUrl ? ' cocoon-item-clickable' : ''}" id="${itemId}" ${postUrl ? `data-post-url="${escapeAttr(postUrl)}"` : ''}>
        ${headerHtml}
        ${titleHtml}
        ${bodyHtml}
        ${showMoreBtn}
        ${mediaHtml}
        ${metricsHtml}
      </div>
    `;
  },

  getStyles(): string {
    // X.com Lights Out dark theme
    return `
      .cocoon-item {
        background: #16181C;
        border: 1px solid #2F3336;
        border-radius: 12px;
        padding: 16px;
        animation: cocoon-item-in 0.3s ease-out;
      }

      .cocoon-item-clickable {
        cursor: pointer;
        transition: background 0.15s;
      }

      .cocoon-item-clickable:hover {
        background: #202327;
      }

      .cocoon-item-header {
        display: flex;
        align-items: center;
        gap: 6px;
        font-size: 13px;
        color: #71767B;
        margin-bottom: 8px;
      }

      .cocoon-subreddit {
        color: #ff4500;
        text-decoration: none;
        font-weight: 500;
      }

      .cocoon-subreddit:hover {
        text-decoration: underline;
      }

      .cocoon-timestamp {
        color: #71767B;
      }

      .cocoon-separator {
        color: #2F3336;
      }

      .cocoon-item-title {
        font-weight: 600;
        font-size: 16px;
        margin-bottom: 8px;
        color: #E7E9EA;
        line-height: 1.3;
      }

      .cocoon-item-text {
        font-size: 14px;
        line-height: 1.5;
        color: #E7E9EA;
        white-space: pre-wrap;
        word-wrap: break-word;
      }

      .cocoon-show-more {
        background: none;
        border: none;
        color: #ff4500;
        font-size: 14px;
        padding: 4px 0;
        margin-top: 4px;
        cursor: pointer;
        display: block;
      }

      .cocoon-show-more:hover {
        text-decoration: underline;
      }

      .cocoon-metrics {
        display: flex;
        gap: 12px;
        margin-top: 10px;
        padding-top: 10px;
        border-top: 1px solid #2F3336;
      }

      .cocoon-metric {
        font-size: 13px;
        color: #71767B;
      }

      .cocoon-item-media {
        position: relative;
        margin-top: 12px;
        display: grid;
        grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
        gap: 8px;
      }

      .cocoon-item-media img {
        width: 100%;
        border-radius: 8px;
        object-fit: cover;
        max-height: 400px;
      }

      .cocoon-has-video .cocoon-video-indicator {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        width: 48px;
        height: 48px;
        background: rgba(0, 0, 0, 0.6);
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        color: white;
        font-size: 18px;
        pointer-events: none;
      }

      @keyframes cocoon-item-in {
        from {
          opacity: 0;
          transform: translateY(8px);
        }
        to {
          opacity: 1;
          transform: translateY(0);
        }
      }
    `;
  },
};

// STUBBED: Reddit platform temporarily disabled for Twitter-only launch
// To re-enable: uncomment the registerPlatform call and add import in index.ts
// registerPlatform(redditPlatform);

export default redditPlatform;
