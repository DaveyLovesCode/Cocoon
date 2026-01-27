/**
 * Rendered-content segmenter.
 *
 * Approach:
 * - Treat "what's rendered on screen" as the source of truth.
 * - Sweep scroll to force virtualization/infinite feeds to render.
 * - Capture visible content units and reduce each to a small summary for LLM hide/keep.
 * - Delegate platform-specific extraction to platform adapters.
 */

import { createLogger } from './logger';
import { getPlatformForUrl, type Platform, type PlatformAdapter, type ExtractedContent, type ScrollStrategy } from './platforms';
import { normalizeWhitespace } from './utils/text';

const log = createLogger('Segmenter');

const SKIP_ELEMENTS = new Set([
  "SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG",
  "IFRAME", "OBJECT", "EMBED",
  "BR", "HR", "INPUT", "BUTTON", "SELECT", "TEXTAREA",
]);

const SKIP_IDS = new Set(["__cocoon_overlay", "__cocoon_feed_overlay"]);

// Twitter sidebar elements to always skip (don't send to LLM)
// These are "What's happening" trends and "Who to follow" suggestions
const SKIP_TESTIDS = new Set(["trend", "UserCell"]);

const MIN_TEXT_LENGTH = 10;

const STABLE_TEST_ATTRIBUTES = [
  "data-testid",
  "data-test",
  "data-test-id",
  "data-qa",
  "data-cy",
  "data-e2e",
  "data-automation",
  "data-automation-id",
];

let cosmeticSelectors: string[] = [];

export function setCosmeticSelectors(selectors: string[]): void {
  cosmeticSelectors = selectors;
  log.info(`Loaded ${selectors.length} cosmetic filter selectors`);
}

function getStableTestAttribute(el: Element): { name: string; value: string } | null {
  for (const name of STABLE_TEST_ATTRIBUTES) {
    const value = el.getAttribute(name);
    if (value) return { name, value };
  }
  return null;
}

function intersectsViewport(rect: DOMRect, padding = 0): boolean {
  const left = 0 - padding;
  const top = 0 - padding;
  const right = (globalThis.innerWidth || 0) + padding;
  const bottom = (globalThis.innerHeight || 0) + padding;

  return rect.right > left && rect.left < right && rect.bottom > top && rect.top < bottom;
}

function hashFNV1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

export interface BlockMetadata {
  id: string;
  tag: string;
  role: string;
  text: string;
  title?: string;
  primaryText?: string;
  signature?: string;
  structure: string;
  linkCount: number;
  linkDensity: number;
  images: string[];
  classes: string[];
  elementId: string;
  depth: number;
  children: BlockMetadata[];
  isFeedItem?: boolean;

  // Platform-extracted content (generic structure)
  author?: { name?: string; handle?: string };
  url?: string;
  timestamp?: string;
  metrics?: { replies?: number; likes?: number; shares?: number; views?: number };
  hasVideo?: boolean;
  videoUrl?: string;
  statusId?: string;
  html?: string;
  quote?: { text: string; url?: string; html?: string };
  mediaUrls?: string[];
  quoteMediaUrls?: string[];
}

interface Block {
  element: Element;
  id: string;
  isFeedItem: boolean;
  title: string;
  primaryText: string;
  signature: string;
  extracted?: ExtractedContent;
  mediaUrls: string[];
  quoteMediaUrls: string[];
}

export type SegmentOptions = {
  sweep?: boolean;
  maxScreens?: number;
  stepRatio?: number;
  settleMs?: number;
  signal?: AbortSignal;
  /** Extra wait at the bottom for infinite-scroll content to append (default: 8000) */
  bottomWaitMs?: number;
  /** Starting scroll position for incremental capture */
  startY?: number;
  /** Existing signatures to skip (for incremental capture) */
  existingSignatures?: Set<string>;
  /** Don't restore scroll position after sweep (for incremental capture) */
  keepScrollPosition?: boolean;
  /** Pre-determined scroll container (skip detection) */
  scrollContainer?: Element | null;
};

export type SegmentResult = {
  blocks: BlockMetadata[];
  /** Final scroll position after capture */
  endScrollY: number;
  /** Whether more content might be available */
  hasMore: boolean;
  /** Signatures seen during this capture */
  signatures: Set<string>;
  /** The scroll container used (for caching) */
  scrollContainer: Element | null;
};

