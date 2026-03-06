// WebClaw Extension - Content Script
// Injected into web pages. Manages the WebClaw overlay and gateway connection.

(() => {
  if (window.__webclawActive) return;
  window.__webclawActive = false;

  let ws = null;
  let audioContext = null;
  let mediaStream = null;
  let processor = null;
  let playbackQueue = [];
  let isPlaying = false;
  let overlay = null;

  // Listen for messages from popup/background
  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.type === 'GET_STATUS') {
      sendResponse({ connected: window.__webclawActive });
      return true;
    }
    if (msg.type === 'ACTIVATE') {
      if (window.__webclawActive) {
        deactivate();
      } else {
        activate(msg);
      }
      sendResponse({ ok: true });
      return true;
    }
  });

  function activate(config) {
    window.__webclawActive = true;
    createOverlay();
    connectGateway(config.gatewayUrl, config.sendDom);
    if (config.voiceMode) {
      startMic();
    }
  }

  function deactivate() {
    window.__webclawActive = false;
    ws?.close();
    ws = null;
    stopMic();
    overlay?.remove();
    overlay = null;
  }

  function createOverlay() {
    overlay = document.createElement('div');
    overlay.id = 'webclaw-ext-overlay';
    overlay.style.cssText = `
      position: fixed; bottom: 24px; right: 24px; z-index: 999999;
      width: 360px; background: white; border-radius: 16px;
      box-shadow: 0 8px 32px rgba(0,0,0,0.15);
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      overflow: hidden; display: flex; flex-direction: column;
    `;

    overlay.innerHTML = `
      <div style="background:#1a1a2e;color:white;padding:14px 16px;display:flex;align-items:center;gap:10px;">
        <span style="font-size:18px">🦀</span>
        <span style="font-weight:600;font-size:14px;flex:1">WebClaw Personal</span>
        <button id="wc-close" style="background:none;border:none;color:rgba(255,255,255,0.6);cursor:pointer;font-size:18px">&times;</button>
      </div>
      <div id="wc-messages" style="flex:1;overflow-y:auto;padding:14px;min-height:180px;max-height:300px;font-size:14px;"></div>
      <div style="display:flex;border-top:1px solid #eee;padding:8px;gap:8px;align-items:center;">
        <input id="wc-input" type="text" placeholder="Type or speak..." style="flex:1;border:none;outline:none;padding:10px;font-size:14px;" />
        <button id="wc-mic" style="width:36px;height:36px;border-radius:50%;border:none;background:#4285f4;color:white;cursor:pointer;font-size:16px;">🎤</button>
      </div>
    `;

    document.body.appendChild(overlay);

    // Event listeners
    overlay.querySelector('#wc-close').addEventListener('click', deactivate);
    overlay.querySelector('#wc-input').addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.value.trim()) {
        sendText(e.target.value.trim());
        e.target.value = '';
      }
    });
    overlay.querySelector('#wc-mic').addEventListener('click', toggleMic);
  }

  function connectGateway(gatewayUrl, sendDom) {
    const wsUrl = gatewayUrl.replace(/^http/, 'ws');
    const sessionId = 'ext_' + Math.random().toString(36).substring(2, 10) + Date.now().toString(36);
    // Personal agent uses site_id = domain
    const siteId = window.location.hostname.replace(/\./g, '_') || 'personal';

    ws = new WebSocket(`${wsUrl}/ws/${siteId}/${sessionId}`);

    ws.onopen = () => {
      addMessage('system', 'Connected to WebClaw');
      if (sendDom) {
        // Send initial page context
        const snapshot = captureSimpleSnapshot();
        ws.send(JSON.stringify({ type: 'dom_snapshot', html: snapshot, url: window.location.href }));
      }
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleEvent(msg);
      } catch {}
    };

    ws.onclose = () => {
      if (window.__webclawActive) {
        addMessage('system', 'Disconnected. Reconnecting...');
        setTimeout(() => {
          if (window.__webclawActive) connectGateway(gatewayUrl, sendDom);
        }, 3000);
      }
    };
  }

  function handleEvent(event) {
    if (event.content?.parts) {
      for (const part of event.content.parts) {
        if (part.text) {
          addMessage('agent', part.text);
        }
        if (part.function_call) {
          executeAction(part.function_call);
        }
        if (part.inline_data) {
          playAudioChunk(part.inline_data.data);
        }
      }
    }
  }

  function executeAction(call) {
    const args = call.args || {};
    const name = call.name;

    try {
      switch (name) {
        case 'click_element': {
          const el = findEl(args.selector);
          if (el) { el.click(); addMessage('action', `Clicked: ${args.selector}`); }
          break;
        }
        case 'type_text': {
          const el = findEl(args.selector);
          if (el) { if (args.clear_first) el.value = ''; el.value += args.text; el.dispatchEvent(new Event('input', {bubbles:true})); addMessage('action', `Typed into: ${args.selector}`); }
          break;
        }
        case 'scroll_to': {
          if (args.selector) {
            const el = findEl(args.selector);
            if (el) el.scrollIntoView({behavior:'smooth', block:'center'});
          } else {
            window.scrollBy({top: args.direction === 'up' ? -300 : 300, behavior:'smooth'});
          }
          addMessage('action', `Scrolled ${args.selector || args.direction}`);
          break;
        }
        case 'navigate_to':
          addMessage('action', `Navigating to: ${args.url}`);
          window.location.href = args.url;
          break;
        case 'highlight_element': {
          const el = findEl(args.selector);
          if (el) highlightEl(el, args.message);
          break;
        }
        case 'read_page': {
          const el = findEl(args.selector) || document.body;
          const text = el.textContent?.trim().substring(0, 2000);
          ws?.send(JSON.stringify({ type: 'dom_result', result: { text } }));
          break;
        }
      }
    } catch (e) {
      addMessage('error', `Action failed: ${e.message}`);
    }
  }

  function findEl(selector) {
    let el = document.querySelector(selector);
    if (el) return el;
    el = document.querySelector(`[aria-label="${selector}"]`);
    if (el) return el;
    // Text match
    for (const c of document.querySelectorAll('a, button, [role="button"], label, h1, h2, h3')) {
      if (c.textContent?.trim().toLowerCase().includes(selector.toLowerCase())) return c;
    }
    return null;
  }

  function highlightEl(el, message) {
    const rect = el.getBoundingClientRect();
    const hl = document.createElement('div');
    hl.style.cssText = `position:fixed;top:${rect.top-4}px;left:${rect.left-4}px;width:${rect.width+8}px;height:${rect.height+8}px;border:3px solid #4285f4;border-radius:8px;background:rgba(66,133,244,0.1);pointer-events:none;z-index:999998;`;
    if (message) {
      const tip = document.createElement('div');
      tip.style.cssText = 'position:absolute;bottom:100%;left:50%;transform:translateX(-50%);background:#333;color:white;padding:4px 10px;border-radius:6px;font-size:12px;white-space:nowrap;margin-bottom:6px;';
      tip.textContent = message;
      hl.appendChild(tip);
    }
    document.body.appendChild(hl);
    setTimeout(() => hl.remove(), 4000);
    addMessage('action', `Highlighted: ${message || 'element'}`);
  }

  function sendText(text) {
    addMessage('user', text);
    ws?.send(JSON.stringify({ type: 'text', text }));
  }

  function addMessage(role, text) {
    const container = overlay?.querySelector('#wc-messages');
    if (!container) return;
    const div = document.createElement('div');
    const colors = { user: '#4285f4', agent: '#f0f0f0', system: '#fff3cd', action: '#d4edda', error: '#f8d7da' };
    const textColors = { user: 'white', agent: '#333', system: '#856404', action: '#155724', error: '#721c24' };
    div.style.cssText = `margin-bottom:8px;padding:8px 12px;border-radius:10px;font-size:13px;line-height:1.4;background:${colors[role]||'#f0f0f0'};color:${textColors[role]||'#333'};${role==='user'?'margin-left:40px;text-align:right;':'margin-right:40px;'}`;
    div.textContent = text;
    container.appendChild(div);
    container.scrollTop = container.scrollHeight;
  }

  // Audio
  let micActive = false;

  async function startMic() {
    try {
      audioContext = new AudioContext({ sampleRate: 16000 });
      mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
      const source = audioContext.createMediaStreamSource(mediaStream);
      processor = audioContext.createScriptProcessor(4096, 1, 1);
      processor.onaudioprocess = (e) => {
        if (!micActive || !ws || ws.readyState !== WebSocket.OPEN) return;
        const input = e.inputBuffer.getChannelData(0);
        const pcm16 = new Int16Array(input.length);
        for (let i = 0; i < input.length; i++) {
          const s = Math.max(-1, Math.min(1, input[i]));
          pcm16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
        }
        ws.send(pcm16.buffer);
      };
      source.connect(processor);
      processor.connect(audioContext.destination);
    } catch (e) {
      addMessage('error', 'Mic access denied');
    }
  }

  function stopMic() {
    processor?.disconnect();
    mediaStream?.getTracks().forEach(t => t.stop());
    audioContext?.close();
    processor = null; mediaStream = null; audioContext = null;
    micActive = false;
  }

  function toggleMic() {
    micActive = !micActive;
    const btn = overlay?.querySelector('#wc-mic');
    if (btn) {
      btn.style.background = micActive ? '#ea4335' : '#4285f4';
    }
    if (micActive && !mediaStream) startMic().then(() => { micActive = true; });
  }

  function playAudioChunk(base64Data) {
    const ctx = audioContext || new AudioContext({ sampleRate: 24000 });
    const binary = atob(base64Data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const int16 = new Int16Array(bytes.buffer);
    const float32 = new Float32Array(int16.length);
    for (let i = 0; i < int16.length; i++) float32[i] = int16[i] / 0x7FFF;

    const buffer = ctx.createBuffer(1, float32.length, 24000);
    buffer.getChannelData(0).set(float32);
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
    source.start();
  }

  function captureSimpleSnapshot() {
    const els = [];
    for (const el of document.querySelectorAll('h1,h2,h3,nav a,button,.btn,input,select,textarea,[role="button"],a[href]')) {
      const tag = el.tagName.toLowerCase();
      const text = el.textContent?.trim().substring(0, 80);
      const attrs = [];
      if (el.id) attrs.push(`id="${el.id}"`);
      if (el.getAttribute('href')) attrs.push(`href="${el.getAttribute('href')}"`);
      if (el.getAttribute('placeholder')) attrs.push(`placeholder="${el.getAttribute('placeholder')}"`);
      if (el.getAttribute('aria-label')) attrs.push(`aria-label="${el.getAttribute('aria-label')}"`);
      if (el.getAttribute('type')) attrs.push(`type="${el.getAttribute('type')}"`);
      els.push(`<${tag} ${attrs.join(' ')}>${text}</${tag}>`);
    }
    return els.slice(0, 50).join('\n');
  }

  // Auto-activate check
  chrome.storage?.sync.get({ autoActivate: false, gatewayUrl: 'http://localhost:8080', voiceMode: true, sendDom: true }, (settings) => {
    if (settings.autoActivate) {
      activate(settings);
    }
  });
})();
