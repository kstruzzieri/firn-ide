import { LSPDidChange, LSPDidClose, LSPDidOpen, LSPDidSave } from '../../wailsjs/go/main/App';
import { lsp } from '../../wailsjs/go/models';

export const DIDCHANGE_DEBOUNCE_MS = 150;

type TrackedDocument = {
  syncedContent: string;
  pendingContent?: string;
  changeTimer?: ReturnType<typeof setTimeout>;
  openPromise?: Promise<void>;
};

const versions = new Map<string, number>();
const documents = new Map<string, TrackedDocument>();

function nextVersion(path: string): number {
  const current = versions.get(path) ?? 0;
  const next = current + 1;
  versions.set(path, next);
  return next;
}

function clearChangeTimer(doc: TrackedDocument): void {
  if (!doc.changeTimer) return;
  clearTimeout(doc.changeTimer);
  doc.changeTimer = undefined;
}

export function openLSPDocument(
  path: string,
  languageID: string,
  content: string
): Promise<void> | null {
  if (documents.has(path)) return null;

  const doc: TrackedDocument = {
    syncedContent: content,
  };
  documents.set(path, doc);

  const openPromise = LSPDidOpen(path, languageID, nextVersion(path), content)
    .catch((err) => {
      if (documents.get(path) === doc) {
        clearChangeTimer(doc);
        documents.delete(path);
      }
      throw err;
    })
    .finally(() => {
      if (doc.openPromise === openPromise) {
        doc.openPromise = undefined;
      }
    });

  doc.openPromise = openPromise;
  return openPromise;
}

export function scheduleLSPDocumentChange(
  path: string,
  content: string,
  onError?: (err: unknown) => void
): void {
  const doc = documents.get(path);
  if (!doc) return;

  if (content === doc.syncedContent) {
    doc.pendingContent = undefined;
    clearChangeTimer(doc);
    return;
  }

  doc.pendingContent = content;
  clearChangeTimer(doc);
  doc.changeTimer = setTimeout(() => {
    void flushLSPDocumentChange(path).catch((err) => onError?.(err));
  }, DIDCHANGE_DEBOUNCE_MS);
}

export async function flushLSPDocumentChange(path: string, content?: string): Promise<boolean> {
  const doc = documents.get(path);
  if (!doc) return false;

  clearChangeTimer(doc);

  const nextContent = content ?? doc.pendingContent;
  if (nextContent === undefined || nextContent === doc.syncedContent) {
    doc.pendingContent = undefined;
    return false;
  }

  if (doc.openPromise) {
    await doc.openPromise;
  }

  const current = documents.get(path);
  if (!current) return false;

  current.pendingContent = undefined;
  const change = new lsp.TextDocumentContentChangeEvent({ text: nextContent });
  await LSPDidChange(path, nextVersion(path), [change]);
  current.syncedContent = nextContent;
  return true;
}

export async function saveLSPDocument(path: string, content: string): Promise<void> {
  const doc = documents.get(path);
  if (!doc) return;

  await flushLSPDocumentChange(path, content);

  const current = documents.get(path);
  if (!current) return;

  if (current.openPromise) {
    await current.openPromise;
  }
  if (!documents.has(path)) return;

  await LSPDidSave(path);
}

export async function closeLSPDocument(path: string, lastContent?: string): Promise<void> {
  const doc = documents.get(path);
  if (!doc) return;

  clearChangeTimer(doc);
  documents.delete(path);

  try {
    if (doc.openPromise) {
      await doc.openPromise;
    }
  } catch {
    return;
  }

  const nextContent = lastContent ?? doc.pendingContent;
  if (nextContent !== undefined && nextContent !== doc.syncedContent) {
    const change = new lsp.TextDocumentContentChangeEvent({ text: nextContent });
    await LSPDidChange(path, nextVersion(path), [change]);
  }

  await LSPDidClose(path);
}

export function forgetLSPDocument(path: string): void {
  const doc = documents.get(path);
  if (!doc) return;
  clearChangeTimer(doc);
  documents.delete(path);
}

export function trackedLSPDocumentPaths(): string[] {
  return [...documents.keys()];
}

export function resetLSPDocumentSyncState(): void {
  for (const doc of documents.values()) {
    clearChangeTimer(doc);
  }
  documents.clear();
  versions.clear();
}
