import { useEffect, useMemo, useRef } from 'react';
import { MergeView, goToNextChunk, goToPreviousChunk } from '@codemirror/merge';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import { EditorState, type Extension } from '@codemirror/state';
import type { DiffSession } from '../../stores/gitStore';
import { useEditorSyntaxTheme } from '../../stores/ideStore';
import { diffLines } from '../../utils/lineDiff';
import { buildTheme, getLanguageExtension } from './codemirror';
import styles from './GitDiffView.module.css';

/**
 * Read-only side-by-side diff for the git preview tab. A plain MergeView
 * (not the editing unified view): both sides are revision snapshots, so
 * nothing here writes back to disk.
 */
/** Split-ratio bounds: neither pane may shrink past this. */
const MIN_SPLIT = 15;
const MAX_SPLIT = 85;

export function GitDiffView({ session }: { session: DiffSession }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const mergeRef = useRef<MergeView | null>(null);
  const themeId = useEditorSyntaxTheme();

  // Hunk count from the same line diff the gutter uses — render-derived, so
  // no post-mount state write. May differ from the merge view's char-level
  // chunking by at most adjacent-hunk merging, which is fine for a count.
  const diffCount = useMemo(
    () => diffLines(session.left.content, session.right.content).length,
    [session.left.content, session.right.content]
  );

  useEffect(() => {
    if (!hostRef.current || session.binary || session.truncated) return undefined;

    const filename = session.path.split('/').pop() ?? session.path;
    // No lineWrapping here: the merge view aligns the two panes with spacer
    // widgets sized from measured line heights, and wrapped lines re-measure
    // as pane widths settle — producing sudden mid-scroll jumps and blank
    // regions. Long lines scroll horizontally inside their pane instead.
    const shared: Extension[] = [
      lineNumbers(),
      EditorView.editable.of(false),
      EditorState.readOnly.of(true),
      // JetBrains diff-navigation keys.
      keymap.of([{ key: 'F7', run: goToNextChunk, shift: goToPreviousChunk }]),
      buildTheme(themeId),
      getLanguageExtension(filename) ?? [],
    ];

    const view = new MergeView({
      a: { doc: session.left.content, extensions: shared },
      b: { doc: session.right.content, extensions: shared },
      parent: hostRef.current,
      gutter: true,
      highlightChanges: true,
    });
    mergeRef.current = view;
    return () => {
      mergeRef.current = null;
      view.destroy();
    };
  }, [session, themeId]);

  // Both sides are revision snapshots; navigating from the working-tree side
  // keeps focus where the user reads.
  const navigate = (direction: 'next' | 'prev') => {
    const side = mergeRef.current?.b;
    if (!side) return;
    (direction === 'next' ? goToNextChunk : goToPreviousChunk)(side);
    side.focus();
  };

  // Column split, applied as a CSS variable so the panes, the divider, and
  // the header labels all track the same ratio.
  const setSplit = (percent: number) => {
    const clamped = Math.min(MAX_SPLIT, Math.max(MIN_SPLIT, Math.round(percent)));
    rootRef.current?.style.setProperty('--diff-left', `${clamped}%`);
    return clamped;
  };

  const currentSplit = (): number => {
    const raw = rootRef.current?.style.getPropertyValue('--diff-left');
    const parsed = raw ? Number.parseFloat(raw) : NaN;
    return Number.isFinite(parsed) ? parsed : 50;
  };

  const handleDividerMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const onMove = (ev: MouseEvent) => {
      const rect = rootRef.current?.getBoundingClientRect();
      if (!rect || rect.width === 0) return;
      setSplit(((ev.clientX - rect.left) / rect.width) * 100);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  const handleDividerKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    setSplit(currentSplit() + (e.key === 'ArrowLeft' ? -2 : 2));
  };

  if (session.binary) {
    return (
      <div className={styles.stateMessage} data-testid="diff-binary">
        Binary file changed — no text diff available.
      </div>
    );
  }
  if (session.truncated) {
    return (
      <div className={styles.stateMessage} data-testid="diff-too-large">
        Diff too large to display.
      </div>
    );
  }

  return (
    <div className={styles.diffRoot} ref={rootRef} data-testid="diff-root">
      <div className={styles.toolbar}>
        <div className={styles.labels} aria-hidden="true">
          <span>{session.left.label}</span>
          <span>{session.right.label}</span>
        </div>
        <div className={styles.nav}>
          <span className={styles.diffCount}>
            {diffCount} difference{diffCount === 1 ? '' : 's'}
          </span>
          <button
            type="button"
            className={styles.navBtn}
            onClick={() => navigate('prev')}
            aria-label="Previous difference"
            title="Previous difference (Shift-F7)"
          >
            ↑
          </button>
          <button
            type="button"
            className={styles.navBtn}
            onClick={() => navigate('next')}
            aria-label="Next difference"
            title="Next difference (F7)"
          >
            ↓
          </button>
        </div>
      </div>
      <div ref={hostRef} className={styles.mergeHost} data-testid="merge-host">
        <button
          type="button"
          className={styles.divider}
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize diff columns"
          title="Drag to resize columns"
          onMouseDown={handleDividerMouseDown}
          onKeyDown={handleDividerKeyDown}
        />
      </div>
    </div>
  );
}
