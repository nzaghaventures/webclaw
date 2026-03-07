import { api } from '../api';
import { toast } from '../utils';
import type { SiteConfig } from '../types';
import { navigate } from '../main';

const ALL_ACTIONS = ['click', 'type', 'scroll', 'navigate', 'highlight', 'read', 'select', 'check'];

let currentSites: SiteConfig[] = [];

export async function renderSites(el: HTMLElement): Promise<void> {
  const data = await api<{ sites: SiteConfig[] }>('/api/sites');
  currentSites = data.sites || [];

  el.innerHTML = `
    <div class="flex-between">
      <h2>Sites</h2>
      <button class="btn btn-primary" id="add-site-btn">+ Add Site</button>
    </div>
    <div id="sites-list">
      ${currentSites.map(s => `
        <div class="card">
          <div class="flex-between">
            <h3>${s.persona_name} <span class="badge badge-success">Active</span></h3>
            <div style="display:flex;gap:8px">
              <button class="btn btn-sm btn-outline" data-edit="${s.site_id}">Edit</button>
              ${s.site_id !== 'demo' ? `<button class="btn btn-sm btn-danger" data-delete="${s.site_id}">Delete</button>` : ''}
            </div>
          </div>
          <p style="font-size:13px;color:var(--text-secondary);margin-top:8px">
            <strong>ID:</strong> <code>${s.site_id}</code> &middot;
            <strong>Domain:</strong> ${s.domain} &middot;
            <strong>Actions:</strong> ${(s.allowed_actions || []).length} allowed
          </p>
        </div>
      `).join('')}
    </div>
    <div id="site-form" class="card hidden"></div>
  `;

  document.getElementById('add-site-btn')?.addEventListener('click', () => showSiteForm());
  el.querySelectorAll<HTMLButtonElement>('[data-edit]').forEach(btn =>
    btn.addEventListener('click', () => editSite(btn.dataset.edit!))
  );
  el.querySelectorAll<HTMLButtonElement>('[data-delete]').forEach(btn =>
    btn.addEventListener('click', () => deleteSite(btn.dataset.delete!))
  );
}

export async function editSite(siteId: string): Promise<void> {
  const data = await api<{ config: SiteConfig }>(`/api/sites/${siteId}`);
  if (data.config) {
    navigate('sites');
    // Wait for render, then show form
    setTimeout(() => showSiteForm(data.config), 50);
  }
}

function showSiteForm(config?: SiteConfig): void {
  const form = document.getElementById('site-form');
  if (!form) return;
  form.classList.remove('hidden');
  const isEdit = !!config;
  const allowed = config?.allowed_actions || ALL_ACTIONS;

  form.innerHTML = `
    <h3>${isEdit ? 'Edit Site' : 'Add New Site'}</h3>
    <div class="form-group">
      <label>Domain</label>
      <input id="f-domain" value="${config?.domain || ''}" placeholder="yoursite.com" />
    </div>
    <div class="form-group">
      <label>Persona Name</label>
      <input id="f-name" value="${config?.persona_name || 'WebClaw'}" />
    </div>
    <div class="form-group">
      <label>Voice Style</label>
      <input id="f-voice" value="${config?.persona_voice || 'friendly and helpful'}" placeholder="e.g., warm, professional, concise" />
    </div>
    <div class="form-group">
      <label>Welcome Message</label>
      <input id="f-welcome" value="${config?.welcome_message || ''}" />
    </div>
    <div class="form-group">
      <label>Knowledge Base</label>
      <textarea id="f-kb" placeholder="Add FAQs, product info, policies...">${config?.knowledge_base || ''}</textarea>
    </div>
    <div class="form-group">
      <label>Escalation Email</label>
      <input id="f-email" type="email" value="${config?.escalation_email || ''}" placeholder="support@yoursite.com" />
    </div>
    <div class="form-group">
      <label>Allowed Actions</label>
      <div class="action-checks">
        ${ALL_ACTIONS.map(a => `
          <label>
            <input type="checkbox" class="action-cb" value="${a}" ${allowed.includes(a) ? 'checked' : ''} />
            ${a}
          </label>
        `).join('')}
      </div>
    </div>
    <div style="display:flex;gap:8px;margin-top:16px">
      <button class="btn btn-primary" id="save-site-btn">${isEdit ? 'Update' : 'Create'}</button>
      <button class="btn btn-outline" id="cancel-site-btn">Cancel</button>
    </div>
  `;

  document.getElementById('save-site-btn')?.addEventListener('click', () =>
    saveSite(config?.site_id)
  );
  document.getElementById('cancel-site-btn')?.addEventListener('click', () =>
    form.classList.add('hidden')
  );
  form.scrollIntoView({ behavior: 'smooth' });
}

async function saveSite(siteId?: string): Promise<void> {
  const body = {
    domain: (document.getElementById('f-domain') as HTMLInputElement).value,
    persona_name: (document.getElementById('f-name') as HTMLInputElement).value,
    persona_voice: (document.getElementById('f-voice') as HTMLInputElement).value,
    welcome_message: (document.getElementById('f-welcome') as HTMLInputElement).value,
    knowledge_base: (document.getElementById('f-kb') as HTMLTextAreaElement).value,
    escalation_email: (document.getElementById('f-email') as HTMLInputElement).value,
    allowed_actions: [...document.querySelectorAll<HTMLInputElement>('.action-cb:checked')].map(cb => cb.value),
    restricted_actions: [...document.querySelectorAll<HTMLInputElement>('.action-cb:not(:checked)')].map(cb => cb.value),
  };

  if (siteId) {
    await api(`/api/sites/${siteId}`, { method: 'PUT', body });
    toast('Site updated');
  } else {
    await api('/api/sites', { method: 'POST', body });
    toast('Site created');
  }
  renderSites(document.getElementById('main-content')!);
}

async function deleteSite(siteId: string): Promise<void> {
  if (!confirm(`Delete site ${siteId}? This cannot be undone.`)) return;
  await api(`/api/sites/${siteId}`, { method: 'DELETE' });
  toast('Site deleted');
  renderSites(document.getElementById('main-content')!);
}
