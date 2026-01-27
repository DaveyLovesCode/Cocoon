/**
 * Firefox Blocking Engine
 * Uses webRequest API for network blocking (full power, no rule limits).
 * This is the same approach used by uBlock Origin.
 */

import { FiltersEngine, Request, RequestType } from '@ghostery/adblocker';
import { createLogger } from '../logger';
import type { BlockingEngine, CosmeticResult } from './types';

import { ALL_DOMAINS } from '../sites';

const log = createLogger('FirefoxBlocking');

const FILTER_LISTS = [
  'https://easylist.to/easylist/easylist.txt',
  'https://easylist.to/easylist/easyprivacy.txt',
  'https://secure.fanboy.co.nz/fanboy-annoyance.txt',
];

const IDB_NAME = 'cocoon-filters';
const IDB_STORE = 'engine';
const CACHE_KEY = 'serialized';
const ONE_DAY = 24 * 60 * 60 * 1000;

export class FirefoxBlockingEngine implements BlockingEngine {
  private engine: FiltersEngine | null = null;
  private loading: Promise<void> | null = null;
  private ready = false;
  private blockedCount = 0;

  async init(): Promise<void> {
    if (this.ready) return;
    if (this.loading) return this.loading;

    this.loading = this.doInit();
    await this.loading;
    this.loading = null;
  }

  private async doInit(): Promise<void> {
    const start = Date.now();

    try {
      // Try IndexedDB cache first
      const cached = await this.getCached();
      if (cached && (Date.now() - cached.timestamp < ONE_DAY)) {
        log.info('Loading from IndexedDB cache...');
        this.engine = FiltersEngine.deserialize(cached.data);
        log.info(`Loaded from cache in ${Date.now() - start}ms`);
        this.setupWebRequestBlocking();
        this.ready = true;
        return;
      }

      // Fetch fresh filter lists
      log.info('Fetching fresh filter lists...');
      const lists = await Promise.all(
        FILTER_LISTS.map(async (url) => {
          try {
            const res = await fetch(url);
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return await res.text();
          } catch (e) {
            log.warn(`Failed to fetch ${url}`);
            return '';
          }
        })
      );

      const combined = lists.filter(Boolean).join('\n');
      this.engine = FiltersEngine.parse(combined, { enableCompression: true });

      log.info(`Parsed ${(combined.length / 1024).toFixed(0)}KB in ${Date.now() - start}ms`);

      // Cache to IndexedDB
      const serialized = this.engine.serialize();
      await this.setCache(serialized);
      log.info(`Cached ${(serialized.length / 1024).toFixed(0)}KB to IndexedDB`);

      // Setup real-time request blocking
      this.setupWebRequestBlocking();

      this.ready = true;
    } catch (e) {
      log.error('Failed to initialize blocking engine', e);
      this.engine = FiltersEngine.empty();
      this.ready = true;
    }
  }

  private setupWebRequestBlocking(): void {
    if (!this.engine) return;

    // Remove any existing listener first
    if (browser.webRequest.onBeforeRequest.hasListener(this.handleRequest)) {
      browser.webRequest.onBeforeRequest.removeListener(this.handleRequest);
    }

    // Add blocking listener
    browser.webRequest.onBeforeRequest.addListener(
      this.handleRequest,
      { urls: ['<all_urls>'] },
      ['blocking']
    );

    log.info('webRequest blocking listener registered');
  }

  private handleRequest = (details: { url: string; originUrl?: string; documentUrl?: string; type: string }): { cancel: boolean } | void => {
    if (!this.engine) return;

    // Skip extension URLs
    if (details.url.startsWith('moz-extension://') || details.url.startsWith('about:')) {
      return;
    }

    // Only block when on supported sites
    const originUrl = details.originUrl || details.documentUrl || '';
    if (originUrl) {
      try {
        const originHost = new URL(originUrl).hostname.replace(/^www\./, '');
        if (!ALL_DOMAINS.some(d => originHost === d || originHost.endsWith('.' + d))) {
          return;
        }
      } catch {
        return; // Can't parse origin, don't block
      }
    }

    try {
      const request = Request.fromRawDetails({
        url: details.url,
        sourceUrl: details.originUrl || details.documentUrl || '',
        type: this.mapResourceType(details.type) as RequestType,
      });

      const result = this.engine.match(request);

      if (result.match && !result.exception) {
        this.blockedCount++;
        if (this.blockedCount % 100 === 0) {
          log.debug(`Blocked ${this.blockedCount} requests`);
        }
        return { cancel: true };
      }
    } catch (e) {
      // Don't block on errors
    }
  };

  private mapResourceType(type: string): string {
    const typeMap: Record<string, string> = {
      main_frame: 'document',
      sub_frame: 'subdocument',
      stylesheet: 'stylesheet',
      script: 'script',
      image: 'image',
      font: 'font',
      object: 'object',
      xmlhttprequest: 'xmlhttprequest',
      ping: 'ping',
      csp_report: 'csp_report',
      media: 'media',
      websocket: 'websocket',
      other: 'other',
    };
    return typeMap[type] || 'other';
  }

  async getCosmeticFilters(url: string): Promise<CosmeticResult> {
    if (!this.engine) {
      return { selectors: [], styles: '' };
    }

    try {
      const urlObj = new URL(url);
      const hostname = urlObj.hostname;
      const parts = hostname.split('.');
      const domain = parts.length > 2 ? parts.slice(-2).join('.') : hostname;

      const result = this.engine.getCosmeticsFilters({
        url,
        hostname,
        domain,
        getBaseRules: true,
        getInjectionRules: true,
        getExtendedRules: true,
        getRulesFromDOM: false,
        getRulesFromHostname: true,
      });

      const styles = result.styles || '';

      // Parse selectors for DOM filtering
      const selectors: string[] = [];
      const ruleMatches = styles.matchAll(/([^{}]+)\s*\{[^}]*\}/g);
      for (const match of ruleMatches) {
        const selectorPart = match[1].trim();
        const selectorParts = selectorPart.split(',').map(s => s.trim()).filter(Boolean);
        selectors.push(...selectorParts);
      }

      log.info(`Cosmetic: ${url} - ${selectors.length} selectors, ${styles.length} chars CSS`);

      return { selectors, styles };
    } catch (e) {
      log.error('Failed to get cosmetic filters', e);
      return { selectors: [], styles: '' };
    }
  }

  isReady(): boolean {
    return this.ready;
  }

  getBlockedCount(): number {
    return this.blockedCount;
  }

  // IndexedDB helpers
  private openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(IDB_NAME, 1);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => resolve(req.result);
      req.onupgradeneeded = () => {
        req.result.createObjectStore(IDB_STORE);
      };
    });
  }

  private async getCached(): Promise<{ data: Uint8Array; timestamp: number } | null> {
    try {
      const db = await this.openDB();
      return new Promise((resolve) => {
        const tx = db.transaction(IDB_STORE, 'readonly');
        const store = tx.objectStore(IDB_STORE);
        const req = store.get(CACHE_KEY);
        req.onsuccess = () => resolve(req.result || null);
        req.onerror = () => resolve(null);
      });
    } catch {
      return null;
    }
  }

  private async setCache(data: Uint8Array): Promise<void> {
    try {
      const db = await this.openDB();
      return new Promise((resolve, reject) => {
        const tx = db.transaction(IDB_STORE, 'readwrite');
        const store = tx.objectStore(IDB_STORE);
        store.put({ data, timestamp: Date.now() }, CACHE_KEY);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    } catch (e) {
      log.warn('IndexedDB cache write failed', e);
    }
  }
}