export class DOMSegmenter {
  private blockIndex = 0;
  private cosmeticFiltered = 0;
  private platform: Platform | null = null;
  private scrollContainer: Element | null = null;
  private windowScrollable: boolean = true;

  async segment(options: SegmentOptions = {}): Promise<BlockMetadata[]> {
    const result = await this.segmentIncremental(options);
    return result.blocks;
  }

  async segmentIncremental(options: SegmentOptions = {}): Promise<SegmentResult> {
    const throwIfAborted = () => {
      if (options.signal?.aborted) throw new Error('COCOON_ABORT');
    };

    const body = document.body;
    if (!body) return { blocks: [], endScrollY: 0, hasMore: false, signatures: new Set(), scrollContainer: null };

    // Use provided scroll container or detect it
    if (options.scrollContainer !== undefined) {
      this.scrollContainer = options.scrollContainer;
      this.platform = getPlatformForUrl(window.location.href);
      this.windowScrollable = this.detectWindowScrollable();
      log.info(`Using provided scroll container: ${this.scrollContainer?.tagName || 'null'}`);
    } else {
      // Get platform adapter for current URL
      this.platform = getPlatformForUrl(window.location.href);
      if (this.platform) {
        log.info(`Using platform adapter: ${this.platform.adapter.name}`);

        // Try scroll strategy first (preferred)
        const strategy = this.platform.adapter.getScrollStrategy?.();
        if (strategy) {
          this.scrollContainer = strategy.container;
          this.windowScrollable = strategy.windowScrollable;
          log.info(`Using platform scroll strategy: container=${this.scrollContainer?.tagName || 'null'}, windowScrollable=${this.windowScrollable}`);
        } else {
          // Fallback to legacy method
          this.scrollContainer = this.platform.adapter.getScrollContainer?.() || null;
          this.windowScrollable = this.detectWindowScrollable();
          if (this.scrollContainer) {
            log.info(`Using platform scroll container: ${this.scrollContainer.tagName}`);
          }
        }
      } else {
        // No platform - use generic detection
        this.scrollContainer = this.detectScrollContainer();
        this.windowScrollable = this.detectWindowScrollable();
        log.info(`Generic detection: container=${this.scrollContainer?.tagName || 'null'}, windowScrollable=${this.windowScrollable}`);
      }
    }

    const sweep = options.sweep !== false;
    const maxScreens = options.maxScreens ?? 25;
    const stepRatio = options.stepRatio ?? 0.85;
    const settleMs = options.settleMs ?? 150;
    const bottomWaitMs = options.bottomWaitMs ?? 8000;
    const initialStartY = options.startY ?? 0;
    const restoreScroll = sweep && !options.keepScrollPosition;

    const startX = globalThis.scrollX || 0;
    const originalY = this.scrollContainer ? this.scrollContainer.scrollTop : (globalThis.scrollY || 0);

    const blocks: Block[] = [];
    const seenSignatures = options.existingSignatures ? new Set(options.existingSignatures) : new Set<string>();
    let endScrollY = initialStartY;
    let hasMore = true;

    try {
      if (sweep) {
        throwIfAborted();
        await this.scrollToAndSettle(initialStartY, settleMs, options.signal);
        log.info(`Sweep starting at ${initialStartY}, scrollContainer=${this.scrollContainer?.tagName || 'window'}`);

        let screens = 0;
        let lastScrollHeight = 0;

        while (screens < maxScreens) {
          throwIfAborted();
          const beforeCapture = blocks.length;
          await this.captureViewport(blocks, seenSignatures, undefined, options.signal);
          const captured = blocks.length - beforeCapture;

          let metrics = this.getScrollMetrics();
          let maxY = Math.max(0, metrics.scrollHeight - metrics.viewportH);
          endScrollY = metrics.scrollY;

          log.debug(`Screen ${screens}: scrollY=${metrics.scrollY}, maxY=${maxY}, captured=${captured}, total=${blocks.length}`);

          if (metrics.scrollY >= maxY - 2) {
            if (metrics.scrollHeight === lastScrollHeight) {
              const grew = await this.waitForScrollHeightToIncrease(metrics.scrollHeight, bottomWaitMs, options.signal);
              if (!grew) {
                hasMore = false;
                break;
              }
              metrics = this.getScrollMetrics();
              maxY = Math.max(0, metrics.scrollHeight - metrics.viewportH);
            }
            lastScrollHeight = metrics.scrollHeight;
          }

          const step = Math.max(200, Math.floor(metrics.viewportH * stepRatio));
          const nextY = Math.min(maxY, metrics.scrollY + step);
          if (nextY === metrics.scrollY) {
            hasMore = false;
            break;
          }

          await this.scrollToAndSettle(nextY, settleMs, options.signal);
          endScrollY = nextY;
          screens++;
        }
      } else {
        throwIfAborted();
        await this.captureViewport(blocks, seenSignatures, undefined, options.signal);
        endScrollY = this.getScrollMetrics().scrollY;
      }
    } finally {
      if (restoreScroll) {
        if (this.scrollContainer) {
          this.scrollContainer.scrollTop = originalY;
        } else {
          globalThis.scrollTo(startX, originalY);
        }
      }
    }

    log.info(`Captured ${blocks.length} rendered blocks`);
    if (this.cosmeticFiltered > 0) {
      log.info(`Pre-filtered ${this.cosmeticFiltered} elements via cosmetic rules`);
    }

    return {
      blocks: blocks.map(block => this.blockToMetadata(block)),
      endScrollY,
      hasMore,
      signatures: seenSignatures,
      scrollContainer: this.scrollContainer,
    };
  }

