/**
 * WebClaw Embed Script
 * Drop-in <script> tag for any website to add a live AI agent.
 *
 * Usage:
 *   <script src="https://gateway.webclaw.dev/embed.js"
 *           data-site-id="YOUR_SITE_ID"
 *           data-gateway="https://gateway.webclaw.dev">
 *   </script>
 */

import { GatewayClient } from './gateway-client';
import { AudioHandler } from './audio';
import { Avatar, AvatarState } from './avatar';
import { executeAction } from './dom-actions';
import { captureSnapshot } from './dom-snapshot';
import { animateToElement, cleanupVisualizerElements } from './action-visualizer';
import { captureScreenshot } from './screenshot';

// ========================================
// Configuration
// ========================================

interface WebClawConfig {
  siteId: string;
  gatewayUrl: string;
  position?: 'bottom-right' | 'bottom-left';
  theme?: 'light' | 'dark';
  avatarColor?: string;
}

function getConfig(): WebClawConfig {
  const script = document.currentScript as HTMLScriptElement
    || document.querySelector('script[data-site-id]');

  return {
    siteId: script?.getAttribute('data-site-id') || 'demo',
    gatewayUrl: script?.getAttribute('data-gateway') || 'http://localhost:8080',
    position: (script?.getAttribute('data-position') as any) || 'bottom-right',
    theme: (script?.getAttribute('data-theme') as any) || 'light',
    avatarColor: script?.getAttribute('data-color') || '#FF4D4D',
  };
}

// ========================================
// Overlay UI (Web Component in Shadow DOM)
// ========================================

