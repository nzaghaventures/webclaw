// WebClaw Extension - Onboarding Controller

let currentStep = 0;
const totalSteps = 4;

// Mic test state
let micStream = null;
let audioContext = null;
let analyser = null;
let mediaRecorder = null;
let recordedChunks = [];
let isRecording = false;
let vizAnimFrame = 0;

// =============================================
// Step Navigation
// =============================================

function goToStep(step) {
  if (step < 0 || step >= totalSteps) return;

  // Hide current
  document.getElementById(`step-${currentStep}`)?.classList.remove('active');

  // Update dots
  const dots = document.querySelectorAll('.step-dot');
  dots.forEach((dot, i) => {
    dot.classList.remove('active');
    if (i < step) dot.classList.add('completed');
    else dot.classList.remove('completed');
  });
  dots[step]?.classList.add('active');

  // Show new
  currentStep = step;
  document.getElementById(`step-${currentStep}`)?.classList.add('active');
}

function nextStep() {
  saveCurrentStepSettings();
  goToStep(currentStep + 1);
}

function prevStep() {
  goToStep(currentStep - 1);
}

// Click on step dots
document.getElementById('step-nav')?.addEventListener('click', (e) => {
  const dot = e.target.closest('.step-dot');
  if (dot) {
    const step = parseInt(dot.dataset.step);
    if (!isNaN(step)) goToStep(step);
  }
});

// =============================================
// Step 1: Microphone
// =============================================

async function loadMicrophones() {
  try {
    // Need to request permission first to get device labels
    const tempStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    tempStream.getTracks().forEach(t => t.stop());

    const devices = await navigator.mediaDevices.enumerateDevices();
    const mics = devices.filter(d => d.kind === 'audioinput');
    const select = document.getElementById('mic-select');
    select.innerHTML = '';

    if (mics.length === 0) {
      select.innerHTML = '<option value="">No microphones found</option>';
      return;
    }

    mics.forEach((mic, i) => {
      const opt = document.createElement('option');
      opt.value = mic.deviceId;
      opt.textContent = mic.label || `Microphone ${i + 1}`;
      select.appendChild(opt);
    });

    setMicStatus('ready', 'Microphone ready. Click to test.');
  } catch (err) {
    console.error('Mic access error:', err);
    setMicStatus('error', 'Microphone access denied. Please allow access.');
  }
}

function setMicStatus(state, text) {
  const dot = document.getElementById('mic-dot');
  const statusText = document.getElementById('mic-status-text');
  dot.className = 'dot';
  if (state === 'active') dot.classList.add('active');
  if (state === 'error') dot.classList.add('error');
  statusText.textContent = text;
}

document.getElementById('mic-test-btn')?.addEventListener('click', async () => {
  if (isRecording) {
    stopRecording();
  } else {
    await startRecording();
  }
});

async function startRecording() {
  const deviceId = document.getElementById('mic-select')?.value;
  try {
    micStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: deviceId ? { exact: deviceId } : undefined,
        sampleRate: 16000,
        channelCount: 1,
        echoCancellation: true,
        noiseSuppression: true,
      },
    });

    audioContext = new AudioContext({ sampleRate: 16000 });
    const source = audioContext.createMediaStreamSource(micStream);
    analyser = audioContext.createAnalyser();
    analyser.fftSize = 256;
    source.connect(analyser);

    // MediaRecorder for playback test
    mediaRecorder = new MediaRecorder(micStream);
    recordedChunks = [];
    mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) recordedChunks.push(e.data);
    };
    mediaRecorder.start();

    isRecording = true;
    const btn = document.getElementById('mic-test-btn');
    btn.classList.add('recording');
    btn.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>`;

    setMicStatus('active', 'Recording... Speak now!');
    startVisualization();

    // Auto-stop after 10 seconds
    setTimeout(() => {
      if (isRecording) stopRecording();
    }, 10000);

  } catch (err) {
    console.error('Recording error:', err);
    setMicStatus('error', 'Could not access microphone.');
  }
}

function stopRecording() {
  isRecording = false;
  mediaRecorder?.stop();
  micStream?.getTracks().forEach(t => t.stop());
  cancelAnimationFrame(vizAnimFrame);

  const btn = document.getElementById('mic-test-btn');
  btn.classList.remove('recording');
  btn.innerHTML = `<svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3zm-1-9c0-.55.45-1 1-1s1 .45 1 1v6c0 .55-.45 1-1 1s-1-.45-1-1V5zm6 6c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z"/></svg>`;

  setMicStatus('ready', 'Recording complete. Play it back to check quality.');
  document.getElementById('playback-btn').disabled = false;

  audioContext?.close();
  audioContext = null;
  analyser = null;
}

