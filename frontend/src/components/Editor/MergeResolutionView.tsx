import { useEffect, useRef, useState } from 'react';
import {
  createMergeResolutionEditor,
  type MergeResolutionEditor,
  type MergeResolutionState,
} from './codemirror';
import {
  useGitStore,
  type MergeDecision,
  type MergeSession,
  type TextMergeSession,
} from '../../stores/gitStore';
import { useEditorSyntaxTheme } from '../../stores/ideStore';
import styles from './MergeResolutionView.module.css';

function initialState(session: TextMergeSession): MergeResolutionState {
  return {
    activeIndex: null,
    decisions: session.decisions,
    order: 'current-first',
  };
}

function decisionClass(decision: MergeDecision | undefined): string {
  return decision ? styles[`decision${decision}`] : styles.unresolved;
}

function decisionLabel(decision: MergeDecision | undefined): string {
  switch (decision) {
    case 'C':
      return 'Current';
    case 'I':
      return 'Incoming';
    case 'B':
      return 'Both';
    case 'M':
      return 'Manual';
    default:
      return 'unresolved';
  }
}

export function MergeResolutionView({
  session,
  visible,
  onFinalizingChange,
}: {
  session: MergeSession;
  visible: boolean;
  onFinalizingChange?: (finalizing: boolean) => void;
}) {
  if (session.kind === 'sides') {
    return <SidesResolutionView session={session} onFinalizingChange={onFinalizingChange} />;
  }
  return (
    <TextResolutionView
      session={session}
      visible={visible}
      onFinalizingChange={onFinalizingChange}
    />
  );
}

function TextResolutionView({
  session,
  visible,
  onFinalizingChange,
}: {
  session: TextMergeSession;
  visible: boolean;
  onFinalizingChange?: (finalizing: boolean) => void;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<MergeResolutionEditor | null>(null);
  const sessionRef = useRef(session);
  const decisionsRef = useRef(session.decisions);
  const themeId = useEditorSyntaxTheme();
  const themeIdRef = useRef(themeId);
  const appliedThemeIdRef = useRef(themeId);
  themeIdRef.current = themeId;
  const [resolutionState, setResolutionState] = useState(() => initialState(session));
  const [finalizing, setFinalizing] = useState(false);
  sessionRef.current = session;

  useEffect(() => {
    if (!hostRef.current) return undefined;
    const initialSession = sessionRef.current;
    const editor = createMergeResolutionEditor(hostRef.current, initialSession, {
      syntaxThemeId: themeIdRef.current,
      onStateChange: (next) => {
        const previous = decisionsRef.current;
        const actions = useGitStore.getState();
        for (const index of new Set([...Object.keys(previous), ...Object.keys(next.decisions)])) {
          const region = Number(index);
          if (previous[region] === next.decisions[region]) continue;
          if (next.decisions[region] === undefined) actions.reopenDecision(region);
          else actions.recordDecision(region, next.decisions[region]);
        }
        decisionsRef.current = next.decisions;
        setResolutionState(next);
      },
    });
    editorRef.current = editor;
    appliedThemeIdRef.current = themeIdRef.current;
    const initialEditorState = editor.getState();
    decisionsRef.current = initialEditorState.decisions;
    setResolutionState(initialEditorState);
    return () => {
      editor.destroy();
      editorRef.current = null;
    };
  }, [session.labels, session.regions]);

  useEffect(() => {
    if (appliedThemeIdRef.current === themeId) return;
    editorRef.current?.setTheme(themeId);
    appliedThemeIdRef.current = themeId;
  }, [themeId]);

  useEffect(() => {
    if (visible) editorRef.current?.view.requestMeasure();
  }, [visible]);

  useEffect(() => {
    return () => onFinalizingChange?.(false);
  }, [onFinalizingChange]);

  const unresolved = session.regions.length - Object.keys(resolutionState.decisions).length;
  const fileIndex = session.fileQueue.indexOf(session.path) + 1;
  const disabled = unresolved !== 0 || session.readOnly || finalizing;
  const finalize = async () => {
    const editor = editorRef.current;
    if (!editor || disabled) return;
    editor.setFrozen(true);
    onFinalizingChange?.(true);
    setFinalizing(true);
    try {
      await useGitStore
        .getState()
        .mergeFinalizeAndStage(editor.getResult(), { suppressQueueAdvance: true });
    } finally {
      if (editorRef.current === editor) {
        editor.setFrozen(false);
        onFinalizingChange?.(false);
        setFinalizing(false);
      }
    }
  };

  return (
    <section className={styles.root} aria-label={`Merge resolution for ${session.path}`}>
      <header className={styles.header}>
        <span className={styles.path}>{session.path}</span>
        <span className={styles.filePosition}>
          File {fileIndex} of {session.fileQueue.length}
        </span>
        <span className={styles.unresolvedCount}>{unresolved} unresolved</span>
        {session.readOnly && (
          <span className={styles.readOnlyReason}>
            Read-only: {session.encoding} / {session.lineEndings} cannot be written losslessly.
          </span>
        )}
        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => editorRef.current?.undo()}
            disabled={finalizing}
          >
            Undo
          </button>
          <button
            type="button"
            className={styles.secondaryButton}
            onClick={() => editorRef.current?.next(1)}
            disabled={finalizing}
          >
            Next unresolved
          </button>
        </div>
      </header>
      <div className={styles.body}>
        <nav className={styles.rail} aria-label="Conflicts">
          {session.regions.map((_, index) => {
            const decision = resolutionState.decisions[index];
            return (
              <button
                key={index}
                type="button"
                className={`${styles.railItem} ${decisionClass(decision)} ${resolutionState.activeIndex === index ? styles.active : ''}`}
                aria-current={resolutionState.activeIndex === index ? 'true' : undefined}
                aria-label={`Conflict ${index + 1}: ${decisionLabel(decision)}`}
                onClick={() => editorRef.current?.activate(index)}
                disabled={finalizing}
              >
                {decision ?? index + 1}
              </button>
            );
          })}
        </nav>
        <div ref={hostRef} className={styles.editorHost} />
      </div>
      <footer className={styles.statusRow}>
        <div className={styles.progress} aria-label={`${unresolved} unresolved conflicts`}>
          {session.regions.map((_, index) => (
            <span
              key={index}
              className={`${styles.segment} ${decisionClass(resolutionState.decisions[index])}`}
            />
          ))}
        </div>
        <button
          type="button"
          className={styles.finalizeButton}
          disabled={disabled}
          onClick={() => void finalize()}
        >
          Write &amp; stage
        </button>
      </footer>
    </section>
  );
}

