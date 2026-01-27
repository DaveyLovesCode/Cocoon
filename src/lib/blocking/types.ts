/**
 * Shared types for blocking engine abstraction
 */

export interface CosmeticResult {
  selectors: string[];
  styles: string;
}

export interface BlockingEngine {
  /** Initialize the blocking engine (load filter lists, etc.) */
  init(): Promise<void>;

  /** Get cosmetic filters for a URL */
  getCosmeticFilters(url: string): Promise<CosmeticResult>;

  /** Check if initialization is complete */
  isReady(): boolean;
}

export interface NetworkBlockStats {
  blockedRequests: number;
  rulesLoaded: number;
}
