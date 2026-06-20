// src/components/FileExplorer/TreeRow.tsx
import React from 'react';
import { ChevronRightIcon, ChevronDownIcon } from '../icons';
import { FileIcon } from './FileIcon';
import { getFolderType } from './fileIconUtils';
import type { WorkspaceAccent } from '../../stores/ideStore';
import { shortenPath } from '../../utils/workspace';
import styles from './TreeRow.module.css';

/** Fixed row height; MUST match `.row { height }` in TreeRow.module.css. */
export const ROW_HEIGHT = 28;

/** Stable DOM id for a row, used as aria-activedescendant target. */
export function rowDomId(key: string): string {
  return `treeitem-${encodeURIComponent(key)}`;
}

export interface TreeRowProps {
  kind: 'root' | 'entry';
  /** entry.path for entries; undefined for the root row. */
  path?: string;
  name: string;
  depth: number;
  level: number;
  isDir: boolean;
  isExpanded: boolean;
  isSelected: boolean;
  regionAccent: WorkspaceAccent | null;
  setSize: number;
  posInSet: number;
  /** Root only: absolute path shown as a dimmed label. */
  rootPath?: string;
  /** DOM id for aria-activedescendant. */
  rowId: string;
  /** True when this row is the keyboard-active descendant. */
  isActive: boolean;
  onToggle: (kind: 'root' | 'entry', path?: string) => void;
  onSelect: (path: string) => void;
  onOpen: (path: string) => void;
}

/**
 * A single windowed tree row (root or entry). All props are primitives or stable
 * callbacks, so React.memo skips re-render when nothing about this row changed —
 * the key enabler for cheap re-renders on toggle/select over large trees.
 */
function TreeRowImpl({
  kind,
  path,
  name,
  depth,
  level,
  isDir,
  isExpanded,
  isSelected,
  regionAccent,
  setSize,
  posInSet,
  rootPath,
  rowId,
  isActive,
  onToggle,
  onSelect,
  onOpen,
}: TreeRowProps) {
  const indentPx = depth * 16;
  const isHidden = isDir && getFolderType(name) === 'hidden';

  const handleToggleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggle(kind, path);
  };

  const handleRowClick = () => {
    if (kind === 'root') {
      onToggle('root', undefined);
    } else if (path) {
      onSelect(path);
    }
  };

  const handleRowDoubleClick = () => {
    if (kind === 'root') return;
    if (isDir) {
      onToggle('entry', path);
    } else if (path) {
      onOpen(path);
    }
  };

  const className =
    `${styles.row}` +
    (kind === 'root' ? ` ${styles.root}` : '') +
    (regionAccent ? ` ${styles.tinted}` : '') +
    (isActive ? ` ${styles.active}` : '');

  return (
    <div
      id={rowId}
      className={className}
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
      role="treeitem"
      aria-level={level}
      aria-setsize={setSize}
      aria-posinset={posInSet}
      aria-expanded={isDir ? isExpanded : undefined}
      aria-selected={isSelected}
      tabIndex={-1}
    >
      {isDir ? (
        <button
          type="button"
          className={styles.toggle}
          onClick={handleToggleClick}
          aria-label={`Toggle ${name}`}
          data-testid="toggle-button"
          tabIndex={-1}
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

      <FileIcon name={name} isDir={isDir} isExpanded={isExpanded} className={styles.icon} />
      <span className={styles.name}>{name}</span>
      {kind === 'root' && rootPath && <span className={styles.path}>{shortenPath(rootPath)}</span>}
    </div>
  );
}

export const TreeRow = React.memo(TreeRowImpl);
