/**
 * Tweet collector - interactive single-tweet picker with cumulative storage
 * Activates via message from popup, highlights tweet articles on hover
 */
import { extractTweetData } from '@/lib/tweet-collector/extract';
import type { CollectedTweet } from '@/lib/tweet-collector/types';

export default defineContentScript({
  matches: ['*://x.com/*', '*://twitter.com/*'],
  runAt: 'document_end',
  main() {
    let pickerActive = false;
    let overlay: HTMLDivElement | null = null;
    let highlight: HTMLDivElement | null = null;
    let label: HTMLDivElement | null = null;
    let currentTweet: Element | null = null;
    let lastX = 0;
    let lastY = 0;

    browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if ((message as { type?: string })?.type === 'COLLECT_TWEET_START') {
        startCollector();
        sendResponse({ started: true });
      }
      return true;
    });

    function startCollector() {
      if (pickerActive) return;
      pickerActive = true;

      highlight = document.createElement('div');
      highlight.style.cssText = 'position:fixed;pointer-events:none;border:2px solid #00d4ff;background:rgba(0,212,255,0.08);z-index:2147483646;transition:all 0.05s ease-out;border-radius:12px;display:none;';

      label = document.createElement('div');
      label.style.cssText = 'position:fixed;pointer-events:none;background:#1a1a2e;color:#00d4ff;font:12px/1.4 system-ui;padding:6px 10px;border-radius:6px;z-index:2147483647;white-space:nowrap;display:none;';
      label.textContent = 'Click to collect';

      overlay = document.createElement('div');
      overlay.id = '__cocoon_collector_overlay';
      overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483645;cursor:crosshair;';

      document.body.appendChild(highlight);
      document.body.appendChild(label);
      document.body.appendChild(overlay);

      overlay.addEventListener('mousemove', onMouseMove);
      overlay.addEventListener('click', onClick);
      overlay.addEventListener('contextmenu', onCancel);
      document.addEventListener('keydown', onKeyDown);
      window.addEventListener('scroll', onScroll, true);
    }

    function stopCollector() {
      pickerActive = false;
      currentTweet = null;
      overlay?.remove();
      highlight?.remove();
      label?.remove();
      overlay = null;
      highlight = null;
      label = null;
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', onScroll, true);
    }

    function findTweetArticle(el: Element | null): Element | null {
      if (!el) return null;
      // Walk up to find article[data-testid="tweet"]
      let current: Element | null = el;
      while (current) {
        if (current.tagName === 'ARTICLE' && current.getAttribute('data-testid') === 'tweet') {
          return current;
        }
        current = current.parentElement;
      }
      return null;
    }

    function updateHighlight(x: number, y: number) {
      if (!overlay || !highlight || !label) return;

      overlay.style.pointerEvents = 'none';
      const el = document.elementFromPoint(x, y);
      overlay.style.pointerEvents = 'auto';

      if (!el || el === overlay || el === highlight || el === label) {
        highlight.style.display = 'none';
        label.style.display = 'none';
        currentTweet = null;
        return;
      }

      const tweet = findTweetArticle(el);
      if (!tweet) {
        highlight.style.display = 'none';
        label.style.display = 'none';
        currentTweet = null;
        return;
      }

      currentTweet = tweet;
      const rect = tweet.getBoundingClientRect();

      highlight.style.display = 'block';
      highlight.style.left = rect.left + 'px';
      highlight.style.top = rect.top + 'px';
      highlight.style.width = rect.width + 'px';
      highlight.style.height = rect.height + 'px';

      label.style.display = 'block';
      const labelTop = rect.top > 40 ? rect.top - 32 : rect.bottom + 8;
      label.style.left = rect.left + 'px';
      label.style.top = labelTop + 'px';
    }

    function onMouseMove(e: MouseEvent) {
      lastX = e.clientX;
      lastY = e.clientY;
      updateHighlight(lastX, lastY);
    }

    function onScroll() {
      if (pickerActive) updateHighlight(lastX, lastY);
    }

    async function onClick(e: MouseEvent) {
      e.preventDefault();
      e.stopPropagation();

      if (!currentTweet) return;

      const tweetData = await extractTweetData(currentTweet);
      if (!tweetData) {
        showToast('Failed to extract tweet');
        return;
      }

      // Store tweet
      const stored = await browser.storage.local.get(['collectedTweets']) as { collectedTweets?: CollectedTweet[] };
      const existing: CollectedTweet[] = Array.isArray(stored.collectedTweets) ? stored.collectedTweets : [];

      // Dedupe by ID
      if (existing.some(t => t.id === tweetData.id)) {
        showToast('Already collected');
        return;
      }

      const updated = [...existing, tweetData];
      await browser.storage.local.set({ collectedTweets: updated });

      showToast(`Added (${updated.length} total)`);
      // Stay active for more collection
    }

    function showToast(message: string) {
      const existing = document.getElementById('__cocoon_collector_toast');
      existing?.remove();

      const toast = document.createElement('div');
      toast.id = '__cocoon_collector_toast';
      toast.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#1a1a2e;color:#00d4ff;font:14px/1.4 system-ui;padding:12px 20px;border-radius:8px;z-index:2147483647;';
      toast.textContent = message;
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 2000);
    }

    function onCancel(e: Event) {
      e.preventDefault();
      stopCollector();
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') stopCollector();
    }
  }
});
