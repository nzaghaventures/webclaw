/**
 * WebClaw Embed Script
 * Entry point: auto-initializes when loaded via <script> tag.
 *
 * Usage:
 * <script src="https://gateway.webclaw.dev/embed.js"
 *         data-site-id="your-site-id"
 *         data-gateway="https://gateway.webclaw.dev"></script>
 */

import { GatewayClient } from './gateway-client';
import { AudioHandler } from './audio';
import { DOMActionsEngine, DOMAction } from './dom-actions';
import { Overlay } from './overlay';

class WebClawEmbed {
  private gateway: GatewayClient;
  private audio: AudioHandler;
  private dom: DOMActionsEngine;
  private overlay: Overlay;
  private snapshotInterval: number = 0;

  constructor(siteId: string, gatewayUrl: string) {
    this.gateway = new GatewayClient(gatewayUrl, siteId);
    this.audio = new AudioHandler();
    this.dom = new DOMActionsEngine();
    this.overlay = new Overlay();

    this.setupEventHandlers();
    this.connect();
  }

  private setupEventHandlers(): void {
    // Gateway events
    this.gateway.on('connected', () => {
      this.overlay.setState('idle');
      // Send initial page snapshot
      const snapshot = this.dom.getPageSnapshot();
      this.gateway.sendDomSnapshot(snapshot.html, snapshot.url);
      // Periodic snapshots (every 10s)
      this.snapshotInterval = window.setInterval(() => {
        const s = this.dom.getPageSnapshot();
        this.gateway.sendDomSnapshot(s.html, s.url);
      }, 10000);
    });

    this.gateway.on('disconnected', () => {
      this.overlay.setState('connecting');
      window.clearInterval(this.snapshotInterval);
    });

    // Agent text response
    this.gateway.on('text', (msg) => {
      console.log('[WebClaw]', msg.text);
      this.overlay.setState('speaking');
      // Auto-return to idle after text
      setTimeout(() => {
        if (this.overlay) this.overlay.setState('idle');
      }, 2000);
    });

    // Agent audio response
    this.gateway.on('audio', (msg) => {
      this.overlay.setState('speaking');
      this.audio.playAudio(msg.data as string);
      // Simulate mouth movement from audio
      this.overlay.setMouthOpenness(0.6 + Math.random() * 0.4);
      setTimeout(() => this.overlay.setMouthOpenness(0), 200);
    });

    // Agent DOM action
    this.gateway.on('action', async (msg) => {
      this.overlay.setState('executing');
      const action: DOMAction = {
        action: msg.action as string,
        id: msg.id as string,
        ...(msg.args as object),
      };

      const result = await this.dom.execute(action);
      this.gateway.sendActionResult(result.action_id, result);

      // Send updated snapshot after action
      await new Promise(r => setTimeout(r, 500));
      const snapshot = this.dom.getPageSnapshot();
      this.gateway.sendDomSnapshot(snapshot.html, snapshot.url);

      this.overlay.setState('idle');
    });

    // Mic toggle from overlay
    this.overlay.onMicToggle = async (active: boolean) => {
      if (active) {
        try {
          await this.audio.startCapture((data) => {
            this.gateway.sendAudio(data);
          });
          this.overlay.setState('listening');
        } catch (e) {
          console.error('[WebClaw] Mic access denied:', e);
          this.overlay.setState('idle');
        }
      } else {
        this.audio.stopCapture();
        this.overlay.setState('idle');
      }
    };
  }

  private async connect(): Promise<void> {
    this.overlay.setState('connecting');
    try {
      await this.gateway.connect();
    } catch (e) {
      console.error('[WebClaw] Connection failed:', e);
      this.overlay.setState('idle');
    }
  }

  destroy(): void {
    window.clearInterval(this.snapshotInterval);
    this.gateway.disconnect();
    this.audio.destroy();
    this.overlay.destroy();
  }
}

// ---- Auto-initialize from script tag ----

function init(): void {
  const script = document.currentScript as HTMLScriptElement | null
    || document.querySelector('script[data-site-id]');

  if (!script) {
    console.warn('[WebClaw] No script tag with data-site-id found');
    return;
  }

  const siteId = script.getAttribute('data-site-id');
  if (!siteId) {
    console.warn('[WebClaw] Missing data-site-id attribute');
    return;
  }

  const gatewayUrl = script.getAttribute('data-gateway')
    || script.src.replace(/\/embed\.js.*$/, '').replace(/\/webclaw\.js.*$/, '')
    || 'http://localhost:8080';

  // Wait for DOM ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      (window as any).__webclaw = new WebClawEmbed(siteId, gatewayUrl);
    });
  } else {
    (window as any).__webclaw = new WebClawEmbed(siteId, gatewayUrl);
  }
}

init();

// Export for programmatic use
export { WebClawEmbed };
