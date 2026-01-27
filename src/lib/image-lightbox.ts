/**
 * Image lightbox for viewing images in an overlay modal.
 * Supports multiple images with navigation.
 */

import { createLogger } from './logger';
import { escapeHtml } from './utils/escape';

const log = createLogger('Lightbox');
const LIGHTBOX_ID = '__cocoon_lightbox';

let currentImages: string[] = [];
let currentIndex = 0;

export function openLightbox(images: string[], startIndex = 0): void {
  log.debug(`openLightbox called with ${images.length} images: ${JSON.stringify(images).substring(0, 200)}`);
  if (images.length === 0) return;

  currentImages = images;
  currentIndex = Math.max(0, Math.min(startIndex, images.length - 1));

  // Remove existing lightbox immediately if any
  closeLightbox(true);

  const lightbox = document.createElement('div');
  lightbox.id = LIGHTBOX_ID;
  // Apply critical styles inline to guarantee they take effect
  lightbox.style.cssText = 'position:fixed;inset:0;z-index:2147483647;opacity:0;transition:opacity 0.2s ease;';
  lightbox.innerHTML = getLightboxHtml();

  // Append to overlay if it exists, otherwise body
  const overlay = document.getElementById('__cocoon_overlay');
  const parent = overlay || document.body;
  parent.appendChild(lightbox);
  log.debug(`Lightbox appended to: ${parent.id || 'body'}`);

  // Check if styles exist
  const styleEl = document.getElementById('__cocoon_content_styles');
  log.debug(`Lightbox appended. Styles element exists: ${!!styleEl}`);
  if (styleEl) {
    const hasLightboxStyles = styleEl.textContent?.includes('__cocoon_lightbox');
    log.debug(`Styles contain lightbox CSS: ${hasLightboxStyles}`);
  }

  // Attach handlers
  const backdrop = lightbox.querySelector('.lightbox-backdrop') as HTMLElement;
  const closeBtn = lightbox.querySelector('.lightbox-close') as HTMLElement;
  const prevBtn = lightbox.querySelector('.lightbox-prev') as HTMLElement;
  const nextBtn = lightbox.querySelector('.lightbox-next') as HTMLElement;

  backdrop?.addEventListener('click', (e) => {
    if (e.target === backdrop) closeLightbox();
  });
  closeBtn?.addEventListener('click', () => closeLightbox());
  prevBtn?.addEventListener('click', () => showPrev());
  nextBtn?.addEventListener('click', () => showNext());

  document.addEventListener('keydown', handleKeydown);

  updateImage();

  // Animate in
  requestAnimationFrame(() => {
    lightbox.classList.add('visible');
    lightbox.style.opacity = '1';
    log.debug(`Lightbox classes: ${lightbox.className}, id: ${lightbox.id}`);

    // Check styles after transition
    setTimeout(() => {
      const computed = getComputedStyle(lightbox);
      log.debug(`Lightbox styles after 250ms: z-index=${computed.zIndex}, opacity=${computed.opacity}, display=${computed.display}`);

      // Check if element still exists and is in DOM
      const inDom = document.body.contains(lightbox);
      log.debug(`Lightbox in DOM: ${inDom}`);
    }, 250);
  });
}

export function closeLightbox(immediate = false): void {
  const lightbox = document.getElementById(LIGHTBOX_ID);
  if (!lightbox) return;

  document.removeEventListener('keydown', handleKeydown);

  if (immediate) {
    lightbox.remove();
  } else {
    lightbox.classList.remove('visible');
    setTimeout(() => lightbox.remove(), 200);
  }
}

function showPrev(): void {
  if (currentImages.length <= 1) return;
  currentIndex = (currentIndex - 1 + currentImages.length) % currentImages.length;
  updateImage();
}

function showNext(): void {
  if (currentImages.length <= 1) return;
  currentIndex = (currentIndex + 1) % currentImages.length;
  updateImage();
}

function handleKeydown(e: KeyboardEvent): void {
  if (e.key === 'Escape') {
    closeLightbox();
  } else if (e.key === 'ArrowLeft') {
    showPrev();
  } else if (e.key === 'ArrowRight') {
    showNext();
  }
}

