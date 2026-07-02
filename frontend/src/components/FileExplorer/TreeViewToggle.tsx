import { useTreeViewMode, useCanFocusWorkspace, useIDEStore } from '../../stores/ideStore';
import styles from './TreeViewToggle.module.css';

/**
 * Segmented Project | Workspace control for panel headers.
 * Workspace is disabled when no non-project workspace exists.
 *
 * @param ariaLabel - Accessible label for the group landmark. Defaults to
 *   "File tree view" to preserve the FileExplorer context. Pass a distinct
 *   label whenever the toggle is reused in another panel (e.g. "Run profiles view").
 */
export function TreeViewToggle({ ariaLabel = 'File tree view' }: { ariaLabel?: string }) {
  const mode = useTreeViewMode();
  const canFocus = useCanFocusWorkspace();
  const setTreeViewMode = useIDEStore((s) => s.setTreeViewMode);

  return (
    <div className={styles.toggle} role="group" aria-label={ariaLabel}>
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
