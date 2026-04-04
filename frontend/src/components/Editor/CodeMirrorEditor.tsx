/**
 * CodeMirror Editor Component
 *
 * A React wrapper for CodeMirror 6 that provides:
 * - Automatic language detection based on filename
 * - Firn Glacier theme integration
 * - Content change notifications
 * - Cursor position tracking
 * - LSP diagnostics display (underlines + gutter markers)
 * - Programmatic navigation support
 * - Proper cleanup on unmount
 */

import { useEffect, useRef, useCallback, memo } from 'react';
import {
  EditorView,
  EditorState,
  createEditorExtensions,
  updateEditorDiagnostics,
} from './codemirror';
import { useIDEStore, type EditorNavigationRequest } from '../../stores/ideStore';
import { useLSPStore } from '../../stores/lspStore';
import { filePathToURI } from '../../utils/lspUri';
import styles from './CodeMirrorEditor.module.css';

interface CodeMirrorEditorProps {
  /** Unique identifier for the file */
  fileId: string;
  /** Filename used for language detection */
  filename: string;
  /** Initial content of the file */
  content: string;
  /** Whether the editor is read-only */
  readOnly?: boolean;
  /** Tab size (default: 2) */
  tabSize?: number;
  /** Callback when content changes */
  onContentChange?: (fileId: string, content: string) => void;
  /** Callback when cursor position changes */
  onCursorChange?: (line: number, column: number) => void;
  /** Callback when editor is focused */
  onFocus?: () => void;
  /** Callback when editor is blurred */
  onBlur?: () => void;
  /** Callback when scroll position changes */
  onScrollChange?: (scrollTop: number) => void;
  /** Initial cursor line to set on mount (for workspace restore) */
  initialCursorLine?: number;
  /** Initial cursor column to set on mount (for workspace restore) */
  initialCursorColumn?: number;
  /** Initial scroll top to set on mount (for workspace restore) */
  initialScrollTop?: number;
}

/**
 * CodeMirror editor component with full IDE integration.
 * Memoized to prevent unnecessary re-renders.
 */