function updateImage(): void {
  const lightbox = document.getElementById(LIGHTBOX_ID);
  if (!lightbox) {
    log.warn('updateImage: lightbox not found');
    return;
  }

  const img = lightbox.querySelector('.lightbox-image') as HTMLImageElement;
  const counter = lightbox.querySelector('.lightbox-counter') as HTMLElement;
  const prevBtn = lightbox.querySelector('.lightbox-prev') as HTMLElement;
  const nextBtn = lightbox.querySelector('.lightbox-next') as HTMLElement;

  log.debug(`updateImage: img element found: ${!!img}, currentIndex: ${currentIndex}, images: ${currentImages.length}`);

  if (img) {
    // Upgrade to large size
    const url = currentImages[currentIndex].replace(/name=\w+/, 'name=large');
    log.debug(`Setting image src to: ${url.substring(0, 80)}...`);
    img.src = url;
  } else {
    log.warn('updateImage: .lightbox-image element not found');
  }

  if (counter) {
    counter.textContent = currentImages.length > 1
      ? `${currentIndex + 1} / ${currentImages.length}`
      : '';
  }

  // Show/hide nav buttons
  const showNav = currentImages.length > 1;
  if (prevBtn) prevBtn.style.display = showNav ? 'flex' : 'none';
  if (nextBtn) nextBtn.style.display = showNav ? 'flex' : 'none';
}

function getLightboxHtml(): string {
  return `
    <div class="lightbox-backdrop" style="position:absolute;inset:0;background:rgba(0,0,0,0.9);display:flex;align-items:center;justify-content:center;">
      <button type="button" class="lightbox-close" style="position:absolute;top:16px;right:16px;width:44px;height:44px;border:none;background:rgba(255,255,255,0.1);border-radius:50%;color:white;cursor:pointer;display:flex;align-items:center;justify-content:center;" aria-label="Close">
        <svg viewBox="0 0 24 24" fill="currentColor" width="24" height="24">
          <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/>
        </svg>
      </button>
      <button type="button" class="lightbox-prev" style="position:absolute;top:50%;left:16px;transform:translateY(-50%);width:48px;height:48px;border:none;background:rgba(255,255,255,0.1);border-radius:50%;color:white;cursor:pointer;display:flex;align-items:center;justify-content:center;" aria-label="Previous">
        <svg viewBox="0 0 24 24" fill="currentColor" width="32" height="32">
          <path d="M15.41 7.41L14 6l-6 6 6 6 1.41-1.41L10.83 12z"/>
        </svg>
      </button>
      <img class="lightbox-image" style="max-width:90vw;max-height:90vh;object-fit:contain;border-radius:4px;" src="" alt="" />
      <button type="button" class="lightbox-next" style="position:absolute;top:50%;right:16px;transform:translateY(-50%);width:48px;height:48px;border:none;background:rgba(255,255,255,0.1);border-radius:50%;color:white;cursor:pointer;display:flex;align-items:center;justify-content:center;" aria-label="Next">
        <svg viewBox="0 0 24 24" fill="currentColor" width="32" height="32">
          <path d="M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z"/>
        </svg>
      </button>
      <div class="lightbox-counter" style="position:absolute;bottom:16px;left:50%;transform:translateX(-50%);color:rgba(255,255,255,0.8);font-size:14px;font-weight:500;"></div>
    </div>
  `;
}

/**
 * Styles for the lightbox - injected once when first opened.
 */
export function getLightboxStyles(): string {
  return `
    #${LIGHTBOX_ID} {
      position: fixed;
      inset: 0;
      z-index: 2147483647;
      opacity: 0;
      transition: opacity 0.2s ease;
    }
    #${LIGHTBOX_ID}.visible {
      opacity: 1;
    }

    .lightbox-backdrop {
      position: absolute;
      inset: 0;
      background: rgba(0, 0, 0, 0.9);
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .lightbox-image {
      max-width: 90vw;
      max-height: 90vh;
      object-fit: contain;
      border-radius: 4px;
      user-select: none;
    }

    .lightbox-close {
      position: absolute;
      top: 16px;
      right: 16px;
      width: 44px;
      height: 44px;
      border: none;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 50%;
      color: white;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s;
    }
    .lightbox-close:hover {
      background: rgba(255, 255, 255, 0.2);
    }

    .lightbox-prev,
    .lightbox-next {
      position: absolute;
      top: 50%;
      transform: translateY(-50%);
      width: 48px;
      height: 48px;
      border: none;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 50%;
      color: white;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: background 0.15s;
    }
    .lightbox-prev:hover,
    .lightbox-next:hover {
      background: rgba(255, 255, 255, 0.2);
    }
    .lightbox-prev { left: 16px; }
    .lightbox-next { right: 16px; }

    .lightbox-counter {
      position: absolute;
      bottom: 16px;
      left: 50%;
      transform: translateX(-50%);
      color: rgba(255, 255, 255, 0.8);
      font-size: 14px;
      font-weight: 500;
    }
  `;
}
