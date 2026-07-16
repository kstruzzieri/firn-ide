/**
 * Editor Component
 *
 * The main editor panel with tab bar and CodeMirror integration.
 * Manages open files, tab switching, and editor state.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  type CSSProperties,
  type KeyboardEvent as ReactKeyboardEvent,
} from 'react';
import styles from './Editor.module.css';
import {
  useOpenFiles,
  useActiveFile,
  useIDEStore,
  useRecentWorkspaces,
  useWorkspace,
  useWorkspaces,
} from '../../stores/ideStore';
import { FileIcon } from '../FileExplorer/FileIcon';
import { FolderOutlineIcon, GitBranchIcon } from '../icons';
import { formatShortcut, isMac } from '../../utils/platform';
import { openWorkspaceByPath, shortenPath } from '../../utils/workspace';
import { CodeMirrorEditor } from './CodeMirrorEditor';
import { GitDiffView } from './GitDiffView';
import { useGitStore } from '../../stores/gitStore';
import { useGitBaseline } from '../../hooks/useGitBaseline';
import { getLanguageName } from './codemirror';
import { createWorkspacePathResolver } from '../../utils/workspaceRegions';
import { accentVar } from '../../utils/accent';
import type { workspace as workspaceModels } from '../../../wailsjs/go/models';
import firnLogo from '../../assets/branding/banner-transparent.svg';

export function Editor() {
  const openFiles = useOpenFiles();
  const activeFile = useActiveFile();
  const workspace = useWorkspace();
  const workspaces = useWorkspaces();
  const recentWorkspaces = useRecentWorkspaces();
  const resolveWorkspace = useMemo(
    () => createWorkspacePathResolver(workspace?.path ?? '', workspaces),
    [workspace?.path, workspaces]
  );
  const diffSession = useGitStore((state) => state.diffSession);
  const diffFocused = useGitStore((state) => state.diffFocused);
  const gitBaseline = useGitBaseline(activeFile?.path);
  const setActiveFile = useIDEStore((state) => state.setActiveFile);
  const closeFile = useIDEStore((state) => state.closeFile);
  const updateFileContent = useIDEStore((state) => state.updateFileContent);
  const setCursorPosition = useIDEStore((state) => state.setCursorPosition);
  const setFileCursorPosition = useIDEStore((state) => state.setFileCursorPosition);
  const setScrollPosition = useIDEStore((state) => state.setScrollPosition);
  const scrollPositions = useIDEStore((state) => state.scrollPositions);
  const cursorPositions = useIDEStore((state) => state.cursorPositions);
  const editorRef = useRef<HTMLDivElement>(null);
  const restoreFocusAfterCloseRef = useRef(false);

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

  // Opening or switching to a real file supersedes the diff preview: the diff
  // is a transient tab, so yield focus to the file the user just opened
  // (e.g. a double-click in the file tree). Only react to an actual change of
  // the active file, not the initial mount, so a diff opened while a file
  // happens to be active isn't immediately dismissed. Opening a diff never
  // changes the active file id, so this doesn't fight the diff on open.
  const activeFileId = activeFile?.id;
  const prevActiveFileIdRef = useRef(activeFileId);
  useEffect(() => {
    if (prevActiveFileIdRef.current === activeFileId) return;
    prevActiveFileIdRef.current = activeFileId;
    if (activeFileId) useGitStore.getState().setDiffFocused(false);
  }, [activeFileId]);

  // Show the diff when it's focused, or when there's simply no file to show
  // instead (e.g. the file opened from a diff was closed, leaving only the
  // diff tab) — otherwise the panel would render blank.
  const showDiff = !!diffSession && (diffFocused || !activeFile);
  const diffOwner = diffSession ? resolveWorkspace(diffSession.absPath) : null;

  useEffect(() => {
    if (!restoreFocusAfterCloseRef.current) return undefined;

    // Closing an active file can also update diff focus in a following effect.
    // Wait for that state to settle, then focus the final selected tab or the
    // main landmark when the tablist became empty.
    const timeout = window.setTimeout(() => {
      restoreFocusAfterCloseRef.current = false;
      const selectedTab = editorRef.current?.querySelector<HTMLElement>(
        '[role="tab"][aria-selected="true"]'
      );
      const fallback = document.getElementById('main-content') ?? editorRef.current;
      (selectedTab ?? fallback)?.focus();
    }, 0);

    return () => window.clearTimeout(timeout);
  }, [activeFileId, diffFocused, diffSession, openFiles]);

  // Re-fetch the diff each time it becomes visible so it reflects edits made in
  // the editor while it was in the background (the working-tree side re-reads
  // the live buffer).
  const prevShowDiffRef = useRef(showDiff);
  useEffect(() => {
    if (showDiff && !prevShowDiffRef.current) {
      void useGitStore.getState().refreshOpenDiff();
    }
    prevShowDiffRef.current = showDiff;
  }, [showDiff]);

  // Welcome screen when no files are open (and no diff preview tab)
  if (openFiles.length === 0 && !diffSession) {
    // Filter out the currently open workspace from recent list
    const recentProjects = recentWorkspaces.filter((w) => w.path !== workspace?.path);

    return (
      <div ref={editorRef} className={styles.editor} tabIndex={-1}>
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
                      type="button"
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
    <div ref={editorRef} className={styles.editor} tabIndex={-1}>
      {/* Tab bar */}
      <div className={styles.tabBar} role="tablist" aria-label="Open files">
        {openFiles.map((file) => {
          // A focused diff tab owns the active state, so the file tab it was
          // opened from doesn't also read as active.
          const isActive = file.id === activeFile?.id && !showDiff;
          const languageName = getLanguageName(file.name);
          const owner = resolveWorkspace(file.path);

          const activateFileTab = () => {
            useGitStore.getState().setDiffFocused(false);
            setActiveFile(file.id);
          };

          return (
            <div
              key={file.id}
              className={`${styles.tab} ${owner ? styles.workspaceTab : ''} ${isActive ? styles.active : ''}`}
              style={tabAccentStyle(owner)}
              title={`${file.path}\n${languageName}`}
              onClick={activateFileTab}
            >
              <div
                id={editorTabId(file.id)}
                className={styles.tabTarget}
                role="tab"
                tabIndex={isActive ? 0 : -1}
                aria-selected={isActive}
                aria-controls="editor-tabpanel"
                onKeyDown={(event) => handleTabKeyDown(event, activateFileTab)}
              >
                <FileIcon name={file.name} isDir={false} className={styles.tabIcon} />
                <span className={styles.tabName}>{file.name}</span>
                {file.isModified && (
                  <span className={styles.tabDot} role="img" aria-label="Modified" />
                )}
              </div>
              <button
                className={styles.tabClose}
                onClick={(e) => {
                  e.stopPropagation();
                  restoreFocusAfterCloseRef.current = true;
                  closeFile(file.id);
                }}
                aria-label={`Close ${file.name}`}
                type="button"
              >
                <CloseIcon />
              </button>
            </div>
          );
        })}
        {diffSession && (
          <div
            className={`${styles.tab} ${diffOwner ? styles.workspaceTab : ''} ${showDiff ? styles.active : ''}`}
            style={tabAccentStyle(diffOwner)}
            title={`${diffSession.path}\n${diffSession.left.label} ↔ ${diffSession.right.label}`}
            onClick={() => useGitStore.getState().setDiffFocused(true)}
          >
            <div
              id="tab-git-diff"
              className={styles.tabTarget}
              role="tab"
              tabIndex={showDiff ? 0 : -1}
              aria-selected={showDiff}
              aria-controls="editor-tabpanel"
              onKeyDown={(event) =>
                handleTabKeyDown(event, () => useGitStore.getState().setDiffFocused(true))
              }
            >
              <GitBranchIcon className={styles.tabIcon} aria-hidden="true" />
              <span className={styles.tabName}>{diffTabName(diffSession.path)} (diff)</span>
            </div>
            <button
              className={styles.tabClose}
              onClick={(e) => {
                e.stopPropagation();
                restoreFocusAfterCloseRef.current = true;
                useGitStore.getState().closeDiff();
              }}
              aria-label="Close diff"
              type="button"
            >
              <CloseIcon />
            </button>
          </div>
        )}
      </div>

      {/* Editor content */}
      <div
        id="editor-tabpanel"
        className={styles.content}
        role="tabpanel"
        tabIndex={0}
        aria-labelledby={
          showDiff ? 'tab-git-diff' : activeFile ? editorTabId(activeFile.id) : undefined
        }
      >
        {/* Both surfaces stay mounted and are toggled with CSS so switching
            between a file and its diff preserves scroll position (no rebuild):
            the diff keeps its merge-view scroll, and the editor doesn't jump
            back to the top and re-restore its scroll on every return. */}
        {diffSession && (
          <div className={styles.pane} style={{ display: showDiff ? undefined : 'none' }}>
            <GitDiffView session={diffSession} visible={showDiff} />
          </div>
        )}
        {activeFile && (
          <div className={styles.editorContent} style={{ display: showDiff ? 'none' : undefined }}>
            <CodeMirrorEditor
              fileId={activeFile.id}
              filename={activeFile.name}
              content={activeFile.content || ''}
              openFileIds={openFiles.map((f) => f.id)}
              gitBaseline={gitBaseline}
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

function editorTabId(fileId: string): string {
  return `tab-file-${encodeURIComponent(fileId)}`;
}

/** Inline style carrying a tab's owning-workspace accent token, if any. */
function tabAccentStyle(owner: workspaceModels.WorkspaceDef | null): CSSProperties | undefined {
  if (!owner) return undefined;
  return { ['--tab-accent' as string]: accentVar(owner.accent) } as CSSProperties;
}

/** Tab label for the diff preview: filename only, path lives in the tooltip. */
function diffTabName(path: string): string {
  const idx = path.lastIndexOf('/');
  return idx === -1 ? path : path.slice(idx + 1);
}

function handleTabKeyDown(event: ReactKeyboardEvent<HTMLDivElement>, action: () => void) {
  if (event.currentTarget !== event.target) return;

  const tabs = Array.from(
    event.currentTarget
      .closest('[role="tablist"]')
      ?.querySelectorAll<HTMLElement>('[role="tab"]') ?? []
  );
  const index = tabs.indexOf(event.currentTarget);
  let next: number | null = null;

  switch (event.key) {
    case 'ArrowRight':
      next = index < tabs.length - 1 ? index + 1 : 0;
      break;
    case 'ArrowLeft':
      next = index > 0 ? index - 1 : tabs.length - 1;
      break;
    case 'Home':
      next = 0;
      break;
    case 'End':
      next = tabs.length - 1;
      break;
    case 'Enter':
    case ' ':
      event.preventDefault();
      action();
      return;
  }

  if (next !== null) {
    event.preventDefault();
    tabs[next]?.focus();
  }
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
