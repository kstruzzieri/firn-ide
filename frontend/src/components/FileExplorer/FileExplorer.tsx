import { useCallback, useEffect } from 'react';
import { Panel, PanelAction } from '../layout';
import {
  HomeIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  MinusIcon,
  FolderOpenIcon,
  FolderIcon,
} from '../icons';
import {
  useWorkspace,
  useIDEStore,
  useDirectoryTree,
  useExpandedPaths,
  useSelectedPath,
  useIsRootExpanded,
  useIsLoadingTree,
  useTreeError,
  useActiveFileId,
} from '../../stores/ideStore';
import { useDirectoryTree as useFetchDirectoryTree } from './useDirectoryTree';
import { useOpenFolder } from '../../hooks/useOpenFolder';
import { TreeNode } from './TreeNode';
import { ReadFile } from '../../../wailsjs/go/main/App';
import type { filesystem } from '../../../wailsjs/go/models';
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

/** Maps file extension to language identifier for the editor */
function getLanguageFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() ?? '';
  const langMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'typescript',
    js: 'javascript',
    jsx: 'javascript',
    json: 'json',
    md: 'markdown',
    go: 'go',
    py: 'python',
    css: 'css',
    html: 'html',
    yaml: 'yaml',
    yml: 'yaml',
  };
  return langMap[ext] ?? 'plaintext';
}

export function FileExplorer() {
  const workspace = useWorkspace();
  const directoryTree = useDirectoryTree();
  const expandedPaths = useExpandedPaths();
  const selectedPath = useSelectedPath();
  const isRootExpanded = useIsRootExpanded();
  const isLoadingTree = useIsLoadingTree();
  const treeError = useTreeError();
  const activeFileId = useActiveFileId();

  const toggleExpanded = useIDEStore((state) => state.toggleExpanded);
  const toggleRootExpanded = useIDEStore((state) => state.toggleRootExpanded);
  const setSelectedPath = useIDEStore((state) => state.setSelectedPath);
  const openFile = useIDEStore((state) => state.openFile);
  const toggleLeftPanel = useIDEStore((state) => state.toggleLeftPanel);

  // Sync active file in editor to file tree selection.
  // Only depends on activeFileId — reads expandedPaths from store snapshot
  // to avoid a dependency cycle (Set references change on every update).
  useEffect(() => {
    if (activeFileId && activeFileId !== useIDEStore.getState().selectedPath) {
      setSelectedPath(activeFileId);

      // Expand all parent folders to reveal the file
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

  // Fetch directory tree on workspace change
  const { refetch } = useFetchDirectoryTree();

  const handleToggle = useCallback(
    (path: string) => {
      toggleExpanded(path);
    },
    [toggleExpanded]
  );

  // Single click: just select the entry
  const handleSelect = useCallback(
    (entry: filesystem.FileEntry) => {
      setSelectedPath(entry.path);
    },
    [setSelectedPath]
  );

  // Double click: open file in editor
  const handleOpen = useCallback(
    async (entry: filesystem.FileEntry) => {
      if (entry.isDir) return;

      try {
        const content = await ReadFile(entry.path);
        openFile({
          id: entry.path,
          name: entry.name,
          path: entry.path,
          language: getLanguageFromPath(entry.path),
          encoding: content.encoding,
          lineEndings: content.lineEndings,
          content: content.content,
          isModified: false,
        });
      } catch (err) {
        console.error('Failed to open file:', err);
      }
    },
    [openFile]
  );

  const handleHidePanel = useCallback(() => {
    toggleLeftPanel();
  }, [toggleLeftPanel]);

  const renderContent = () => {
    // Loading state
    if (isLoadingTree) {
      return <FileExplorerSkeleton />;
    }

    // Error state
    if (treeError) {
      return <FileExplorerError message={treeError} onRetry={refetch} />;
    }

    // No workspace
    if (!workspace) {
      return <FileExplorerEmpty message="Open a folder to get started" onOpenFolder={openFolder} />;
    }

    // Empty workspace
    if (directoryTree.length === 0) {
      return <FileExplorerEmpty message="No files in workspace" onOpenFolder={openFolder} />;
    }

    // Render tree with root folder
    const FolderIconComponent = isRootExpanded ? FolderOpenIcon : FolderIcon;
    const ChevronIcon = isRootExpanded ? ChevronDownIcon : ChevronRightIcon;

    return (
      <div role="tree" aria-label="File explorer">
        {/* Root folder entry */}
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
            aria-label={`Toggle ${workspace.name}`}
          >
            <ChevronIcon aria-hidden="true" />
          </button>
          <FolderIconComponent
            className={treeStyles.icon}
            style={{ color: isRootExpanded ? '#6A9AB0' : '#4A7080' }}
            aria-hidden="true"
          />
          <span className={treeStyles.name}>{workspace.name}</span>
          <span className={treeStyles.path}>{shortenPath(workspace.path)}</span>
        </div>

        {/* Children when root is expanded */}
        {isRootExpanded && (
          <div role="group">
            {directoryTree.map((entry) => (
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
              />
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <Panel
      title={
        <button
          type="button"
          className={styles.viewToggle}
          aria-haspopup="listbox"
          aria-expanded="false"
          aria-label="Switch file tree view"
        >
          <HomeIcon aria-hidden="true" />
          <span>PROJECT</span>
          <ChevronDownIcon aria-hidden="true" />
        </button>
      }
      actions={
        <PanelAction
          icon={<MinusIcon />}
          title="Hide Panel"
          ariaLabel="Hide Panel"
          onClick={handleHidePanel}
        />
      }
    >
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
