import { api } from '../api';
import { toast, formatDuration } from '../utils';
import type { SiteConfig, SessionRecord } from '../types';

let sites: SiteConfig[] = [];
let activeSiteId: string = '';

export async function renderSessions(el: HTMLElement): Promise<void> {
  const data = await api<{ sites: SiteConfig[] }>('/api/sites');
  sites = data.sites || [];

  if (sites.length === 0) {
    el.innerHTML = '<h2>Sessions</h2><p>Register a site first.</p>';
    return;
  }

  activeSiteId = activeSiteId || sites[0].site_id;
  const sessions = await api<{ sessions: SessionRecord[] }>(`/api/sites/${activeSiteId}/sessions?limit=20`);
  const list = sessions.sessions || [];

  el.innerHTML = `
    <div class="flex-between">
      <h2>Sessions</h2>
      <select id="sess-site" class="select-inline">
        ${sites.map(s => `<option value="${s.site_id}" ${s.site_id === activeSiteId ? 'selected' : ''}>${s.persona_name} (${s.domain})</option>`).join('')}
      </select>
    </div>

    ${list.length === 0
      ? '<div class="card"><p style="color:var(--text-secondary)">No sessions recorded yet. Sessions are saved when visitors interact via WebClaw.</p></div>'
      : `<table class="table">
        <thead><tr><th>Session</th><th>User</th><th>Messages</th><th>Duration</th><th>Last Active</th></tr></thead>
        <tbody>
          ${list.map(s => `
            <tr style="cursor:pointer" data-view-session="${s.session_id || ''}">
              <td><code>${(s.session_id || s.user_id || '-').substring(0, 12)}...</code></td>
              <td>${s.user_id || '-'}</td>
              <td>${s.metadata?.message_count || (s.messages || []).length || '-'}</td>
              <td>${s.metadata?.duration_seconds ? formatDuration(s.metadata.duration_seconds) : '-'}</td>
              <td>${s.updated_at ? new Date(s.updated_at * 1000).toLocaleString() : '-'}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>`}
  `;

  document.getElementById('sess-site')?.addEventListener('change', (e) => {
    activeSiteId = (e.target as HTMLSelectElement).value;
    renderSessions(el);
  });
  el.querySelectorAll<HTMLTableRowElement>('[data-view-session]').forEach(row =>
    row.addEventListener('click', () => viewSession(el, row.dataset.viewSession!))
  );
}

async function viewSession(el: HTMLElement, sessionId: string): Promise<void> {
  if (!sessionId) return;
  const data = await api<{ session: SessionRecord }>(`/api/sites/${activeSiteId}/sessions/${sessionId}`);
  const session = data.session;
  if (!session) { toast('Session not found', 'error'); return; }

  el.innerHTML = `
    <div style="margin-bottom:16px">
      <button class="btn btn-outline btn-sm" id="back-to-sessions">← Back</button>
    </div>
    <h2>Session: ${sessionId.substring(0, 16)}...</h2>
    <p style="font-size:13px;color:var(--text-secondary);margin-bottom:16px">
      Duration: ${session.metadata?.duration_seconds ? formatDuration(session.metadata.duration_seconds) : 'unknown'} &middot;
      Messages: ${(session.messages || []).length}
    </p>
    <div class="card">
      ${(session.messages || []).map(m => `
        <div class="chat-bubble ${m.role === 'user' ? 'chat-bubble-user' : 'chat-bubble-agent'}">
          <div class="chat-bubble-meta">${m.role} &middot; ${m.type} &middot; ${new Date(m.ts * 1000).toLocaleTimeString()}</div>
          <div class="chat-bubble-text">${m.text || ''}</div>
        </div>
      `).join('')}
    </div>
  `;

  document.getElementById('back-to-sessions')?.addEventListener('click', () => renderSessions(el));
}
