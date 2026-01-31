/**
 * Editor Component
 *
 * The main editor panel with tab bar and CodeMirror integration.
 * Manages open files, tab switching, and editor state.
 */

import { useCallback } from 'react';
import styles from './Editor.module.css';
import { useOpenFiles, useActiveFile, useIDEStore } from '../../stores/ideStore';
import { FileIcon } from '../icons';
import { formatShortcut } from '../../utils/platform';
import { CodeMirrorEditor } from './CodeMirrorEditor';
import { getLanguageName } from './codemirror';

export function Editor() {
  const openFiles = useOpenFiles();
  const activeFile = useActiveFile();
  const setActiveFile = useIDEStore((state) => state.setActiveFile);
  const closeFile = useIDEStore((state) => state.closeFile);
  const setFileModified = useIDEStore((state) => state.setFileModified);
  const setCursorPosition = useIDEStore((state) => state.setCursorPosition);

  // Handle content changes from the editor
  const handleContentChange = useCallback(
    (fileId: string, _content: string) => {
      // Mark file as modified when content changes
      setFileModified(fileId, true);
    },
    [setFileModified]
  );

  // Handle cursor position changes
  const handleCursorChange = useCallback(
    (line: number, column: number) => {
      setCursorPosition({ line, column });
    },
    [setCursorPosition]
  );

  // Welcome screen when no files are open
  if (openFiles.length === 0) {
    return (
      <div className={styles.editor}>
        <div className={styles.welcome}>
          <div className={styles.welcomeLogo}>
            <FluxWelcomeLogo />
          </div>
          <h1>Welcome to Flux</h1>
          <p>A lightweight, workspace-focused IDE</p>
          <div className={styles.shortcuts}>
            <div className={styles.shortcutItem}>
              <span className={styles.shortcutLabel}>Open File</span>
              <kbd>{formatShortcut('⌘O')}</kbd>
            </div>
            <div className={styles.shortcutItem}>
              <span className={styles.shortcutLabel}>Command Palette</span>
              <kbd>{formatShortcut('⌘⇧P')}</kbd>
            </div>
            <div className={styles.shortcutItem}>
              <span className={styles.shortcutLabel}>Quick Search</span>
              <kbd>{formatShortcut('⌘K')}</kbd>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.editor}>
      {/* Tab bar */}
      <div className={styles.tabBar} role="tablist" aria-label="Open files">
        {openFiles.map((file) => {
          const isActive = file.id === activeFile?.id;
          const languageName = getLanguageName(file.name);

          return (
            <button
              key={file.id}
              id={`tab-${file.id}`}
              className={`${styles.tab} ${isActive ? styles.active : ''}`}
              role="tab"
              aria-selected={isActive}
              aria-controls={`panel-${file.id}`}
              title={`${file.path}\n${languageName}`}
              onClick={() => setActiveFile(file.id)}
            >
              <FileIcon className={styles.tabIcon} aria-hidden="true" />
              <span className={styles.tabName}>{file.name}</span>
              {file.isModified && (
                <span className={styles.tabDot} aria-label="Modified" />
              )}
              <button
                className={styles.tabClose}
                onClick={(e) => {
                  e.stopPropagation();
                  closeFile(file.id);
                }}
                aria-label={`Close ${file.name}`}
                type="button"
              >
                <CloseIcon />
              </button>
            </button>
          );
        })}
      </div>

      {/* Editor content */}
      <div
        id={activeFile ? `panel-${activeFile.id}` : undefined}
        className={styles.content}
        role="tabpanel"
        tabIndex={0}
        aria-labelledby={activeFile ? `tab-${activeFile.id}` : undefined}
      >
        {activeFile && (
          <div className={styles.editorContent}>
            <CodeMirrorEditor
              fileId={activeFile.id}
              filename={activeFile.name}
              content={activeFile.content || ''}
              onContentChange={handleContentChange}
              onCursorChange={handleCursorChange}
            />
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Close icon for tab close buttons.
 */
function CloseIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}

/**
 * Flux logo for the welcome screen.
 */
function FluxWelcomeLogo() {
  return (
    <svg
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect width="48" height="48" rx="12" fill="url(#flux-gradient)" />
      <path
        d="M14 16h20M14 24h14M14 32h8"
        stroke="white"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <defs>
        <linearGradient
          id="flux-gradient"
          x1="0"
          y1="0"
          x2="48"
          y2="48"
          gradientUnits="userSpaceOnUse"
        >
          <stop stopColor="var(--accent)" />
          <stop offset="1" stopColor="var(--accent-dark)" />
        </linearGradient>
      </defs>
    </svg>
  );
}
