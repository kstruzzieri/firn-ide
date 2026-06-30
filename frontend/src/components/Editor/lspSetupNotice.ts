import type { LSPServerStatus } from '../../stores/lspStore';

export interface LSPSetupNotice {
  message: string;
  hint: string;
  tone: 'error' | 'warning' | 'info';
}

/**
 * Maps a server's typed setup status onto a user-facing message + next-step
 * hint. Returns null when there is nothing actionable to show (server ready,
 * or no setup state reported). Phase 1 surfaces guidance text only; the
 * interactive interpreter picker is a follow-up.
 */
export function describeSetup(status: LSPServerStatus | undefined): LSPSetupNotice | null {
  if (!status?.setupState || status.setupState === 'ready') return null;

  switch (status.setupState) {
    case 'missing_server':
      return {
        message: `Language server not found for ${status.family}.`,
        hint: 'Install it (e.g. pyright) or add it as a project dependency, then reopen the file.',
        tone: 'error',
      };
    case 'missing_interpreter':
      return {
        message: 'No Python interpreter found - imports and types cannot be checked.',
        hint: 'Create a virtual environment (uv sync, or python -m venv .venv) and reopen the file.',
        tone: 'warning',
      };
    case 'misconfigured_env':
      return {
        message: 'Python environment looks incomplete - diagnostics may be unreliable.',
        hint: 'Check that your .venv contains a Python interpreter.',
        tone: 'warning',
      };
    case 'config_degraded':
      return {
        message: `Using a fallback interpreter${status.interpreterPath ? ` (${status.interpreterPath})` : ''}.`,
        hint: 'Create or activate a project virtual environment for accurate import/version checks.',
        tone: 'warning',
      };
    case 'retryable':
      return {
        message: 'The language server failed to start.',
        hint: 'Reopen the file to retry.',
        tone: 'error',
      };
    case 'provisioning':
      return {
        message: 'Setting up language server…',
        hint: status.provisionPct
          ? `Downloading (${status.provisionPct}%).`
          : 'Downloading the language server.',
        tone: 'info',
      };
    case 'offline':
      return {
        message: 'Could not download the language server (offline).',
        hint: 'Check your connection, then Retry.',
        tone: 'error',
      };
    case 'provision_failed':
      return {
        message: 'Language server setup failed.',
        hint: 'Retry, or install basedpyright/pyright manually.',
        tone: 'error',
      };
    default:
      return null;
  }
}
