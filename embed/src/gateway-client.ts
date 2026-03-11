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
    // ADK events come in various shapes; normalize them for the embed.
    //
    // Gemini Live API / ADK returns events with different structures:
    //   - content.parts[].text          → agent text response
    //   - content.parts[].inline_data   → audio chunk (base64 PCM)
    //   - content.parts[].function_call → tool call (DOM action)
    //   - serverContent.modelTurn.parts → alternative Gemini Live wrapping
    //   - type: "error"                 → gateway/ADK error
    //   - type: "negotiate_ack"         → negotiation acknowledgment
    //   - outputTranscription           → agent's spoken words transcribed as text

    // Handle gateway-level error events
    if (msg.type === 'error') {
      console.error('[WebClaw] Gateway error:', msg.error, msg.details);
      this.emit('error', msg);
      return;
    }

    // Negotiation acknowledgment
    if (msg.type === 'negotiate_ack') {
      this.emit('negotiate_ack', msg);
      return;
    }

    // Extract parts from various ADK event structures
    let parts: any[] = [];

    if (msg.content?.parts) {
      parts = msg.content.parts;
    } else if (msg.serverContent?.modelTurn?.parts) {
      // Gemini Live native format
      parts = msg.serverContent.modelTurn.parts;
    }

    // Process all parts
    for (const part of parts) {
      // Text response
      if (part.text) {
        this.emit('text', { type: 'text', text: part.text });
      }
      // Audio response (handles both snake_case and camelCase)
      if (part.inline_data || part.inlineData) {
        const inlineData = part.inline_data || part.inlineData;
        this.emit('audio', {
          type: 'audio',
          data: inlineData.data,
          mimeType: inlineData.mime_type || inlineData.mimeType,
        });
      }
      // Tool call / function call → DOM actions
      if (part.function_call || part.functionCall) {
        const fc = part.function_call || part.functionCall;
        this.emit('action', {
          type: 'action',
          action: fc.name,
          args: fc.args,
          id: fc.id,
        });
      }
    }

    // Handle output transcription (agent's spoken words as text)
    if (msg.outputTranscription) {
      this.emit('transcription', { type: 'transcription', text: msg.outputTranscription });
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

  sendScreenshot(base64Data: string, url: string, prompt?: string): void {
    this.send({ type: 'screenshot', data: base64Data, mimeType: 'image/jpeg', url, prompt });
  }

  sendNegotiate(capabilities: Record<string, unknown>): void {
    this.send({ type: 'negotiate', capabilities });
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
