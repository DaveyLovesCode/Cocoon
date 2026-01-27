/**
 * Chrome Blocking Engine
 * Uses declarativeNetRequest API for network blocking (MV3 requirement).
 * Limited to 30,000 dynamic rules.
 */

import { FiltersEngine, NetworkFilter } from '@ghostery/adblocker';
import { createLogger } from '../logger';
import { ALL_DOMAINS } from '../sites';
import type { BlockingEngine, CosmeticResult } from './types';

const log = createLogger('ChromeBlocking');

const MAX_DNR_RULES = 30000;

const FILTER_LISTS = [
  'https://easylist.to/easylist/easylist.txt',
  'https://easylist.to/easylist/easyprivacy.txt',
  'https://secure.fanboy.co.nz/fanboy-annoyance.txt',
];

const IDB_NAME = 'cocoon-filters';
const IDB_STORE = 'engine';
const CACHE_KEY = 'serialized';
const ONE_DAY = 24 * 60 * 60 * 1000;

export class ChromeBlockingEngine implements BlockingEngine {
  private engine: FiltersEngine | null = null;
  private loading: Promise<void> | null = null;
  private ready = false;

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

        // Check if DNR rules need updating
        const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
        if (existingRules.length === 0) {
          await this.updateNetworkRules();
        } else {
          log.info(`${existingRules.length} DNR rules already registered`);
        }

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

      // Update network blocking rules
      await this.updateNetworkRules();

      this.ready = true;
    } catch (e) {
      log.error('Failed to initialize blocking engine', e);
      this.engine = FiltersEngine.empty();
      this.ready = true;
    }
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

      log.info(`Cosmetic: ${hostname} - ${selectors.length} selectors`);

      return { selectors, styles };
    } catch (e) {
      log.error('Failed to get cosmetic filters', e);
      return { selectors: [], styles: '' };
    }
  }

  isReady(): boolean {
    return this.ready;
  }

  private async updateNetworkRules(): Promise<void> {
    if (!this.engine) return;

    const start = Date.now();

    try {
      // Use getFilters() to access network filters
      const { networkFilters } = this.engine.getFilters();
      log.info(`Processing ${networkFilters.length} network filters...`);

      const rules: chrome.declarativeNetRequest.Rule[] = [];
      let skipped = 0;
      let idx = 0;

      for (const filter of networkFilters) {
        if (rules.length >= MAX_DNR_RULES) break;
        idx++;

        const rule = this.networkFilterToDNR(filter, idx);
        if (rule) {
          rules.push(rule);
        } else {
          skipped++;
        }
      }

      log.info(`Converted ${rules.length} rules (skipped ${skipped} unsupported)`);

      // Get existing rule IDs to remove
      const existingRules = await chrome.declarativeNetRequest.getDynamicRules();
      const removeRuleIds = existingRules.map(r => r.id);

      // Update rules
      await chrome.declarativeNetRequest.updateDynamicRules({
        removeRuleIds,
        addRules: rules,
      });

      log.info(`Registered ${rules.length} DNR rules in ${Date.now() - start}ms`);
    } catch (e) {
      log.error('Failed to update DNR rules', e);
    }
  }

  private networkFilterToDNR(filter: NetworkFilter, id: number): chrome.declarativeNetRequest.Rule | null {
    try {
      // Skip unsupported filter types
      if (filter.isCSP() || filter.isRedirect() || filter.isBadFilter()) return null;

      // Build URL filter pattern
      let urlFilter = filter.getFilter() || '';
      if (!urlFilter && filter.getHostname()) {
        urlFilter = `||${filter.getHostname()}^`;
      }
      if (!urlFilter || urlFilter.length < 3) return null;

      // Skip regex filters (DNR has limited regex support)
      if (filter.isRegex()) return null;

      // Determine action
      const action = filter.isException()
        ? { type: 'allow' }
        : { type: 'block' };

      // Build resource types
      const resourceTypes: string[] = [];
      if (filter.fromScript()) resourceTypes.push('script');
      if (filter.fromImage()) resourceTypes.push('image');
      if (filter.fromStylesheet()) resourceTypes.push('stylesheet');
      if (filter.fromSubdocument()) resourceTypes.push('sub_frame');
      if (filter.fromXmlHttpRequest()) resourceTypes.push('xmlhttprequest');
      if (filter.fromMedia()) resourceTypes.push('media');
      if (filter.fromFont()) resourceTypes.push('font');
      if (filter.fromWebsocket()) resourceTypes.push('websocket');
      if (filter.fromPing()) resourceTypes.push('ping');

      // If no specific types, apply to main types
      if (resourceTypes.length === 0) {
        resourceTypes.push('script', 'image', 'stylesheet', 'sub_frame', 'xmlhttprequest', 'media');
      }

      // Build condition
      const condition: Record<string, unknown> = {
        urlFilter,
        resourceTypes,
        // Only apply rules when browsing on supported sites
        initiatorDomains: ALL_DOMAINS,
      };

      // Add domain constraints if present
      if (filter.firstParty() && !filter.thirdParty()) {
        condition.domainType = 'firstParty';
      } else if (filter.thirdParty() && !filter.firstParty()) {
        condition.domainType = 'thirdParty';
      }

      return {
        id,
        priority: filter.isException() ? 2 : 1,
        action,
        condition,
      } as chrome.declarativeNetRequest.Rule;
    } catch {
      return null;
    }
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
