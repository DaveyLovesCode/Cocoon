/**
 * Twitter/X platform adapter.
 * Handles content extraction, media extraction, and item rendering.
 */

import { getFeedItemStyles } from './styles';
import { getRenderSettings, extractStatusId } from './init';
import { escapeHtml, escapeAttr } from '../../utils/escape';
import { normalizeWhitespace, formatNumber } from '../../utils/text';
import { SITES, isSupportedFeedUrl } from '../../sites';
import type {
  PlatformAdapter,
  ExtractedContent,
  MediaUrls,
  FeedItem,
  ScrollStrategy,
} from '../types';

const twitterSite = SITES.twitter;

/**
 * Parse metric number from aria-label.
 */
export function parseMetricNumber(ariaLabel: string): number | undefined {
  const match = ariaLabel.match(/^([\d,]+)/);
  if (match) {
    return parseInt(match[1].replace(/,/g, ''), 10);
  }
  return undefined;
}

/**
 * Convert tweet text element to HTML with links.
 */
export function convertTweetTextToHtml(tweetText: Element): string {
  const clone = tweetText.cloneNode(true) as Element;

  const links = clone.querySelectorAll('a');
  for (const link of links) {
    const href = link.getAttribute('href') || '';
    if (href.startsWith('/')) {
      link.setAttribute('href', 'https://x.com' + href);
    }
    link.setAttribute('target', '_blank');
    link.setAttribute('rel', 'noopener');
    link.className = 'text-cocoon-accent no-underline hover:underline';
  }

  const emojis = clone.querySelectorAll('img[alt]');
  for (const emoji of emojis) {
    const alt = emoji.getAttribute('alt') || '';
    if (alt) {
      const textNode = document.createTextNode(alt);
      emoji.parentNode?.replaceChild(textNode, emoji);
    }
  }

  return clone.innerHTML;
}

/**
 * Twitter platform adapter.
 */
