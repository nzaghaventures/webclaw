/**
 * WebClaw Embed Script
 * Drop-in <script> tag for any website to add a live AI agent.
 * Now with seamless voice (VAD), character avatar, and agent switching.
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
  seamless?: boolean;
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
    seamless: script?.getAttribute('data-seamless') !== 'false', // default true
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
    padding: 14px 16px;
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
    display: flex; align-items: center; gap: 4px;
  }

  .webclaw-status-dot {
    width: 8px; height: 8px; border-radius: 50%; background: #4CAF50;
  }

  .webclaw-status-dot.connecting {
    background: #FFC107; animation: webclaw-blink 1s infinite;
  }

  .webclaw-status-dot.disconnected { background: #F44336; }
  .webclaw-status-dot.listening { background: #00E5CC; animation: webclaw-blink 1s infinite; }

  .webclaw-btn-close {
    background: none; border: none; color: white; font-size: 20px; cursor: pointer;
    padding: 4px; width: 32px; height: 32px;
    display: flex; align-items: center; justify-content: center;
    border-radius: 4px; transition: background 0.2s;
  }

  .webclaw-btn-close:hover { background: rgba(255, 255, 255, 0.2); }

  /* Agent switch pills */
  .webclaw-agent-switch {
    display: flex; gap: 4px;
    background: rgba(255,255,255,0.15); border-radius: 6px; padding: 2px;
  }

  .webclaw-agent-pill {
    padding: 4px 10px; border-radius: 4px; border: none;
    font-size: 11px; font-weight: 500; cursor: pointer;
    transition: all 0.2s;
  }

  .webclaw-agent-pill.active { background: rgba(255,255,255,0.3); color: white; }
  .webclaw-agent-pill:not(.active) { background: transparent; color: rgba(255,255,255,0.6); }

  /* Voice indicator */
  .webclaw-voice-bar {
    display: none; align-items: center; gap: 8px;
    padding: 8px 16px; background: rgba(0,229,204,0.08);
    font-size: 12px; color: #00B8A3;
  }

  .webclaw-voice-bar.active { display: flex; }

  .webclaw-voice-bars {
    display: flex; gap: 2px; align-items: flex-end; height: 14px;
  }

  .webclaw-voice-bar-item {
    width: 3px; background: #00E5CC; border-radius: 1px;
    animation: webclaw-bar-pulse 0.6s ease-in-out infinite;
  }

  @keyframes webclaw-bar-pulse {
    0%, 100% { transform: scaleY(0.5); }
    50% { transform: scaleY(1); }
  }

  @keyframes webclaw-blink {
    0%, 49%, 100% { opacity: 1; }
    50%, 99% { opacity: 0.5; }
  }

  .webclaw-messages {
    flex: 1; overflow-y: auto; padding: 16px;
    min-height: 200px; max-height: 320px;
  }

  .webclaw-msg-wrapper {
    display: flex; flex-direction: column; margin-bottom: 12px; gap: 4px;
  }

  .webclaw-msg {
    padding: 10px 14px; border-radius: 12px;
    font-size: 14px; line-height: 1.4; max-width: 85%; word-wrap: break-word;
  }

  .webclaw-msg.agent { background: #f0f0f0; align-self: flex-start; border-bottom-left-radius: 4px; }
  .webclaw-msg.typing { background: #f0f0f0; align-self: flex-start; border-bottom-left-radius: 4px; font-style: italic; opacity: 0.7; }
  .webclaw-msg.user { background: var(--wc-color, #FF4D4D); color: white; margin-left: auto; border-bottom-right-radius: 4px; }

  .webclaw-msg-timestamp {
    font-size: 11px; opacity: 0.6; padding: 0 14px; align-self: flex-start;
  }

  .webclaw-msg.user ~ .webclaw-msg-timestamp { align-self: flex-end; }

  .webclaw-input-row {
    display: flex; border-top: 1px solid #eee; padding: 8px; gap: 8px; align-items: center;
  }

  .webclaw-input-row input {
    flex: 1; border: none; outline: none; padding: 10px; font-size: 14px; background: transparent;
  }

  .webclaw-input-row input:focus {
    outline: 1px solid #e0e0e0; outline-offset: -1px;
  }

  .webclaw-btn-send {
    width: 40px; height: 40px; border-radius: 50%; border: none;
    background: var(--wc-color, #FF4D4D); color: white; cursor: pointer;
    display: flex; align-items: center; justify-content: center;
    transition: transform 0.15s;
  }

  .webclaw-btn-send:hover { transform: scale(1.05); }

  /* FAB (character avatar) */
  .webclaw-fab {
    width: 64px; height: 64px; border-radius: 50%;
    border: none; cursor: pointer;
    box-shadow: 0 4px 16px rgba(0,0,0,0.2);
    display: flex; align-items: center; justify-content: center;
    transition: transform 0.2s, box-shadow 0.2s;
    background: transparent; padding: 0;
    overflow: hidden;
  }

  .webclaw-fab:hover {
    transform: scale(1.08);
    box-shadow: 0 6px 24px rgba(0,0,0,0.25);
  }

  /* Welcome bubble (HTML popup near the FAB) */
  .webclaw-welcome-bubble {
    position: absolute;
    bottom: 72px;
    right: 0;
    background: white;
    color: #333;
    padding: 12px 16px;
    border-radius: 12px;
    box-shadow: 0 4px 20px rgba(0,0,0,0.12), 0 1px 4px rgba(0,0,0,0.08);
    font-size: 14px;
    line-height: 1.4;
    max-width: 260px;
    min-width: 160px;
    opacity: 0;
    transform: translateY(8px) scale(0.95);
    transition: opacity 0.3s ease, transform 0.3s ease;
    pointer-events: none;
    z-index: 1;
  }

  .webclaw-welcome-bubble.visible {
    opacity: 1;
    transform: translateY(0) scale(1);
  }

  .webclaw-welcome-bubble::after {
    content: '';
    position: absolute;
    bottom: -6px;
    right: 24px;
    width: 12px;
    height: 12px;
    background: white;
    transform: rotate(45deg);
    box-shadow: 2px 2px 4px rgba(0,0,0,0.06);
  }

  .webclaw-welcome-bubble .bubble-name {
    font-weight: 600;
    font-size: 12px;
    color: var(--wc-color, #FF4D4D);
    margin-bottom: 4px;
  }

  .webclaw-container.bottom-left .webclaw-welcome-bubble {
    right: auto;
    left: 0;
  }

  .webclaw-container.bottom-left .webclaw-welcome-bubble::after {
    right: auto;
    left: 24px;
  }

  /* Animations */
  @keyframes webclaw-slide-up {
    from { opacity: 0; transform: translateY(16px); }
    to { opacity: 1; transform: translateY(0); }
  }
`;

// Global highlight animation
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
  private isOpen = false;
  private typingIndicator: HTMLElement | null = null;
  private connectionState: 'connected' | 'connecting' | 'disconnected' = 'disconnected';
  private currentAgent: 'site' | 'personal' = 'site';
  private voiceBarEl: HTMLElement | null = null;
  private welcomeMessage: string = '';
  private personaName: string = 'WebClaw';

  constructor(config: WebClawConfig) {
    this.config = config;
    this.gateway = new GatewayClient(config.gatewayUrl, config.siteId);
    this.audio = new AudioHandler({ seamless: config.seamless ?? true });

    this.createUI();
    this.bindGatewayEvents();
    this.bindAudioEvents();

    // Fetch welcome config and show bubble, then auto-connect to gateway
    this.initWelcomeAndConnect();
  }

  /**
   * Fetch welcome config from gateway REST API, show speech bubble on avatar,
   * and auto-connect the WebSocket so the agent is ready immediately.
   */
  private async initWelcomeAndConnect(): Promise<void> {
    // 1. Fetch welcome config from REST API
    try {
      const res = await fetch(
        `${this.config.gatewayUrl}/api/sites/${this.config.siteId}/welcome`
      );
      if (res.ok) {
        const data = await res.json();
        this.welcomeMessage = data.welcome_message || 'Hi! I\'m here to help.';
        this.personaName = data.persona_name || 'WebClaw';
      }
    } catch (e) {
      console.warn('[WebClaw] Could not fetch welcome config, using defaults');
      this.welcomeMessage = 'Hi! I\'m here to help.';
    }

    // 2. Update the panel header with the persona name
    const headerTitle = this.shadow.querySelector('.webclaw-panel-header h3');
    if (headerTitle) headerTitle.textContent = this.personaName;

    // 3. Show welcome message as HTML popup bubble near the chathead
    if (this.welcomeMessage) {
      const bubble = this.shadow.querySelector('#wc-welcome-bubble');
      const bubbleName = this.shadow.querySelector('#wc-welcome-bubble .bubble-name');
      const bubbleText = this.shadow.querySelector('#wc-welcome-bubble .bubble-text');
      if (bubble && bubbleName && bubbleText) {
        bubbleName.textContent = this.personaName;
        bubbleText.textContent = this.welcomeMessage;
        // Short delay so the user sees the avatar appear first, then the bubble pops
        setTimeout(() => {
          bubble.classList.add('visible');
          // Auto-hide the bubble after 8 seconds
          setTimeout(() => {
            bubble.classList.remove('visible');
          }, 8000);
        }, 1500);
      }
    }

    // 4. Auto-connect to gateway WebSocket (don't wait for panel open)
    this.setConnectionState('connecting');
    this.setStatus('Connecting...');
    try {
      await this.gateway.connect();
    } catch (e: any) {
      this.setConnectionState('disconnected');
      this.setStatus('Tap to connect');
      console.error('[WebClaw] Auto-connect failed:', e);
    }
  }

  private createUI(): void {
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
          <div class="webclaw-agent-switch">
            <button class="webclaw-agent-pill active" data-agent="site">Site</button>
            <button class="webclaw-agent-pill" data-agent="personal">My Claw</button>
          </div>
          <button class="webclaw-btn-close" aria-label="Close WebClaw chat panel" title="Close">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor">
              <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12 19 6.41z"/>
            </svg>
          </button>
        </div>
        <div class="webclaw-voice-bar">
          <div class="webclaw-voice-bars">
            <div class="webclaw-voice-bar-item" style="height:4px;animation-delay:0s;"></div>
            <div class="webclaw-voice-bar-item" style="height:8px;animation-delay:0.1s;"></div>
            <div class="webclaw-voice-bar-item" style="height:12px;animation-delay:0.2s;"></div>
            <div class="webclaw-voice-bar-item" style="height:8px;animation-delay:0.3s;"></div>
            <div class="webclaw-voice-bar-item" style="height:4px;animation-delay:0.4s;"></div>
          </div>
          <span>Listening... just speak naturally</span>
        </div>
        <div class="webclaw-messages"></div>
        <div class="webclaw-input-row">
          <input type="text" placeholder="Type a message..." aria-label="Chat message input" />
          <button class="webclaw-btn-send" aria-label="Send message" title="Send">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
            </svg>
          </button>
        </div>
      </div>
      <div class="webclaw-welcome-bubble" id="wc-welcome-bubble">
        <div class="bubble-name"></div>
        <div class="bubble-text"></div>
      </div>
      <button class="webclaw-fab" aria-label="Open WebClaw chat" title="Chat with WebClaw">
        <canvas id="wc-fab-avatar" width="128" height="128" style="width:64px;height:64px;border-radius:50%;"></canvas>
      </button>
    `;

    this.shadow.appendChild(container);
    document.body.appendChild(host);

    // Cache references
    this.panel = container.querySelector('.webclaw-panel')!;
    this.messagesEl = container.querySelector('.webclaw-messages')!;
    this.statusDot = container.querySelector('.webclaw-status-dot')!;
    this.voiceBarEl = container.querySelector('.webclaw-voice-bar');

    // FAB avatar
    const fabCanvas = container.querySelector('#wc-fab-avatar') as HTMLCanvasElement;
    if (fabCanvas) {
      this.avatar = new Avatar(fabCanvas, this.config.avatarColor!, 128, {
        showLimbs: false, // Too small for limbs on FAB
      });
    }

    // Events
    const fab = container.querySelector('.webclaw-fab')!;
    fab.addEventListener('click', () => this.toggle());

    const closeBtn = container.querySelector('.webclaw-btn-close')!;
    closeBtn.addEventListener('click', () => this.close());

    const input = container.querySelector('input')!;
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && input.value.trim()) {
        this.sendText(input.value.trim());
        input.value = '';
      }
    });

    const sendBtn = container.querySelector('.webclaw-btn-send')! as HTMLElement;
    sendBtn.addEventListener('click', () => {
      if (input.value.trim()) {
        this.sendText(input.value.trim());
        input.value = '';
      }
    });

    // Agent switch pills
    container.querySelectorAll('.webclaw-agent-pill').forEach((pill: Element) => {
      pill.addEventListener('click', () => {
        const agent = (pill as HTMLElement).dataset.agent as 'site' | 'personal';
        this.switchAgent(agent);
      });
    });
  }

  private bindAudioEvents(): void {
    this.audio.on('stateChange', (state) => {
      switch (state) {
        case 'listening': this.avatar?.setState('listening'); break;
        case 'speaking': this.avatar?.setState('speaking'); break;
        case 'playing': this.avatar?.setState('speaking'); break;
        case 'idle': this.avatar?.setState('idle'); break;
      }
    });

    this.audio.on('speechStart', () => {
      // Barge-in: stop playback when user starts speaking
      this.audio.stopPlayback();
    });

    this.audio.on('amplitude', (amplitude) => {
      this.avatar?.setMouthTarget(Math.min(1, amplitude * 25));
    });
  }

  private bindGatewayEvents(): void {
    this.gateway.on('connected', () => {
      this.setConnectionState('connected');
      this.setStatus('Connected');
      this.avatar?.setState('idle');
      this.removeTypingIndicator();
      const snapshot = captureSnapshot();
      this.gateway.sendDomSnapshot(snapshot, window.location.href);

      this.sendScreenshotToGateway();

      // Start seamless voice on connect
      if (this.config.seamless) {
        this.startSeamlessVoice();
      }
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
      setTimeout(() => this.avatar?.setState(
        this.audio.isCapturing ? 'listening' : 'idle'
      ), 2000);

      // Check for voice agent-switch commands
      this.checkVoiceSwitchCommand(msg.text as string);
    });

    this.gateway.on('audio', (msg) => {
      this.removeTypingIndicator();
      this.avatar?.setState('speaking');
      this.audio.playAudio(msg.data as string);

      // Connect playback analyser to avatar for lip-sync
      const analyser = this.audio.getPlaybackAnalyser();
      if (analyser && this.avatar) {
        // Use the playback context for lip-sync
        const ctx = (analyser as any).context as AudioContext;
        if (ctx) this.avatar.connectAudio(ctx, analyser);
      }
    });

    this.gateway.on('action', async (msg) => {
      this.removeTypingIndicator();
      this.showTypingIndicator();
      this.avatar?.setState('acting');
      const selector = (msg.args as Record<string, unknown>)?.selector as string || msg.selector as string || '';

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

      try {
        const result = await executeAction({
          action: msg.action as string,
          id: msg.id as string,
          ...(msg.args as Record<string, unknown> || {}),
        });
        this.gateway.sendActionResult(result.action_id, result);
        this.addMessage('agent', `⚡ ${result.message || result.action_id}`);
      } catch (e: any) {
        this.addMessage('agent', `⚡ Action error: ${e.message}`);
      }
      this.removeTypingIndicator();
      setTimeout(() => this.avatar?.setState(
        this.audio.isCapturing ? 'listening' : 'idle'
      ), 1000);
    });

    // Handle transcription (agent's spoken words transcribed to text)
    this.gateway.on('transcription', (msg) => {
      // Show transcribed agent speech in chat panel too
      if (msg.text) {
        this.addMessage('agent', msg.text as string);
      }
    });

    // Handle gateway/ADK errors
    this.gateway.on('error', (msg) => {
      this.removeTypingIndicator();
      this.addMessage('agent', `Connection issue: ${msg.error || 'Unknown error'}`);
      this.avatar?.setState('idle');
    });
  }

  private async startSeamlessVoice(): Promise<void> {
    try {
      await this.audio.startSeamless((data) => {
        this.gateway.sendAudio(data);
      });
      this.setStatus('Listening...');
      this.statusDot.className = 'webclaw-status-dot listening';
      if (this.voiceBarEl) {
        this.voiceBarEl.classList.add('active');
      }
    } catch (e) {
      console.error('[WebClaw] Seamless voice error:', e);
      this.setStatus('Connected (mic unavailable)');
    }
  }

  private switchAgent(agent: 'site' | 'personal'): void {
    this.currentAgent = agent;

    // Update pills
    this.shadow.querySelectorAll('.webclaw-agent-pill').forEach((pill: Element) => {
      const el = pill as HTMLElement;
      el.classList.toggle('active', el.dataset.agent === agent);
    });

    // Notify gateway
    this.gateway.sendText(`[SYSTEM: Switched to ${agent} agent]`);
    this.addMessage('agent', `Switched to ${agent === 'personal' ? 'your personal agent' : 'the site agent'}.`);
  }

  private checkVoiceSwitchCommand(text: string): void {
    const lower = text.toLowerCase();
    if (lower.includes('switching to your personal') || lower.includes('switching to my claw')) {
      this.switchAgent('personal');
    } else if (lower.includes('switching to site') || lower.includes('switching back')) {
      this.switchAgent('site');
    }
  }

  private async toggle(): Promise<void> {
    this.isOpen = !this.isOpen;
    this.panel.classList.toggle('open', this.isOpen);

    // If panel opened and we're disconnected, try to reconnect
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

    // If panel opened and connected, add welcome message to chat if empty
    if (this.isOpen && this.connectionState === 'connected' && this.messagesEl.children.length === 0) {
      if (this.welcomeMessage) {
        this.addMessage('agent', this.welcomeMessage);
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
    // Check for switch commands
    const lower = text.toLowerCase();
    if (lower.includes('switch to my') || lower.includes('my agent') || lower.includes('use my claw')) {
      this.switchAgent('personal');
      return;
    }
    if (lower.includes('switch to site') || lower.includes('site agent')) {
      this.switchAgent('site');
      return;
    }

    this.addMessage('user', text);
    this.gateway.sendText(text);
  }

  private addMessage(role: 'user' | 'agent', text: string): void {
    const wrapper = document.createElement('div');
    wrapper.className = 'webclaw-msg-wrapper';

    const msg = document.createElement('div');
    msg.className = `webclaw-msg ${role}`;
    msg.textContent = text;

    const timestamp = document.createElement('div');
    timestamp.className = 'webclaw-msg-timestamp';
    const now = new Date();
    timestamp.textContent = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    wrapper.appendChild(msg);
    wrapper.appendChild(timestamp);
    this.messagesEl.appendChild(wrapper);
    this.messagesEl.scrollTop = this.messagesEl.scrollHeight;
  }

  private showTypingIndicator(): void {
    if (this.typingIndicator) return;
    const wrapper = document.createElement('div');
    wrapper.className = 'webclaw-msg-wrapper';
    const indicator = document.createElement('div');
    indicator.className = 'webclaw-msg typing';
    indicator.textContent = 'Agent is thinking...';
    wrapper.appendChild(indicator);
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
    this.statusDot.classList.remove('connecting', 'disconnected', 'listening');
    if (state === 'connecting') this.statusDot.classList.add('connecting');
    else if (state === 'disconnected') this.statusDot.classList.add('disconnected');
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
