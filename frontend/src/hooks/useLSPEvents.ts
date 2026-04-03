import { useEffect, useRef } from 'react';
import { EventsOn } from '../../wailsjs/runtime/runtime';
import { useLSPStore } from '../stores/lspStore';
import { useIDEStore } from '../stores/ideStore';
import type { LSPDiagnostic, LSPServerStatus } from '../stores/lspStore';

interface DiagnosticsPayload {
  workspace: string;
  uri: string;
  version?: number;
  diagnostics: LSPDiagnostic[];
}

interface ErrorPayload {
  family: string;
  workspace: string;
  message: string;
}

/**
 * useLSPEvents subscribes to backend LSP Wails events and routes them
 * into lspStore. Shows Toast notifications for actionable errors.
 *
 * Toast deduplication: Only one Toast per workspace::family error state.
 * Crash-retry status updates update the store but don't spam Toasts.
 */
export function useLSPEvents() {
  // Track which workspace::family combos have already shown an error Toast
  // to avoid spamming on crash-retry backoff cycles.
  const toastedErrors = useRef(new Set<string>());

  useEffect(() => {
    const cancelDiagnostics = EventsOn('lsp:diagnostics', (payload: DiagnosticsPayload) => {
      if (!payload?.uri) return;

      // Reject diagnostics from a non-active workspace
      const activeWorkspace = useIDEStore.getState().workspace?.path;
      if (activeWorkspace && payload.workspace && payload.workspace !== activeWorkspace) {
        return;
      }

      useLSPStore.getState().setDiagnostics(payload.uri, payload.diagnostics ?? []);
    });

    const cancelStatus = EventsOn('lsp:status', (payload: LSPServerStatus) => {
      if (!payload?.family) return;
      useLSPStore.getState().setServerStatus(payload);

      if (payload.state === 'error' && payload.error) {
        // Deduplicate: only toast once per workspace::family error state
        const dedupeKey = `${payload.workspace}::${payload.family}`;
        if (!toastedErrors.current.has(dedupeKey)) {
          toastedErrors.current.add(dedupeKey);
          useIDEStore.getState().showToast(payload.error, 'error');
        }
      } else if (payload.state === 'ready') {
        // Server recovered — clear the dedup guard so future errors can toast again
        const dedupeKey = `${payload.workspace}::${payload.family}`;
        toastedErrors.current.delete(dedupeKey);
      }
    });

    const cancelError = EventsOn('lsp:error', (payload: ErrorPayload) => {
      if (!payload?.message) return;
      // Terminal errors (crash exhaustion) always show a Toast regardless of dedup
      useIDEStore.getState().showToast(payload.message, 'error');
    });

    return () => {
      cancelDiagnostics();
      cancelStatus();
      cancelError();
    };
  }, []);
}