export const twitterAdapter: PlatformAdapter = {
  name: 'twitter',
  algorithmName: 'the X algorithm',

  getScrollStrategy(): ScrollStrategy {
    return {
      container: null,
      isVirtualized: true,
      windowScrollable: true,
    };
  },

  getRenderedFeedItemCount(): number {
    const tweetEls = document.querySelectorAll('article[data-testid="tweet"], [data-testid="tweet"]');
    if (tweetEls.length > 0) return tweetEls.length;

    const cells = document.querySelectorAll('[data-testid="cellInnerDiv"]');
    if (cells.length > 0) {
      let count = 0;
      for (const cell of Array.from(cells)) {
        if (cell.querySelector('[data-testid="tweetText"]')) count++;
      }
      if (count > 0) return count;
    }

    return document.querySelectorAll('[data-testid="tweetText"]').length;
  },

  getMinExpectedFeedItems(url: string): number {
    try {
      const pathname = new URL(url).pathname;
      if (pathname === '/' || pathname === '/home') return 5;
      return 1;
    } catch {
      return 5;
    }
  },

  getSearchQuery(url: string): string | null {
    try {
      const parsed = new URL(url);
      if (parsed.pathname === '/search') {
        return parsed.searchParams.get('q');
      }
    } catch {
      // ignore
    }
    return null;
  },

  matchesSite(url: string): boolean {
    try {
      const host = new URL(url).hostname.replace(/^www\./, '');
      if (!twitterSite.domains.some(d => host === d || host.endsWith('.' + d))) {
        return false;
      }
      return isSupportedFeedUrl(url);
    } catch {
      return false;
    }
  },

  isFeedItem(el: Element): boolean {
    return el.getAttribute('data-testid') === 'tweet';
  },

  extractContent(el: Element): ExtractedContent {
    const parts: string[] = [];

    // Find quote container first
    let quoteContainer: Element | null = null;
    const potentialQuotes = el.querySelectorAll('div[role="link"]');
    for (const pq of potentialQuotes) {
      if (pq.querySelector('[data-testid="tweetText"]') || (pq.textContent?.length || 0) > 50) {
        quoteContainer = pq;
        break;
      }
    }

    // Get all tweetText divs
    const tweetTexts = el.querySelectorAll('[data-testid="tweetText"]');
    let quoteText = '';
    let quoteHtml: string | undefined;

    tweetTexts.forEach((tt, i) => {
      const text = normalizeWhitespace(tt.textContent || '');
      if (text.length === 0) return;

      const isQuote = tt.closest('div[role="link"]') !== null;
      if (isQuote && i > 0) {
        quoteText = text;
        quoteHtml = convertTweetTextToHtml(tt);
      } else {
        parts.push(text);
      }
    });

    // Note media attachments
    const hasVideo = el.querySelector('[data-testid="videoPlayer"], [data-testid="videoComponent"], video') !== null;
    const mediaImages = el.querySelectorAll('[data-testid="tweetPhoto"] img, img[src*="pbs.twimg.com/media"]');
    const imageCount = mediaImages.length;

    if (hasVideo) parts.push('[video attached]');
    if (imageCount > 0) parts.push(`[${imageCount} image${imageCount > 1 ? 's' : ''} attached]`);

    // Extract author info
    const userNameContainer = el.querySelector('[data-testid="User-Name"]');
    let authorName: string | undefined;
    let authorHandle: string | undefined;

    if (userNameContainer) {
      const nameLink = userNameContainer.querySelector('a[href^="/"]');
      if (nameLink) authorName = normalizeWhitespace(nameLink.textContent || '');

      const links = userNameContainer.querySelectorAll('a[href^="/"]');
      for (const link of links) {
        const text = link.textContent || '';
        if (text.startsWith('@')) {
          authorHandle = text;
          break;
        }
      }
    }

    // Extract tweet URL and timestamp
    let tweetUrl: string | undefined;
    let timestamp: string | undefined;
    const statusLinks = el.querySelectorAll('a[href*="/status/"]');
    for (const link of statusLinks) {
      if (quoteContainer && quoteContainer.contains(link)) continue;
      const href = link.getAttribute('href');
      if (href && !href.includes('/analytics')) {
        tweetUrl = href;
        const timeEl = link.querySelector('time');
        timestamp = timeEl?.textContent || link.textContent || undefined;
        break;
      }
    }

    // Extract quote URL
    let quoteUrl: string | undefined;
    if (quoteContainer) {
      const quoteStatusLink = quoteContainer.querySelector('a[href*="/status/"]');
      if (quoteStatusLink) {
        const href = quoteStatusLink.getAttribute('href');
        if (href && !href.includes('/analytics')) quoteUrl = href;
      }
      if (!quoteUrl) {
        const allLinks = quoteContainer.querySelectorAll('a[href]');
        for (const link of allLinks) {
          const href = link.getAttribute('href');
          if (href?.includes('/status/') && !href.includes('/analytics')) {
            quoteUrl = href;
            break;
          }
        }
      }
    }

    // Extract metrics
    const metrics: ExtractedContent['metrics'] = {};
    const replyBtn = el.querySelector('[data-testid="reply"]');
    const retweetBtn = el.querySelector('[data-testid="retweet"]');
    const likeBtn = el.querySelector('[data-testid="like"]');
    const viewsLink = el.querySelector('a[href*="/analytics"]');

    if (replyBtn) metrics.replies = parseMetricNumber(replyBtn.getAttribute('aria-label') || '');
    if (retweetBtn) metrics.shares = parseMetricNumber(retweetBtn.getAttribute('aria-label') || '');
    if (likeBtn) metrics.likes = parseMetricNumber(likeBtn.getAttribute('aria-label') || '');
    if (viewsLink) metrics.views = parseMetricNumber(viewsLink.getAttribute('aria-label') || '');

    // Extract main tweet HTML
    let mainHtml: string | undefined;
    for (const tt of tweetTexts) {
      if (quoteContainer && quoteContainer.contains(tt)) continue;
      mainHtml = convertTweetTextToHtml(tt);
      break;
    }

    const statusId = extractStatusId(tweetUrl);

    const result: ExtractedContent = {
      text: parts.join(' '),
      author: (authorName || authorHandle) ? { name: authorName, handle: authorHandle } : undefined,
      url: tweetUrl,
      timestamp,
      metrics: Object.keys(metrics).length > 0 ? metrics : undefined,
      hasVideo,
      statusId,
      html: mainHtml,
    };

    if (quoteText) {
      result.quote = {
        text: quoteText,
        url: quoteUrl,
        html: quoteHtml,
      };
    }

    return result;
  },

  async expandTruncatedContent(el: Element): Promise<void> {
    const showMoreButtons = el.querySelectorAll('button[data-testid="tweet-text-show-more-link"]');
    if (showMoreButtons.length === 0) return;

    for (const btn of showMoreButtons) {
      try {
        const tweetText = btn.previousElementSibling;
        const originalText = tweetText?.textContent || '';

        (btn as HTMLElement).click();

        await new Promise<void>(resolve => {
          let attempts = 0;
          const check = () => {
            attempts++;
            const stillThere = el.contains(btn);
            const newText = tweetText?.textContent || '';
            if (!stillThere || newText.length > originalText.length || attempts >= 10) {
              resolve();
            } else {
              setTimeout(check, 50);
            }
          };
          setTimeout(check, 50);
        });
      } catch {
        // Ignore click failures
      }
    }
  },

  extractMediaUrls(el: Element): MediaUrls {
    const mainMedia: string[] = [];
    const quoteMedia: string[] = [];

    const quoteContainer = el.querySelector('div[role="link"]');

    const tweetPhotos = el.querySelectorAll('[data-testid="tweetPhoto"] img, img[src*="pbs.twimg.com/media"]');
    for (const img of tweetPhotos) {
      const src = (img as HTMLImageElement).src;
      if (!src) continue;

      const url = src.replace(/name=\w+/, 'name=medium');
      const isInQuote = quoteContainer && quoteContainer.contains(img);

      if (isInQuote) {
        if (!quoteMedia.includes(url)) quoteMedia.push(url);
      } else {
        if (!mainMedia.includes(url)) mainMedia.push(url);
      }
    }

    const videos = el.querySelectorAll('video[poster]');
    for (const video of videos) {
      const poster = (video as HTMLVideoElement).poster;
      if (!poster) continue;

      const isInQuote = quoteContainer && quoteContainer.contains(video);

      if (isInQuote) {
        if (!quoteMedia.includes(poster)) quoteMedia.push(poster);
      } else {
        if (!mainMedia.includes(poster)) mainMedia.push(poster);
      }
    }

    return {
      main: mainMedia.slice(0, 4),
      quote: quoteMedia.slice(0, 4),
    };
  },

  renderItem(item: FeedItem, index: number): string {
    const itemId = `cocoon-item-${index}`;
    const settings = getRenderSettings();

    const plainText = (item.text || '')
      .replace(/\s*\[video attached\]/g, '')
      .replace(/\s*\[\d+ images? attached\]/g, '');

    const mainHtml = item.html || escapeHtml(plainText);

    // Use character count to determine if truncation is needed
    const truncateThreshold = 400;
    const needsTruncation = !settings.alwaysExpandTweets && plainText.length > truncateThreshold;

    // Author header
    const authorParts: string[] = [];
    if (item.author?.handle) {
      const handleWithoutAt = item.author.handle.slice(1);
      authorParts.push(`<a class="text-cocoon-muted no-underline font-medium hover:text-cocoon-text hover:underline" href="https://x.com/${handleWithoutAt}">${escapeHtml(item.author.handle)}</a>`);
    }
    if (item.timestamp) {
      authorParts.push(`<span class="text-cocoon-accent">${escapeHtml(item.timestamp)}</span>`);
    }
    const authorHtml = authorParts.length > 0
      ? `<div class="flex items-center gap-1.5 text-[13px] text-cocoon-muted mb-2">${authorParts.join('<span class="text-cocoon-border">·</span>')}</div>`
      : '';

    // Main tweet media
    const hasVideo = item.hasVideo || false;
    let mediaHtml = '';

    if (hasVideo && item.mediaUrls.length > 0) {
      mediaHtml = `<div class="cocoon-has-video relative mt-3 grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-2">${item.mediaUrls.map(url =>
        `<img class="w-full rounded-lg object-cover max-h-[300px]" src="${escapeHtml(url)}" loading="lazy" alt="" />`
      ).join('')}<div class="cocoon-video-indicator w-14 h-14 bg-black/65 rounded-full flex items-center justify-center text-white text-xl pointer-events-none backdrop-blur-sm">▶</div></div>`;
    } else if (item.mediaUrls.length > 0) {
      const imageData = encodeURIComponent(JSON.stringify(item.mediaUrls));
      mediaHtml = `<div class="cocoon-media-grid relative mt-3 grid grid-cols-[repeat(auto-fit,minmax(200px,1fr))] gap-2" data-images="${imageData}">${item.mediaUrls.map((url, i) =>
        `<img class="cocoon-media-image w-full rounded-lg object-cover max-h-[300px] cursor-pointer hover:opacity-90 transition-opacity" src="${escapeHtml(url)}" loading="lazy" alt="" data-index="${i}" />`
      ).join('')}</div>`;
    }

    // Quote tweet media
    let quoteMediaHtml = '';
    if (item.quoteMediaUrls.length > 0) {
      const quoteImageData = encodeURIComponent(JSON.stringify(item.quoteMediaUrls));
      quoteMediaHtml = `<div class="cocoon-media-grid mt-2.5 grid grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-1.5" data-images="${quoteImageData}">${item.quoteMediaUrls.map((url, i) =>
        `<img class="cocoon-media-image w-full rounded-md object-cover max-h-[200px] cursor-pointer hover:opacity-90 transition-opacity" src="${escapeHtml(url)}" loading="lazy" alt="" data-index="${i}" />`
      ).join('')}</div>`;
    }

    // Quote block
    const tweetUrl = item.url ? `https://x.com${item.url}` : '';
    const quoteTweetUrl = item.quote?.url ? `https://x.com${item.quote.url}` : tweetUrl;
    const quoteHtmlContent = item.quote?.html || (item.quote?.text ? escapeHtml(item.quote.text) : '');
    const quoteBlockHtml = quoteHtmlContent
      ? `<div class="cocoon-quote-clickable mt-3 py-3 px-3.5 bg-cocoon-dim rounded-xl border border-cocoon-border cursor-pointer transition-colors duration-150 hover:bg-cocoon-surface hover:border-cocoon-elevated" ${quoteTweetUrl ? `data-quote-url="${escapeAttr(quoteTweetUrl)}"` : ''}>
          <div class="text-sm leading-normal text-cocoon-muted whitespace-pre-wrap break-words">${quoteHtmlContent}</div>
          ${quoteMediaHtml}
        </div>`
      : '';

    // Show more button
    const showMoreBtn = needsTruncation
      ? `<button class="cocoon-show-more bg-transparent border-0 text-cocoon-accent text-sm py-1 mt-1 cursor-pointer block hover:underline" data-target="${itemId}">Show more</button>`
      : '';

    // Engagement metrics
    let metricsHtml = '';
    if (item.metrics) {
      const parts: string[] = [];
      const { showMetrics } = settings;
      if (showMetrics.retweets && item.metrics.shares) {
        parts.push(`<span class="text-[13px] text-cocoon-muted">↻ ${formatNumber(item.metrics.shares)}</span>`);
      }
      if (showMetrics.likes && item.metrics.likes) {
        parts.push(`<span class="text-[13px] text-cocoon-muted">♡ ${formatNumber(item.metrics.likes)}</span>`);
      }
      if (showMetrics.views && item.metrics.views) {
        parts.push(`<span class="text-[13px] text-cocoon-muted flex items-center gap-1"><svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>${formatNumber(item.metrics.views)}</span>`);
      }
      if (parts.length > 0) {
        metricsHtml = `<div class="flex gap-3 mt-2.5 pt-2.5 border-t border-cocoon-border">${parts.join('')}</div>`;
      }
    }

    const statusId = extractStatusId(item.url);

    // Check if this item is the current post being viewed
    const currentStatusId = extractStatusId(window.location.pathname);
    const isCurrentPost = statusId && currentStatusId && statusId === currentStatusId;

    // Only add clickable styles if not viewing this specific post
    const clickableStyles = tweetUrl && !isCurrentPost
      ? ' cursor-pointer transition-colors duration-150 hover:bg-cocoon-elevated'
      : '';

    return `
      <div class="cocoon-item bg-cocoon-surface border border-cocoon-border rounded-xl p-4${clickableStyles}" id="${itemId}" ${tweetUrl ? `data-tweet-url="${escapeAttr(tweetUrl)}"` : ''} ${statusId ? `data-status-id="${statusId}"` : ''}>
        ${authorHtml}
        ${item.title ? `<div class="font-semibold text-base mb-2 text-cocoon-text">${escapeHtml(item.title)}</div>` : ''}
        <div class="cocoon-item-text text-[15px] leading-relaxed text-cocoon-text whitespace-pre-wrap break-words${needsTruncation ? ' cocoon-text-truncated' : ''}">${mainHtml}</div>
        ${showMoreBtn}
        ${mediaHtml}
        ${quoteBlockHtml}
        ${metricsHtml}
      </div>
    `;
  },

  getStyles(): string {
    return getFeedItemStyles();
  },
};