export const CodeMirrorEditor = memo(function CodeMirrorEditor({
  fileId,
  filename,
  content,
  readOnly = false,
  tabSize = 2,
  onContentChange,
  onCursorChange,
  onFocus,
  onBlur,
  onScrollChange,
  initialCursorLine,
  initialCursorColumn,
  initialScrollTop,
}: CodeMirrorEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<EditorView | null>(null);
  const fileIdRef = useRef(fileId);
  const hasAppliedInitialCursorRef = useRef(false);
  const hasAppliedInitialScrollRef = useRef(false);
  // Flag to skip onChange during external content sync
  const isSyncingRef = useRef(false);

  // Keep refs in sync
  fileIdRef.current = fileId;

  // Stable callback for content changes
  const handleContentChange = useCallback(
    (newContent: string) => {
      // Skip if we're syncing external content to prevent loops
      if (isSyncingRef.current) return;
      if (onContentChange) {
        onContentChange(fileIdRef.current, newContent);
      }
    },
    [onContentChange]
  );

  const applyInitialCursor = useCallback(() => {
    const view = editorRef.current;
    if (!view || initialCursorLine === undefined || initialCursorLine <= 0) return;

    const lineNum = Math.min(initialCursorLine, view.state.doc.lines);
    const line = view.state.doc.line(lineNum);
    const col = Math.min((initialCursorColumn ?? 1) - 1, line.length);
    view.dispatch({
      selection: { anchor: line.from + col },
      scrollIntoView: false,
    });
    hasAppliedInitialCursorRef.current = true;
  }, [initialCursorColumn, initialCursorLine]);

  const applyInitialScroll = useCallback(() => {
    const view = editorRef.current;
    if (!view || initialScrollTop === undefined || initialScrollTop < 0) return;

    requestAnimationFrame(() => {
      if (!editorRef.current) return;
      editorRef.current.scrollDOM.scrollTop = initialScrollTop;
      hasAppliedInitialScrollRef.current = true;
    });
  }, [initialScrollTop]);

  useEffect(() => {
    hasAppliedInitialCursorRef.current = false;
    hasAppliedInitialScrollRef.current = false;
  }, [fileId]);

  // Initialize editor
  useEffect(() => {
    if (!containerRef.current) return;

    // Create extensions with callbacks
    const extensions = createEditorExtensions({
      filename,
      readOnly,
      tabSize,
      onChange: handleContentChange,
      onCursorChange,
    });

    // Create initial state
    const state = EditorState.create({
      doc: content,
      extensions,
    });

    // Create editor view
    const view = new EditorView({
      state,
      parent: containerRef.current,
    });

    editorRef.current = view;

    applyInitialCursor();
    applyInitialScroll();

    // Apply any existing diagnostics for this file
    const uri = filePathToURI(fileId);
    const existingDiags = useLSPStore.getState().diagnostics.get(uri);
    if (existingDiags && existingDiags.length > 0) {
      updateEditorDiagnostics(view, existingDiags);
    }

    // Focus/blur event handlers
    const handleFocusEvent = () => onFocus?.();
    const handleBlurEvent = () => onBlur?.();
    const handleScroll = () => {
      onScrollChange?.(view.scrollDOM.scrollTop);
    };

    view.contentDOM.addEventListener('focus', handleFocusEvent);
    view.contentDOM.addEventListener('blur', handleBlurEvent);
    view.scrollDOM.addEventListener('scroll', handleScroll);

    // Cleanup on unmount
    return () => {
      view.contentDOM.removeEventListener('focus', handleFocusEvent);
      view.contentDOM.removeEventListener('blur', handleBlurEvent);
      view.scrollDOM.removeEventListener('scroll', handleScroll);
      view.destroy();
      editorRef.current = null;
    };
    // Only re-create editor when fileId changes (new file opened)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId]);

  useEffect(() => {
    if (hasAppliedInitialCursorRef.current) return;
    applyInitialCursor();
  }, [applyInitialCursor]);

  useEffect(() => {
    if (hasAppliedInitialScrollRef.current) return;
    applyInitialScroll();
  }, [applyInitialScroll]);

  // Update content when it changes externally (e.g., file reload)
  useEffect(() => {
    const view = editorRef.current;
    if (!view) return;

    const currentContent = view.state.doc.toString();
    if (currentContent !== content) {
      // Set flag to prevent onChange from firing during sync
      isSyncingRef.current = true;
      view.dispatch({
        changes: {
          from: 0,
          to: currentContent.length,
          insert: content,
        },
      });
      isSyncingRef.current = false;
    }
  }, [content]);

  // Subscribe to diagnostics for this file's URI
  useEffect(() => {
    const uri = filePathToURI(fileId);
    let prevDiags = useLSPStore.getState().diagnostics.get(uri);

    const cancel = useLSPStore.subscribe((state) => {
      const diags = state.diagnostics.get(uri);
      if (diags === prevDiags) return;
      prevDiags = diags;

      const view = editorRef.current;
      if (!view) return;

      updateEditorDiagnostics(view, diags ?? []);
    });

    return cancel;
  }, [fileId]);

  // Handle programmatic navigation requests
  useEffect(() => {
    const cancel = useIDEStore.subscribe((state, prevState) => {
      const nav = state.pendingEditorNavigation;
      const prevNav = prevState.pendingEditorNavigation;
      if (!nav || nav === prevNav || nav.fileId !== fileIdRef.current) return;

      const view = editorRef.current;
      if (!view) return;

      applyNavigation(view, nav);
      useIDEStore.getState().clearPendingEditorNavigation(nav.fileId, nav.revision);
    });

    // Also check if there's a pending navigation right now (e.g., file just opened)
    const nav = useIDEStore.getState().pendingEditorNavigation;
    if (nav && nav.fileId === fileId && editorRef.current) {
      applyNavigation(editorRef.current, nav);
      useIDEStore.getState().clearPendingEditorNavigation(nav.fileId, nav.revision);
    }

    return cancel;
  }, [fileId]);

  return <div ref={containerRef} className={styles.container} data-testid="codemirror-editor" />;
});

CodeMirrorEditor.displayName = 'CodeMirrorEditor';

function applyNavigation(view: EditorView, nav: EditorNavigationRequest): void {
  const lineNum = Math.min(nav.line, view.state.doc.lines);
  if (lineNum <= 0) return;
  const line = view.state.doc.line(lineNum);
  const col = Math.min((nav.column ?? 1) - 1, line.length);
  const pos = line.from + col;

  view.dispatch({
    selection: { anchor: pos },
    scrollIntoView: true,
  });
  view.focus();
}