  async sweepAndHide(signatures: Set<string>, options: SegmentOptions = {}): Promise<number> {
    this.platform = getPlatformForUrl(window.location.href);
    this.scrollContainer = this.platform?.adapter.getScrollContainer?.() || null;

    const sweep = options.sweep !== false;
    const maxScreens = options.maxScreens ?? 25;
    const stepRatio = options.stepRatio ?? 0.85;
    const settleMs = options.settleMs ?? 150;
    const bottomWaitMs = options.bottomWaitMs ?? 8000;

    const startX = globalThis.scrollX || 0;
    const startY = this.scrollContainer ? this.scrollContainer.scrollTop : (globalThis.scrollY || 0);
    const restoreScroll = sweep;

    let hidden = 0;

    try {
      if (sweep) {
        await this.scrollToAndSettle(0, settleMs, options.signal);

        let screens = 0;
        let lastScrollHeight = 0;

        while (screens < maxScreens) {
          hidden += await this.captureViewport(undefined, undefined, signatures, options.signal);

          let metrics = this.getScrollMetrics();
          let maxY = Math.max(0, metrics.scrollHeight - metrics.viewportH);

          if (metrics.scrollY >= maxY - 2) {
            if (metrics.scrollHeight === lastScrollHeight) {
              const grew = await this.waitForScrollHeightToIncrease(metrics.scrollHeight, bottomWaitMs, options.signal);
              if (!grew) break;
              metrics = this.getScrollMetrics();
              maxY = Math.max(0, metrics.scrollHeight - metrics.viewportH);
            }
            lastScrollHeight = metrics.scrollHeight;
          }

          const step = Math.max(200, Math.floor(metrics.viewportH * stepRatio));
          const nextY = Math.min(maxY, metrics.scrollY + step);
          if (nextY === metrics.scrollY) break;

          await this.scrollToAndSettle(nextY, settleMs, options.signal);
          screens++;
        }
      } else {
        hidden += await this.captureViewport(undefined, undefined, signatures, options.signal);
      }
    } finally {
      if (restoreScroll) {
        if (this.scrollContainer) {
          this.scrollContainer.scrollTop = startY;
        } else {
          globalThis.scrollTo(startX, startY);
        }
      }
    }

    return hidden;
  }

