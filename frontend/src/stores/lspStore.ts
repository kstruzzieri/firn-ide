import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { fileURIToPath } from '../utils/lspUri';

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
  completionTriggerCharacters?: string[];
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

// --- Reactive selector hooks ---

function countBySeverity(diagnostics: Map<string, LSPDiagnostic[]>, severity: number): number {
  let count = 0;
  for (const diags of diagnostics.values()) {
    for (const d of diags) {
      if (d.severity === severity) count++;
    }
  }
  return count;
}

function countByPredicate(
  diagnostics: Map<string, LSPDiagnostic[]>,
  predicate: (diagnostic: LSPDiagnostic) => boolean
): number {
  let count = 0;
  for (const diags of diagnostics.values()) {
    for (const d of diags) {
      if (predicate(d)) count++;
    }
  }
  return count;
}

/** Reactive error count — triggers re-render when diagnostics map changes. */
export const useLSPErrorCount = () => useLSPStore((state) => countBySeverity(state.diagnostics, 1));

/** Reactive warning count — triggers re-render when diagnostics map changes. */
export const useLSPWarningCount = () =>
  useLSPStore((state) => countBySeverity(state.diagnostics, 2));

/** Reactive informational count — includes info, hints, and unspecified severities. */
export const useLSPInfoCount = () =>
  useLSPStore((state) =>
    countByPredicate(state.diagnostics, (d) => d.severity !== 1 && d.severity !== 2)
  );

/** Reactive total count of diagnostics shown in the Problems panel. */
export const useLSPDiagnosticCount = () =>
  useLSPStore((state) => countByPredicate(state.diagnostics, () => true));

/** Diagnostics for a specific URI. Returns empty array if none. */
export const useDiagnosticsForURI = (uri: string | null) =>
  useLSPStore((state) => (uri ? (state.diagnostics.get(uri) ?? []) : []));

export interface GroupedDiagnostic {
  filePath: string;
  uri: string;
  diagnostics: LSPDiagnostic[];
}

/** Compute grouped diagnostics from a diagnostics Map. Pure function for use in selectors. */
export function computeGroupedDiagnostics(
  diagnostics: Map<string, LSPDiagnostic[]>
): GroupedDiagnostic[] {
  const groups: GroupedDiagnostic[] = [];
  for (const [uri, diags] of diagnostics) {
    if (diags.length === 0) continue;
    const filePath = fileURIToPath(uri) ?? uri;
    groups.push({ filePath, uri, diagnostics: diags });
  }

  // Sort groups: files with errors first, then by path
  groups.sort((a, b) => {
    const aHasError = a.diagnostics.some((d) => d.severity === 1);
    const bHasError = b.diagnostics.some((d) => d.severity === 1);
    if (aHasError !== bHasError) return aHasError ? -1 : 1;
    return a.filePath.localeCompare(b.filePath);
  });

  // Sort diagnostics within each group
  for (const group of groups) {
    group.diagnostics = [...group.diagnostics].sort((a, b) => {
      if ((a.severity ?? 4) !== (b.severity ?? 4)) return (a.severity ?? 4) - (b.severity ?? 4);
      if (a.range.start.line !== b.range.start.line) return a.range.start.line - b.range.start.line;
      return a.range.start.character - b.range.start.character;
    });
  }

  return groups;
}

/** Reactive hook: all diagnostics grouped by file. Uses the diagnostics map reference for subscription. */
export function useGroupedDiagnostics(): GroupedDiagnostic[] {
  const diagnostics = useLSPStore((state) => state.diagnostics);
  return computeGroupedDiagnostics(diagnostics);
}
