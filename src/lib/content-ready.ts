/**
 * Content Readiness Detection
 *
 * Waits for dynamic content to load using:
 * 1. PerformanceObserver for network idle (like Puppeteer's networkidle2)
 * 2. MutationObserver for DOM settle
 * 3. Max timeout fallback
 */

import { createLogger } from './logger';

const log = createLogger('ContentReady');

interface ReadyOptions {
  /** Max time to wait in ms (default: 8000) */
  maxWait?: number;
  /** Network idle threshold in ms (default: 500) */
  networkIdleTime?: number;
  /** Max concurrent requests to consider "idle" (default: 2, like networkidle2) */
  networkIdleThreshold?: number;
  /** DOM mutation settle time in ms (default: 300) */
  domSettleTime?: number;
  /** Minimum wait time before checking (default: 100) */
  minWait?: number;
}

const DEFAULT_OPTIONS: Required<ReadyOptions> = {
  maxWait: 8000,
  networkIdleTime: 500,
  networkIdleThreshold: 2,
  domSettleTime: 300,
  minWait: 100,
};

/**
 * Wait for page content to be ready.
 * Resolves when network is idle AND DOM has settled, or max timeout reached.
 */
export function waitForContentReady(options: ReadyOptions = {}): Promise<void> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  const startTime = performance.now();

  return new Promise(resolve => {
    let networkIdleTimer: ReturnType<typeof setTimeout> | null = null;
    let domSettleTimer: ReturnType<typeof setTimeout> | null = null;
    let maxWaitTimer: ReturnType<typeof setTimeout> | null = null;
    let resolved = false;

    // Track network activity - simpler approach: just detect when resources stop loading
    let networkIdle = false;
    let domSettled = false;

    const cleanup = () => {
      if (networkIdleTimer) clearTimeout(networkIdleTimer);
      if (domSettleTimer) clearTimeout(domSettleTimer);
      if (maxWaitTimer) clearTimeout(maxWaitTimer);
      if (perfObserver) perfObserver.disconnect();
      if (mutationObserver) mutationObserver.disconnect();
    };

    const done = (reason: string) => {
      if (resolved) return;
      resolved = true;
      cleanup();
      const elapsed = Math.round(performance.now() - startTime);
      log.info(`Content ready: ${reason} (${elapsed}ms)`);
      resolve();
    };

    const checkReady = () => {
      if (resolved) return;

      // Need both network idle AND dom settled
      if (networkIdle && domSettled) {
        done('network idle + DOM settled');
      }
    };

    // --- Network Idle Detection via PerformanceObserver ---
    // Simpler approach: if we see new resource entries, reset the idle timer
    // Idle = no new resources for networkIdleTime ms
    let perfObserver: PerformanceObserver | null = null;
    let resourceCount = 0;

    const resetNetworkIdleTimer = () => {
      networkIdle = false;
      if (networkIdleTimer) clearTimeout(networkIdleTimer);

      networkIdleTimer = setTimeout(() => {
        networkIdle = true;
        log.debug(`Network idle (${resourceCount} resources loaded)`);
        checkReady();
      }, opts.networkIdleTime);
    };

    try {
      perfObserver = new PerformanceObserver(list => {
        const entries = list.getEntries() as PerformanceResourceTiming[];

        // Count only completed resources, skip extension resources
        const relevantEntries = entries.filter(entry =>
          !entry.name.includes('chrome-extension://') &&
          !entry.name.includes('moz-extension://') &&
          entry.responseEnd > 0
        );

        if (relevantEntries.length > 0) {
          resourceCount += relevantEntries.length;
          resetNetworkIdleTimer();
        }
      });

      perfObserver.observe({ type: 'resource', buffered: true });
    } catch (e) {
      // PerformanceObserver not available, skip network idle check
      log.warn('PerformanceObserver not available, skipping network idle detection');
      networkIdle = true;
    }

    // Start initial network idle timer
    resetNetworkIdleTimer();

    // --- DOM Mutation Settle Detection ---
    let mutationObserver: MutationObserver | null = null;

    const resetDomSettleTimer = () => {
      domSettled = false;
      if (domSettleTimer) clearTimeout(domSettleTimer);

      domSettleTimer = setTimeout(() => {
        domSettled = true;
        log.debug('DOM settled');
        checkReady();
      }, opts.domSettleTime);
    };

    try {
      mutationObserver = new MutationObserver(mutations => {
        // Filter out our own changes
        const dominated = mutations.some(m => {
          const target = m.target as Element;
          if (target.id?.startsWith('__cocoon')) return true;
          if (target.closest?.('#__cocoon_overlay')) return true;
          return false;
        });

        if (!dominated && mutations.length > 0) {
          resetDomSettleTimer();
        }
      });

      // Wait for body to exist before observing
      const observeBody = () => {
        if (document.body) {
          mutationObserver!.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: false, // Don't care about attribute changes
            characterData: false,
          });
          resetDomSettleTimer();
        } else {
          // Body doesn't exist yet, wait a tick
          setTimeout(observeBody, 10);
        }
      };
      observeBody();
    } catch (e) {
      log.warn('MutationObserver error, skipping DOM settle detection');
      domSettled = true;
    }

    // --- Max Timeout Fallback ---
    maxWaitTimer = setTimeout(() => {
      done(`max timeout (${opts.maxWait}ms)`);
    }, opts.maxWait);

    // --- Minimum Wait ---
    // Ensure we wait at least minWait before potentially resolving
    setTimeout(() => {
      // After min wait, if already ready, resolve
      if (networkIdle && domSettled) {
        done('ready after min wait');
      }
    }, opts.minWait);
  });
}

/**
 * Simple wait for DOM to be interactive (DOMContentLoaded equivalent).
 * Use waitForContentReady() for SPAs with dynamic content.
 */
export function waitForDomReady(): Promise<void> {
  return new Promise(resolve => {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', () => resolve(), { once: true });
    } else {
      resolve();
    }
  });
}
