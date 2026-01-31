/**
 * CodeMirror Editor Component
 *
 * A React wrapper for CodeMirror 6 that provides:
 * - Automatic language detection based on filename
 * - Deep Ocean theme integration
 * - Content change notifications
 * - Cursor position tracking
 * - Proper cleanup on unmount
 */

import { useEffect, useRef, useCallback, memo } from 'react';
import { EditorView, EditorState, createEditorExtensions } from './codemirror';
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
}: CodeMirrorEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<EditorView | null>(null);
  const fileIdRef = useRef(fileId);
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

    // Focus/blur event handlers
    const handleFocusEvent = () => onFocus?.();
    const handleBlurEvent = () => onBlur?.();

    view.contentDOM.addEventListener('focus', handleFocusEvent);
    view.contentDOM.addEventListener('blur', handleBlurEvent);

    // Cleanup on unmount
    return () => {
      view.contentDOM.removeEventListener('focus', handleFocusEvent);
      view.contentDOM.removeEventListener('blur', handleBlurEvent);
      view.destroy();
      editorRef.current = null;
    };
    // Only re-create editor when fileId changes (new file opened)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileId]);

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

  return (
    <div
      ref={containerRef}
      className={styles.container}
      data-testid="codemirror-editor"
    />
  );
});

CodeMirrorEditor.displayName = 'CodeMirrorEditor';
