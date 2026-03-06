// WebClaw Extension - Popup Controller

const DEFAULT_GATEWAY = 'http://localhost:8080';

async function init() {
  const settings = await chrome.storage.sync.get({
    gatewayUrl: DEFAULT_GATEWAY,
    autoActivate: false,
    voiceMode: true,
    sendDom: true,
  });

  document.getElementById('gateway-url').value = settings.gatewayUrl;
  document.getElementById('auto-activate').checked = settings.autoActivate;
  document.getElementById('voice-mode').checked = settings.voiceMode;
  document.getElementById('send-dom').checked = settings.sendDom;

  // Check connection status
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id) {
    try {
      const response = await chrome.tabs.sendMessage(tab.id, { type: 'GET_STATUS' });
      updateStatus(response?.connected || false);
    } catch {
      updateStatus(false);
    }
  }

  // Save settings on change
  for (const id of ['auto-activate', 'voice-mode', 'send-dom']) {
    document.getElementById(id).addEventListener('change', saveSettings);
  }
  document.getElementById('gateway-url').addEventListener('blur', saveSettings);

  // Activate button
  document.getElementById('btn-activate').addEventListener('click', async () => {
    await saveSettings();
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab?.id) {
      // Inject content script if needed, then activate
      await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        files: ['content.js'],
      }).catch(() => {}); // May already be injected

      chrome.tabs.sendMessage(tab.id, {
        type: 'ACTIVATE',
        gatewayUrl: document.getElementById('gateway-url').value || DEFAULT_GATEWAY,
        voiceMode: document.getElementById('voice-mode').checked,
        sendDom: document.getElementById('send-dom').checked,
      });

      updateStatus(true);
    }
  });
}

function updateStatus(connected) {
  const dot = document.getElementById('status-dot');
  const text = document.getElementById('status-text');
  dot.className = `status-dot ${connected ? 'connected' : 'disconnected'}`;
  text.textContent = connected ? 'Connected to this tab' : 'Not connected';

  const btn = document.getElementById('btn-activate');
  if (connected) {
    btn.textContent = 'Deactivate';
    btn.className = 'btn-primary btn-danger';
  } else {
    btn.textContent = 'Activate on This Page';
    btn.className = 'btn-primary';
  }
}

async function saveSettings() {
  await chrome.storage.sync.set({
    gatewayUrl: document.getElementById('gateway-url').value || DEFAULT_GATEWAY,
    autoActivate: document.getElementById('auto-activate').checked,
    voiceMode: document.getElementById('voice-mode').checked,
    sendDom: document.getElementById('send-dom').checked,
  });
}

init();
