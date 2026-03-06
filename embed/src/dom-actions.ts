/**
 * WebClaw DOM Actions Engine
 * Executes agent-requested actions on the page with visual feedback.
 */

export interface DOMAction {
  action: string;
  selector?: string;
  text?: string;
  url?: string;
  direction?: string;
  amount?: number;
  value?: string;
  checked?: boolean;
  clear_first?: boolean;
  description?: string;
  message?: string;
  id?: string;
}

export interface ActionResult {
  action_id: string;
  success: boolean;
  result?: unknown;
  error?: string;
}

export class DOMActionsEngine {
  private highlightOverlay: HTMLElement | null = null;

  /**
   * Execute a DOM action requested by the agent.
   */
  async execute(action: DOMAction): Promise<ActionResult> {
    const actionId = action.id || Math.random().toString(36).substring(2);

    try {
      switch (action.action) {
        case 'click':
          return await this.click(actionId, action);
        case 'type':
          return await this.type(actionId, action);
        case 'scroll':
          return await this.scroll(actionId, action);
        case 'navigate':
          return await this.navigate(actionId, action);
        case 'highlight':
          return await this.highlight(actionId, action);
        case 'read':
          return await this.read(actionId, action);
        case 'select':
          return await this.select(actionId, action);
        case 'check':
          return await this.check(actionId, action);
        default:
          return { action_id: actionId, success: false, error: `Unknown action: ${action.action}` };
      }
    } catch (e: any) {
      return { action_id: actionId, success: false, error: e.message };
    }
  }

  private findElement(selector: string): Element | null {
    // Try CSS selector first
    let el = document.querySelector(selector);
    if (el) return el;

    // Try aria label
    el = document.querySelector(`[aria-label="${selector}"]`);
    if (el) return el;

    // Try text content match
    const allElements = document.querySelectorAll('button, a, input, [role="button"]');
    for (const candidate of allElements) {
      if (candidate.textContent?.trim().toLowerCase().includes(selector.toLowerCase())) {
        return candidate;
      }
    }

    return null;
  }

  private async click(id: string, action: DOMAction): Promise<ActionResult> {
    const el = this.findElement(action.selector!);
    if (!el) return { action_id: id, success: false, error: `Element not found: ${action.selector}` };

    await this.animateToElement(el);
    (el as HTMLElement).click();
    this.flashElement(el);

    return { action_id: id, success: true, result: { clicked: action.selector } };
  }

  private async type(id: string, action: DOMAction): Promise<ActionResult> {
    const el = this.findElement(action.selector!) as HTMLInputElement | HTMLTextAreaElement;
    if (!el) return { action_id: id, success: false, error: `Element not found: ${action.selector}` };

    await this.animateToElement(el);
    el.focus();

    if (action.clear_first) {
      el.value = '';
    }

    // Type character by character for visual effect
    for (const char of action.text || '') {
      el.value += char;
      el.dispatchEvent(new Event('input', { bubbles: true }));
      await this.sleep(30 + Math.random() * 20);
    }

    el.dispatchEvent(new Event('change', { bubbles: true }));
    this.flashElement(el);

    return { action_id: id, success: true, result: { typed: action.text } };
  }

  private async scroll(id: string, action: DOMAction): Promise<ActionResult> {
    if (action.selector) {
      const el = this.findElement(action.selector);
      if (!el) return { action_id: id, success: false, error: `Element not found: ${action.selector}` };
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
      const amount = action.direction === 'up' ? -(action.amount || 300) : (action.amount || 300);
      window.scrollBy({ top: amount, behavior: 'smooth' });
    }
    return { action_id: id, success: true };
  }

  private async navigate(id: string, action: DOMAction): Promise<ActionResult> {
    if (action.url) {
      window.location.href = action.url;
    }
    return { action_id: id, success: true, result: { navigated: action.url } };
  }

  private async highlight(id: string, action: DOMAction): Promise<ActionResult> {
    const el = this.findElement(action.selector!);
    if (!el) return { action_id: id, success: false, error: `Element not found: ${action.selector}` };

    await this.animateToElement(el);
    this.showHighlight(el, action.message);

    return { action_id: id, success: true };
  }

  private async read(id: string, action: DOMAction): Promise<ActionResult> {
    const el = this.findElement(action.selector || 'body');
    if (!el) return { action_id: id, success: false, error: `Element not found: ${action.selector}` };

    const text = (el as HTMLElement).innerText?.substring(0, 5000) || '';
    return { action_id: id, success: true, result: { text, url: window.location.href } };
  }

