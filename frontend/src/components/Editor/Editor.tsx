/**
 * Editor Component
 *
 * The main editor panel with tab bar and CodeMirror integration.
 * Manages open files, tab switching, and editor state.
 */

import { useCallback } from 'react';
import styles from './Editor.module.css';
import { useOpenFiles, useActiveFile, useIDEStore } from '../../stores/ideStore';
import { FileIcon } from '../FileExplorer/FileIcon';
import { formatShortcut } from '../../utils/platform';
import { CodeMirrorEditor } from './CodeMirrorEditor';
import { getLanguageName } from './codemirror';
import firnLogo from '../../assets/branding/banner-transparent.svg';

export function Editor() {
  const openFiles = useOpenFiles();
  const activeFile = useActiveFile();
  const setActiveFile = useIDEStore((state) => state.setActiveFile);
  const closeFile = useIDEStore((state) => state.closeFile);
  const updateFileContent = useIDEStore((state) => state.updateFileContent);
  const setCursorPosition = useIDEStore((state) => state.setCursorPosition);

  // Handle content changes from the editor
  const handleContentChange = useCallback(
    (fileId: string, content: string) => {
      updateFileContent(fileId, content);
    },
    [updateFileContent]
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
          <img src={firnLogo} alt="Firn IDE" className={styles.welcomeLogo} />
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
              <FileIcon name={file.name} isDir={false} className={styles.tabIcon} />
              <span className={styles.tabName}>{file.name}</span>
              {file.isModified && <span className={styles.tabDot} aria-label="Modified" />}
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
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  );
}
