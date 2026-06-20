import { ChevronRightIcon, ChevronDownIcon } from '../icons';
import { FileIcon } from './FileIcon';
import { getFolderType } from './fileIconUtils';
import type { filesystem } from '../../../wailsjs/go/models';
import type { WorkspaceAccent } from '../../stores/ideStore';
import styles from './TreeNode.module.css';

interface TreeNodeProps {
  /** The file or directory entry to render */
  entry: filesystem.FileEntry;
  /** Nesting depth for indentation */
  depth: number;
  /** Whether this folder is expanded (only applies to directories) */
  isExpanded: boolean;
  /** Set of expanded paths for nested folders */
  expandedPaths?: Set<string>;
  /** Currently selected path in the tree */
  selectedPath?: string | null;
  /** Called when a folder's expand/collapse state should toggle */
  onToggle: (path: string) => void;
  /** Called when a file or folder is single-clicked (select) */
  onSelect: (entry: filesystem.FileEntry) => void;
  /** Called when a file is double-clicked (open) */
  onOpen: (entry: filesystem.FileEntry) => void;
  /** Project-View region tint resolver. Absent → no tinting (Workspace View). */
  getRegionAccent?: (entry: filesystem.FileEntry) => WorkspaceAccent | null;
}

/**
 * Renders a single tree node (file or folder) with recursive children.
 * Handles expand/collapse for folders and click-to-select for files.
 */
export function TreeNode({
  entry,
  depth,
  isExpanded,
  expandedPaths = new Set(),
  selectedPath,
  onToggle,
  onSelect,
  onOpen,
  getRegionAccent,
}: TreeNodeProps) {
  const isFolder = entry.isDir;
  const indentPx = depth * 16;
  const isSelected = selectedPath === entry.path;
  const isHidden = isFolder && getFolderType(entry.name) === 'hidden';
  const regionAccent = getRegionAccent?.(entry) ?? null;

  const handleToggleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggle(entry.path);
  };

  // Single click: select only (highlight)
  const handleRowClick = () => {
    onSelect(entry);
  };

  // Double click: open file OR expand/collapse folder
  const handleRowDoubleClick = () => {
    if (isFolder) {
      onToggle(entry.path);
    } else {
      onOpen(entry);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (isFolder) {
        onToggle(entry.path);
      } else {
        onOpen(entry);
      }
    } else if (e.key === ' ') {
      e.preventDefault();
      onSelect(entry);
    }
  };

  return (
    <div data-testid="tree-node" data-depth={depth}>
      <div
        className={`${styles.row}${regionAccent ? ` ${styles.tinted}` : ''}`}
        data-hidden={isHidden || undefined}
        style={{
          paddingLeft: `${indentPx}px`,
          ...(regionAccent
            ? ({
                ['--region-accent' as string]: `var(--accent-${regionAccent})`,
              } as React.CSSProperties)
            : {}),
        }}
        onClick={handleRowClick}
        onDoubleClick={handleRowDoubleClick}
        onKeyDown={handleKeyDown}
        role="treeitem"
        aria-expanded={isFolder ? isExpanded : undefined}
        aria-selected={isSelected}
        tabIndex={0}
      >
        {/* Expand/collapse toggle for folders */}
        {isFolder ? (
          <button
            type="button"
            className={styles.toggle}
            onClick={handleToggleClick}
            aria-label={`Toggle ${entry.name}`}
            data-testid="toggle-button"
          >
            {isExpanded ? (
              <ChevronDownIcon data-testid="chevron-down" aria-hidden="true" />
            ) : (
              <ChevronRightIcon data-testid="chevron-right" aria-hidden="true" />
            )}
          </button>
        ) : (
          <span className={styles.toggleSpacer} />
        )}

        {/* File/folder icon */}
        <FileIcon
          name={entry.name}
          isDir={isFolder}
          isExpanded={isExpanded}
          className={styles.icon}
        />

        {/* Entry name */}
        <span className={styles.name}>{entry.name}</span>
      </div>

      {/* Render children if folder is expanded */}
      {isFolder && isExpanded && entry.children && (
        <div role="group">
          {entry.children.map((child) => (
            <TreeNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              isExpanded={expandedPaths.has(child.path)}
              expandedPaths={expandedPaths}
              selectedPath={selectedPath}
              onToggle={onToggle}
              onSelect={onSelect}
              onOpen={onOpen}
              getRegionAccent={getRegionAccent}
            />
          ))}
        </div>
      )}
    </div>
  );
}