function startVisualization() {
  const canvas = document.getElementById('mic-viz');
  const ctx = canvas.getContext('2d');
  const bufferLen = analyser.frequencyBinCount;
  const dataArray = new Uint8Array(bufferLen);

  function draw() {
    vizAnimFrame = requestAnimationFrame(draw);
    analyser.getByteFrequencyData(dataArray);

    ctx.fillStyle = '#1A1A24';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    const barWidth = (canvas.width / bufferLen) * 2.5;
    let x = 0;

    for (let i = 0; i < bufferLen; i++) {
      const barHeight = (dataArray[i] / 255) * canvas.height;
      const hue = (dataArray[i] / 255) * 30;
      ctx.fillStyle = `hsl(${hue}, 85%, ${50 + dataArray[i] / 5}%)`;
      ctx.fillRect(x, canvas.height - barHeight, barWidth - 1, barHeight);
      x += barWidth;
    }
  }

  draw();
}

document.getElementById('playback-btn')?.addEventListener('click', () => {
  if (recordedChunks.length === 0) return;
  const blob = new Blob(recordedChunks, { type: 'audio/webm' });
  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  audio.play();

  const btn = document.getElementById('playback-btn');
  btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg> Playing...`;
  audio.onended = () => {
    btn.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg> Play Back`;
  };
});

// =============================================
// Step 2: Import
// =============================================

function scanForInstallations() {
  const container = document.getElementById('import-list-container');

  // Check for OpenClaw data in common locations
  // In a real implementation, this would scan chrome.storage, local files, etc.
  setTimeout(() => {
    const found = checkForOpenClawData();
    if (found.length > 0) {
      let html = '<ul class="import-list">';
      found.forEach(item => {
        html += `
          <li>
            <div class="import-info">
              <div class="import-icon">${item.icon}</div>
              <div>
                <div class="import-name">${item.name}</div>
                <div class="import-desc">${item.desc}</div>
              </div>
            </div>
            <button class="import-btn" onclick="importItem('${item.id}', this)">${item.count} items</button>
          </li>
        `;
      });
      html += '</ul>';
      container.innerHTML = html;
    } else {
      container.innerHTML = `
        <div class="empty-state">
          <div class="empty-icon">📭</div>
          <p>No existing OpenClaw installations found.<br>You can import manually below, or skip this step.</p>
        </div>
      `;
    }
  }, 1500);
}

function checkForOpenClawData() {
  // Mock: check localStorage/storage for openclaw data
  const items = [];
  try {
    const skills = localStorage.getItem('openclaw_skills');
    if (skills) {
      const parsed = JSON.parse(skills);
      items.push({
        id: 'skills',
        icon: '🧠',
        name: 'Skills',
        desc: 'Custom agent skills and behaviors',
        count: Array.isArray(parsed) ? parsed.length : 0,
      });
    }
  } catch {}

  try {
    const personas = localStorage.getItem('openclaw_personas');
    if (personas) {
      const parsed = JSON.parse(personas);
      items.push({
        id: 'personas',
        icon: '🎭',
        name: 'Personas',
        desc: 'Agent personality configurations',
        count: Array.isArray(parsed) ? parsed.length : 0,
      });
    }
  } catch {}

  try {
    const prefs = localStorage.getItem('openclaw_preferences');
    if (prefs) {
      items.push({
        id: 'preferences',
        icon: '⚙️',
        name: 'Preferences',
        desc: 'Voice, behavior, and UI preferences',
        count: 1,
      });
    }
  } catch {}

  return items;
}

function importItem(id, btn) {
  btn.classList.add('imported');
  btn.textContent = 'Imported ✓';
  btn.disabled = true;

  // Store import status
  chrome.storage?.sync.set({ [`imported_${id}`]: true });
}

function manualImport() {
  const url = document.getElementById('import-url')?.value;
  if (!url) return;

  // Handle import URL
  if (url.startsWith('http')) {
    // Would fetch and parse OpenClaw export
    alert('Import from URL is being processed...');
  }
}

// Drag-and-drop for import files
document.addEventListener('dragover', (e) => { e.preventDefault(); });
document.addEventListener('drop', (e) => {
  e.preventDefault();
  const files = e.dataTransfer?.files;
  if (files?.length > 0) {
    for (const file of files) {
      if (file.name.endsWith('.openclaw') || file.name.endsWith('.json')) {
        const reader = new FileReader();
        reader.onload = (ev) => {
          try {
            const data = JSON.parse(ev.target.result);
            processOpenClawImport(data);
          } catch (err) {
            console.error('Import parse error:', err);
          }
        };
        reader.readAsText(file);
      }
    }
  }
});

