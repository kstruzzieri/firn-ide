import { create } from 'zustand';
import { devtools } from 'zustand/middleware';

// --- Types ---

export interface LSPPosition {
  line: number;
  character: number;
}

export interface LSPRange {
  start: LSPPosition;
  end: LSPPosition;
}

export interface LSPDiagnostic {
  range: LSPRange;
  severity?: number;
  code?: number | string;
  source?: string;
  message: string;
}

export interface LSPServerStatus {
  family: string;
  workspace: string;
  state: 'starting' | 'ready' | 'stopping' | 'stopped' | 'error';
  error?: string;
}

// --- Store ---

/** Build the composite key for serverStatuses. */
export function serverStatusKey(workspace: string, family: string): string {
  return `${workspace}::${family}`;
}

interface LSPState {
  /** URI -> diagnostics array. Updated by publishDiagnostics notifications. */
  diagnostics: Map<string, LSPDiagnostic[]>;
  /** "workspace::family" -> server status. Updated by lsp:status events. */
  serverStatuses: Map<string, LSPServerStatus>;
}

interface LSPActions {
  setDiagnostics: (uri: string, diagnostics: LSPDiagnostic[]) => void;
  removeDiagnostics: (uri: string) => void;
  clearAllDiagnostics: () => void;

  setServerStatus: (status: LSPServerStatus) => void;
  removeServerStatus: (workspace: string, family: string) => void;
  clearAllStatuses: () => void;

  /** Clear server statuses for a given workspace. */
  clearWorkspaceState: (workspace: string) => void;

  /** Derived: total count of severity=1 diagnostics across all files.
   *  Note: This is a method, not a reactive selector. Phase 4 should convert
   *  to proper derived state when wiring StatusBar consumers. */
  errorCount: () => number;
  /** Derived: total count of severity=2 diagnostics across all files. */
  warningCount: () => number;
}

type LSPStore = LSPState & LSPActions;

export const useLSPStore = create<LSPStore>()(
  devtools(
    (set, get) => ({
      diagnostics: new Map(),
      serverStatuses: new Map(),

      setDiagnostics: (uri, diagnostics) =>
        set(
          (state) => {
            const next = new Map(state.diagnostics);
            next.set(uri, diagnostics);
            return { diagnostics: next };
          },
          false,
          'setDiagnostics'
        ),

      removeDiagnostics: (uri) =>
        set(
          (state) => {
            const next = new Map(state.diagnostics);
            next.delete(uri);
            return { diagnostics: next };
          },
          false,
          'removeDiagnostics'
        ),

      clearAllDiagnostics: () => set({ diagnostics: new Map() }, false, 'clearAllDiagnostics'),

      setServerStatus: (status) =>
        set(
          (state) => {
            const next = new Map(state.serverStatuses);
            next.set(serverStatusKey(status.workspace, status.family), status);
            return { serverStatuses: next };
          },
          false,
          'setServerStatus'
        ),

      removeServerStatus: (workspace, family) =>
        set(
          (state) => {
            const next = new Map(state.serverStatuses);
            next.delete(serverStatusKey(workspace, family));
            return { serverStatuses: next };
          },
          false,
          'removeServerStatus'
        ),

      clearAllStatuses: () => set({ serverStatuses: new Map() }, false, 'clearAllStatuses'),

      clearWorkspaceState: (workspace) =>
        set(
          (state) => {
            const nextStatuses = new Map(state.serverStatuses);
            for (const [key, status] of nextStatuses) {
              if (status.workspace === workspace) {
                nextStatuses.delete(key);
              }
            }
            return { serverStatuses: nextStatuses };
          },
          false,
          'clearWorkspaceState'
        ),

      errorCount: () => {
        let count = 0;
        for (const diags of get().diagnostics.values()) {
          for (const d of diags) {
            if (d.severity === 1) count++;
          }
        }
        return count;
      },

      warningCount: () => {
        let count = 0;
        for (const diags of get().diagnostics.values()) {
          for (const d of diags) {
            if (d.severity === 2) count++;
          }
        }
        return count;
      },
    }),
    { name: 'lsp-store' }
  )
);
