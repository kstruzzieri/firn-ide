import { useEffect, useRef, useCallback } from 'react';
import { useIDEStore } from '../stores/ideStore';
import { WriteFile } from '../../wailsjs/go/main/App';
import { isMac } from '../utils/platform';

const AUTOSAVE_DELAY = 1500;

export function useAutosave() {
  const debounceTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const savingFiles = useRef(new Set<string>());

  // Save a single file by ID
  const saveFile = useCallback(async (fileId: string) => {
    if (savingFiles.current.has(fileId)) return;

    const file = useIDEStore.getState().openFiles.find((f) => f.id === fileId);
    if (!file || !file.isModified) return;

    savingFiles.current.add(fileId);

    try {
      await WriteFile(file.path, file.content, file.encoding, file.lineEndings, false);
      useIDEStore.getState().setFileModified(fileId, false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      useIDEStore.getState().showToast(`Failed to save ${file.name}: ${message}`, 'error');
    } finally {
      savingFiles.current.delete(fileId);
    }
  }, []);

  // Save all modified files
  const saveAllModified = useCallback(() => {
    const { openFiles } = useIDEStore.getState();
    openFiles.forEach((file) => {
      if (file.isModified) {
        saveFile(file.id);
      }
    });
  }, [saveFile]);

  // Schedule debounced save for a file
  const scheduleSave = useCallback(
    (fileId: string) => {
      const existing = debounceTimers.current.get(fileId);
      if (existing) clearTimeout(existing);

      const timer = setTimeout(() => {
        debounceTimers.current.delete(fileId);
        saveFile(fileId);
      }, AUTOSAVE_DELAY);

      debounceTimers.current.set(fileId, timer);
    },
    [saveFile]
  );

  // Watch for content changes (isModified transitions to true)
  useEffect(() => {
    return useIDEStore.subscribe((state, prevState) => {
      state.openFiles.forEach((file) => {
        const prevFile = prevState.openFiles.find((f) => f.id === file.id);
        if (file.isModified && (!prevFile || !prevFile.isModified)) {
          scheduleSave(file.id);
        }
      });
    });
  }, [scheduleSave]);

  // Save outgoing tab on tab switch
  useEffect(() => {
    let prevActiveFileId = useIDEStore.getState().activeFileId;

    return useIDEStore.subscribe((state) => {
      if (state.activeFileId !== prevActiveFileId) {
        if (prevActiveFileId) {
          const timer = debounceTimers.current.get(prevActiveFileId);
          if (timer) {
            clearTimeout(timer);
            debounceTimers.current.delete(prevActiveFileId);
          }
          saveFile(prevActiveFileId);
        }
        prevActiveFileId = state.activeFileId;
      }
    });
  }, [saveFile]);

  // Save on focus loss (visibility change + window blur)
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        saveAllModified();
      }
    };

    const handleBlur = () => {
      saveAllModified();
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('blur', handleBlur);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('blur', handleBlur);
    };
  }, [saveAllModified]);

  // Cmd+S / Ctrl+S handler
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const modifier = isMac() ? e.metaKey : e.ctrlKey;
      if (modifier && e.key === 's') {
        e.preventDefault();
        const { activeFileId } = useIDEStore.getState();
        if (activeFileId) {
          const timer = debounceTimers.current.get(activeFileId);
          if (timer) {
            clearTimeout(timer);
            debounceTimers.current.delete(activeFileId);
          }
          saveFile(activeFileId);
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [saveFile]);

  // Cleanup timers on unmount
  useEffect(() => {
    const timers = debounceTimers.current;
    return () => {
      timers.forEach((timer) => clearTimeout(timer));
      timers.clear();
    };
  }, []);
}
