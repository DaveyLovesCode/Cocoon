/**
 * Twitter/X platform module.
 * Registers the platform and exports all providers.
 */

import { registerPlatform } from '../registry';
import { twitterAdapter } from './adapter';
import { twitterContext } from './context';
import { twitterNavigation } from './navigation';
import { twitterInit, getRenderSettings, extractStatusId } from './init';
import type { Platform } from '../types';

/**
 * Complete Twitter platform.
 */
export const twitter: Platform = {
  name: 'twitter',
  adapter: twitterAdapter,
  context: twitterContext,
  navigation: twitterNavigation,
  init: twitterInit,
};

// Self-register on import
registerPlatform(twitter);

// Re-export for direct access when needed
export { twitterAdapter, parseMetricNumber, convertTweetTextToHtml } from './adapter';
export { twitterContext } from './context';
export { twitterNavigation } from './navigation';
export { twitterInit, getRenderSettings, extractStatusId, fetchVideoUrl } from './init';
