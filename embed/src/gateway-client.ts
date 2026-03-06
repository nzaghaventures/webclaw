/**
 * WebClaw Gateway Client
 * Handles WebSocket communication with the WebClaw Gateway.
 */

export interface GatewayMessage {
  type: string;
  [key: string]: unknown;
}

export type MessageHandler = (msg: GatewayMessage) => void;

export class GatewayClient {
  private ws: WebSocket | null = null;
  private gatewayUrl: string;
  private siteId: string;
  private sessionId: string;
  private handlers: Map<string, MessageHandler[]> = new Map();
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;

  constructor(gatewayUrl: string, siteId: string) {
    this.gatewayUrl = gatewayUrl.replace(/^http/, 'ws');
    this.siteId = siteId;
    this.sessionId = this.generateSessionId();
  }

  private generateSessionId(): string {
    return 'wc_' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `${this.gatewayUrl}/ws/${this.siteId}/${this.sessionId}`;
      this.ws = new WebSocket(url);

      this.ws.onopen = () => {
        this.reconnectAttempts = 0;
        this.emit('connected', { type: 'connected' });
        resolve();
      };

      this.ws.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this.handleMessage(msg);
        } catch (e) {
          console.error('[WebClaw] Failed to parse message:', e);
        }
      };

      this.ws.onclose = () => {
        this.emit('disconnected', { type: 'disconnected' });
        this.attemptReconnect();
      };

      this.ws.onerror = (err) => {
        console.error('[WebClaw] WebSocket error:', err);
        reject(err);
      };
    });
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) return;
    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 10000);
    setTimeout(() => this.connect().catch(() => {}), delay);
  }

  private handleMessage(msg: any): void {
    // ADK events come in various shapes; normalize them
    // Check for tool calls (DOM actions)
    if (msg.content?.parts) {
      for (const part of msg.content.parts) {
        if (part.function_call) {
          this.emit('action', {
            type: 'action',
            action: part.function_call.name,
            args: part.function_call.args,
            id: part.function_call.id,
          });
        }
        if (part.text) {
          this.emit('text', { type: 'text', text: part.text });
        }
        if (part.inline_data) {
          this.emit('audio', {
            type: 'audio',
            data: part.inline_data.data,
            mimeType: part.inline_data.mime_type,
          });
        }
      }
    }

    // Also emit raw event for custom handling
    this.emit('raw', msg);
  }

  on(event: string, handler: MessageHandler): void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, []);
    }
    this.handlers.get(event)!.push(handler);
  }

  private emit(event: string, msg: GatewayMessage): void {
    const handlers = this.handlers.get(event) || [];
    for (const handler of handlers) {
      try { handler(msg); } catch (e) { console.error('[WebClaw] Handler error:', e); }
    }
  }

  sendText(text: string): void {
    this.send({ type: 'text', text });
  }

  sendDomSnapshot(html: string, url: string): void {
    this.send({ type: 'dom_snapshot', html, url });
  }

  sendActionResult(actionId: string, result: unknown): void {
    this.send({ type: 'dom_result', action_id: actionId, result });
  }

  sendAudio(audioData: ArrayBuffer): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(audioData);
    }
  }

  sendImage(base64Data: string, mimeType: string = 'image/jpeg'): void {
    this.send({ type: 'image', data: base64Data, mimeType });
  }

  private send(data: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  disconnect(): void {
    this.maxReconnectAttempts = 0; // Prevent reconnect
    this.ws?.close();
  }
}
