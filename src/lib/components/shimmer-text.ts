/**
 * ShimmerText - Creates animated text with staggered letter fade.
 * Each character fades in opacity, creating a wave effect left-to-right.
 */

import { escapeHtml } from '@/lib/utils/escape';

/**
 * Create shimmer text HTML with staggered animation delays.
 * Each character gets its own span with animation-delay based on index.
 */
export function createShimmerText(text: string): string {
  const chars = text.split('');
  return chars.map((char, i) => {
    const escaped = char === ' ' ? '&nbsp;' : escapeHtml(char);
    // Negative delay: animation starts "in the past" so wave is already established
    const delay = -(i * 0.06);
    return `<span class="shimmer-char" style="animation-delay:${delay.toFixed(2)}s">${escaped}</span>`;
  }).join('');
}

/**
 * Create shimmer text element directly (for use in hide-immediate.js).
 * Returns the HTML string for the shimmer text container.
 */
export function getShimmerTextHtml(text: string): string {
  return `<div class="shimmer-text">${createShimmerText(text)}</div>`;
}

/**
 * Update existing shimmer text with new message.
 * Preserves animation continuity by keeping the container.
 */
export function updateShimmerText(container: HTMLElement, text: string): void {
  container.innerHTML = createShimmerText(text);
}
