// WebClaw Extension - Background Service Worker

chrome.runtime.onInstalled.addListener(() => {
  console.log('[WebClaw] Extension installed');
  chrome.storage.sync.set({
    gatewayUrl: 'http://localhost:8080',
    autoActivate: false,
    voiceMode: true,
    sendDom: true,
  });
});

// Handle keyboard shortcut (if configured)
chrome.commands?.onCommand.addListener((command) => {
  if (command === 'toggle-webclaw') {
    chrome.tabs.query({ active: true, currentWindow: true }, ([tab]) => {
      if (tab?.id) {
        chrome.tabs.sendMessage(tab.id, { type: 'ACTIVATE' });
      }
    });
  }
});
