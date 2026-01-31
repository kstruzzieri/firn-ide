import styles from './Sidebar.module.css';
import { FilesIcon, SearchIcon, GitBranchIcon, PlayIcon, SettingsIcon } from '../icons';
import { useIDEStore, SidebarView } from '../../stores/ideStore';
import { formatShortcut } from '../../utils/platform';

const SIDEBAR_ITEMS: Array<{
  view: SidebarView;
  icon: typeof FilesIcon;
  label: string;
  shortcut: string;
}> = [
  { view: 'explorer', icon: FilesIcon, label: 'Explorer', shortcut: '⌘1' },
  { view: 'search', icon: SearchIcon, label: 'Search', shortcut: '⌘⇧F' },
  { view: 'git', icon: GitBranchIcon, label: 'Source Control', shortcut: '⌘⇧G' },
  { view: 'run', icon: PlayIcon, label: 'Run Profiles', shortcut: '⌘⇧P' },
];

export function Sidebar() {
  const activeView = useIDEStore((state) => state.activeSidebarView);
  const setSidebarView = useIDEStore((state) => state.setSidebarView);

  return (
    <>
      {SIDEBAR_ITEMS.map(({ view, icon: Icon, label, shortcut }) => (
        <button
          key={view}
          className={`${styles.activityBtn} ${activeView === view ? styles.active : ''}`}
          title={`${label} (${formatShortcut(shortcut)})`}
          onClick={() => setSidebarView(view)}
          aria-pressed={activeView === view}
          aria-label={label}
        >
          <Icon aria-hidden="true" />
        </button>
      ))}

      <div className={styles.spacer} />

      <button className={styles.activityBtn} title="Settings" aria-label="Settings">
        <SettingsIcon aria-hidden="true" />
      </button>
    </>
  );
}
