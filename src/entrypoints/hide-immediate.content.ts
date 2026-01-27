/**
 * Hide-immediate content script
 * Runs at document_start to hide the page before any flash.
 * Must run before content.ts (which runs at document_end).
 */

import { createShimmerText } from '@/lib/components/shimmer-text';
import { startInitialSkeletonReveal } from '@/lib/components/skeleton';
import { getShellHeaderHtml, getSidebarNavHtml, renderNavItem, X_LOGO_SVG } from '@/lib/components/shell-header';
import {
  OVERLAY_ID,
  PREHIDE_STYLE_ID,
  CONTENT_STYLES_ID,
  READY_ATTR,
  PREV_VIS_ATTR,
  NAV_CACHE_KEY,
  NAV_CACHE_TTL_MS,
  TWITTER_VARIANT_CACHE_KEY,
} from '@/lib/constants';
import {
  getNavigationType,
  getBackForwardFeedCache,
  type FeedCacheBase,
  type NavItem,
} from '@/lib/cache';
import {
  themes,
  twitterThemes,
  getThemeColors as getThemeColorsFromLib,
  type ThemeColors,
} from '@/lib/theme/themes';
import { ALL_MATCH_PATTERNS, isSupportedFeedUrl } from '@/lib/sites';

export default defineContentScript({
  matches: ALL_MATCH_PATTERNS,
  runAt: 'document_start',

  main() {
    // ========================================================================
    // DIAGNOSTICS (keep inline - specific to this script)
    // ========================================================================

    type DiagState = {
      v: number;
      pageId: string;
      events: DiagEvent[];
    };

    type DiagEvent = {
      name: string;
      t: number;
      epoch: number;
      rs: DocumentReadyState;
      data?: unknown;
    };

    const MAX_EVENTS = 120;
    const g = globalThis as typeof globalThis & { __cocoonDiag?: DiagState };
    const diag: DiagState = g.__cocoonDiag = g.__cocoonDiag || { v: 1, pageId: '', events: [] };
    if (!diag.pageId) {
      diag.pageId = String(Date.now()) + '-' + Math.random().toString(16).slice(2);
    }

    function now(): number {
      try {
        return performance?.now?.() ?? Date.now();
      } catch {
        return Date.now();
      }
    }

    function push(name: string, data?: unknown): void {
      try {
        if (!diag.events) diag.events = [];
        if (diag.events.length >= MAX_EVENTS) return;
        diag.events.push({ name, t: now(), epoch: Date.now(), rs: document.readyState, data });
      } catch { /* ignore */ }
    }

    function safeComputed(el: Element | null) {
      try {
        if (!el) return null;
        const cs = getComputedStyle(el);
        return {
          display: cs.display,
          visibility: cs.visibility,
          opacity: cs.opacity,
          backgroundColor: cs.backgroundColor,
          color: cs.color,
          zIndex: cs.zIndex,
          position: cs.position,
        };
      } catch {
        return null;
      }
    }

    function elementAt(x: number, y: number) {
      try {
        const el = document.elementFromPoint(x, y);
        if (!el) return null;
        return { tag: el.tagName, id: el.id || null, class: el.className || null };
      } catch {
        return null;
      }
    }

    function snap(label: string, extra?: Record<string, unknown>) {
      const htmlEl = document.documentElement;
      const overlayEl = document.getElementById(OVERLAY_ID);
      return {
        label,
        url: location.href,
        readyState: document.readyState,
        visibilityState: document.visibilityState,
        prerendering: typeof (document as Document & { prerendering?: boolean }).prerendering === 'boolean'
          ? (document as Document & { prerendering?: boolean }).prerendering!
          : null,
        isTop: (() => { try { return window.top === window; } catch { return null; } })(),
        hasHead: !!document.head,
        hasBody: !!document.body,
        html: {
          readyAttr: htmlEl?.getAttribute(READY_ATTR) ?? null,
          styleAttr: htmlEl?.getAttribute('style') ?? null,
          inlineVisibility: htmlEl?.style.visibility ?? '',
          computed: safeComputed(htmlEl),
        },
        overlay: {
          exists: !!overlayEl,
          computed: safeComputed(overlayEl),
        },
        at1x1: elementAt(1, 1),
        at10x10: elementAt(10, 10),
        ...extra,
      };
    }

    // ========================================================================
    // THEME HELPERS
    // ========================================================================

    // Build a map of theme variants from the themes array for quick lookup
    const THEME_VARIANTS: Record<string, { light: ThemeColors; dark: ThemeColors }> = {};
    for (const theme of themes) {
      THEME_VARIANTS[theme.id] = theme.variants;
    }

    function getThemeColors(themeId: string, mode: 'light' | 'dark'): ThemeColors {
      const variants = THEME_VARIANTS[themeId] || THEME_VARIANTS['cocoon'];
      return variants?.[mode] || getThemeColorsFromLib(themeId, mode);
    }

    function applyThemeColors(colors: ThemeColors, mode: 'light' | 'dark'): void {
      const root = document.documentElement;
      root.setAttribute('data-cocoon-theme-applied', 'true');
      root.setAttribute('data-theme-type', mode);
      root.style.setProperty('--cocoon-bg', colors.bg);
      root.style.setProperty('--cocoon-surface', colors.surface);
      root.style.setProperty('--cocoon-elevated', colors.elevated);
      root.style.setProperty('--cocoon-text', colors.text);
      root.style.setProperty('--cocoon-muted', colors.muted);
      root.style.setProperty('--cocoon-accent', colors.accent);
      root.style.setProperty('--cocoon-accent-fg', colors.accentFg);
      root.style.setProperty('--cocoon-border', colors.border);
      root.style.setProperty('--cocoon-dim', colors.dim);
    }

    function getCachedTwitterVariant(): 'lights-out' | 'dim' | 'default' | null {
      try {
        const raw = localStorage.getItem(TWITTER_VARIANT_CACHE_KEY);
        if (!raw) return null;
        if (raw === 'lights-out' || raw === 'dim' || raw === 'default') return raw;
        const parsed = JSON.parse(raw);
        const v = parsed?.variant;
        if (v === 'lights-out' || v === 'dim' || v === 'default') return v;
      } catch { /* ignore */ }
      return null;
    }

    function resolveSystemMode(): 'light' | 'dark' {
      try {
        if (matchMedia?.('(prefers-color-scheme: dark)').matches) {
          return 'dark';
        }
      } catch { /* ignore */ }
      return 'light';
    }

    // ========================================================================
    // URL HELPERS
    // ========================================================================

    function isWhitelistedHost(hostname: string, whitelist: string[]): boolean {
      if (!hostname || !Array.isArray(whitelist)) return false;
      for (const domain of whitelist) {
        if (!domain) continue;
        if (hostname === domain || hostname.endsWith('.' + domain)) return true;
      }
      return false;
    }

    // ========================================================================
    // STORAGE HELPERS
    // ========================================================================

    type StorageSettings = {
      enabled?: boolean;
      whitelist?: string[];
      apiKey?: string;
      theme?: string;
      themeMode?: string;
      autoMatchFeedTheme?: boolean;
    };

    function storageSyncGet(keys: (keyof StorageSettings)[], cb: (result: StorageSettings | null, ok: boolean) => void): void {
      try {
        if (typeof browser !== 'undefined' && browser.storage?.sync?.get) {
          const p = browser.storage.sync.get(keys as string[]);
          if (p && typeof p.then === 'function') {
            p.then((r) => cb(r as StorageSettings, true)).catch(() => cb(null, false));
            return;
          }
        }
      } catch { /* ignore */ }

      try {
        if (typeof chrome !== 'undefined' && chrome.storage?.sync?.get) {
          chrome.storage.sync.get(keys as string[], (r) => cb((r || null) as StorageSettings | null, true));
          return;
        }
      } catch { /* ignore */ }

      cb(null, false);
    }

    // ========================================================================
    // NAV CACHE READER
    // ========================================================================

    function getNavCacheItems(): NavItem[] | null {
      try {
        const data = localStorage.getItem(NAV_CACHE_KEY);
        if (!data) return null;
        const cache = JSON.parse(data);
        if (Date.now() - cache.timestamp > NAV_CACHE_TTL_MS) return null;
        return cache.items || null;
      } catch {
        return null;
      }
    }

    /** Get current username from nav cache profile link */
    function getCurrentUsernameFromNavCache(): string | null {
      try {
        const data = localStorage.getItem(NAV_CACHE_KEY);
        if (!data) return null;
        const cache = JSON.parse(data);
        const profileItem = cache.items?.find((item: NavItem) => item.id === 'profile');
        if (!profileItem?.href) return null;
        return profileItem.href.replace(/^\//, '').toLowerCase();
      } catch {
        return null;
      }
    }

    /** Check if URL is the user's own profile */
    function isOwnProfileUrl(url: string, currentUsername: string | null): boolean {
      if (!currentUsername) return false;
      try {
        const parsed = new URL(url);
        const host = parsed.hostname.replace(/^www\./, '');
        if (host !== 'x.com' && host !== 'twitter.com') return false;
        const profileMatch = parsed.pathname.match(/^\/([a-zA-Z0-9_]{1,15})$/);
        if (!profileMatch) return false;
        return profileMatch[1].toLowerCase() === currentUsername;
      } catch {
        return false;
      }
    }

    /** Get cached compose button SVG from nav cache */
    function getCachedComposeSvg(): string | null {
      try {
        const data = localStorage.getItem(NAV_CACHE_KEY);
        if (!data) return null;
        const cache = JSON.parse(data);
        return cache.composeSvg || null;
      } catch {
        return null;
      }
    }

    // ========================================================================
    // SHIMMER TEXT HELPER
    // ========================================================================

    function getShimmerTextHtml(text: string): string {
      return `<div class="shimmer-text">${createShimmerText(text)}</div>`;
    }

    // ========================================================================
    // MAIN LOGIC
    // ========================================================================

    push('hide-immediate:start', snap('start'));

    const html = document.documentElement;

    // ========================================================================
    // TWITTER SIDEBAR HIDING (always inject on X.com regardless of filtering)
    // ========================================================================

    function injectTwitterSidebarHiding(): void {
      try {
        const host = location.hostname.replace(/^www\./, '');
        if (host !== 'x.com' && host !== 'twitter.com') return;

        // Check if already injected
        if (document.getElementById('__cocoon_sidebar_hide')) return;

        const style = document.createElement('style');
        style.id = '__cocoon_sidebar_hide';
        // Hide "What's happening" and "Who to follow" sidebar widgets
        // Must hide the outer card containers (div.r-1kqtdi0.r-1867qdf), not just inner content
        style.textContent = `
          /* Hide the card container that wraps "Who to follow" */
          div:has(> div > aside[aria-label="Who to follow"]) { display: none !important; }
          /* Hide the card container that wraps "What's happening" / trending */
          div:has(> section [aria-label="Timeline: Trending now"]) { display: none !important; }
          /* Fallback: hide the inner elements too */
          aside[aria-label="Who to follow"],
          [aria-label="Timeline: Trending now"],
          [data-testid="trend"],
          [data-testid="UserCell"] { display: none !important; }
        `;
        (document.head || html).appendChild(style);
        push('hide-immediate:sidebar-hide-injected', { host });
      } catch { /* ignore */ }
    }

    // Inject sidebar hiding immediately (before any other logic)
    injectTwitterSidebarHiding();
    if (!html) {
      push('hide-immediate:no-html', snap('no-html'));
      return;
    }

    function restoreVisibilityAndReady(reason: string): void {
      try {
        push('hide-immediate:skip', snap('skip', { reason, href: location.href }));

        html.setAttribute(READY_ATTR, 'true');

        const prevVisibility = html.getAttribute(PREV_VIS_ATTR);
        if (prevVisibility !== null) {
          if (html.style.getPropertyValue('visibility') === 'hidden') {
            if (prevVisibility) html.style.visibility = prevVisibility;
            else html.style.removeProperty('visibility');
          }
          html.removeAttribute(PREV_VIS_ATTR);
        } else {
          html.style.removeProperty('visibility');
        }

        const overlay = document.getElementById(OVERLAY_ID);
        if (overlay) overlay.remove();
        const prehideStyle = document.getElementById(PREHIDE_STYLE_ID);
        if (prehideStyle) prehideStyle.remove();
      } catch { /* ignore */ }
    }

    push('hide-immediate:before-hide', snap('before-hide'));

    if (!html.hasAttribute(PREV_VIS_ATTR)) {
      html.setAttribute(PREV_VIS_ATTR, html.style.visibility || '');
    }

    html.style.setProperty('visibility', 'hidden', 'important');
    push('hide-immediate:after-hide', snap('after-hide'));

    // Minimal CSS fallback
    const s = document.createElement('style');
    s.id = PREHIDE_STYLE_ID;
    s.textContent = [
      `html:not([${READY_ATTR}="true"]){background:var(--cocoon-bg,#000)!important}`,
      `html:not([${READY_ATTR}="true"]) body{visibility:hidden!important}`,
      `#${OVERLAY_ID}{position:fixed!important;inset:0!important;z-index:2147483646!important;background:var(--cocoon-bg,#000)!important;display:flex!important;flex-direction:column!important;align-items:stretch!important;justify-content:flex-start!important;font-family:system-ui,-apple-system,sans-serif!important;color:var(--cocoon-text,#E7E9EA)!important;visibility:visible!important}`,
      `#${OVERLAY_ID},#${OVERLAY_ID} *,#${OVERLAY_ID} *::before,#${OVERLAY_ID} *::after{box-sizing:border-box!important}`,
      `#${OVERLAY_ID} *{visibility:visible!important}`,
      `#${OVERLAY_ID} .cocoon-error-title{margin-top:6px;font-size:14px;font-weight:600;color:var(--cocoon-text,#E7E9EA);letter-spacing:0;text-transform:none}`,
      `#${OVERLAY_ID} .cocoon-error-message{margin-top:10px;max-width:560px;padding:0 18px;text-align:center;font-size:13px;line-height:1.5;color:var(--cocoon-muted,#71767B);white-space:pre-wrap}`,
      `#${OVERLAY_ID} .cocoon-actions{display:flex;gap:12px;margin-top:18px;align-items:center;justify-content:center}`,
      `#${OVERLAY_ID} .cocoon-btn{appearance:none;border:1px solid var(--cocoon-border,#2F3336);background:var(--cocoon-surface,#16181C);color:var(--cocoon-text,#E7E9EA);padding:10px 14px;border-radius:10px;font-size:13px;font-weight:500;cursor:pointer}`,
      `#${OVERLAY_ID} .cocoon-btn:disabled{opacity:.65;cursor:default}`,
      `#${OVERLAY_ID} .cocoon-btn-danger{border-color:#67292D;background:#1C0E10;color:#F4212E}`,
      `#${OVERLAY_ID}.cocoon-content-mode~*,html:has(#${OVERLAY_ID}.cocoon-content-mode){overflow:hidden!important}`,
    ].join('');
    (document.head || html).appendChild(s);
    push('hide-immediate:after-style', snap('after-style', { styleLen: s.textContent?.length ?? 0 }));

    type CacheInfo = {
      navType: string | null;
      cache: FeedCacheBase | null;
      age: number | null;
    };

    function startFiltering(cacheInfo: CacheInfo): void {
      let cachedHtml: string | null = null;
      let cachedCss: string | null = null;
      try {
        if (cacheInfo?.navType) {
          push('hide-immediate:nav-type', { navType: cacheInfo.navType });
        }
        if (cacheInfo?.cache) {
          cachedHtml = cacheInfo.cache.renderedHtml || null;
          cachedCss = cacheInfo.cache.renderedCss || null;
          push('hide-immediate:cache-hit', { age: cacheInfo.age, hasCss: !!cachedCss, hasTheme: !!(cacheInfo.cache?.theme) });
        } else if (cacheInfo?.navType === 'back_forward') {
          push('hide-immediate:cache-miss', { age: cacheInfo.age });
        }
      } catch (e) {
        push('hide-immediate:cache-error', { message: e instanceof Error ? e.message : String(e) });
      }

      // Inject cached CSS immediately if available
      if (cachedCss && !document.getElementById(CONTENT_STYLES_ID)) {
        const cssStyle = document.createElement('style');
        cssStyle.id = CONTENT_STYLES_ID;
        cssStyle.textContent = cachedCss;
        (document.head || html).appendChild(cssStyle);
        push('hide-immediate:css-injected', { cssLen: cachedCss.length });
      }

      // Ensure an overlay exists immediately
      if (!document.getElementById(OVERLAY_ID)) {
        const overlay = document.createElement('div');
        overlay.id = OVERLAY_ID;
        if (cachedHtml) {
          overlay.innerHTML = cachedHtml;
          overlay.classList.add('cocoon-content-mode');
          if (document.body) document.body.style.overflow = 'hidden';
          push('hide-immediate:overlay-from-cache', { htmlLen: cachedHtml.length });
        } else {
          // Check nav cache and build sidebar
          let sidebarHtml: string;
          const navItems = getNavCacheItems();
          const composeSvg = getCachedComposeSvg();
          if (navItems && navItems.length > 0) {
            const navItemsHtml = navItems.map(item => {
              // Use X logo for home link
              const svgContent = item.id === 'home' ? X_LOGO_SVG : item.svg;
              return `<a href="${item.href}" class="cocoon-nav-link" title="${item.label}" data-nav-id="${item.id}"><span class="cocoon-nav-icon">${svgContent}</span></a>`;
            }).join('');
            sidebarHtml = getSidebarNavHtml(navItemsHtml, composeSvg || undefined);
            push('hide-immediate:nav-from-cache', { count: navItems.length, hasComposeSvg: !!composeSvg });
          } else {
            sidebarHtml = getSidebarNavHtml(undefined, composeSvg || undefined);
          }

          overlay.innerHTML = `${getShellHeaderHtml()}
${sidebarHtml}
<div class="cocoon-main-content">
  <div class="cocoon-skeleton-container">
    <div class="cocoon-feed-container"></div>
    <div class="cocoon-feed-status cocoon-feed-status-enter"><div class="cocoon-feed-status-inner"><div class="loader" aria-hidden="true"></div>
${getShimmerTextHtml('Waiting for feed')}
    </div></div>
  </div>
</div>`;
          overlay.classList.add('cocoon-content-mode');
          startInitialSkeletonReveal(overlay);
          push('hide-immediate:overlay-created', { parent: null });
        }
        (document.body || html).appendChild(overlay);
        if (!cachedHtml) {
          push('hide-immediate:overlay-created', snap('overlay-created', { parent: overlay.parentElement?.tagName ?? null }));
        }
      } else {
        push('hide-immediate:overlay-already-exists', snap('overlay-already-exists'));
      }

      // Detect style changes
      try {
        let styleChangeCount = 0;
        const mo = new MutationObserver((muts) => {
          for (const m of muts) {
            if (m.type !== 'attributes') continue;
            styleChangeCount++;
            push('hide-immediate:html-attr-change', snap('html-attr-change', {
              count: styleChangeCount,
              attr: m.attributeName,
              oldValue: m.oldValue,
              newValue: html.getAttribute(m.attributeName ?? ''),
            }));
            if (styleChangeCount >= 25) {
              mo.disconnect();
              push('hide-immediate:html-attr-change:disconnect', { count: styleChangeCount });
              break;
            }
          }
        });
        mo.observe(html, { attributes: true, attributeFilter: ['style', READY_ATTR], attributeOldValue: true });
      } catch (e) {
        push('hide-immediate:mutation-observer-error', { message: e instanceof Error ? e.message : String(e) });
      }

      // Paint timing
      try {
        const paintEntries = performance.getEntriesByType('paint') || [];
        push('hide-immediate:perf-paint-entries', {
          entries: paintEntries.map(e => ({ entryType: e.entryType, name: e.name, startTime: e.startTime, duration: e.duration }))
        });
      } catch (e) {
        push('hide-immediate:perf-get-entries-error', { message: e instanceof Error ? e.message : String(e) });
      }

      try {
        requestAnimationFrame(() => {
          push('hide-immediate:raf-1', snap('raf-1'));
          requestAnimationFrame(() => {
            push('hide-immediate:raf-2', snap('raf-2'));
          });
        });
      } catch (e) {
        push('hide-immediate:raf-error', { message: e instanceof Error ? e.message : String(e) });
      }

      setTimeout(() => {
        push('hide-immediate:timeout-0', snap('timeout-0'));
      }, 0);
    }

    // Decide whether to run
    storageSyncGet(['enabled', 'whitelist', 'apiKey', 'theme', 'themeMode', 'autoMatchFeedTheme'], (settings, ok) => {
      try {
        if (!ok || !settings) {
          push('hide-immediate:settings-unavailable', { ok });
          applyThemeColors(twitterThemes['lights-out'], 'dark');
          const cacheInfo = getBackForwardFeedCache(location.href);
          startFiltering(cacheInfo);
          return;
        }

        const whitelist = Array.isArray(settings.whitelist) ? settings.whitelist : [];
        const themeId = settings.theme || 'cocoon';
        const themeMode = settings.themeMode || 'system';
        const autoMatchFeed = settings.autoMatchFeedTheme !== false;
        let hostname = '';
        try { hostname = location.hostname; } catch { /* ignore */ }

        if (isWhitelistedHost(hostname, whitelist)) {
          restoreVisibilityAndReady('whitelisted');
          return;
        }

        // Skip overlay for user's own profile
        const currentUsername = getCurrentUsernameFromNavCache();
        if (isOwnProfileUrl(location.href, currentUsername)) {
          restoreVisibilityAndReady('own-profile');
          return;
        }

        if (!isSupportedFeedUrl(location.href)) {
          restoreVisibilityAndReady('not-feed-site');
          return;
        }

        const cacheInfo = getBackForwardFeedCache(location.href);
        const cacheTheme = cacheInfo?.cache?.theme;
        if (cacheTheme?.colors && cacheTheme.mode) {
          applyThemeColors(cacheTheme.colors, cacheTheme.mode);
          document.documentElement.setAttribute('data-cocoon-theme-source', 'feed-cache');
          push('hide-immediate:theme-from-cache', { mode: cacheTheme.mode });
        }

        const resolvedMode = themeMode === 'system' ? resolveSystemMode() : themeMode as 'light' | 'dark';

        if (!(cacheTheme?.colors && cacheTheme.mode)) {
          const host = hostname.replace(/^www\./, '');
          const isTwitter = (host === 'twitter.com' || host === 'x.com');

          if (autoMatchFeed && isTwitter) {
            let twitterVariant = getCachedTwitterVariant();
            const twitterVariantSource = twitterVariant ? 'twitter-cache' : 'twitter-default';
            if (!twitterVariant) twitterVariant = (resolvedMode === 'light') ? 'default' : 'lights-out';
            const colors = twitterThemes[twitterVariant] || twitterThemes['lights-out'];
            const mode = twitterVariant === 'default' ? 'light' : 'dark';
            applyThemeColors(colors, mode);
            document.documentElement.setAttribute('data-cocoon-theme-source', twitterVariantSource);
          } else {
            const colors = getThemeColors(themeId, resolvedMode);
            applyThemeColors(colors, resolvedMode);
            document.documentElement.setAttribute('data-cocoon-theme-source', 'settings');
          }
        }

        push('hide-immediate:theme-applied', { themeId, mode: resolvedMode, autoMatch: autoMatchFeed });

        startFiltering(cacheInfo);
      } catch (e) {
        push('hide-immediate:decide-error', { message: e instanceof Error ? e.message : String(e) });
        applyThemeColors(THEME_VARIANTS['cocoon']?.dark || twitterThemes['lights-out'], 'dark');
        const cacheInfo = getBackForwardFeedCache(location.href);
        startFiltering(cacheInfo);
      }
    });
  }
});
