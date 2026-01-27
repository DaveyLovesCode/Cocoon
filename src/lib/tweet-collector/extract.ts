import type { CollectedTweet, CollectedTweetMedia } from './types';
import {
  fetchVideoUrl,
  extractStatusId,
  parseMetricNumber,
  convertTweetTextToHtml,
} from '../platforms/twitter';
import { normalizeWhitespace } from '../utils/text';

/**
 * Extract media from a tweet element.
 */
async function extractMedia(el: Element, statusId: string): Promise<CollectedTweetMedia[]> {
  const media: CollectedTweetMedia[] = [];

  // Images
  const images = el.querySelectorAll('[data-testid="tweetPhoto"] img, img[src*="pbs.twimg.com/media"]');
  for (const img of images) {
    const src = (img as HTMLImageElement).src;
    if (!src) continue;
    const url = src.replace(/name=\w+/, 'name=large');
    if (!media.some(m => m.url === url)) {
      media.push({ type: 'image', url });
    }
  }

  // Videos
  const videos = el.querySelectorAll('video[poster]');
  for (const video of videos) {
    const poster = (video as HTMLVideoElement).poster;
    if (!poster) continue;

    const videoUrl = await fetchVideoUrl(statusId);
    media.push({
      type: 'video',
      url: poster,
      thumbnailUrl: poster,
      videoUrl: videoUrl || undefined,
    });
  }

  // GIFs (Twitter marks them differently)
  const gifs = el.querySelectorAll('[data-testid="videoPlayer"]');
  for (const gif of gifs) {
    const video = gif.querySelector('video');
    if (!video) continue;
    // GIFs are usually short looping videos
    const poster = video.poster;
    if (poster && !media.some(m => m.url === poster)) {
      const videoUrl = await fetchVideoUrl(statusId);
      media.push({
        type: 'gif',
        url: poster,
        thumbnailUrl: poster,
        videoUrl: videoUrl || undefined,
      });
    }
  }

  return media;
}

/**
 * Extract quote tweet data.
 */
async function extractQuote(el: Element): Promise<CollectedTweet['quote'] | undefined> {
  const quoteContainer = el.querySelector('div[role="link"]');
  if (!quoteContainer) return undefined;

  // Check if it contains tweet content
  const quoteTweetText = quoteContainer.querySelector('[data-testid="tweetText"]');
  if (!quoteTweetText) return undefined;

  // Get quote URL and ID
  let quoteUrl = '';
  let quoteId = '';
  const quoteLinks = quoteContainer.querySelectorAll('a[href*="/status/"]');
  for (const link of quoteLinks) {
    const href = link.getAttribute('href');
    if (href && !href.includes('/analytics')) {
      quoteUrl = 'https://x.com' + href;
      quoteId = extractStatusId(href) || '';
      break;
    }
  }

  if (!quoteId) return undefined;

  // Author info
  let author = '';
  let handle = '';
  const userNameContainer = quoteContainer.querySelector('[data-testid="User-Name"]');
  if (userNameContainer) {
    const nameLink = userNameContainer.querySelector('a[href^="/"]');
    if (nameLink) author = normalizeWhitespace(nameLink.textContent || '');
    const links = userNameContainer.querySelectorAll('a[href^="/"]');
    for (const link of links) {
      const text = link.textContent || '';
      if (text.startsWith('@')) {
        handle = text;
        break;
      }
    }
  }

  // Profile picture
  let profilePicture = '';
  const avatar = quoteContainer.querySelector('img[src*="profile_images"]');
  if (avatar) {
    profilePicture = (avatar as HTMLImageElement).src;
  }

  // Content
  const content = normalizeWhitespace(quoteTweetText.textContent || '');

  // Media
  const media: CollectedTweetMedia[] = [];
  const quoteImages = quoteContainer.querySelectorAll('[data-testid="tweetPhoto"] img, img[src*="pbs.twimg.com/media"]');
  for (const img of quoteImages) {
    const src = (img as HTMLImageElement).src;
    if (!src) continue;
    const url = src.replace(/name=\w+/, 'name=large');
    if (!media.some(m => m.url === url)) {
      media.push({ type: 'image', url });
    }
  }

  return {
    id: quoteId,
    url: quoteUrl,
    author,
    handle,
    content,
    profilePicture,
    media: media.length > 0 ? media : undefined,
  };
}

