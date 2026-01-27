/**
 * HTML/attribute escaping utilities.
 * Single source of truth for escaping text before inserting into HTML.
 */

/**
 * Escape text for safe insertion into HTML content.
 * Uses the browser's native DOM encoding.
 */
export function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Escape text for safe insertion into HTML attributes.
 * More explicit escaping to handle all special attribute characters.
 */
export function escapeAttr(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
