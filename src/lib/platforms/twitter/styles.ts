/**
 * Minimal CSS for Twitter/X platform adapter.
 * Most styling is done via Tailwind classes in renderItem.
 * This file contains only what Tailwind can't handle.
 */

import { getVideoPlayerStyles } from '../../video-player';

/**
 * Minimal CSS for feed items - animations and things Tailwind can't do.
 */
export function getFeedItemStyles(): string {
  return `
    /* Item entrance animation */
    .cocoon-item { animation: cocoon-item-in 0.3s ease-out; }

    /* Thumbnail play indicator positioning */
    .cocoon-has-video .cocoon-video-indicator {
      position: absolute;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
    }

    /* Text truncation using line-clamp (preserves formatting) */
    .cocoon-text-truncated {
      display: -webkit-box;
      -webkit-line-clamp: 6;
      -webkit-box-orient: vertical;
      overflow: hidden;
    }

    ${getVideoPlayerStyles()}
  `;
}