  private async scrollToAndSettle(y: number, settleMs: number, signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) return;
    if (this.scrollContainer) {
      this.scrollContainer.scrollTop = y;
    } else {
      globalThis.scrollTo(0, y);
    }
    await new Promise<void>(resolve => requestAnimationFrame(() => setTimeout(resolve, settleMs)));
  }

  private async waitForScrollHeightToIncrease(previousHeight: number, maxWaitMs: number, signal?: AbortSignal): Promise<boolean> {
    const start = performance.now();
    while (performance.now() - start < maxWaitMs) {
      if (signal?.aborted) return false;
      await new Promise<void>(resolve => setTimeout(resolve, 150));
      const current = this.getScrollMetrics().scrollHeight;
      if (current > previousHeight + 8) return true;
    }
    return false;
  }

  private getScrollMetrics(): { scrollY: number; scrollHeight: number; viewportH: number } {
    if (this.scrollContainer) {
      return {
        scrollY: this.scrollContainer.scrollTop,
        scrollHeight: this.scrollContainer.scrollHeight,
        viewportH: this.scrollContainer.clientHeight,
      };
    }

    // Only use window if it's actually scrollable
    if (!this.windowScrollable) {
      const bodyOverflow = getComputedStyle(document.body).overflowY;
      const htmlOverflow = getComputedStyle(document.documentElement).overflowY;
      const docScrollH = document.documentElement?.scrollHeight || 0;
      const bodyScrollH = document.body?.scrollHeight || 0;
      log.warn(`No scroll container and window not scrollable - sweep will be limited. ` +
        `body.overflow=${bodyOverflow}, html.overflow=${htmlOverflow}, ` +
        `docScrollH=${docScrollH}, bodyScrollH=${bodyScrollH}`);
      return { scrollY: 0, scrollHeight: 0, viewportH: window.innerHeight };
    }

    return {
      scrollY: globalThis.scrollY || 0,
      scrollHeight: Math.max(
        document.documentElement?.scrollHeight || 0,
        document.body?.scrollHeight || 0,
      ),
      viewportH: globalThis.innerHeight || 0,
    };
  }

  /** Detect scroll container using overflow CSS (generic fallback) */
  private detectScrollContainer(): Element | null {
    const startPoints = [
      document.querySelector('main'),
      document.querySelector('[role="main"]'),
      document.querySelector('#content'),
      document.querySelector('.content'),
      document.body.firstElementChild,
    ].filter(Boolean) as Element[];

    for (const start of startPoints) {
      let current: Element | null = start;
      while (current && current !== document.documentElement) {
        const style = getComputedStyle(current);
        if (style.overflowY === 'auto' || style.overflowY === 'scroll') {
          return current;
        }
        current = current.parentElement;
      }
    }
    return null;
  }

  /** Check if window/document scrolling is possible */
  private detectWindowScrollable(): boolean {
    const bodyStyle = getComputedStyle(document.body);
    const htmlStyle = getComputedStyle(document.documentElement);

    // If both body and html have overflow:hidden, window won't scroll
    if (bodyStyle.overflowY === 'hidden' && htmlStyle.overflowY === 'hidden') {
      return false;
    }

    // If body alone has overflow:hidden, check if document has scroll height
    if (bodyStyle.overflowY === 'hidden') {
      const docHeight = Math.max(
        document.documentElement.scrollHeight,
        document.body.scrollHeight
      );
      return docHeight > window.innerHeight;
    }

    return true;
  }

  private async captureViewport(
    blocks?: Block[],
    seen?: Set<string>,
    hideSignatures?: Set<string>,
    signal?: AbortSignal
  ): Promise<number> {
    let hidden = 0;
    const viewportH = globalThis.innerHeight || 0;
    const rectHeightLimit = viewportH * 2.5;

    const candidates = document.querySelectorAll(this.getViewportCandidateSelector());
    const unitEls = new Set<Element>();
    for (const el of Array.from(candidates)) {
      if (SKIP_ELEMENTS.has(el.tagName)) continue;
      if (el.id && SKIP_IDS.has(el.id)) continue;
      if (el.closest("#__cocoon_overlay, #__cocoon_feed_overlay")) continue;
      // Skip Twitter sidebar elements early
      const testId = el.getAttribute("data-testid");
      if (testId && SKIP_TESTIDS.has(testId)) continue;
      const unit = this.getUnitElement(el);
      unitEls.add(unit);
    }

    for (const el of unitEls) {
      if (signal?.aborted) throw new Error('COCOON_ABORT');
      if (SKIP_ELEMENTS.has(el.tagName)) continue;
      if (el.id && SKIP_IDS.has(el.id)) continue;
      if (el.closest("#__cocoon_overlay, #__cocoon_feed_overlay")) continue;
      // Skip Twitter sidebar elements (trends, user suggestions)
      const testId = el.getAttribute("data-testid");
      if (testId && SKIP_TESTIDS.has(testId)) continue;
      if (this.isHidden(el)) continue;
      if (this.matchesCosmeticFilter(el)) continue;

      const rect = (el as HTMLElement).getBoundingClientRect?.();
      if (!rect || rect.width <= 0 || rect.height <= 0) continue;
      if (!intersectsViewport(rect, 8)) continue;

      const isFeedItem = this.isFeedItemElement(el);
      if (!isFeedItem && rect.height > rectHeightLimit) continue;

      if ((el.tagName === "MAIN" || el.tagName === "SECTION") && el.querySelectorAll('article,[role="article"],[role="listitem"],li').length >= 3) {
        continue;
      }

      // Skip container elements that hold multiple feed items (e.g., timeline wrappers)
      if (!isFeedItem && this.platform) {
        const nestedFeedItems = el.querySelectorAll('[data-testid="tweet"], article[role="article"], [role="listitem"]');
        if (nestedFeedItems.length >= 2) continue;
      }

      // Expand truncated content for feed items before extracting text
      if (isFeedItem && blocks && this.platform?.adapter.expandTruncatedContent) {
        await this.platform.adapter.expandTruncatedContent(el);
      }

      const hasMedia = el.querySelector("img, video, canvas") !== null;

      const summary = this.summarizeElement(el, isFeedItem, hasMedia);
      if (summary.primaryText.length < MIN_TEXT_LENGTH && !hasMedia) continue;

      if (seen && seen.has(summary.signature)) continue;
      seen?.add(summary.signature);

      const id = this.nextId();
      (el as HTMLElement).setAttribute("data-cocoon-id", id);
      (el as HTMLElement).setAttribute("data-cocoon-sig", summary.signature);

      if (hideSignatures?.has(summary.signature)) {
        (el as HTMLElement).setAttribute("data-cocoon-hide", "true");
        hidden++;
      }

      if (blocks) {
        blocks.push({
          element: el,
          id,
          isFeedItem,
          title: summary.title,
          primaryText: summary.primaryText,
          signature: summary.signature,
          extracted: summary.extracted,
          mediaUrls: summary.mediaUrls,
          quoteMediaUrls: summary.quoteMediaUrls,
        });
      }
    }

    return hidden;
  }

  private getUnitElement(el: Element): Element {
    const feed = el.closest('article,[role="article"],[role="listitem"],li');
    if (feed) return feed;

    const innerFeed = el.querySelector(':scope > article, :scope > [role="article"], article[data-testid="tweet"]');
    if (innerFeed) return innerFeed;

    const chrome = el.closest('nav,header,footer,aside');
    if (chrome) return chrome;

    const labeledDiv = el.closest('div[id],div[role],div[aria-label],div[aria-labelledby],div[aria-describedby]');
    if (labeledDiv) return labeledDiv;

    const tag = el.tagName;
    if (tag === "MAIN" || tag === "SECTION" || tag === "FIGURE") return el;

    const isTextLeaf = tag === "P" || tag === "H1" || tag === "H2" || tag === "H3";
    if (!isTextLeaf) {
      const structural = el.closest('main,section,figure');
      if (structural) return structural;
    }

    return el;
  }

  private getViewportCandidateSelector(): string {
    const selectors: string[] = [
      "article",
      "[role=\"article\"]",
      "[role=\"listitem\"]",
      "li",
      "main",
      "section",
      "nav",
      "aside",
      "header",
      "footer",
      "figure",
      "div[id]",
      "div[role]",
      "div[aria-label]",
      "div[aria-labelledby]",
      "div[aria-describedby]",
      "p",
      "h1",
      "h2",
      "h3",
    ];

    for (const attr of STABLE_TEST_ATTRIBUTES) selectors.push(`[${attr}]`);

    return selectors.join(", ");
  }

  private isFeedItemElement(el: Element): boolean {
    // Use platform-specific detection if available (no fallback when platform exists)
    if (this.platform) {
      return this.platform.adapter.isFeedItem(el);
    }

    // Generic fallback for sites without platform adapter
    const role = (el.getAttribute("role") || "").toLowerCase();
    if (role === "article" || role === "listitem") return true;
    if (el.tagName === "ARTICLE" || el.tagName === "LI") return true;
    return false;
  }

  private summarizeElement(el: Element, isFeedItem: boolean, hasMedia: boolean): {
    title: string;
    primaryText: string;
    signature: string;
    extracted?: ExtractedContent;
    mediaUrls: string[];
    quoteMediaUrls: string[];
  } {
    const title = this.extractTitle(el);
    let primaryText: string;
    let extracted: ExtractedContent | undefined;
    let mediaUrls: string[] = [];
    let quoteMediaUrls: string[] = [];

    // Use platform adapter for extraction if available and this is a feed item
    if (isFeedItem && this.platform?.adapter.isFeedItem(el)) {
      extracted = this.platform.adapter.extractContent(el);
      primaryText = extracted.text;

      const media = this.platform.adapter.extractMediaUrls(el);
      mediaUrls = media.main;
      quoteMediaUrls = media.quote;
    } else {
      primaryText = this.extractPrimaryText(el, isFeedItem ? 10 : 30);
    }

    // Image alt texts for signature
    const images: string[] = [];
    for (const img of el.querySelectorAll("img")) {
      const alt = ((img as HTMLImageElement).alt || "").trim();
      if (alt) images.push(alt);
    }

    // Use statusId for signature if available (most stable identifier for feed items)
    // Otherwise fall back to text-based signature
    let signature: string;
    if (extracted?.statusId) {
      signature = hashFNV1a(extracted.statusId);
    } else {
      const mediaHint = hasMedia && images.length === 0 ? "[media]" : images.slice(0, 3).join(" | ");
      const sigSource = `${title}\n${primaryText}\n${mediaHint}`;
      signature = hashFNV1a(sigSource.substring(0, 2000));
    }

    return { title, primaryText, signature, extracted, mediaUrls, quoteMediaUrls };
  }

  private extractTitle(el: Element): string {
    const headings = el.querySelectorAll("h1, h2, h3");
    for (const h of headings) {
      const text = normalizeWhitespace(h.textContent || "");
      if (text.length >= 8) return text;
    }
    return "";
  }

  private extractPrimaryText(root: Element, minCandidateTextLength: number): string {
    const candidates: Array<{ el: Element; text: string; len: number }> = [];

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT);
    let node: Node | null = walker.currentNode;
    let visited = 0;

    while (node && visited < 800) {
      const el = node as Element;
      visited++;

      if (SKIP_ELEMENTS.has(el.tagName)) {
        node = walker.nextNode();
        continue;
      }

      const text = normalizeWhitespace(el.textContent || "");
      if (text.length >= minCandidateTextLength) {
        candidates.push({ el, text, len: text.length });
      }

      node = walker.nextNode();
    }

    if (candidates.length === 0) return normalizeWhitespace(root.textContent || "");

    candidates.sort((a, b) => b.len - a.len);
    const shortList = candidates.slice(0, 60);

    let best = shortList[0];
    let bestScore = -Infinity;

    for (const c of shortList) {
      const el = c.el;

      const role = (el.getAttribute("role") || "").toLowerCase();
      const tag = el.tagName;
      const isChrome = tag === "NAV" || tag === "HEADER" || tag === "FOOTER" ||
        role === "navigation" || role === "banner" || role === "contentinfo";

      const descCount = el.querySelectorAll("*").length;
      const density = c.len / (descCount + 1);
      const punct = (c.text.match(/[.!?]/g) || []).length;

      const score = Math.min(c.len, 2500) + (density * 120) + (punct * 10) + (isChrome ? -500 : 0);

      if (score > bestScore) {
        bestScore = score;
        best = c;
      }
    }

    return best.text;
  }

  private nextId(): string {
    return this.base62(this.blockIndex++);
  }

  private base62(num: number): string {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    if (num < 62) return chars[num];

    let result = "";
    let n = num;
    while (n >= 0) {
      result = chars[n % 62] + result;
      n = Math.floor(n / 62) - 1;
      if (n < 0) break;
    }
    return result || "A";
  }

  private isHidden(el: Element): boolean {
    if (el.hasAttribute("hidden")) return true;
    if (el.getAttribute("aria-hidden") === "true") return true;
    const style = (el.getAttribute("style") || "").toLowerCase();
    if (style.includes("display:none") || style.includes("display: none") ||
        style.includes("visibility:hidden") || style.includes("visibility: hidden")) {
      return true;
    }

    try {
      const computed = getComputedStyle(el);
      if (computed.display === 'none') return true;
    } catch {
      // Ignore detached elements
    }

    return false;
  }

  private matchesCosmeticFilter(el: Element): boolean {
    if (cosmeticSelectors.length === 0) return false;

    for (const selector of cosmeticSelectors) {
      try {
        if (el.matches(selector)) {
          this.cosmeticFiltered++;
          return true;
        }
      } catch {
        // Invalid selector, skip
      }
    }
    return false;
  }

  private blockToMetadata(block: Block): BlockMetadata {
    const el = block.element;
    const tag = el.tagName.toLowerCase();
    const structure = this.getStructure(el);

    const links = el.querySelectorAll("a[href]");
    const linkCount = links.length;

    let linkTextLen = 0;
    for (const link of links) linkTextLen += (link.textContent || "").trim().length;
    const linkDensity = block.primaryText.length > 0 ? Math.round((linkTextLen / block.primaryText.length) * 100) / 100 : 0;

    const images: string[] = [];
    for (const img of el.querySelectorAll("img")) {
      const alt = ((img as HTMLImageElement).alt || "").trim();
      if (alt) images.push(alt);
    }

    const classes = this.getClasses(el);
    const extracted = block.extracted;

    return {
      id: block.id,
      tag,
      role: el.getAttribute("role") || "",
      text: block.primaryText.substring(0, 2000),
      title: block.title ? block.title.substring(0, 300) : undefined,
      primaryText: block.primaryText.substring(0, 2000),
      signature: block.signature,
      structure,
      linkCount,
      linkDensity,
      images: images.slice(0, 5),
      classes,
      elementId: el.id || "",
      depth: 0,
      children: [],
      isFeedItem: block.isFeedItem,

      // Platform-extracted fields
      author: extracted?.author,
      url: extracted?.url,
      timestamp: extracted?.timestamp,
      metrics: extracted?.metrics,
      hasVideo: extracted?.hasVideo,
      videoUrl: extracted?.videoUrl,
      statusId: extracted?.statusId,
      html: extracted?.html,
      quote: extracted?.quote,
      mediaUrls: block.mediaUrls,
      quoteMediaUrls: block.quoteMediaUrls,
    };
  }

  private getStructure(el: Element): string {
    const parts: string[] = [];

    let summary = `<${el.tagName.toLowerCase()}`;
    if (el.id) summary += ` id="${el.id}"`;
    const cls = this.getClasses(el).join(" ");
    if (cls) summary += ` class="${cls}"`;
    if (el.getAttribute("role")) summary += ` role="${el.getAttribute("role")}"`;
    summary += ">";
    parts.push(summary);

    const childTags: Record<string, number> = {};
    for (const child of el.children) {
      if (SKIP_ELEMENTS.has(child.tagName)) continue;
      const tag = child.tagName.toLowerCase();
      childTags[tag] = (childTags[tag] || 0) + 1;
    }

    if (Object.keys(childTags).length > 0) {
      const childSummary = Object.entries(childTags)
        .map(([tag, count]) => count > 1 ? `${tag}x${count}` : tag)
        .join(", ");
      parts.push(`children: [${childSummary}]`);
    }

    return parts.join(" ");
  }

  private getClasses(el: Element): string[] {
    const result: string[] = [];

    const stableAttr = getStableTestAttribute(el);
    if (stableAttr) result.push(`[${stableAttr.value}]`);

    const classAttr = el.getAttribute("class") || "";
    const classes = classAttr.split(/\s+/).filter(Boolean);

    const patterns = [
      /nav/i, /menu/i, /header/i, /footer/i, /sidebar/i, /content/i,
      /article/i, /post/i, /comment/i, /related/i, /recommend/i,
      /ad[s-]?/i, /sponsor/i, /promo/i, /cookie/i, /consent/i,
      /popup/i, /modal/i, /social/i, /share/i, /banner/i, /card/i,
      /list/i, /grid/i, /hero/i, /main/i, /feed/i, /stream/i,
      /item/i, /entry/i, /story/i, /result/i, /row/i, /thread/i,
    ];

    const significant = classes.filter(cls => patterns.some(p => p.test(cls)));
    const classesToAdd = (significant.length > 0 ? significant : classes).slice(0, 3);
    result.push(...classesToAdd);

    return result.slice(0, 4);
  }
}
