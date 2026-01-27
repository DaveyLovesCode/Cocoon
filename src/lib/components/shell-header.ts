/**
 * Shell header component - the floating header pill with logo, settings, and search.
 * Single source of truth for header HTML structure.
 */

// Cocoon logo SVG
const COCOON_LOGO_SVG = `<svg width="16" height="16" viewBox="0 0 64 64" fill="none">
  <circle cx="32" cy="32" r="32" fill="#A8E6CF" />
  <circle cx="22.4" cy="27.2" r="3.84" fill="rgba(0, 0, 0, 0.6)" />
  <circle cx="41.6" cy="27.2" r="3.84" fill="rgba(0, 0, 0, 0.6)" />
  <path d="M 24 38.4 Q 32 46.4 40 38.4" stroke="rgba(0, 0, 0, 0.6)" stroke-width="2.56" stroke-linecap="round" fill="none" />
</svg>`;

// Settings gear icon
const SETTINGS_ICON_SVG = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/>
  <circle cx="12" cy="12" r="3"/>
</svg>`;

// Search icon
const SEARCH_ICON_SVG = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
  <circle cx="11" cy="11" r="8"/>
  <path d="m21 21-4.3-4.3"/>
</svg>`;

// X logo for nav home link
export const X_LOGO_SVG = '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>';

/**
 * Get the shell header HTML.
 * Includes brand pill with logo/settings and search toggle.
 */
export function getShellHeaderHtml(): string {
  return `<header class="cocoon-shell-header">
  <div class="cocoon-header-pill">
    <div class="cocoon-header-brand">
      ${COCOON_LOGO_SVG}
      <span>Cocoon</span>
    </div>
    <button type="button" class="cocoon-settings-btn" aria-label="Settings">
      ${SETTINGS_ICON_SVG}
    </button>
  </div>
  <div class="cocoon-search-wrapper">
    <button type="button" class="cocoon-search-toggle" aria-label="Search">
      ${SEARCH_ICON_SVG}
    </button>
  </div>
</header>`;
}

/**
 * Get sidebar nav HTML.
 * @param navItemsHtml - Pre-rendered nav items HTML, or empty for hidden sidebar
 * @param composeSvg - Cached compose button SVG, or undefined for empty button (will be filled later)
 */
export function getSidebarNavHtml(navItemsHtml?: string, composeSvg?: string): string {
  // If we have a cached compose icon, use it; otherwise leave button empty (content.ts will fill it)
  const composeInner = composeSvg || '';
  const composeHtml = `<button type="button" class="cocoon-compose-btn" title="Post" aria-label="Compose new post">${composeInner}</button>`;
  if (navItemsHtml) {
    return `<aside class="cocoon-sidebar-nav"><nav>${navItemsHtml}</nav>${composeHtml}</aside>`;
  }
  return `<aside class="cocoon-sidebar-nav cocoon-sidebar-hidden"><nav></nav>${composeHtml}</aside>`;
}

/**
 * Render a single nav item.
 */
export function renderNavItem(item: { id: string; href: string; label: string; svg: string }): string {
  const svgContent = item.id === 'home' ? X_LOGO_SVG : item.svg;
  return `<a href="${item.href}" class="cocoon-nav-link" title="${item.label}" data-nav-id="${item.id}"><span class="cocoon-nav-icon">${svgContent}</span></a>`;
}
