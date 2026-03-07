import { getApiBase } from '../api';

export function renderSettings(el: HTMLElement): void {
  el.innerHTML = `
    <h2>Settings</h2>
    <div class="card">
      <h3>Gateway</h3>
      <p style="font-size:14px;color:var(--text-secondary)">Connected to: <code>${getApiBase()}</code></p>
    </div>
    <div class="card">
      <h3>Version</h3>
      <p style="font-size:14px;color:var(--text-secondary)">WebClaw Gateway v0.2.0</p>
    </div>
  `;
}
