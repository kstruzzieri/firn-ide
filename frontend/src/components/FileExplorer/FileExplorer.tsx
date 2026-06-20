import { useCallback, useEffect } from 'react';
import { Panel, PanelAction } from '../layout';
import { ChevronDownIcon, ChevronRightIcon, MinusIcon, FolderOpenIcon, FolderIcon } from '../icons';
import {
  useIDEStore,
  useExpandedPaths,
  useSelectedPath,
  useIsRootExpanded,
} from '../../stores/ideStore';
import {
  useIsLoadingTree,
  useTreeError,
  useActiveFileId,
  useWorkspace,
} from '../../stores/ideStore';
import { useDirectoryTree as useFetchDirectoryTree } from './useDirectoryTree';
import { useFileTreePresentation } from '../../hooks/useFileTreePresentation';
import { useOpenFolder } from '../../hooks/useOpenFolder';
import { TreeNode } from './TreeNode';
import { TreeViewToggle } from './TreeViewToggle';
import { WorkspaceTabs } from './WorkspaceTabs';
import type { filesystem } from '../../../wailsjs/go/models';
import { ensureEditorFileOpen } from '../../utils/editorNavigation';
import styles from './FileExplorer.module.css';
import treeStyles from './TreeNode.module.css';

/** Shortens a file path by replacing home directory with ~ */
function shortenPath(path: string): string {
  const home = '/Users/';
  if (path.startsWith(home)) {
    const afterHome = path.slice(home.length);
    const slashIndex = afterHome.indexOf('/');
    if (slashIndex !== -1) {
      return '~' + afterHome.slice(slashIndex);
    }
  }
  return path;
}

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

  // Sync active file in editor to file tree selection. Reads expandedPaths from
  // the store snapshot to avoid a dependency cycle (Set refs change each update).
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

  const handleToggle = useCallback((path: string) => toggleExpanded(path), [toggleExpanded]);
  const handleSelect = useCallback(
    (entry: filesystem.FileEntry) => setSelectedPath(entry.path),
    [setSelectedPath]
  );
  const handleOpen = useCallback(async (entry: filesystem.FileEntry) => {
    if (entry.isDir) return;
    await ensureEditorFileOpen(entry.path);
  }, []);
  const handleHidePanel = useCallback(() => toggleLeftPanel(), [toggleLeftPanel]);

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

    const FolderIconComponent = isRootExpanded ? FolderOpenIcon : FolderIcon;
    const ChevronIcon = isRootExpanded ? ChevronDownIcon : ChevronRightIcon;

    return (
      <div role="tree" aria-label="File explorer">
        <div
          className={`${treeStyles.row} ${treeStyles.root}`}
          onClick={toggleRootExpanded}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              toggleRootExpanded();
            }
          }}
          role="treeitem"
          aria-expanded={isRootExpanded}
          tabIndex={0}
        >
          <button
            type="button"
            className={treeStyles.toggle}
            onClick={(e) => {
              e.stopPropagation();
              toggleRootExpanded();
            }}
            aria-label={`Toggle ${rootLabel}`}
          >
            <ChevronIcon aria-hidden="true" />
          </button>
          <FolderIconComponent
            className={treeStyles.icon}
            style={{ color: isRootExpanded ? '#6A9AB0' : '#4A7080' }}
            aria-hidden="true"
          />
          <span className={treeStyles.name}>{rootLabel}</span>
          <span className={treeStyles.path}>{shortenPath(rootPath)}</span>
        </div>

        {isRootExpanded && (
          <div role="group">
            {roots.map((entry) => (
              <TreeNode
                key={entry.path}
                entry={entry}
                depth={1}
                isExpanded={expandedPaths.has(entry.path)}
                expandedPaths={expandedPaths}
                selectedPath={selectedPath}
                onToggle={handleToggle}
                onSelect={handleSelect}
                onOpen={handleOpen}
                getRegionAccent={getRegionAccent}
              />
            ))}
          </div>
        )}
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
      <div
        className={styles.tree}
        style={treeAccent ? { boxShadow: `inset 3px 0 0 var(--accent-${treeAccent})` } : undefined}
      >
        {renderContent()}
      </div>
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