function processOpenClawImport(data) {
  // Process imported OpenClaw data
  if (data.skills) {
    chrome.storage?.sync.set({ imported_skills: data.skills });
  }
  if (data.personas) {
    chrome.storage?.sync.set({ imported_personas: data.personas });
  }
  if (data.preferences) {
    chrome.storage?.sync.set({ imported_preferences: data.preferences });
  }
  scanForInstallations(); // Refresh
}

// =============================================
// Step 3: Gateway / BYOK Config
// =============================================

function switchConfigTab(tab) {
  document.querySelectorAll('.config-tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.config-panel').forEach(p => p.classList.remove('active'));

  const tabBtn = document.querySelector(`.config-tab[onclick*="${tab}"]`);
  const panel = document.getElementById(`panel-${tab}`);
  tabBtn?.classList.add('active');
  panel?.classList.add('active');

  // Store preference
  chrome.storage?.sync.set({ configMode: tab });
}

async function testGateway() {
  const url = document.getElementById('gateway-url')?.value;
  const btn = document.getElementById('test-gateway-btn');
  const result = document.getElementById('gateway-test-result');

  btn.textContent = 'Testing...';
  btn.disabled = true;
  result.style.display = 'block';

  try {
    const resp = await fetch(`${url}/health`, { signal: AbortSignal.timeout(5000) });
    if (resp.ok) {
      result.textContent = 'Connection successful!';
      result.style.color = '#00E676';
    } else {
      result.textContent = `Server responded with ${resp.status}`;
      result.style.color = '#FFB800';
    }
  } catch (err) {
    result.textContent = 'Could not reach gateway. Check the URL and ensure the server is running.';
    result.style.color = '#FF4757';
  }

  btn.textContent = 'Test Connection';
  btn.disabled = false;
}

function toggleKeyVisibility(inputId) {
  const input = document.getElementById(inputId);
  input.type = input.type === 'password' ? 'text' : 'password';
}

// BYOK provider change
document.getElementById('byok-provider')?.addEventListener('change', (e) => {
  const modelSelect = document.getElementById('byok-model');
  const provider = e.target.value;

  modelSelect.innerHTML = '';
  const models = {
    gemini: [
      ['gemini-2.0-flash-exp', 'Gemini 2.0 Flash (Live)'],
      ['gemini-2.0-pro-exp', 'Gemini 2.0 Pro'],
    ],
    openai: [
      ['gpt-4o-realtime', 'GPT-4o Realtime'],
      ['gpt-4o', 'GPT-4o'],
    ],
    anthropic: [
      ['claude-opus-4-6', 'Claude Opus 4.6'],
      ['claude-sonnet-4-6', 'Claude Sonnet 4.6'],
    ],
  };

  (models[provider] || []).forEach(([val, label]) => {
    const opt = document.createElement('option');
    opt.value = val;
    opt.textContent = label;
    modelSelect.appendChild(opt);
  });
});

// =============================================
// Settings Persistence
// =============================================

function saveCurrentStepSettings() {
  const settings = {};

  // Step 0: Mic
  settings.preferredMic = document.getElementById('mic-select')?.value || '';
  settings.seamlessVoice = document.getElementById('seamless-toggle')?.checked ?? true;

  // Step 2: Gateway
  settings.gatewayUrl = document.getElementById('gateway-url')?.value || 'http://localhost:8080';
  settings.gatewayApiKey = document.getElementById('gateway-api-key')?.value || '';
  settings.byokProvider = document.getElementById('byok-provider')?.value || 'gemini';
  settings.byokApiKey = document.getElementById('byok-api-key')?.value || '';
  settings.byokModel = document.getElementById('byok-model')?.value || '';
  settings.autoActivate = document.getElementById('auto-activate')?.checked ?? false;
  settings.sendDom = document.getElementById('send-dom')?.checked ?? true;

  chrome.storage?.sync.set(settings);
}

function loadSettings() {
  chrome.storage?.sync.get(null, (settings) => {
    if (settings.preferredMic) {
      const select = document.getElementById('mic-select');
      if (select) select.value = settings.preferredMic;
    }
    if (settings.seamlessVoice !== undefined) {
      document.getElementById('seamless-toggle').checked = settings.seamlessVoice;
    }
    if (settings.gatewayUrl) {
      document.getElementById('gateway-url').value = settings.gatewayUrl;
    }
    if (settings.autoActivate !== undefined) {
      document.getElementById('auto-activate').checked = settings.autoActivate;
    }
    if (settings.sendDom !== undefined) {
      document.getElementById('send-dom').checked = settings.sendDom;
    }
  });
}

