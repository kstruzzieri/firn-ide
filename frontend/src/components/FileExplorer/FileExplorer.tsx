import { useCallback } from 'react';
import { Panel, PanelAction } from '../layout';
import { HomeIcon, ChevronDownIcon, PlusIcon, CollapseIcon } from '../icons';
import {
  useWorkspace,
  useIDEStore,
  useDirectoryTree,
  useExpandedPaths,
  useIsLoadingTree,
  useTreeError,
} from '../../stores/ideStore';
import { useDirectoryTree as useFetchDirectoryTree } from './useDirectoryTree';
import { TreeNode } from './TreeNode';
import { ReadFile } from '../../../wailsjs/go/main/App';
import type { filesystem } from '../../../wailsjs/go/models';
import styles from './FileExplorer.module.css';

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
  const isLoadingTree = useIsLoadingTree();
  const treeError = useTreeError();

  const toggleExpanded = useIDEStore((state) => state.toggleExpanded);
  const openFile = useIDEStore((state) => state.openFile);

  // Fetch directory tree on workspace change
  const { refetch } = useFetchDirectoryTree();

  const handleToggle = useCallback(
    (path: string) => {
      toggleExpanded(path);
    },
    [toggleExpanded]
  );

  const handleSelect = useCallback(
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
          content: content.content,
          isModified: false,
        });
      } catch (err) {
        console.error('Failed to open file:', err);
      }
    },
    [openFile]
  );

  const handleCollapseAll = useCallback(() => {
    // Reset expanded paths to empty set
    useIDEStore.setState({ expandedPaths: new Set() });
  }, []);

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
      return <FileExplorerEmpty message="Open a folder to get started" />;
    }

    // Empty workspace
    if (directoryTree.length === 0) {
      return <FileExplorerEmpty message="No files in workspace" />;
    }

    // Render tree
    return (
      <div role="tree" aria-label="File explorer">
        {directoryTree.map((entry) => (
          <TreeNode
            key={entry.path}
            entry={entry}
            depth={0}
            isExpanded={expandedPaths.has(entry.path)}
            expandedPaths={expandedPaths}
            onToggle={handleToggle}
            onSelect={handleSelect}
          />
        ))}
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
        <>
          <PanelAction
            icon={<PlusIcon />}
            title="New File"
            disabled={!workspace}
            ariaLabel="New File"
          />
          <PanelAction
            icon={<CollapseIcon />}
            title="Collapse All"
            disabled={!workspace}
            ariaLabel="Collapse All"
            onClick={handleCollapseAll}
          />
        </>
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
}

function FileExplorerEmpty({ message }: FileExplorerEmptyProps) {
  return (
    <div className={styles.empty}>
      <p>{message}</p>
      <button type="button" className={styles.openButton}>
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
