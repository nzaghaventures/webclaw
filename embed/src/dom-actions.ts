/**
 * WebClaw DOM Actions
 * Executes agent tool calls on the actual page DOM.
 */

export interface ActionRequest {
  action: string;
  id?: string;
  [key: string]: unknown;
}

export interface ActionResult {
  action_id: string;
  status: 'success' | 'error';
  message?: string;
  data?: unknown;
}

export function executeAction(req: ActionRequest): ActionResult {
  const id = req.id || 'unknown';
  try {
    switch (req.action) {
      case 'click': return doClick(id, req.selector as string);
      case 'type': return doType(id, req.selector as string, req.text as string, req.clear_first as boolean);
      case 'scroll': return doScroll(id, req.selector as string, req.direction as string, req.amount as number);
      case 'navigate': return doNavigate(id, req.url as string);
      case 'highlight': return doHighlight(id, req.selector as string, req.message as string);
      case 'read': return doRead(id, req.selector as string);
      case 'select': return doSelect(id, req.selector as string, req.value as string);
      case 'check': return doCheck(id, req.selector as string, req.checked as boolean);
      default:
        return { action_id: id, status: 'error', message: `Unknown action: ${req.action}` };
    }
  } catch (e: any) {
    return { action_id: id, status: 'error', message: e.message };
  }
}

function findElement(selector: string): Element | null {
  // Try CSS selector first, then aria-label, then text content
  let el = document.querySelector(selector);
  if (el) return el;

  el = document.querySelector(`[aria-label="${selector}"]`);
  if (el) return el;

  // Text content search (buttons, links)
  const candidates = document.querySelectorAll('a, button, [role="button"], label');
  for (const c of candidates) {
    if (c.textContent?.trim().toLowerCase().includes(selector.toLowerCase())) {
      return c;
    }
  }
  return null;
}

function doClick(id: string, selector: string): ActionResult {
  const el = findElement(selector);
  if (!el) return { action_id: id, status: 'error', message: `Element not found: ${selector}` };
  (el as HTMLElement).click();
  return { action_id: id, status: 'success', message: `Clicked: ${selector}` };
}

function doType(id: string, selector: string, text: string, clearFirst: boolean): ActionResult {
  const el = findElement(selector) as HTMLInputElement | HTMLTextAreaElement | null;
  if (!el) return { action_id: id, status: 'error', message: `Element not found: ${selector}` };
  el.focus();
  if (clearFirst) el.value = '';
  el.value += text;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return { action_id: id, status: 'success', message: `Typed into: ${selector}` };
}

function doScroll(id: string, selector: string, direction: string, amount: number): ActionResult {
  if (selector) {
    const el = findElement(selector);
    if (!el) return { action_id: id, status: 'error', message: `Element not found: ${selector}` };
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    return { action_id: id, status: 'success', message: `Scrolled to: ${selector}` };
  }
  const y = direction === 'up' ? -amount : amount;
  window.scrollBy({ top: y, behavior: 'smooth' });
  return { action_id: id, status: 'success', message: `Scrolled ${direction} ${amount}px` };
}

function doNavigate(id: string, url: string): ActionResult {
  window.location.href = url;
  return { action_id: id, status: 'success', message: `Navigating to: ${url}` };
}

function doHighlight(id: string, selector: string, message: string): ActionResult {
  const el = findElement(selector);
  if (!el) return { action_id: id, status: 'error', message: `Element not found: ${selector}` };

  // Create highlight overlay
  const rect = el.getBoundingClientRect();
  const overlay = document.createElement('div');
  overlay.className = 'webclaw-highlight';
  overlay.style.cssText = `
    position: fixed; top: ${rect.top - 4}px; left: ${rect.left - 4}px;
    width: ${rect.width + 8}px; height: ${rect.height + 8}px;
    border: 3px solid #4285f4; border-radius: 8px;
    background: rgba(66, 133, 244, 0.1);
    pointer-events: none; z-index: 999998;
    animation: webclaw-pulse 1.5s ease-in-out 3;
  `;

  if (message) {
    const tooltip = document.createElement('div');
    tooltip.style.cssText = `
      position: absolute; bottom: 100%; left: 50%; transform: translateX(-50%);
      background: #333; color: white; padding: 6px 12px; border-radius: 6px;
      font-size: 13px; white-space: nowrap; margin-bottom: 8px;
    `;
    tooltip.textContent = message;
    overlay.appendChild(tooltip);
  }

  document.body.appendChild(overlay);
  setTimeout(() => overlay.remove(), 5000);
  return { action_id: id, status: 'success', message: `Highlighted: ${selector}` };
}

function doRead(id: string, selector: string): ActionResult {
  const el = findElement(selector) || document.body;
  const text = (el.textContent || '').trim().substring(0, 2000);
  return { action_id: id, status: 'success', data: text };
}

function doSelect(id: string, selector: string, value: string): ActionResult {
  const el = findElement(selector) as HTMLSelectElement | null;
  if (!el) return { action_id: id, status: 'error', message: `Element not found: ${selector}` };
  // Try by value then by text
  const option = Array.from(el.options).find(o => o.value === value || o.text === value);
  if (!option) return { action_id: id, status: 'error', message: `Option not found: ${value}` };
  el.value = option.value;
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return { action_id: id, status: 'success', message: `Selected: ${value}` };
}

function doCheck(id: string, selector: string, checked: boolean): ActionResult {
  const el = findElement(selector) as HTMLInputElement | null;
  if (!el) return { action_id: id, status: 'error', message: `Element not found: ${selector}` };
  el.checked = checked;
  el.dispatchEvent(new Event('change', { bubbles: true }));
  return { action_id: id, status: 'success', message: `${checked ? 'Checked' : 'Unchecked'}: ${selector}` };
}
