/**
 * Skeleton loading component - placeholder UI while content loads.
 * Single source of truth for skeleton HTML structure.
 */

import { SKELETON_HEIGHT, INITIAL_SKELETON_MAX, SKELETON_REVEAL_ATTR } from '@/lib/constants';

/**
 * Generate HTML for a single skeleton item.
 * Used by both hide-immediate (early load) and feed-overlay (content script).
 */
export function getSkeletonItemHtml(index: number): string {
  return `<div class="cocoon-item cocoon-skeleton cocoon-skeleton-enter" data-skeleton-idx="${index}" style="height: ${SKELETON_HEIGHT}px;">
  <div class="skeleton-inner">
    <div class="skeleton-header">
      <div class="skeleton-bone skeleton-avatar"></div>
      <div class="skeleton-bone skeleton-handle"></div>
    </div>
    <div class="skeleton-body">
      <div class="skeleton-bone skeleton-line skeleton-line-full"></div>
      <div class="skeleton-bone skeleton-line skeleton-line-3-4"></div>
      <div class="skeleton-bone skeleton-line skeleton-line-half"></div>
    </div>
  </div>
  <div class="skeleton-content"></div>
</div>`;
}

/**
 * Create a skeleton DOM element.
 */
export function createSkeletonElement(index: number): HTMLElement | null {
  const temp = document.createElement('div');
  temp.innerHTML = getSkeletonItemHtml(index);
  return temp.firstElementChild as HTMLElement | null;
}

/**
 * Reveal a skeleton with animation (remove enter class).
 */
export function revealSkeleton(el: HTMLElement): void {
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      el.classList.remove('cocoon-skeleton-enter');
    });
  });
}

// Track reveal timeouts so we can cancel them
let initialSkeletonRevealTimeouts: number[] = [];

/**
 * Stop any pending skeleton reveal animations.
 */
export function stopInitialSkeletonReveal(): void {
  for (const id of initialSkeletonRevealTimeouts) {
    window.clearTimeout(id);
  }
  initialSkeletonRevealTimeouts = [];
}

/**
 * Start the initial skeleton reveal animation sequence.
 * Shows skeletons one-by-one with staggered timing.
 */
export function startInitialSkeletonReveal(overlay: HTMLElement): void {
  if (overlay.getAttribute(SKELETON_REVEAL_ATTR) === '1') return;
  overlay.setAttribute(SKELETON_REVEAL_ATTR, '1');

  const feedContainer = overlay.querySelector('.cocoon-feed-container');
  if (!feedContainer) return;

  const stopIfContent = () => !!overlay.querySelector('.cocoon-item:not(.cocoon-skeleton)');

  if (stopIfContent()) return;
  if (feedContainer.querySelector('.cocoon-skeleton')) return;

  stopInitialSkeletonReveal();

  const status = overlay.querySelector('.cocoon-feed-status') as HTMLElement | null;
  status?.classList.add('cocoon-feed-status-enter');

  const frag = document.createDocumentFragment();
  for (let i = 0; i < INITIAL_SKELETON_MAX; i++) {
    const el = createSkeletonElement(i);
    if (!el) continue;
    el.classList.add('cocoon-skeleton-enter');
    frag.appendChild(el);
  }
  feedContainer.insertBefore(frag, feedContainer.firstChild);

  const skeletons = Array.from(feedContainer.querySelectorAll('.cocoon-skeleton')).slice(0, INITIAL_SKELETON_MAX) as HTMLElement[];
  for (let i = 0; i < skeletons.length; i++) {
    const el = skeletons[i];
    initialSkeletonRevealTimeouts.push(window.setTimeout(() => {
      if (!overlay.isConnected) return;
      if (stopIfContent()) return;
      revealSkeleton(el);
      if (i === skeletons.length - 1 && status) {
        initialSkeletonRevealTimeouts.push(window.setTimeout(() => {
          status.classList.remove('cocoon-feed-status-enter');
        }, 90));
      }
    }, i * 70));
  }
}

/**
 * Calculate how many skeleton items should fill the viewport.
 */
export function getSkeletonCount(): number {
  const viewportHeight = window.innerHeight;
  // Account for header/padding (~60px top)
  const availableHeight = viewportHeight - 60;
  return Math.ceil(availableHeight / (SKELETON_HEIGHT + 12)); // 12 = gap
}
