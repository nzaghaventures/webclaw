import { api, getApiBase } from '../api';
import { copyToClipboard } from '../utils';
import type { SiteConfig, SiteStats } from '../types';
import { editSite } from './sites';

export async function renderOverview(el: HTMLElement): Promise<void> {
  const data = await api<{ sites: SiteConfig[] }>('/api/sites');
  const sites = data.sites || [];
  const base = getApiBase();

  el.innerHTML = `
    <h2>Overview</h2>
    <div class="stat-grid">
      <div class="stat-card">
        <div class="value">${sites.length}</div>
        <div class="label">Registered Sites</div>
      </div>
      <div class="stat-card">
        <div class="value" id="stat-sessions">-</div>
        <div class="label">Total Sessions</div>
      </div>
      <div class="stat-card">
        <div class="value" id="stat-messages">-</div>
        <div class="label">Messages</div>
      </div>
      <div class="stat-card">
        <div class="value" id="stat-actions">-</div>
        <div class="label">Actions Executed</div>
      </div>
    </div>

    <div class="card">
      <h3>Your Sites</h3>
      ${sites.length === 0
        ? '<p style="color:var(--text-secondary)">No sites registered yet. Go to Sites to add one.</p>'
        : `<table class="table">
          <thead><tr><th>Site ID</th><th>Domain</th><th>Persona</th><th>Actions</th></tr></thead>
          <tbody>
            ${sites.map(s => `
              <tr>
                <td><code>${s.site_id}</code></td>
                <td>${s.domain}</td>
                <td>${s.persona_name}</td>
                <td><button class="btn btn-sm btn-outline" data-edit-site="${s.site_id}">Edit</button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>`}
    </div>

    <div class="card">
      <h3>Quick Integration</h3>
      <p style="font-size:14px;color:var(--text-secondary);margin-bottom:12px">
        Add this script tag to your website to enable WebClaw:
      </p>
      <div class="code-block">
        <button class="copy-btn" id="copy-snippet-btn">Copy</button>
        <pre id="snippet">&lt;script src="${base}/embed.js"
        data-site-id="${sites[0]?.site_id || 'YOUR_SITE_ID'}"
        data-gateway="${base}"&gt;
&lt;/script&gt;</pre>
      </div>
    </div>
  `;

  // Bind events
  el.querySelectorAll<HTMLButtonElement>('[data-edit-site]').forEach(btn => {
    btn.addEventListener('click', () => editSite(btn.dataset.editSite!));
  });

  document.getElementById('copy-snippet-btn')?.addEventListener('click', () => {
    copyToClipboard(document.getElementById('snippet')!.textContent || '');
  });

  // Load stats
  if (sites.length > 0) {
    const stats = await api<{ stats: SiteStats }>(`/api/sites/${sites[0].site_id}/stats`);
    const s = stats.stats || {} as SiteStats;
    const set = (id: string, val: number | string) => {
      const el = document.getElementById(id);
      if (el) el.textContent = String(val || '0');
    };
    set('stat-sessions', s.sessions_total);
    set('stat-messages', s.messages_text);
    set('stat-actions', s.actions_executed);
  }
}
