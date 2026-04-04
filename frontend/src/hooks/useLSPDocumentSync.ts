import { useEffect, useRef, useCallback } from 'react';
import { useIDEStore, type EditorFile } from '../stores/ideStore';
import { LSPDidOpen, LSPDidChange, LSPDidSave, LSPDidClose } from '../../wailsjs/go/main/App';
import { EventsOn } from '../../wailsjs/runtime/runtime';
import { lsp } from '../../wailsjs/go/models';
import { languageIdForFile } from '../utils/lspLanguageId';
import { filePathToURI } from '../utils/lspUri';

const DIDCHANGE_DEBOUNCE_MS = 150;

/**
 * useLSPDocumentSync wires the editor's document lifecycle to the backend LSP manager.
 *
 * Responsibilities:
 * - Send didOpen when a file is first opened (not on duplicate tab opens)
 * - Send debounced didChange (150ms) when file content changes
 * - Send didSave after autosave completes
 * - Send didClose when the last tab for a file is closed or workspace switches
 *
 * Document versions are tracked per-file and increment monotonically.
 * The frontend is the source of truth for version numbers.
 */
export function useLSPDocumentSync() {
  // Per-file document version. Monotonically increasing, never resets within a session.
  const versions = useRef(new Map<string, number>());
  // Set of file paths we've sent didOpen for (to avoid duplicate opens on workspace restore)
  const openedPaths = useRef(new Set<string>());
  // Debounce timers for didChange per file path
  const changeTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const nextVersion = useCallback((path: string): number => {
    const current = versions.current.get(path) ?? 0;
    const next = current + 1;
    versions.current.set(path, next);
    return next;
  }, []);

  // --- didOpen ---
  const sendDidOpen = useCallback(
    (file: EditorFile) => {
      const langId = languageIdForFile(file.name);
      if (!langId) return; // unsupported language — backend will no-op anyway

      if (openedPaths.current.has(file.path)) return; // already opened
      openedPaths.current.add(file.path);

      const version = nextVersion(file.path);
      LSPDidOpen(file.path, langId, version, file.content).catch((err) => {
        console.error(`LSP didOpen failed for ${file.path}:`, err);
        openedPaths.current.delete(file.path);
      });
    },
    [nextVersion]
  );

  // --- didChange (debounced) ---
  const sendDidChange = useCallback(
    (path: string, content: string) => {
      if (!openedPaths.current.has(path)) return;

      // Cancel pending debounce
      const existing = changeTimers.current.get(path);
      if (existing) clearTimeout(existing);

      const timer = setTimeout(() => {
        changeTimers.current.delete(path);
        const version = nextVersion(path);
        const change = new lsp.TextDocumentContentChangeEvent({ text: content });
        LSPDidChange(path, version, [change]).catch((err) => {
          console.error(`LSP didChange failed for ${path}:`, err);
        });
      }, DIDCHANGE_DEBOUNCE_MS);

      changeTimers.current.set(path, timer);
    },
    [nextVersion]
  );

  // Flush any pending debounced didChange for a file (called before didSave)
  const flushDidChange = useCallback(
    (path: string, content: string) => {
      const timer = changeTimers.current.get(path);
      if (timer) {
        clearTimeout(timer);
        changeTimers.current.delete(path);
        // Send the change immediately
        if (openedPaths.current.has(path)) {
          const version = nextVersion(path);
          const change = new lsp.TextDocumentContentChangeEvent({ text: content });
          LSPDidChange(path, version, [change]).catch((err) => {
            console.error(`LSP didChange flush failed for ${path}:`, err);
          });
        }
      }
    },
    [nextVersion]
  );

  // --- didSave ---
  const sendDidSave = useCallback(
    (path: string, content: string) => {
      if (!openedPaths.current.has(path)) return;
      // Flush any pending changes before save
      flushDidChange(path, content);
      LSPDidSave(path).catch((err) => {
        console.error(`LSP didSave failed for ${path}:`, err);
      });
    },
    [flushDidChange]
  );

  // --- didClose ---
  // lastContent: content to flush if there's a pending debounced didChange.
  // Caller must provide this because the file may already be removed from openFiles.
  const sendDidClose = useCallback(
    (path: string, lastContent?: string) => {
      if (!openedPaths.current.has(path)) return;
      openedPaths.current.delete(path);

      // Flush any pending debounced didChange so the server gets the final state
      const timer = changeTimers.current.get(path);
      if (timer) {
        clearTimeout(timer);
        changeTimers.current.delete(path);
        const content =
          lastContent ?? useIDEStore.getState().openFiles.find((f) => f.path === path)?.content;
        if (content !== undefined) {
          const version = nextVersion(path);
          const change = new lsp.TextDocumentContentChangeEvent({ text: content });
          LSPDidChange(path, version, [change]).catch((err) => {
            console.error(`LSP didChange flush-on-close failed for ${path}:`, err);
          });
        }
      }

      LSPDidClose(path).catch((err) => {
        console.error(`LSP didClose failed for ${path}:`, err);
      });
    },
    [nextVersion]
  );

  // Close all tracked documents (used during workspace switch)
  const closeAll = useCallback(() => {
    for (const path of openedPaths.current) {
      // Flush any pending debounced didChange before closing
      const timer = changeTimers.current.get(path);
      if (timer) {
        clearTimeout(timer);
        changeTimers.current.delete(path);
        const file = useIDEStore.getState().openFiles.find((f) => f.path === path);
        if (file) {
          const version = nextVersion(path);
          const change = new lsp.TextDocumentContentChangeEvent({ text: file.content });
          LSPDidChange(path, version, [change]).catch((err) => {
            console.error(`LSP didChange flush-on-close failed for ${path}:`, err);
          });
        }
      }
      LSPDidClose(path).catch((err) => {
        console.error(`LSP didClose failed for ${path}:`, err);
      });
    }
    openedPaths.current.clear();
  }, [nextVersion]);

  // --- Watch store for file lifecycle events (single subscription) ---
  useEffect(() => {
    let prevOpenFiles: EditorFile[] = useIDEStore.getState().openFiles;

    return useIDEStore.subscribe((state, prevState) => {
      const currentFiles = state.openFiles;

      // Detect newly opened files
      for (const file of currentFiles) {
        const wasOpen = prevOpenFiles.some((f) => f.id === file.id);
        if (!wasOpen) {
          sendDidOpen(file);
        }
      }

      // Detect closed files — pass last known content for flushing pending changes
      for (const prevFile of prevOpenFiles) {
        const stillOpen = currentFiles.some((f) => f.id === prevFile.id);
        if (!stillOpen) {
          sendDidClose(prevFile.path, prevFile.content);
        }
      }

      // Detect content changes and save completions (only for files that existed before)
      for (const file of currentFiles) {
        const prevFile = prevState.openFiles.find((f) => f.id === file.id);
        if (!prevFile) continue;

        // Content changed while modified = didChange
        if (file.content !== prevFile.content && file.isModified) {
          sendDidChange(file.path, file.content);
        }

        // isModified went true→false = save completed
        if (prevFile.isModified && !file.isModified) {
          sendDidSave(file.path, file.content);
        }
      }

      prevOpenFiles = currentFiles;
    });
  }, [sendDidOpen, sendDidClose, sendDidChange, sendDidSave]);

  // --- Watch for workspace switches ---
  useEffect(() => {
    let prevWorkspacePath = useIDEStore.getState().workspace?.path;

    return useIDEStore.subscribe((state) => {
      const currentPath = state.workspace?.path;
      if (currentPath !== prevWorkspacePath) {
        // Workspace changed — close all documents from the old workspace
        closeAll();
        prevWorkspacePath = currentPath;
      }
    });
  }, [closeAll]);

  // --- Listen for lsp:reconnect after server crash recovery ---
  useEffect(() => {
    const cancel = EventsOn('lsp:reconnect', (payload: { documents?: string[] }) => {
      const reconnectedURIs = payload?.documents;
      if (!reconnectedURIs || reconnectedURIs.length === 0) return;

      const reconnectSet = new Set(reconnectedURIs);

      // Re-send didOpen for all currently open files that match the reconnected paths
      const { openFiles } = useIDEStore.getState();
      for (const file of openFiles) {
        if (reconnectSet.has(filePathToURI(file.path))) {
          // Clear the stale guard first so the new server instance gets a fresh didOpen.
          openedPaths.current.delete(file.path);
          sendDidOpen(file);
        }
      }
    });

    return cancel;
  }, [sendDidOpen]);

  // Cleanup on unmount
  useEffect(() => {
    const timers = changeTimers.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  // All lifecycle events are driven by store subscriptions above.
  // No return value needed — this hook is fire-and-forget like useAutosave.
}