const OVERLAY_STYLES = `
  :host {
    all: initial;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  }

  .webclaw-container {
    position: fixed;
    z-index: 999999;
    display: flex;
    flex-direction: column;
    align-items: flex-end;
    gap: 12px;
  }

  .webclaw-container.bottom-right {
    bottom: 24px; right: 24px;
  }

  .webclaw-container.bottom-left {
    bottom: 24px; left: 24px;
    align-items: flex-start;
  }

  /* Chat panel */
  .webclaw-panel {
    width: 360px;
    max-height: 480px;
    background: white;
    border-radius: 16px;
    box-shadow: 0 8px 32px rgba(0,0,0,0.12), 0 2px 8px rgba(0,0,0,0.08);
    overflow: hidden;
    display: none;
    flex-direction: column;
    animation: webclaw-slide-up 0.3s ease;
  }

  .webclaw-panel.open { display: flex; }

  .webclaw-panel-header {
    padding: 16px;
    background: var(--wc-color, #FF4D4D);
    color: white;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .webclaw-panel-header-content {
    display: flex;
    align-items: center;
    gap: 10px;
    flex: 1;
  }

  .webclaw-panel-header h3 {
    margin: 0; font-size: 15px; font-weight: 600;
  }

  .webclaw-panel-header .status {
    font-size: 12px; opacity: 0.8;
  }

  .webclaw-status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    background: #4CAF50;
    animation: none;
  }

  .webclaw-status-dot.connecting {
    background: #FFC107;
    animation: webclaw-blink 1s infinite;
  }

  .webclaw-status-dot.disconnected {
    background: #F44336;
  }

  .webclaw-btn-close {
    background: none;
    border: none;
    color: white;
    font-size: 20px;
    cursor: pointer;
    padding: 4px;
    width: 32px;
    height: 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 4px;
    transition: background 0.2s;
  }

  .webclaw-btn-close:hover {
    background: rgba(255, 255, 255, 0.2);
  }

  @keyframes webclaw-blink {
    0%, 49%, 100% { opacity: 1; }
    50%, 99% { opacity: 0.5; }
  }

  .webclaw-messages {
    flex: 1;
    overflow-y: auto;
    padding: 16px;
    min-height: 200px;
    max-height: 320px;
  }

  .webclaw-msg-wrapper {
    display: flex;
    flex-direction: column;
    margin-bottom: 12px;
    gap: 4px;
  }

  .webclaw-msg {
    padding: 10px 14px;
    border-radius: 12px;
    font-size: 14px;
    line-height: 1.4;
    max-width: 85%;
    word-wrap: break-word;
  }

  .webclaw-msg.agent {
    background: #f0f0f0;
    align-self: flex-start;
    border-bottom-left-radius: 4px;
  }

  .webclaw-msg.typing {
    background: #f0f0f0;
    align-self: flex-start;
    border-bottom-left-radius: 4px;
    font-style: italic;
    opacity: 0.7;
  }

  .webclaw-msg.user {
    background: var(--wc-color, #FF4D4D);
    color: white;
    margin-left: auto;
    border-bottom-right-radius: 4px;
  }

  .webclaw-msg-timestamp {
    font-size: 11px;
    opacity: 0.6;
    padding: 0 14px;
    align-self: flex-start;
  }

  .webclaw-msg.user ~ .webclaw-msg-timestamp {
    align-self: flex-end;
  }

  .webclaw-input-row {
    display: flex;
    border-top: 1px solid #eee;
    padding: 8px;
    gap: 8px;
    align-items: center;
  }

  .webclaw-input-row input {
    flex: 1;
    border: none;
    outline: none;
    padding: 10px;
    font-size: 14px;
    background: transparent;
  }

  .webclaw-input-row input:focus {
    outline: 1px solid #e0e0e0;
    outline-offset: -1px;
  }

  .webclaw-btn-mic {
    width: 40px; height: 40px;
    border-radius: 50%;
    border: none;
    background: var(--wc-color, #FF4D4D);
    color: white;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: transform 0.15s, box-shadow 0.15s;
  }

  .webclaw-btn-mic:hover { transform: scale(1.05); }
  .webclaw-btn-mic:focus {
    outline: 2px solid #333;
    outline-offset: 2px;
  }
  .webclaw-btn-mic.active {
    background: #ea4335;
    animation: webclaw-pulse-mic 1.5s infinite;
  }

  /* FAB */
  .webclaw-fab {
    width: 56px; height: 56px;
    border-radius: 50%;
    background: var(--wc-color, #FF4D4D);
    color: white;
    border: none;
    cursor: pointer;
    box-shadow: 0 4px 16px rgba(0,0,0,0.2);
    display: flex;
    align-items: center;
    justify-content: center;
    transition: transform 0.2s, box-shadow 0.2s;
    font-size: 24px;
  }

  .webclaw-fab:hover {
    transform: scale(1.08);
    box-shadow: 0 6px 24px rgba(0,0,0,0.25);
  }

  /* Animations */
  @keyframes webclaw-slide-up {
    from { opacity: 0; transform: translateY(16px); }
    to { opacity: 1; transform: translateY(0); }
  }

  @keyframes webclaw-pulse-mic {
    0%, 100% { box-shadow: 0 0 0 0 rgba(234,67,53,0.4); }
    50% { box-shadow: 0 0 0 12px rgba(234,67,53,0); }
  }

  @keyframes webclaw-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }
`;

// Also inject global highlight animation
const GLOBAL_STYLE = document.createElement('style');
GLOBAL_STYLE.textContent = `
  @keyframes webclaw-pulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }
`;
document.head.appendChild(GLOBAL_STYLE);

// ========================================
// Main WebClaw Class
// ========================================

class WebClawEmbed {
  private config: WebClawConfig;
  private gateway: GatewayClient;
  private audio: AudioHandler;
  private shadow!: ShadowRoot;
  private panel!: HTMLElement;
  private messagesEl!: HTMLElement;
  private statusDot!: HTMLElement;
  private avatar: Avatar | null = null;
  private isMicActive = false;
  private isOpen = false;
  private typingIndicator: HTMLElement | null = null;
  private connectionState: 'connected' | 'connecting' | 'disconnected' = 'disconnected';

  constructor(config: WebClawConfig) {
    this.config = config;
    this.gateway = new GatewayClient(config.gatewayUrl, config.siteId);
    this.audio = new AudioHandler();

    this.createUI();
    this.bindGatewayEvents();
  }