// =============================================
// Finish
// =============================================

function finishSetup() {
  saveCurrentStepSettings();
  chrome.storage?.sync.set({ onboardingComplete: true });
  // Close onboarding tab
  window.close();
}

// =============================================
// Header Avatar Animation (simple teardrop character)
// =============================================

function drawHeaderAvatar() {
  const canvas = document.getElementById('header-avatar');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const s = 80;

  function animate() {
    requestAnimationFrame(animate);
    const now = performance.now();
    ctx.clearRect(0, 0, s, s);

    const cx = s / 2;
    const cy = s / 2 + Math.sin(now * 0.002) * 1.5;
    const bh = s * 0.55;
    const bw = bh * 0.7;

    // Glow
    const glowAlpha = 0.1 + Math.sin(now * 0.003) * 0.05;
    ctx.beginPath();
    ctx.arc(cx, cy, bw * 0.8, 0, Math.PI * 2);
    ctx.fillStyle = `rgba(255,77,77,${glowAlpha})`;
    ctx.fill();

    // Body teardrop
    const top = cy - bh * 0.45;
    const bottom = cy + bh * 0.35;
    const baseR = bw * 0.48;

    ctx.beginPath();
    ctx.moveTo(cx, top);
    ctx.bezierCurveTo(cx + bw * 0.1, top + bh * 0.12, cx + baseR + bw * 0.06, cy - bh * 0.04, cx + baseR, bottom - bh * 0.06);
    ctx.bezierCurveTo(cx + baseR * 0.8, bottom + bh * 0.01, cx + baseR * 0.3, bottom + bh * 0.03, cx, bottom + bh * 0.02);
    ctx.bezierCurveTo(cx - baseR * 0.3, bottom + bh * 0.03, cx - baseR * 0.8, bottom + bh * 0.01, cx - baseR, bottom - bh * 0.06);
    ctx.bezierCurveTo(cx - baseR - bw * 0.06, cy - bh * 0.04, cx - bw * 0.1, top + bh * 0.12, cx, top);
    ctx.closePath();

    const grad = ctx.createLinearGradient(cx, top, cx, bottom);
    grad.addColorStop(0, '#FF7A7A');
    grad.addColorStop(0.5, '#FF4D4D');
    grad.addColorStop(1, '#CC2A2A');
    ctx.fillStyle = grad;
    ctx.fill();

    // Eyes
    const eyeY = cy - bh * 0.06;
    const eyeSpacing = bw * 0.2;
    const eyeR = bw * 0.1;
    const blink = Math.sin(now * 0.005) > 0.98;
    const eyeH = blink ? eyeR * 0.15 : eyeR;

    ctx.fillStyle = 'white';
    ctx.beginPath();
    ctx.ellipse(cx - eyeSpacing, eyeY, eyeR, eyeH, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(cx + eyeSpacing, eyeY, eyeR, eyeH, 0, 0, Math.PI * 2);
    ctx.fill();

    if (!blink) {
      const px = Math.sin(now * 0.001) * eyeR * 0.3;
      ctx.fillStyle = '#1a1a2e';
      ctx.beginPath();
      ctx.arc(cx - eyeSpacing + px, eyeY, eyeR * 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx + eyeSpacing + px, eyeY, eyeR * 0.5, 0, Math.PI * 2);
      ctx.fill();

      // Shine
      ctx.fillStyle = 'rgba(255,255,255,0.8)';
      ctx.beginPath();
      ctx.arc(cx - eyeSpacing + px + eyeR * 0.15, eyeY - eyeR * 0.15, eyeR * 0.18, 0, Math.PI * 2);
      ctx.fill();
      ctx.beginPath();
      ctx.arc(cx + eyeSpacing + px + eyeR * 0.15, eyeY - eyeR * 0.15, eyeR * 0.18, 0, Math.PI * 2);
      ctx.fill();
    }

    // Smile
    const mouthY = cy + bh * 0.1;
    ctx.beginPath();
    ctx.arc(cx, mouthY - bh * 0.015, bw * 0.15, 0.15, Math.PI - 0.15);
    ctx.strokeStyle = 'rgba(26,26,46,0.5)';
    ctx.lineWidth = 1.5;
    ctx.lineCap = 'round';
    ctx.stroke();
  }

  animate();
}

// =============================================
// Init
// =============================================

document.addEventListener('DOMContentLoaded', () => {
  loadMicrophones();
  scanForInstallations();
  loadSettings();
  drawHeaderAvatar();
});
