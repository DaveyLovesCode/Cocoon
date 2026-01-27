/**
 * Cocoon Background Script
 * Handles LLM API calls, filter engine, and message routing.
 */

import { createBlockingEngine, type BlockingEngine } from '@/lib/blocking';
import { createLogger } from '@/lib/logger';
import { WELLNESS_DEFAULTS } from '@/lib/defaults';
import { sendLLMRequest } from '@/lib/llm';
import { decryptApiKey } from '@/lib/crypto';

const log = createLogger('Worker');

// Log Hub port for dev mode (content scripts route through service worker)
declare const __LOG_HUB_PORT__: string | null;
const logHubPort = __LOG_HUB_PORT__ ? parseInt(__LOG_HUB_PORT__) : null;

type StatsData = {
  allTime: { pagesProcessed: number; elementsHidden: number; postsKept: number; postsHidden: number };
  byDomain: Record<string, { pagesProcessed: number; elementsHidden: number; postsKept: number; postsHidden: number }>;
};

type Message = {
  type: string;
  payload?: unknown;
};

let blockingEngine: BlockingEngine | null = null;

export default defineBackground(() => {
  log.info('Service worker started');

  // Handle install and update events - MUST be registered synchronously before any async work
  browser.runtime.onInstalled.addListener((details) => {
    log.info(`Extension ${details.reason}`, details.previousVersion || '');

    if (details.reason === 'install') {
      // First install: open welcome page
      browser.tabs.create({
        url: browser.runtime.getURL('/welcome.html'),
      });

      // Set default settings
      browser.storage.sync.get(['whitelist', 'userProfile']).then((result) => {
        const defaults: Record<string, any> = {};
        if (result.whitelist === undefined) defaults.whitelist = [];
        if (result.userProfile === undefined) {
          defaults.userProfile = WELLNESS_DEFAULTS;
        }
        if (Object.keys(defaults).length > 0) {
          browser.storage.sync.set(defaults);
          log.debug('Set defaults', defaults);
        }
      });
    } else if (details.reason === 'update' && details.previousVersion) {
      // Mark that an update occurred - popup will show toast on next open
      const currentVersion = browser.runtime.getManifest().version;
      if (details.previousVersion !== currentVersion) {
        browser.storage.local.set({
          pendingUpdateNotice: { version: currentVersion, from: details.previousVersion }
        });
      }
    }
  });

  // Initialize blocking engine (async, but don't block listener registration)
  createBlockingEngine()
    .then((engine) => {
      blockingEngine = engine;
      log.info('Blocking engine initialized');
    })
    .catch((e) => {
      log.error('Failed to initialize blocking engine', e);
    });

  // Listen for messages from content scripts
  browser.runtime.onMessage.addListener((rawMessage: unknown, sender, sendResponse) => {
    const message = rawMessage as Message;

    if (message.type === 'OPEN_OPTIONS') {
      log.info('Received OPEN_OPTIONS message, creating tab');
      const payload = message.payload as { highlight?: string } | undefined;
      const highlight = payload?.highlight;
      const baseUrl = browser.runtime.getURL('/options.html');
      const url = highlight ? `${baseUrl}?highlight=${highlight}` : baseUrl;
      log.info('Options URL:', url);
      browser.tabs.create({ url })
        .then(() => {
          log.info('Tab created successfully');
          sendResponse({ success: true });
        })
        .catch((e) => {
          log.error('Failed to create tab:', e);
          sendResponse({ success: false, error: String(e) });
        });
      return true; // Keep channel open for async response
    }

    if (message.type === 'COSMETIC_FILTERS') {
      handleCosmeticFilters(message.payload as { url: string })
        .then(result => sendResponse(result))
        .catch(error => {
          log.error('Cosmetic filters request failed', error.message);
          sendResponse({ selectors: [], styles: '' });
        });
      return true;
    }

    if (message.type === 'FILTER_REQUEST') {
      handleFilterRequest(message.payload as { system: string; user: string; url: string }, sender)
        .then(result => sendResponse({ result }))
        .catch(error => {
          log.error('Filter request failed', error.message);
          sendResponse({ error: error.message });
        });
      return true; // Keep channel open for async response
    }

    if (message.type === 'STATS_UPDATE') {
      handleStatsUpdate(message.payload as { domain: string; elementsHidden: number })
        .then(() => sendResponse({ success: true }))
        .catch(error => {
          log.error('Stats update failed', error.message);
          sendResponse({ error: error.message });
        });
      return true;
    }

    if (message.type === 'FETCH_VIDEO_URL') {
      const payload = message.payload as { statusId: string };
      fetchVideoUrl(payload.statusId)
        .then(result => sendResponse({ result }))
        .catch(error => {
          log.error('Video URL fetch failed', error.message);
          sendResponse({ error: error.message });
        });
      return true;
    }

    // Forward content script logs to Log Hub (avoids Private Network Access restrictions)
    if (message.type === 'LOG_HUB' && logHubPort) {
      const payload = message.payload as { project: string; env: string; scope: string; level: string; message: string };
      fetch(`http://127.0.0.1:${logHubPort}/logs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      }).catch(() => {});
      return false; // No response needed
    }

    return true;
  });
});

async function fetchVideoUrl(statusId: string): Promise<{ url: string } | null> {
  try {
    const response = await fetch(`https://cdn.syndication.twimg.com/tweet-result?id=${statusId}&token=0`);
    if (!response.ok) return null;

    const data = await response.json();

    // Try multiple paths to find video variants
    let variants = data?.video?.variants
      || data?.mediaDetails?.[0]?.video_info?.variants
      || data?.quoted_tweet?.mediaDetails?.[0]?.video_info?.variants;

    if (!variants) return null;

    // Find HLS stream (m3u8)
    for (const variant of variants) {
      const contentType = variant.content_type || variant.type;
      if (contentType === 'application/x-mpegURL') {
        return { url: variant.url || variant.src };
      }
    }

    return null;
  } catch {
    return null;
  }
}

async function handleCosmeticFilters(payload: { url: string }): Promise<{ selectors: string[], styles: string }> {
  if (!blockingEngine) {
    return { selectors: [], styles: '' };
  }

  return blockingEngine.getCosmeticFilters(payload.url);
}

async function handleFilterRequest(
  payload: { system: string; user: string; url: string },
  sender: { tab?: { id?: number } }
): Promise<string> {
  const { system, user, url } = payload;
  const tabId = sender.tab?.id || 'unknown';

  log.info(`Filter request from tab ${tabId}`, url);
  log.debug(`Prompt sizes: system=${system.length}, user=${user.length}`);

  const settings = await browser.storage.sync.get(['apiKey']);
  const encryptedKey = settings.apiKey as string | undefined;

  if (!encryptedKey) {
    log.error('No API key configured');
    throw new Error('API_KEY_MISSING');
  }

  let apiKey: string;
  try {
    apiKey = await decryptApiKey(encryptedKey);
  } catch (e) {
    log.error('Failed to decrypt API key - clearing corrupted data', e);
    // Clear corrupted key so user can set a fresh one
    await browser.storage.sync.remove(['apiKey']);
    throw new Error('API_KEY_DECRYPT_FAILED');
  }

  const response = await sendLLMRequest({
    apiKey,
    messages: [
      { role: 'system' as const, content: system },
      { role: 'user' as const, content: user },
    ],
  });

  log.debug('LLM result', response.content);
  return response.content;
}

async function handleStatsUpdate(
  payload: { domain: string; elementsHidden: number; postsKept?: number; postsHidden?: number }
): Promise<void> {
  const { domain, elementsHidden, postsKept = 0, postsHidden = 0 } = payload;

  log.debug(`Stats update: ${domain} - ${postsKept} kept, ${postsHidden} hidden`);

  // Get current stats
  const { stats } = await browser.storage.local.get(['stats']) as { stats?: StatsData };

  const currentStats: StatsData = stats || {
    allTime: { pagesProcessed: 0, elementsHidden: 0, postsKept: 0, postsHidden: 0 },
    byDomain: {},
  };

  // Ensure new fields exist (migration from old stats)
  if (currentStats.allTime.postsKept === undefined) currentStats.allTime.postsKept = 0;
  if (currentStats.allTime.postsHidden === undefined) currentStats.allTime.postsHidden = 0;

  // Update all-time stats
  currentStats.allTime.pagesProcessed += 1;
  currentStats.allTime.elementsHidden += elementsHidden;
  currentStats.allTime.postsKept += postsKept;
  currentStats.allTime.postsHidden += postsHidden;

  // Update per-domain stats
  if (!currentStats.byDomain[domain]) {
    currentStats.byDomain[domain] = { pagesProcessed: 0, elementsHidden: 0, postsKept: 0, postsHidden: 0 };
  }
  // Ensure new fields exist for domain (migration)
  if (currentStats.byDomain[domain].postsKept === undefined) currentStats.byDomain[domain].postsKept = 0;
  if (currentStats.byDomain[domain].postsHidden === undefined) currentStats.byDomain[domain].postsHidden = 0;

  currentStats.byDomain[domain].pagesProcessed += 1;
  currentStats.byDomain[domain].elementsHidden += elementsHidden;
  currentStats.byDomain[domain].postsKept += postsKept;
  currentStats.byDomain[domain].postsHidden += postsHidden;

  // Save
  await browser.storage.local.set({ stats: currentStats });

  log.debug(`Stats saved: ${currentStats.allTime.postsKept} kept, ${currentStats.allTime.postsHidden} hidden all-time`);
}