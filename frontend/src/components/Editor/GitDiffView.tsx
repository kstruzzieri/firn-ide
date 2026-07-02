import { useEffect, useRef } from 'react';
import { MergeView } from '@codemirror/merge';
import { EditorView, lineNumbers } from '@codemirror/view';
import { EditorState, type Extension } from '@codemirror/state';
import type { DiffSession } from '../../stores/gitStore';
import { useEditorSyntaxTheme } from '../../stores/ideStore';
import { buildTheme, getLanguageExtension } from './codemirror';
import styles from './GitDiffView.module.css';

/**
 * Read-only side-by-side diff for the git preview tab. A plain MergeView
 * (not the editing unified view): both sides are revision snapshots, so
 * nothing here writes back to disk.
 */
export function GitDiffView({ session }: { session: DiffSession }) {
  const hostRef = useRef<HTMLDivElement>(null);
  const themeId = useEditorSyntaxTheme();

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
    return () => view.destroy();
  }, [session, themeId]);

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
    <div className={styles.diffRoot}>
      <div className={styles.labels} aria-hidden="true">
        <span>{session.left.label}</span>
        <span>{session.right.label}</span>
      </div>
      <div ref={hostRef} className={styles.mergeHost} data-testid="merge-host" />
    </div>
  );
}
