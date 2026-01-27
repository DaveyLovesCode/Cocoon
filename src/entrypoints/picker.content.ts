/**
 * Element picker - runs on ALL pages, activates via message
 * Separate from main content script to work on non-supported sites
 */
export default defineContentScript({
  matches: ['<all_urls>'],
  runAt: 'document_end',
  main() {
    let pickerActive = false;
    let overlay: HTMLDivElement | null = null;
    let highlight: HTMLDivElement | null = null;
    let label: HTMLDivElement | null = null;
    let currentHovered: Element | null = null;
    let lastX = 0;
    let lastY = 0;

    browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
      if (message.type === 'DEBUG_PICK_ELEMENT') {
        startPicker();
        sendResponse({ started: true });
      }
      return true;
    });

    function startPicker() {
      if (pickerActive) return;
      pickerActive = true;

      highlight = document.createElement('div');
      highlight.style.cssText = 'position:fixed;pointer-events:none;border:2px solid #00d4ff;background:rgba(0,212,255,0.1);z-index:2147483646;transition:all 0.05s ease-out;';

      label = document.createElement('div');
      label.style.cssText = 'position:fixed;pointer-events:none;background:#1a1a2e;color:#00d4ff;font:12px/1.4 monospace;padding:4px 8px;border-radius:4px;z-index:2147483647;white-space:nowrap;max-width:400px;overflow:hidden;text-overflow:ellipsis;';

      overlay = document.createElement('div');
      overlay.id = '__cocoon_picker_overlay';
      overlay.style.cssText = 'position:fixed;inset:0;z-index:2147483647;cursor:crosshair;';

      document.body.appendChild(highlight);
      document.body.appendChild(label);
      document.body.appendChild(overlay);

      overlay.addEventListener('mousemove', onMouseMove);
      overlay.addEventListener('click', onClick);
      overlay.addEventListener('contextmenu', onCancel);
      document.addEventListener('keydown', onKeyDown);
      window.addEventListener('scroll', onScroll, true);
    }

    function stopPicker() {
      pickerActive = false;
      currentHovered = null;
      overlay?.remove();
      highlight?.remove();
      label?.remove();
      overlay = null;
      highlight = null;
      label = null;
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('scroll', onScroll, true);
    }

    function getSelector(el: Element): string {
      if (el.id) return '#' + el.id;
      let selector = el.tagName.toLowerCase();
      if (el.className && typeof el.className === 'string') {
        const classes = el.className.trim().split(/\s+/).slice(0, 2).join('.');
        if (classes) selector += '.' + classes;
      }
      return selector;
    }

    function updateHighlight(x: number, y: number) {
      if (!overlay || !highlight || !label) return;
      overlay.style.pointerEvents = 'none';
      const el = document.elementFromPoint(x, y);
      overlay.style.pointerEvents = 'auto';
      if (!el || el === overlay || el === highlight || el === label) return;

      currentHovered = el;
      const rect = el.getBoundingClientRect();
      highlight.style.left = rect.left + 'px';
      highlight.style.top = rect.top + 'px';
      highlight.style.width = rect.width + 'px';
      highlight.style.height = rect.height + 'px';

      label.textContent = getSelector(el);
      const labelTop = rect.top > 30 ? rect.top - 28 : rect.bottom + 4;
      label.style.left = Math.max(4, rect.left) + 'px';
      label.style.top = labelTop + 'px';
    }

    function onMouseMove(e: MouseEvent) {
      lastX = e.clientX;
      lastY = e.clientY;
      updateHighlight(lastX, lastY);
    }

    function onScroll() {
      if (pickerActive) updateHighlight(lastX, lastY);
    }

    function onClick(e: MouseEvent) {
      e.preventDefault();
      e.stopPropagation();

      if (!currentHovered) {
        stopPicker();
        return;
      }

      const data = captureElementRecursive(currentHovered);
      stopPicker();

      navigator.clipboard.writeText(data).then(() => {
        showToast('Copied element data to clipboard');
      }).catch(() => {
        showToast('Failed to copy - check console');
        console.log(data);
      });
    }

    function showToast(message: string) {
      const toast = document.createElement('div');
      toast.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:#1a1a2e;color:#00d4ff;font:14px/1.4 system-ui;padding:12px 20px;border-radius:8px;z-index:2147483647;';
      toast.textContent = message;
      document.body.appendChild(toast);
      setTimeout(() => toast.remove(), 2000);
    }

    function captureElementRecursive(root: Element): string {
      const lines: string[] = [];
      lines.push('=== ELEMENT CAPTURE ===');
      lines.push(`Captured: ${new Date().toISOString()}`);
      lines.push(`URL: ${window.location.href}`);
      lines.push('');

      function captureNode(el: Element, depth: number): void {
        const indent = '  '.repeat(depth);
        const tag = el.tagName.toLowerCase();
        const htmlEl = el as HTMLElement;

        const attrs: string[] = [];
        for (const attr of el.attributes) {
          let val = attr.value;
          if (val.length > 200) val = val.substring(0, 200) + '...';
          val = val.replace(/"/g, '\\"');
          attrs.push(`${attr.name}="${val}"`);
        }
        const attrStr = attrs.length ? ' ' + attrs.join(' ') : '';
        lines.push(`${indent}<${tag}${attrStr}>`);

        const meta: string[] = [];
        meta.push(`size: ${htmlEl.offsetWidth}x${htmlEl.offsetHeight}`);
        try {
          const cs = getComputedStyle(el);
          if (cs.display !== 'block') meta.push(`display: ${cs.display}`);
          if (cs.visibility !== 'visible') meta.push(`visibility: ${cs.visibility}`);
          if (cs.opacity !== '1') meta.push(`opacity: ${cs.opacity}`);
          if (cs.position !== 'static') meta.push(`position: ${cs.position}`);
          if (cs.overflow !== 'visible') meta.push(`overflow: ${cs.overflow}`);
        } catch { /* ignore */ }
        if (meta.length > 1) {
          lines.push(`${indent}  /* ${meta.join(', ')} */`);
        }

        const directText: string[] = [];
        for (const node of el.childNodes) {
          if (node.nodeType === Node.TEXT_NODE) {
            const text = (node.textContent || '').trim();
            if (text) directText.push(text);
          }
        }
        if (directText.length) {
          const combined = directText.join(' ').replace(/\s+/g, ' ');
          if (combined.length <= 100) {
            lines.push(`${indent}  "${combined}"`);
          } else {
            lines.push(`${indent}  "${combined.substring(0, 100)}..." (${combined.length} chars)`);
          }
        }

        for (const child of el.children) {
          if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(child.tagName)) continue;
          captureNode(child, depth + 1);
        }

        if (el.children.length > 0 || directText.length > 0) {
          lines.push(`${indent}</${tag}>`);
        }
      }

      captureNode(root, 0);
      return lines.join('\n');
    }

    function onCancel(e: Event) {
      e.preventDefault();
      stopPicker();
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') stopPicker();
    }
  }
});
