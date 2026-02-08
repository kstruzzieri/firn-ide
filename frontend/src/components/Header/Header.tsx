import styles from './Header.module.css';
import { ChevronDownIcon, SearchIcon } from '../icons';
import { useWorkspace } from '../../stores/ideStore';
import { formatShortcut, isMac } from '../../utils/platform';
import arcIcon from '../../assets/branding/icon.svg';

export function Header() {
  const workspace = useWorkspace();
  const workspaceName = workspace?.name || 'No workspace';

  return (
    <>
      {/* Traffic lights spacer (macOS only) */}
      {isMac() && <div className={styles.trafficLights} aria-hidden="true" />}

      {/* Logo */}
      <div className={styles.logo}>
        <img src={arcIcon} alt="Arc" className={styles.logoIcon} />
        <span className={styles.logoText}>Arc</span>
      </div>

      {/* Workspace selector */}
      <button className={styles.workspaceBtn} aria-haspopup="listbox" aria-expanded="false">
        <span className={styles.workspaceDot} aria-hidden="true" />
        <span className={styles.workspaceName}>{workspaceName}</span>
        <ChevronDownIcon className={styles.chevron} aria-hidden="true" />
      </button>

      {/* Search */}
      <button className={`${styles.headerBtn} ${styles.searchBtn}`} aria-label="Search everywhere">
        <SearchIcon aria-hidden="true" />
        <span>Search Everywhere</span>
        <span className={styles.searchShortcut}>{formatShortcut('⇧⌘P')}</span>
      </button>

      {/* Spacer */}
      <div className={styles.spacer} />
    </>
  );
}