function SidesResolutionView({
  session,
  onFinalizingChange,
}: {
  session: Extract<MergeSession, { kind: 'sides' }>;
  onFinalizingChange?: (finalizing: boolean) => void;
}) {
  const [finalizing, setFinalizing] = useState(false);
  useEffect(() => {
    return () => onFinalizingChange?.(false);
  }, [onFinalizingChange]);
  const finalize = async () => {
    if (!session.selectedSide || finalizing) return;
    onFinalizingChange?.(true);
    setFinalizing(true);
    try {
      await useGitStore.getState().mergeFinalizeAndStage(undefined, { suppressQueueAdvance: true });
    } finally {
      onFinalizingChange?.(false);
      setFinalizing(false);
    }
  };
  const side = (key: 'ours' | 'theirs') => {
    const keepsFile = Boolean(session.stages[key]);
    const selected = session.selectedSide === key;
    const heading = key === 'ours' ? 'CURRENT' : 'INCOMING';
    const label = session.labels[key].label;
    return (
      <button
        type="button"
        className={`${styles.sideChoice} ${selected ? styles.sideSelected : ''} ${key === 'ours' ? styles.decisionC : styles.decisionI}`}
        aria-pressed={selected}
        onClick={() => useGitStore.getState().selectMergeSide(key)}
        disabled={finalizing}
      >
        <strong>
          {heading} — {label}
        </strong>{' '}
        {keepsFile ? 'keeps this file' : 'deletes this file'}
      </button>
    );
  };

  return (
    <section className={styles.root} aria-label={`Merge resolution for ${session.path}`}>
      <header className={styles.header}>
        <span className={styles.path}>{session.path}</span>
        <span className={styles.filePosition}>
          File {session.fileQueue.indexOf(session.path) + 1} of {session.fileQueue.length}
        </span>
      </header>
      <div className={styles.sides}>
        {side('ours')}
        {side('theirs')}
      </div>
      <footer className={styles.statusRow}>
        <span className={styles.sideStatus}>Choose the side to stage.</span>
        <button
          type="button"
          className={styles.finalizeButton}
          disabled={!session.selectedSide || finalizing}
          onClick={() => void finalize()}
        >
          Write &amp; stage
        </button>
      </footer>
    </section>
  );
}
