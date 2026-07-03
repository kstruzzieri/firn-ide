import { useEffect, useRef, useState } from 'react';
import { GitBranchIcon, ChevronDownIcon } from '../icons';
import { useGitStore } from '../../stores/gitStore';
import styles from './BranchSwitcher.module.css';

/**
 * Branch name + searchable checkout/create popup. Shared by the git panel
 * header and the always-visible app header widget, so both stay in sync and
 * both answer the status-bar / shortcut focus handoff. Renders nothing when
 * the workspace is not a git repository.
 */
export function BranchSwitcher({
  compact = false,
  respondToFocusRequest = true,
}: {
  compact?: boolean;
  /** Whether a status-bar / shortcut focus request opens this instance. The
   * always-visible header widget owns the handoff; the panel copy stays local
   * so a single request never opens two popups at once. */
  respondToFocusRequest?: boolean;
}) {
  const isRepo = useGitStore((s) => s.status?.isRepo ?? false);
  const branch = useGitStore((s) => (s.status?.isRepo ? s.status.branch : ''));
  const branches = useGitStore((s) => s.branches);
  const focusRevision = useGitStore((s) => s.focusBranchRevision);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Status-bar / shortcut handoff: a bumped revision opens the popup. Render-
  // phase state adjustment (the React "derive state from props" pattern).
  const [seenRevision, setSeenRevision] = useState(focusRevision);
  if (focusRevision !== seenRevision) {
    setSeenRevision(focusRevision);
    if (respondToFocusRequest) setOpen(true);
  }

  useEffect(() => {
    if (!open) return;
    inputRef.current?.focus();
    // Refresh the branch list each time the popup opens so it reflects
    // branches created in a terminal since the last git refresh.
    void useGitStore.getState().loadBranches();
  }, [open]);

  // Close on outside click / Escape.
  useEffect(() => {
    if (!open) return undefined;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!isRepo) return null;

  const filtered = branches.filter((b) => b.includes(query));
  const exactExists = branches.includes(query);

  const checkout = (name: string, create: boolean) => {
    setOpen(false);
    setQuery('');
    void useGitStore.getState().checkout(name, create);
  };

  return (
    <div className={`${styles.wrap} ${compact ? styles.compact : ''}`} ref={wrapRef}>
      <button
        type="button"
        className={styles.trigger}
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Branch: ${branch}. Open branch switcher`}
        title={`Branch: ${branch}`}
      >
        <GitBranchIcon aria-hidden="true" />
        <span className={styles.name}>{branch}</span>
        <ChevronDownIcon aria-hidden="true" />
      </button>
      {open && (
        <div className={styles.popup}>
          <input
            ref={inputRef}
            className={styles.search}
            placeholder="Find or create branch"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Find or create branch"
          />
          <ul role="listbox" aria-label="Branches" className={styles.list}>
            {filtered.map((b) => (
              <li key={b}>
                <button
                  type="button"
                  role="option"
                  aria-selected={b === branch}
                  className={`${styles.option} ${b === branch ? styles.current : ''}`}
                  onClick={() => checkout(b, false)}
                >
                  {b}
                </button>
              </li>
            ))}
            {query && !exactExists && (
              <li>
                <button
                  type="button"
                  role="option"
                  aria-selected={false}
                  className={`${styles.option} ${styles.create}`}
                  onClick={() => checkout(query, true)}
                >
                  Create branch {query}
                </button>
              </li>
            )}
            {filtered.length === 0 && !query && <li className={styles.empty}>No branches</li>}
          </ul>
        </div>
      )}
    </div>
  );
}