  private createUI(): void {
    // Web Component with Shadow DOM to isolate styles
    const host = document.createElement('webclaw-overlay');
    this.shadow = host.attachShadow({ mode: 'closed' });

    const style = document.createElement('style');
    style.textContent = OVERLAY_STYLES;
    this.shadow.appendChild(style);

    const container = document.createElement('div');
    container.className = `webclaw-container ${this.config.position}`;
    container.style.setProperty('--wc-color', this.config.avatarColor!);

    container.innerHTML = `
      <div class="webclaw-panel">
        <div class="webclaw-panel-header">
          <div class="webclaw-panel-header-content">
            <canvas id="wc-avatar" width="36" height="36" style="border-radius:50%;"></canvas>
            <div>
              <h3>WebClaw</h3>
              <div class="status">
                <span class="webclaw-status-dot"></span>
                <span class="status-text">Ready to help</span>
              </div>
            </div>
          </div>
          <button class="webclaw-btn-close" aria-label="Close WebClaw chat panel" title="Close">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"/>
            </svg>
          </button>
        </div>
        <div class="webclaw-messages"></div>
        <div class="webclaw-input-row">
          <input type="text" placeholder="Type a message..." aria-label="Chat message input" />
          <button class="webclaw-btn-mic" aria-label="Send audio message - hold to record" title="Hold to talk">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5zm6 6c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/>
            </svg>
          </button>
        </div>
      </div>
      <button class="webclaw-fab" aria-label="Open WebClaw chat" title="Chat with WebClaw">
        <canvas id="wc-fab-avatar" width="40" height="40" style="border-radius:50%;"></canvas>
      </button>
    `;

    this.shadow.appendChild(container);
    document.body.appendChild(host);

    // Cache references
    this.panel = container.querySelector('.webclaw-panel')!;
    this.messagesEl = container.querySelector('.webclaw-messages')!;
    this.statusDot = container.querySelector('.webclaw-status-dot')!;

    // Event listeners
    const fab = container.querySelector('.webclaw-fab')!;
    fab.addEventListener('click', () => this.toggle());

    const closeBtn = container.querySelector('.webclaw-btn-close')!;
    closeBtn.addEventListener('click', () => this.close());

    // Initialize avatar on FAB
    const fabCanvas = container.querySelector('#wc-fab-avatar') as HTMLCanvasElement;
    if (fabCanvas) {
      this.avatar = new Avatar(fabCanvas, this.config.avatarColor!, 40);
    }

    const input = container.querySelector('input')!;
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && input.value.trim()) {
        this.sendText(input.value.trim());
        input.value = '';
      }
    });

    const micBtn = container.querySelector('.webclaw-btn-mic')! as HTMLElement;
    micBtn.addEventListener('click', () => this.toggleMic(micBtn));
  }

  private bindGatewayEvents(): void {
    this.gateway.on('connected', () => {
      this.setConnectionState('connected');
      this.setStatus('Connected');
      this.avatar?.setState('idle');
      this.removeTypingIndicator();
      const snapshot = captureSnapshot();
      this.gateway.sendDomSnapshot(snapshot, window.location.href);

      // Send initial screenshot for vision context
      this.sendScreenshotToGateway();
    });

    this.gateway.on('disconnected', () => {
      this.setConnectionState('disconnected');
      this.setStatus('Reconnecting...');
      this.avatar?.setState('idle');
      this.removeTypingIndicator();
    });

    this.gateway.on('text', (msg) => {
      this.removeTypingIndicator();
      this.addMessage('agent', msg.text as string);
      this.avatar?.setState('speaking');
      // Return to idle after a delay
      setTimeout(() => this.avatar?.setState('idle'), 2000);
    });

    this.gateway.on('audio', (msg) => {
      this.removeTypingIndicator();
      this.avatar?.setState('speaking');
      this.audio.playAudio(msg.data as string);
      // Audio playback will last a while; return to idle after
      setTimeout(() => this.avatar?.setState('idle'), 3000);
    });

    this.gateway.on('action', async (msg) => {
      this.removeTypingIndicator();
      this.showTypingIndicator();
      this.avatar?.setState('acting');
      const selector = (msg.args as Record<string, unknown>)?.selector as string || msg.selector as string || '';

      // Animate avatar flying to target element
      if (selector) {
        const fab = this.shadow.querySelector('.webclaw-fab');
        if (fab) {
          await animateToElement(
            fab.getBoundingClientRect(),
            selector,
            { color: this.config.avatarColor },
          );
        }
      }

      // Execute DOM action and send result back
      try {
        const result = await executeAction({
          action: msg.action as string,
          id: msg.id as string,
          ...(msg.args as Record<string, unknown> || {}),
        });
        this.gateway.sendActionResult(result.action_id, result);
        // Show action feedback
        this.addMessage('agent', `⚡ ${result.message || result.action_id}`);
      } catch (e: any) {
        this.addMessage('agent', `⚡ Action error: ${e.message}`);
      }
      this.removeTypingIndicator();
      setTimeout(() => this.avatar?.setState('idle'), 1000);
    });
  }

  private async toggle(): Promise<void> {
    this.isOpen = !this.isOpen;
    this.panel.classList.toggle('open', this.isOpen);

    if (this.isOpen && this.connectionState === 'disconnected') {
      this.setConnectionState('connecting');
      this.setStatus('Connecting...');
      try {
        await this.gateway.connect();
      } catch (e: any) {
        this.setConnectionState('disconnected');
        this.setStatus('Connection failed');
        console.error('[WebClaw] Connection error:', e);
      }
    }
  }

  private close(): void {
    this.isOpen = false;
    this.panel.classList.remove('open');
    this.removeTypingIndicator();
    cleanupVisualizerElements();
  }

  private sendText(text: string): void {
    this.addMessage('user', text);
    this.gateway.sendText(text);
  }

  private async toggleMic(btn: HTMLElement): Promise<void> {
    if (this.isMicActive) {
      this.audio.stopCapture();
      btn.classList.remove('active');
      this.isMicActive = false;
      this.avatar?.setState('idle');
    } else {
      try {
        await this.audio.startCapture((data) => {
          this.gateway.sendAudio(data);
        });
        btn.classList.add('active');
        this.isMicActive = true;
        this.avatar?.setState('listening');
      } catch (e) {
        console.error('[WebClaw] Mic access denied:', e);
      }
    }
  }

  private addMessage(role: 'user' | 'agent', text: string): void {
    // Create wrapper for message and timestamp
    const wrapper = document.createElement('div');
    wrapper.className = 'webclaw-msg-wrapper';

    // Create message element
    const msg = document.createElement('div');
    msg.className = `webclaw-msg ${role}`;
    msg.textContent = text;

    // Create timestamp
    const timestamp = document.createElement('div');
    timestamp.className = 'webclaw-msg-timestamp';
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    timestamp.textContent = timeStr;

    wrapper.appendChild(msg);
    wrapper.appendChild(timestamp);
    this.messagesEl.appendChild(wrapper);
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  private showTypingIndicator(): void {
    if (this.typingIndicator) return; // Already showing

    const wrapper = document.createElement('div');
    wrapper.className = 'webclaw-msg-wrapper';

    const indicator = document.createElement('div');
    indicator.className = 'webclaw-msg typing';
    indicator.textContent = 'Agent is thinking...';

    const timestamp = document.createElement('div');
    timestamp.className = 'webclaw-msg-timestamp';
    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    timestamp.textContent = timeStr;

    wrapper.appendChild(indicator);
    wrapper.appendChild(timestamp);
    this.messagesEl.appendChild(wrapper);
    this.typingIndicator = wrapper;
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  private removeTypingIndicator(): void {
    if (this.typingIndicator) {
      this.typingIndicator.remove();
      this.typingIndicator = null;
    }
  }

  private setStatus(text: string): void {
    const statusText = this.shadow.querySelector('.status-text');
    if (statusText) statusText.textContent = text;
  }

  private setConnectionState(state: 'connected' | 'connecting' | 'disconnected'): void {
    this.connectionState = state;

    // Update status dot appearance
    this.statusDot.classList.remove('connecting', 'disconnected');
    if (state === 'connecting') {
      this.statusDot.classList.add('connecting');
    } else if (state === 'disconnected') {
      this.statusDot.classList.add('disconnected');
    }
  }

  private async sendScreenshotToGateway(): Promise<void> {
    const screenshot = await captureScreenshot();
    if (screenshot) {
      this.gateway.sendScreenshot(screenshot.data, screenshot.url);
    }
  }
}

// ========================================
// Auto-init
// ========================================

function init(): void {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => boot());
  } else {
    boot();
  }
}

function boot(): void {
  const config = getConfig();
  (window as any).__webclaw = new WebClawEmbed(config);
}

init();
