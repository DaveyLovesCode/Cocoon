/**
 * Blocking Engine Factory
 * Returns the appropriate blocking engine based on the browser.
 */

import type { BlockingEngine } from './types';

export type { BlockingEngine, CosmeticResult, NetworkBlockStats } from './types';

let engineInstance: BlockingEngine | null = null;

/**
 * Creates and returns the appropriate blocking engine for the current browser.
 * Uses lazy loading to avoid bundling both implementations.
 */
export async function createBlockingEngine(): Promise<BlockingEngine> {
  if (engineInstance) {
    return engineInstance;
  }

  // WXT sets import.meta.env.FIREFOX for Firefox builds
  const isFirefox = typeof import.meta.env.FIREFOX !== 'undefined' && import.meta.env.FIREFOX;

  if (isFirefox) {
    const { FirefoxBlockingEngine } = await import('./firefox');
    engineInstance = new FirefoxBlockingEngine();
  } else {
    const { ChromeBlockingEngine } = await import('./chrome');
    engineInstance = new ChromeBlockingEngine();
  }

  await engineInstance.init();
  return engineInstance;
}

/**
 * Returns the cached engine instance, or null if not yet created.
 */
export function getBlockingEngine(): BlockingEngine | null {
  return engineInstance;
}
