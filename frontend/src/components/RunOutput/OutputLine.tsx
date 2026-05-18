import { useCallback, useMemo, type ReactNode } from 'react';
import { useIDEStore } from '../../stores/ideStore';
import {
  parseFileReferences,
  resolveFileReferencePath,
  type FileReference,
} from '../../utils/parseFileReferences';
import { navigateToEditorLocation } from '../../utils/editorNavigation';
import styles from './RunOutput.module.css';

interface OutputLineProps {
  text: string;
  className: string;
  workingDir?: string;
  workspacePath?: string;
}

export function OutputLine({ text, className, workingDir, workspacePath }: OutputLineProps) {
  const references = useMemo(() => parseFileReferences(text), [text]);

  const openReference = useCallback(
    async (reference: FileReference) => {
      const path = resolveFileReferencePath(reference.path, workingDir, workspacePath);
      const options = workspacePath
        ? {
            shouldApply: () => useIDEStore.getState().workspace?.path === workspacePath,
          }
        : undefined;

      try {
        await navigateToEditorLocation(path, reference.line, reference.column, options);
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unknown error';
        useIDEStore
          .getState()
          .showToast(`Failed to open linked output location: ${message}`, 'error');
      }
    },
    [workingDir, workspacePath]
  );

  if (references.length === 0) {
    return <div className={className}>{text}</div>;
  }

  const parts: ReactNode[] = [];
  let cursor = 0;

  for (const reference of references) {
    if (reference.startIndex > cursor) {
      parts.push(text.slice(cursor, reference.startIndex));
    }

    parts.push(
      <button
        key={`${reference.startIndex}-${reference.endIndex}`}
        type="button"
        className={styles.outputLink}
        title={resolveFileReferencePath(reference.path, workingDir, workspacePath)}
        aria-label={`Open ${reference.path} at line ${reference.line}, column ${reference.column}`}
        onClick={() => {
          void openReference(reference);
        }}
      >
        {text.slice(reference.startIndex, reference.endIndex)}
      </button>
    );

    cursor = reference.endIndex;
  }

  if (cursor < text.length) {
    parts.push(text.slice(cursor));
  }

  return <div className={className}>{parts}</div>;
}
