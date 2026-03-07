let toastTimer: ReturnType<typeof setTimeout>;

export function toast(msg: string, type: 'success' | 'error' = 'success'): void {
  const el = document.getElementById('toast')!;
  el.textContent = msg;
  el.className = `toast toast-${type} show`;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}

export function copyToClipboard(text: string): void {
  navigator.clipboard.writeText(text).then(() => toast('Copied to clipboard'));
}

export function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

export function formatDuration(seconds: number): string {
  if (seconds < 60) return `${Math.round(seconds)}s`;
  return `${Math.floor(seconds / 60)}m ${Math.round(seconds % 60)}s`;
}
