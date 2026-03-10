import { api, getApiBase } from '../api';
import { toast, escapeHtml, emptyStateIcon } from '../utils';

export async function renderSettings(el: HTMLElement): Promise<void> {
  // Show loading state
  el.innerHTML = `
    <div class="page-header">
      <h2>Settings</h2>
      <p>System configuration and status</p>
    </div>
    <div class="loading-placeholder">
      <div class="loading-spinner"></div> Loading settings...
    </div>
  `;

  try {
    const base = getApiBase();
    let healthStatus = 'checking...';
    let healthColor = '#64748b';

    try {
      const health = await api<{ status: string }>('/api/health');
      healthStatus = health.status === 'ok' ? 'Healthy' : 'Degraded';
      healthColor = health.status === 'ok' ? '#059669' : '#d97706';
    } catch (error) {
      healthStatus = 'Unreachable';
      healthColor = '#dc2626';
    }

    el.innerHTML = `
      <div class="page-header">
        <h2>Settings</h2>
        <p>System configuration and status</p>
      </div>

      <div class="card">
        <h3>Gateway Configuration</h3>
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:20px;margin-top:16px">
          <div>
            <div style="font-size:11px;font-weight:500;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:8px">API Base URL</div>
            <code style="font-size:13px;word-break:break-all">${escapeHtml(base)}</code>
          </div>
          <div>
            <div style="font-size:11px;font-weight:500;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:8px">Environment</div>
            <p style="font-size:13px;color:var(--text)">${base.includes('localhost') ? 'Development' : 'Production'}</p>
          </div>
        </div>
      </div>

      <div class="card">
        <h3>API Health</h3>
        <div style="display:flex;align-items:center;gap:12px;margin-top:12px">
          <div style="width:12px;height:12px;border-radius:50%;background:${healthColor}"></div>
          <span style="font-size:14px;color:var(--text)">${escapeHtml(healthStatus)}</span>
        </div>
        <p style="font-size:12px;color:var(--text-secondary);margin-top:8px">
          The WebClaw Gateway API is ${healthStatus === 'Healthy' ? 'operational' : 'experiencing issues'}.
          ${healthStatus === 'Healthy' ? 'All systems functioning normally.' : 'Please contact support if problems persist.'}
        </p>
      </div>

      <div class="card">
        <h3>Version Information</h3>
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:20px;margin-top:16px">
          <div>
            <div style="font-size:11px;font-weight:500;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:8px">Dashboard</div>
            <p style="font-size:13px;color:var(--text)">v1.0.0</p>
          </div>
          <div>
            <div style="font-size:11px;font-weight:500;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:8px">Gateway</div>
            <p style="font-size:13px;color:var(--text)">v0.2.0</p>
          </div>
          <div>
            <div style="font-size:11px;font-weight:500;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:8px">API Version</div>
            <p style="font-size:13px;color:var(--text)">v2.0</p>
          </div>
          <div>
            <div style="font-size:11px;font-weight:500;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:8px">Last Updated</div>
            <p style="font-size:13px;color:var(--text)">${new Date().toLocaleDateString()}</p>
          </div>
        </div>
      </div>

      <div class="card">
        <h3>Browser Information</h3>
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:20px;margin-top:16px">
          <div>
            <div style="font-size:11px;font-weight:500;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:8px">User Agent</div>
            <code style="font-size:12px;word-break:break-all">${escapeHtml(navigator.userAgent)}</code>
          </div>
          <div>
            <div style="font-size:11px;font-weight:500;color:var(--text-secondary);text-transform:uppercase;letter-spacing:0.04em;margin-bottom:8px">Platform</div>
            <p style="font-size:13px;color:var(--text)">${escapeHtml(navigator.platform || 'Unknown')}</p>
          </div>
        </div>
      </div>

      <div class="card">
        <h3>Support & Documentation</h3>
        <p style="font-size:13px;color:var(--text-secondary);margin-bottom:12px">For assistance and documentation, visit:</p>
        <ul style="font-size:13px;color:var(--primary);list-style:none;padding:0">
          <li style="margin-bottom:6px">📖 <a href="#" style="color:var(--primary);text-decoration:none">Documentation</a></li>
          <li style="margin-bottom:6px">🐛 <a href="#" style="color:var(--primary);text-decoration:none">Report an Issue</a></li>
          <li>💬 <a href="#" style="color:var(--primary);text-decoration:none">Get Support</a></li>
        </ul>
      </div>
    `;
  } catch (error) {
    console.error('Failed to load settings:', error);
    el.innerHTML = `
      <div class="page-header">
        <h2>Settings</h2>
        <p>System configuration and status</p>
      </div>
      <div class="card">
        <div class="empty-state">
          ${emptyStateIcon('settings')}
          <p>Failed to load settings</p>
          <p style="font-size:12px;color:var(--text-secondary)">Please try refreshing the page</p>
        </div>
      </div>
    `;
  }
}
