import { api } from '../api';
import { toast } from '../utils';
import type { SiteConfig, KnowledgeDoc } from '../types';

let sites: SiteConfig[] = [];
let activeSiteId: string = '';

export async function renderKnowledge(el: HTMLElement): Promise<void> {
  const data = await api<{ sites: SiteConfig[] }>('/api/sites');
  sites = data.sites || [];

  if (sites.length === 0) {
    el.innerHTML = '<h2>Knowledge Base</h2><p>Register a site first.</p>';
    return;
  }

  activeSiteId = activeSiteId || sites[0].site_id;
  const docs = await api<{ documents: KnowledgeDoc[] }>(`/api/sites/${activeSiteId}/knowledge`);
  const documents = docs.documents || [];

  el.innerHTML = `
    <div class="flex-between">
      <h2>Knowledge Base</h2>
      <div style="display:flex;gap:8px;align-items:center">
        <select id="kb-site" class="select-inline">
          ${sites.map(s => `<option value="${s.site_id}" ${s.site_id === activeSiteId ? 'selected' : ''}>${s.persona_name} (${s.domain})</option>`).join('')}
        </select>
        <button class="btn btn-primary btn-sm" id="add-kb-btn">+ Add Document</button>
      </div>
    </div>

    <div id="kb-docs">
      ${documents.length === 0
        ? '<div class="card"><p style="color:var(--text-secondary)">No knowledge base documents yet. Add FAQs, product info, or policies.</p></div>'
        : documents.map(d => `
          <div class="card">
            <div class="flex-between">
              <h3>${d.title || 'Untitled'}</h3>
              <div style="display:flex;gap:8px">
                <button class="btn btn-sm btn-outline" data-edit-kb="${d.id}" data-title="${encodeURIComponent(d.title || '')}" data-content="${encodeURIComponent(d.content || '')}">Edit</button>
                <button class="btn btn-sm btn-danger" data-delete-kb="${d.id}">Delete</button>
              </div>
            </div>
            <p style="font-size:13px;color:var(--text-secondary);margin-top:8px;white-space:pre-wrap">${(d.content || '').substring(0, 300)}${(d.content || '').length > 300 ? '...' : ''}</p>
          </div>
        `).join('')}
    </div>
    <div id="kb-form" class="card hidden"></div>
  `;

  document.getElementById('kb-site')?.addEventListener('change', (e) => {
    activeSiteId = (e.target as HTMLSelectElement).value;
    renderKnowledge(el);
  });
  document.getElementById('add-kb-btn')?.addEventListener('click', () => showKbForm());
  el.querySelectorAll<HTMLButtonElement>('[data-edit-kb]').forEach(btn =>
    btn.addEventListener('click', () =>
      showKbForm(btn.dataset.editKb!, decodeURIComponent(btn.dataset.title || ''), decodeURIComponent(btn.dataset.content || ''))
    )
  );
  el.querySelectorAll<HTMLButtonElement>('[data-delete-kb]').forEach(btn =>
    btn.addEventListener('click', () => deleteKb(btn.dataset.deleteKb!)
    )
  );
}

function showKbForm(docId: string = '', title: string = '', content: string = ''): void {
  const form = document.getElementById('kb-form');
  if (!form) return;
  form.classList.remove('hidden');

  form.innerHTML = `
    <h3>${docId ? 'Edit Document' : 'Add Document'}</h3>
    <div class="form-group">
      <label>Title</label>
      <input id="kb-title" value="${title}" placeholder="e.g., Shipping Policy" />
    </div>
    <div class="form-group">
      <label>Content</label>
      <textarea id="kb-content" style="min-height:200px" placeholder="Write your FAQ, policy, or product information here...">${content}</textarea>
    </div>
    <div style="display:flex;gap:8px;margin-top:16px">
      <button class="btn btn-primary" id="save-kb-btn">${docId ? 'Update' : 'Create'}</button>
      <button class="btn btn-outline" id="cancel-kb-btn">Cancel</button>
    </div>
  `;

  document.getElementById('save-kb-btn')?.addEventListener('click', () => saveKb(docId));
  document.getElementById('cancel-kb-btn')?.addEventListener('click', () => form.classList.add('hidden'));
  form.scrollIntoView({ behavior: 'smooth' });
}

async function saveKb(docId: string): Promise<void> {
  const body = {
    title: (document.getElementById('kb-title') as HTMLInputElement).value,
    content: (document.getElementById('kb-content') as HTMLTextAreaElement).value,
  };
  if (docId) {
    await api(`/api/sites/${activeSiteId}/knowledge/${docId}`, { method: 'PUT', body });
    toast('Document updated');
  } else {
    await api(`/api/sites/${activeSiteId}/knowledge`, { method: 'POST', body });
    toast('Document added');
  }
  renderKnowledge(document.getElementById('main-content')!);
}

async function deleteKb(docId: string): Promise<void> {
  if (!confirm('Delete this document?')) return;
  await api(`/api/sites/${activeSiteId}/knowledge/${docId}`, { method: 'DELETE' });
  toast('Document deleted');
  renderKnowledge(document.getElementById('main-content')!);
}