/**
 * Extract full tweet data from a tweet article element.
 */
export async function extractTweetData(tweetEl: Element): Promise<CollectedTweet | null> {
  // Get tweet URL and ID
  let tweetUrl = '';
  let statusId = '';

  // Find quote container first to exclude its links
  const quoteContainer = tweetEl.querySelector('div[role="link"]');

  const statusLinks = tweetEl.querySelectorAll('a[href*="/status/"]');
  for (const link of statusLinks) {
    if (quoteContainer && quoteContainer.contains(link)) continue;
    const href = link.getAttribute('href');
    if (href && !href.includes('/analytics')) {
      tweetUrl = 'https://x.com' + href;
      statusId = extractStatusId(href) || '';
      break;
    }
  }

  if (!statusId) return null;

  // Author info
  let author = '';
  let handle = '';
  const userNameContainer = tweetEl.querySelector('[data-testid="User-Name"]');
  if (userNameContainer) {
    const nameLink = userNameContainer.querySelector('a[href^="/"]');
    if (nameLink) author = normalizeWhitespace(nameLink.textContent || '');
    const links = userNameContainer.querySelectorAll('a[href^="/"]');
    for (const link of links) {
      const text = link.textContent || '';
      if (text.startsWith('@')) {
        handle = text;
        break;
      }
    }
  }

  // Profile picture
  let profilePicture = '';
  // Look for avatar outside of quote container
  const avatars = tweetEl.querySelectorAll('img[src*="profile_images"]');
  for (const avatar of avatars) {
    if (quoteContainer && quoteContainer.contains(avatar)) continue;
    profilePicture = (avatar as HTMLImageElement).src;
    break;
  }

  // Tweet content
  let content = '';
  let contentHtml = '';
  const tweetTexts = tweetEl.querySelectorAll('[data-testid="tweetText"]');
  for (const tt of tweetTexts) {
    if (quoteContainer && quoteContainer.contains(tt)) continue;
    content = normalizeWhitespace(tt.textContent || '');
    contentHtml = convertTweetTextToHtml(tt);
    break;
  }

  // Metrics
  let likes = 0;
  let retweets = 0;
  let replies = 0;
  let views = 0;

  const replyBtn = tweetEl.querySelector('[data-testid="reply"]');
  const retweetBtn = tweetEl.querySelector('[data-testid="retweet"]');
  const likeBtn = tweetEl.querySelector('[data-testid="like"]');
  const viewsLink = tweetEl.querySelector('a[href*="/analytics"]');

  if (replyBtn) replies = parseMetricNumber(replyBtn.getAttribute('aria-label') || '') || 0;
  if (retweetBtn) retweets = parseMetricNumber(retweetBtn.getAttribute('aria-label') || '') || 0;
  if (likeBtn) likes = parseMetricNumber(likeBtn.getAttribute('aria-label') || '') || 0;
  if (viewsLink) views = parseMetricNumber(viewsLink.getAttribute('aria-label') || '') || 0;

  // Extract media (excluding quote media)
  const mediaContainer = tweetEl.cloneNode(true) as Element;
  const clonedQuote = mediaContainer.querySelector('div[role="link"]');
  clonedQuote?.remove();
  const media = await extractMedia(mediaContainer, statusId);

  // Extract quote
  const quote = await extractQuote(tweetEl);

  return {
    id: statusId,
    url: tweetUrl,
    author,
    handle,
    content,
    contentHtml,
    likes,
    retweets,
    replies,
    views,
    profilePicture,
    media,
    quote,
    collectedAt: new Date().toISOString(),
  };
}
