// src/components/FileExplorer/FileExplorer.tsx
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
import { Panel, PanelAction } from '../layout';
import { MinusIcon } from '../icons';
import {
  useIDEStore,
  useExpandedPaths,
  useSelectedPath,
  useIsRootExpanded,
  useIsLoadingTree,
  useTreeError,
  useActiveFileId,
  useWorkspace,
} from '../../stores/ideStore';
import { useDirectoryTree as useFetchDirectoryTree } from './useDirectoryTree';
import { useFileTreePresentation } from '../../hooks/useFileTreePresentation';
import { useOpenFolder } from '../../hooks/useOpenFolder';
import { TreeRow, ROW_HEIGHT, rowDomId } from './TreeRow';
import { TreeViewToggle } from './TreeViewToggle';
import { WorkspaceTabs } from './WorkspaceTabs';
import { flattenVisibleTree } from '../../utils/flattenTree';
import type { FlatRow } from '../../utils/flattenTree';
import { useTreeKeyboardNav } from './useTreeKeyboardNav';
import { ensureEditorFileOpen } from '../../utils/editorNavigation';
import styles from './FileExplorer.module.css';

export function FileExplorer() {
  const workspace = useWorkspace();
  const expandedPaths = useExpandedPaths();
  const selectedPath = useSelectedPath();
  const isRootExpanded = useIsRootExpanded();
  const isLoadingTree = useIsLoadingTree();
  const treeError = useTreeError();
  const activeFileId = useActiveFileId();

  const presentation = useFileTreePresentation();
  const { mode, rootLabel, rootPath, roots, scopedError, getRegionAccent, treeAccent } =
    presentation;

  const toggleExpanded = useIDEStore((state) => state.toggleExpanded);
  const toggleRootExpanded = useIDEStore((state) => state.toggleRootExpanded);
  const setSelectedPath = useIDEStore((state) => state.setSelectedPath);
  const toggleLeftPanel = useIDEStore((state) => state.toggleLeftPanel);

  // Sync active editor file into the tree selection + auto-expand its ancestors.
  // Reads expandedPaths from the store snapshot to avoid a dependency cycle.
  useEffect(() => {
    if (activeFileId && activeFileId !== useIDEStore.getState().selectedPath) {
      setSelectedPath(activeFileId);

      const ws = useIDEStore.getState().workspace;
      if (ws) {
        const currentExpanded = useIDEStore.getState().expandedPaths;
        const relativePath = activeFileId.replace(ws.path + '/', '');
        const parts = relativePath.split('/');
        let currentPath = ws.path;

        const newExpanded = new Set(currentExpanded);
        for (let i = 0; i < parts.length - 1; i++) {
          currentPath += '/' + parts[i];
          newExpanded.add(currentPath);
        }
        if (newExpanded.size !== currentExpanded.size) {
          useIDEStore.setState({ expandedPaths: newExpanded });
        }
      }
    }
  }, [activeFileId, setSelectedPath]);

  const { openFolder } = useOpenFolder();
  const { refetch } = useFetchDirectoryTree();

  const rows = useMemo<FlatRow[]>(
    () =>
      flattenVisibleTree({
        roots,
        expandedPaths,
        selectedPath,
        getRegionAccent,
        isRootExpanded,
        rootLabel,
        rootPath,
      }),
    [roots, expandedPaths, selectedPath, getRegionAccent, isRootExpanded, rootLabel, rootPath]
  );

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const virtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => ROW_HEIGHT,
    overscan: 12,
  });

  // Primitive handlers — single source of truth; used by both TreeRow and actions.
  const handleToggle = useCallback(
    (kind: 'root' | 'entry', path?: string) =>
      kind === 'root' ? toggleRootExpanded() : path && toggleExpanded(path),
    [toggleRootExpanded, toggleExpanded]
  );
  const handleSelect = useCallback((path: string) => setSelectedPath(path), [setSelectedPath]);
  const handleOpen = useCallback((path: string) => void ensureEditorFileOpen(path), []);
  const handleHidePanel = useCallback(() => toggleLeftPanel(), [toggleLeftPanel]);

  // Keyboard-nav action adapters — thin wrappers over the primitive handlers above.
  const actions = useMemo(
    () => ({
      toggle: (row: FlatRow) => handleToggle(row.kind, row.entry?.path),
      select: (row: FlatRow) => {
        if (row.entry) handleSelect(row.entry.path);
      },
      open: (row: FlatRow) => {
        if (row.entry && !row.entry.isDir) handleOpen(row.entry.path);
      },
    }),
    [handleToggle, handleSelect, handleOpen]
  );

  const { activeKey, setActiveKey, activeId, onKeyDown } = useTreeKeyboardNav({
    rows,
    actions,
    virtualizer,
  });

  // Active-file reveal: once ancestors are expanded and rows recomputed, scroll
  // the selected row into view and mark it the keyboard-active descendant.
  // lastRevealed guards against re-running when expandedPaths changes (which
  // rebuilds `rows`) but selectedPath has not changed.
  const lastRevealed = useRef<string | null>(null);
  useEffect(() => {
    if (!selectedPath || selectedPath === lastRevealed.current) return;
    const idx = rows.findIndex((r) => r.kind === 'entry' && r.entry!.path === selectedPath);
    if (idx >= 0) {
      lastRevealed.current = selectedPath;
      setActiveKey(rows[idx].key);
      virtualizer.scrollToIndex(idx, { align: 'auto' });
    }
  }, [selectedPath, rows, virtualizer, setActiveKey]);

  const renderContent = () => {
    if (isLoadingTree) return <FileExplorerSkeleton />;
    if (treeError) return <FileExplorerError message={treeError} onRetry={refetch} />;
    if (!workspace) {
      return <FileExplorerEmpty message="Open a folder to get started" onOpenFolder={openFolder} />;
    }
    if (scopedError) {
      return (
        <div className={styles.scopedError} role="status">
          <p>Workspace folder not found</p>
        </div>
      );
    }
    if (roots.length === 0) {
      return <FileExplorerEmpty message="No files in workspace" onOpenFolder={openFolder} />;
    }

    const virtualItems = virtualizer.getVirtualItems();

    return (
      <div
        ref={scrollRef}
        className={styles.scrollArea}
        role="tree"
        aria-label="File explorer"
        aria-activedescendant={activeId}
        tabIndex={0}
        onKeyDown={onKeyDown}
        style={
          treeAccent
            ? { boxShadow: `inset 3px 0 0 var(--accent-${treeAccent})`, minHeight: '100%' }
            : undefined
        }
      >
        <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
          {virtualItems.map((vi) => {
            const row = rows[vi.index];
            return (
              <div
                key={row.key}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  height: `${ROW_HEIGHT}px`,
                  transform: `translateY(${vi.start}px)`,
                }}
              >
                <TreeRow
                  kind={row.kind}
                  path={row.entry?.path}
                  name={row.name}
                  depth={row.depth}
                  level={row.level}
                  isDir={row.isDir}
                  isExpanded={row.isExpanded}
                  isSelected={row.isSelected}
                  regionAccent={row.regionAccent}
                  setSize={row.setSize}
                  posInSet={row.posInSet}
                  rootPath={row.rootPath}
                  rowId={rowDomId(row.key)}
                  isActive={row.key === activeKey}
                  onToggle={handleToggle}
                  onSelect={handleSelect}
                  onOpen={handleOpen}
                />
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <Panel
      title={<TreeViewToggle />}
      actions={
        <PanelAction
          icon={<MinusIcon />}
          title="Hide Panel"
          ariaLabel="Hide Panel"
          onClick={handleHidePanel}
        />
      }
    >
      {mode === 'workspace' && <WorkspaceTabs />}
      <div className={styles.tree}>{renderContent()}</div>
    </Panel>
  );
}

const SKELETON_WIDTHS = [75, 60, 85, 70, 90];

function FileExplorerSkeleton() {
  return (
    <div className={styles.skeleton} role="status" aria-busy="true" aria-label="Loading file tree">
      {SKELETON_WIDTHS.map((width, i) => (
        <div key={i} className={styles.skeletonItem} style={{ width: `${width}%` }} />
      ))}
    </div>
  );
}

interface FileExplorerEmptyProps {
  message: string;
  onOpenFolder?: () => void;
}

function FileExplorerEmpty({ message, onOpenFolder }: FileExplorerEmptyProps) {
  return (
    <div className={styles.empty}>
      <p>{message}</p>
      <button type="button" className={styles.openButton} onClick={onOpenFolder}>
        Open Folder
      </button>
    </div>
  );
}

interface FileExplorerErrorProps {
  message: string;
  onRetry: () => void;
}

function FileExplorerError({ message, onRetry }: FileExplorerErrorProps) {
  return (
    <div className={styles.error}>
      <p>{message}</p>
      <button type="button" className={styles.retryButton} onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}