  private async select(id: string, action: DOMAction): Promise<ActionResult> {
    const el = this.findElement(action.selector!) as HTMLSelectElement;
    if (!el) return { action_id: id, success: false, error: `Element not found: ${action.selector}` };

    await this.animateToElement(el);
    el.value = action.value || '';
    el.dispatchEvent(new Event('change', { bubbles: true }));
    this.flashElement(el);

    return { action_id: id, success: true, result: { selected: action.value } };
  }

  private async check(id: string, action: DOMAction): Promise<ActionResult> {
    const el = this.findElement(action.selector!) as HTMLInputElement;
    if (!el) return { action_id: id, success: false, error: `Element not found: ${action.selector}` };

    await this.animateToElement(el);
    el.checked = action.checked ?? true;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    this.flashElement(el);

    return { action_id: id, success: true, result: { checked: el.checked } };
  }

  // ---- Visual Effects ----

  private async animateToElement(el: Element): Promise<void> {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await this.sleep(300);
  }

  private flashElement(el: Element): void {
    const htmlEl = el as HTMLElement;
    const original = htmlEl.style.outline;
    htmlEl.style.outline = '3px solid #4A90D9';
    htmlEl.style.outlineOffset = '2px';
    setTimeout(() => {
      htmlEl.style.outline = original;
      htmlEl.style.outlineOffset = '';
    }, 1500);
  }

  private showHighlight(el: Element, message?: string): void {
    this.removeHighlight();

    const rect = el.getBoundingClientRect();
    this.highlightOverlay = document.createElement('div');
    Object.assign(this.highlightOverlay.style, {
      position: 'fixed',
      left: `${rect.left - 4}px`,
      top: `${rect.top - 4}px`,
      width: `${rect.width + 8}px`,
      height: `${rect.height + 8}px`,
      border: '3px solid #4A90D9',
      borderRadius: '8px',
      pointerEvents: 'none',
      zIndex: '2147483646',
      animation: 'webclaw-pulse 1.5s ease-in-out infinite',
    });

    if (message) {
      const tooltip = document.createElement('div');
      Object.assign(tooltip.style, {
        position: 'absolute',
        bottom: '100%',
        left: '50%',
        transform: 'translateX(-50%)',
        background: '#333',
        color: '#fff',
        padding: '6px 12px',
        borderRadius: '6px',
        fontSize: '13px',
        whiteSpace: 'nowrap',
        marginBottom: '8px',
      });
      tooltip.textContent = message;
      this.highlightOverlay.appendChild(tooltip);
    }

    document.body.appendChild(this.highlightOverlay);

    // Auto-remove after 5s
    setTimeout(() => this.removeHighlight(), 5000);
  }

  private removeHighlight(): void {
    this.highlightOverlay?.remove();
    this.highlightOverlay = null;
  }

  /**
   * Get a simplified DOM snapshot for the agent to understand the page.
   */
  getPageSnapshot(): { html: string; url: string } {
    const simplify = (el: Element, depth: number): string => {
      if (depth > 4) return '';
      const tag = el.tagName.toLowerCase();
      const interactable = ['a', 'button', 'input', 'select', 'textarea', 'form'];
      const isInteractable = interactable.includes(tag) || el.getAttribute('role') === 'button';
      const isVisible = (el as HTMLElement).offsetParent !== null;

      if (!isVisible && tag !== 'body' && tag !== 'html') return '';

      let attrs = '';
      if (isInteractable) {
        const id = el.id ? ` id="${el.id}"` : '';
        const cls = el.className && typeof el.className === 'string' ? ` class="${el.className.substring(0, 50)}"` : '';
        const href = el.getAttribute('href') ? ` href="${el.getAttribute('href')}"` : '';
        const type = el.getAttribute('type') ? ` type="${el.getAttribute('type')}"` : '';
        const name = el.getAttribute('name') ? ` name="${el.getAttribute('name')}"` : '';
        const aria = el.getAttribute('aria-label') ? ` aria-label="${el.getAttribute('aria-label')}"` : '';
        const placeholder = el.getAttribute('placeholder') ? ` placeholder="${el.getAttribute('placeholder')}"` : '';
        attrs = `${id}${cls}${href}${type}${name}${aria}${placeholder}`;
      }

      const children = Array.from(el.children).map(c => simplify(c, depth + 1)).filter(Boolean).join('');
      const text = !children && el.textContent ? el.textContent.trim().substring(0, 100) : '';

      if (!isInteractable && !children && !text) return '';

      return `<${tag}${attrs}>${text}${children}</${tag}>`;
    };

    return {
      html: simplify(document.body, 0).substring(0, 10000),
      url: window.location.href,
    };
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
