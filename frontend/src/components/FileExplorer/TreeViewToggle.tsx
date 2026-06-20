import { useTreeViewMode, useCanFocusWorkspace, useIDEStore } from '../../stores/ideStore';
import styles from './TreeViewToggle.module.css';

/**
 * Segmented Project | Workspace control for the file-tree panel header.
 * Workspace is disabled when no non-project workspace exists.
 */
export function TreeViewToggle() {
  const mode = useTreeViewMode();
  const canFocus = useCanFocusWorkspace();
  const setTreeViewMode = useIDEStore((s) => s.setTreeViewMode);

  return (
    <div className={styles.toggle} role="group" aria-label="File tree view">
      <button
        type="button"
        className={styles.segment}
        aria-pressed={mode === 'project'}
        onClick={() => setTreeViewMode('project')}
      >
        Project
      </button>
      <button
        type="button"
        className={styles.segment}
        aria-pressed={mode === 'workspace'}
        disabled={!canFocus}
        onClick={() => setTreeViewMode('workspace')}
      >
        Workspace
      </button>
    </div>
  );
}
