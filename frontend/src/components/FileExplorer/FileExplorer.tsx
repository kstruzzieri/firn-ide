import { Panel, PanelAction } from '../layout';
import { HomeIcon, ChevronDownIcon, PlusIcon, CollapseIcon } from '../icons';
import { useWorkspace, useIsLoading } from '../../stores/ideStore';
import styles from './FileExplorer.module.css';

export function FileExplorer() {
  const workspace = useWorkspace();
  const isLoading = useIsLoading();

  return (
    <Panel
      title={
        <button
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
          />
        </>
      }
    >
      <div className={styles.tree}>
        {isLoading ? (
          <FileExplorerSkeleton />
        ) : !workspace ? (
          <FileExplorerEmpty message="Open a folder to get started" />
        ) : (
          <FileExplorerEmpty message="No files in workspace" />
        )}
      </div>
    </Panel>
  );
}

const SKELETON_WIDTHS = [75, 60, 85, 70, 90];

function FileExplorerSkeleton() {
  return (
    <div className={styles.skeleton} aria-busy="true" aria-label="Loading file tree">
      {SKELETON_WIDTHS.map((width, i) => (
        <div
          key={i}
          className={styles.skeletonItem}
          style={{ width: `${width}%` }}
        />
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
      <button className={styles.openButton}>Open Folder</button>
    </div>
  );
}
