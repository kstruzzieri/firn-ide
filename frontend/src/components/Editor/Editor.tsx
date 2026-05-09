/**
 * Editor Component
 *
 * The main editor panel with tab bar and CodeMirror integration.
 * Manages open files, tab switching, and editor state.
 */

import { useCallback, useEffect } from 'react';
import styles from './Editor.module.css';
import {
  useOpenFiles,
  useActiveFile,
  useIDEStore,
  useRecentWorkspaces,
  useWorkspace,
} from '../../stores/ideStore';
import { FileIcon } from '../FileExplorer/FileIcon';
import { FolderOutlineIcon } from '../icons';
import { formatShortcut, isMac } from '../../utils/platform';
import { openWorkspaceByPath, shortenPath } from '../../utils/workspace';
import { CodeMirrorEditor } from './CodeMirrorEditor';
import { getLanguageName } from './codemirror';
import firnLogo from '../../assets/branding/banner-transparent.svg';

export function Editor() {
  const openFiles = useOpenFiles();
  const activeFile = useActiveFile();
  const workspace = useWorkspace();
  const recentWorkspaces = useRecentWorkspaces();
  const setActiveFile = useIDEStore((state) => state.setActiveFile);
  const closeFile = useIDEStore((state) => state.closeFile);
  const updateFileContent = useIDEStore((state) => state.updateFileContent);
  const setCursorPosition = useIDEStore((state) => state.setCursorPosition);
  const setFileCursorPosition = useIDEStore((state) => state.setFileCursorPosition);
  const setScrollPosition = useIDEStore((state) => state.setScrollPosition);
  const scrollPositions = useIDEStore((state) => state.scrollPositions);
  const cursorPositions = useIDEStore((state) => state.cursorPositions);

  // Handle content changes from the editor
  const handleContentChange = useCallback(
    (fileId: string, content: string) => {
      updateFileContent(fileId, content);
    },
    [updateFileContent]
  );

  // Handle cursor position changes — updates both global (status bar) and per-file (persistence)
  const handleCursorChange = useCallback(
    (line: number, column: number) => {
      setCursorPosition({ line, column });
      if (activeFile) {
        setFileCursorPosition(activeFile.id, { line, column });
      }
    },
    [setCursorPosition, setFileCursorPosition, activeFile]
  );

  // Handle scroll position changes
  const handleScrollChange = useCallback(
    (scrollTop: number) => {
      if (activeFile) {
        setScrollPosition(activeFile.id, scrollTop);
      }
    },
    [activeFile, setScrollPosition]
  );

  // When no editor is mounted (welcome screen or empty workspace), suppress
  // the browser's native Cmd+F / Ctrl+F find dialog so users do not see a
  // browser chrome that cannot search workspace files. The CodeMirror search
  // panel handles Cmd+F itself when an editor is focused, so this listener is
  // only registered while there are no open files. Cmd+Shift+F is left
  // untouched because it is reserved for the project Search panel.
  const hasOpenFiles = openFiles.length > 0;
  useEffect(() => {
    if (hasOpenFiles) return undefined;

    const handleNoFileFind = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      if (event.shiftKey || event.altKey) return;

      const key = event.key.toLowerCase();
      if (key !== 'f') return;

      const usesPlatformModifier = isMac() ? event.metaKey : event.ctrlKey;
      if (!usesPlatformModifier) return;

      // Suppress only the native find UI; do not navigate or mutate anything.
      event.preventDefault();
    };

    window.addEventListener('keydown', handleNoFileFind);
    return () => window.removeEventListener('keydown', handleNoFileFind);
  }, [hasOpenFiles]);

  // Welcome screen when no files are open
  if (openFiles.length === 0) {
    // Filter out the currently open workspace from recent list
    const recentProjects = recentWorkspaces.filter((w) => w.path !== workspace?.path);

    return (
      <div className={styles.editor}>
        <div className={styles.welcome}>
          <img src={firnLogo} alt="Firn IDE" className={styles.welcomeLogo} />
          <div className={styles.shortcuts}>
            <div className={styles.shortcutItem}>
              <span className={styles.shortcutLabel}>Open File</span>
              <kbd>{formatShortcut('\u2318O')}</kbd>
            </div>
            <div className={styles.shortcutItem}>
              <span className={styles.shortcutLabel}>Command Palette</span>
              <kbd>{formatShortcut('\u2318\u21e7P')}</kbd>
            </div>
            <div className={styles.shortcutItem}>
              <span className={styles.shortcutLabel}>Quick Search</span>
              <kbd>{formatShortcut('\u2318K')}</kbd>
            </div>
          </div>
          {recentProjects.length > 0 && (
            <div className={styles.recentProjects}>
              <h3 className={styles.recentTitle}>Recent Projects</h3>
              <ul className={styles.recentList}>
                {recentProjects.map((project) => (
                  <li key={project.path}>
                    <button
                      className={styles.recentItem}
                      onClick={() => openWorkspaceByPath(project.path)}
                      title={project.path}
                    >
                      <FolderOutlineIcon className={styles.recentIcon} aria-hidden="true" />
                      <div className={styles.recentItemText}>
                        <span className={styles.recentName}>{project.name}</span>
                        <span className={styles.recentPath}>{shortenPath(project.path)}</span>
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}
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
              onScrollChange={handleScrollChange}
              initialScrollTop={scrollPositions[activeFile.id]}
              initialCursorLine={cursorPositions[activeFile.id]?.line}
              initialCursorColumn={cursorPositions[activeFile.id]?.column}
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
