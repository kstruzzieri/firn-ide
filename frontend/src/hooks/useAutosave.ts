import { useEffect, useRef, useCallback } from 'react';
import { useIDEStore, type EditorFile } from '../stores/ideStore';
import { isMac } from '../utils/platform';
import { writeFileSerialized } from '../utils/fileWrites';

const AUTOSAVE_DELAY = 1500;

export function useAutosave() {
  const debounceTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const savingFiles = useRef(new Set<string>());

  // Save a single file by ID
  const saveFile = useCallback(async (fileId: string) => {
    if (savingFiles.current.has(fileId)) return;

    let file = useIDEStore.getState().openFiles.find((f) => f.id === fileId);
    if (!file?.isModified) return;
    const fileName = file.name;

    savingFiles.current.add(fileId);

    try {
      while (file?.isModified) {
        const savedContent = file.content;
        await writeFileSerialized(file.path, savedContent, file.encoding, file.lineEndings, false);
        file = useIDEStore.getState().openFiles.find((f) => f.id === fileId);
        if (!file || file.content === savedContent) {
          if (file) useIDEStore.getState().setFileModified(fileId, false);
          return;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      useIDEStore.getState().showToast(`Failed to save ${fileName}: ${message}`, 'error');
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

  // Save a file directly from captured data (for files about to leave openFiles)
  const saveFileData = useCallback(async (file: EditorFile) => {
    if (!file.isModified) return;
    try {
      await writeFileSerialized(file.path, file.content, file.encoding, file.lineEndings, false);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      useIDEStore.getState().showToast(`Failed to save ${file.name}: ${message}`, 'error');
    }
  }, []);

  // Watch for content changes (isModified transitions to true)
  // Also save dirty files that are being closed (removed from openFiles)
  useEffect(() => {
    return useIDEStore.subscribe((state, prevState) => {
      // Schedule saves for newly modified files
      state.openFiles.forEach((file) => {
        const prevFile = prevState.openFiles.find((f) => f.id === file.id);
        if (file.isModified && (!prevFile || !prevFile.isModified)) {
          scheduleSave(file.id);
        }
      });

      // Save dirty files that just left openFiles (closed tab)
      for (const prevFile of prevState.openFiles) {
        const stillOpen = state.openFiles.some((f) => f.id === prevFile.id);
        if (!stillOpen && prevFile.isModified) {
          // Cancel any pending debounce timer — we'll save directly with captured content
          const timer = debounceTimers.current.get(prevFile.id);
          if (timer) {
            clearTimeout(timer);
            debounceTimers.current.delete(prevFile.id);
          }
          saveFileData(prevFile);
        }
      }
    });
  }, [scheduleSave, saveFileData]);

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
