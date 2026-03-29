import { useEffect, useRef, useCallback } from 'react';
import { useIDEStore, type EditorFile } from '../stores/ideStore';
import { LSPDidOpen, LSPDidChange, LSPDidSave, LSPDidClose } from '../../wailsjs/go/main/App';
import { lsp } from '../../wailsjs/go/models';
import { languageIdForFile } from '../utils/lspLanguageId';

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

  const getVersion = useCallback((path: string): number => {
    return versions.current.get(path) ?? 0;
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
  const sendDidClose = useCallback((path: string) => {
    if (!openedPaths.current.has(path)) return;
    openedPaths.current.delete(path);

    // Cancel any pending debounce
    const timer = changeTimers.current.get(path);
    if (timer) {
      clearTimeout(timer);
      changeTimers.current.delete(path);
    }

    LSPDidClose(path).catch((err) => {
      console.error(`LSP didClose failed for ${path}:`, err);
    });
  }, []);

  // Close all tracked documents (used during workspace switch)
  const closeAll = useCallback(() => {
    for (const path of openedPaths.current) {
      const timer = changeTimers.current.get(path);
      if (timer) {
        clearTimeout(timer);
        changeTimers.current.delete(path);
      }
      LSPDidClose(path).catch((err) => {
        console.error(`LSP didClose failed for ${path}:`, err);
      });
    }
    openedPaths.current.clear();
  }, []);

  // --- Watch store for file opens ---
  useEffect(() => {
    let prevOpenFiles: EditorFile[] = useIDEStore.getState().openFiles;

    return useIDEStore.subscribe((state) => {
      const currentFiles = state.openFiles;

      // Detect newly opened files
      for (const file of currentFiles) {
        const wasOpen = prevOpenFiles.some((f) => f.id === file.id);
        if (!wasOpen) {
          sendDidOpen(file);
        }
      }

      // Detect closed files
      for (const prevFile of prevOpenFiles) {
        const stillOpen = currentFiles.some((f) => f.id === prevFile.id);
        if (!stillOpen) {
          sendDidClose(prevFile.path);
        }
      }

      prevOpenFiles = currentFiles;
    });
  }, [sendDidOpen, sendDidClose]);

  // --- Watch store for content changes ---
  useEffect(() => {
    return useIDEStore.subscribe((state, prevState) => {
      for (const file of state.openFiles) {
        const prevFile = prevState.openFiles.find((f) => f.id === file.id);
        if (prevFile && file.content !== prevFile.content && file.isModified) {
          sendDidChange(file.path, file.content);
        }
      }
    });
  }, [sendDidChange]);

  // --- Watch store for save completions ---
  useEffect(() => {
    return useIDEStore.subscribe((state, prevState) => {
      for (const file of state.openFiles) {
        const prevFile = prevState.openFiles.find((f) => f.id === file.id);
        // Detect isModified transition from true to false = save completed
        if (prevFile && prevFile.isModified && !file.isModified) {
          sendDidSave(file.path, file.content);
        }
      }
    });
  }, [sendDidSave]);

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

  // Cleanup on unmount
  useEffect(() => {
    const timers = changeTimers.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);

  return { sendDidOpen, sendDidChange, sendDidSave, sendDidClose, flushDidChange, getVersion };
}
