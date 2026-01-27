/**
 * Navigation hook - runs in MAIN world to intercept History API.
 * Dispatches custom events that content.ts listens for.
 */

import { ALL_MATCH_PATTERNS } from '@/lib/sites';

export default defineContentScript({
  matches: ALL_MATCH_PATTERNS,
  runAt: 'document_start',
  world: 'MAIN',

  main() {
    // Avoid double-hooking
    if ((window as unknown as { __cocoonNavHooked?: boolean }).__cocoonNavHooked) {
      return;
    }
    (window as unknown as { __cocoonNavHooked?: boolean }).__cocoonNavHooked = true;

    const dispatchNav = (url: string, type: string) => {
      window.dispatchEvent(new CustomEvent('cocoon-navigation', {
        detail: { url, type }
      }));
    };

    // Hook pushState
    const originalPushState = history.pushState.bind(history);
    history.pushState = function(state: unknown, unused: string, url?: string | URL | null) {
      originalPushState(state, unused, url);
      if (url) {
        try {
          const newUrl = new URL(url, window.location.href).href;
          dispatchNav(newUrl, 'pushState');
        } catch {
          // ignore invalid URLs
        }
      }
    };

    // Hook replaceState
    const originalReplaceState = history.replaceState.bind(history);
    history.replaceState = function(state: unknown, unused: string, url?: string | URL | null) {
      originalReplaceState(state, unused, url);
      if (url) {
        try {
          const newUrl = new URL(url, window.location.href).href;
          dispatchNav(newUrl, 'replaceState');
        } catch {
          // ignore invalid URLs
        }
      }
    };
  }
});
