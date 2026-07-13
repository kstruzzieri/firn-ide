import { WriteFile } from '../../wailsjs/go/main/App';
import { useIDEStore } from '../stores/ideStore';
import { normalizePathForComparison, pathsReferToSameFile } from './lspUri';

/** All editor and diff writes share this queue so one path is never written
 * concurrently by two UI surfaces. */
const writeQueues = new Map<string, Promise<void>>();

export function writeFileSerialized(
  path: string,
  content: string,
  encoding: string,
  lineEndings: string,
  createBackup = false
): Promise<void> {
  const key = normalizePathForComparison(path);
  const previous = writeQueues.get(key);
  const write = previous
    ? previous
        .catch(() => undefined)
        .then(() => WriteFile(path, content, encoding, lineEndings, createBackup))
    : WriteFile(path, content, encoding, lineEndings, createBackup);
  writeQueues.set(key, write);
  void write
    .finally(() => {
      if (writeQueues.get(key) === write) writeQueues.delete(key);
    })
    .catch(() => undefined);
  return write;
}

interface WorkingTreeEdit {
  absPath: string;
  displayPath: string;
  content: string;
  encoding: string;
  lineEndings: string;
  onSaved?: () => void;
}

interface PendingWorkingTreeEdit extends WorkingTreeEdit {
  revision: number;
  timer?: ReturnType<typeof setTimeout>;
  draining?: Promise<void>;
}

const DISK_WRITE_DEBOUNCE_MS = 400;
const pendingWorkingTreeEdits = new Map<string, PendingWorkingTreeEdit>();

function openFileFor(path: string) {
  return useIDEStore.getState().openFiles.find((f) => pathsReferToSameFile(f.path, path));
}

export function queueWorkingTreeEdit(edit: WorkingTreeEdit): void {
  const key = normalizePathForComparison(edit.absPath);
  const openFile = openFileFor(edit.absPath);
  if (openFile) {
    const pending = pendingWorkingTreeEdits.get(key);
    if (pending?.timer) clearTimeout(pending.timer);
    pendingWorkingTreeEdits.delete(key);
    if (openFile.content !== edit.content) {
      useIDEStore.getState().updateFileContent(openFile.id, edit.content);
    } else if (pending?.draining && !openFile.isModified) {
      // The matching buffer must still save after the older in-flight diff
      // write, or that write could leave disk behind a clean buffer.
      useIDEStore.getState().setFileModified(openFile.id, true);
    }
    edit.onSaved?.();
    return;
  }

  const existing = pendingWorkingTreeEdits.get(key);
  if (existing?.timer) clearTimeout(existing.timer);
  const pending = existing ?? { ...edit, revision: 0 };
  Object.assign(pending, edit);
  pending.revision += 1;
  pending.timer = setTimeout(() => {
    pending.timer = undefined;
    void drainWorkingTreeEdit(edit.absPath).catch(() => undefined);
  }, DISK_WRITE_DEBOUNCE_MS);
  pendingWorkingTreeEdits.set(key, pending);
}

function drainWorkingTreeEdit(path: string): Promise<void> {
  const key = normalizePathForComparison(path);
  const pending = pendingWorkingTreeEdits.get(key);
  if (!pending) return Promise.resolve();
  if (pending.timer) {
    clearTimeout(pending.timer);
    pending.timer = undefined;
  }
  if (pending.draining) return pending.draining;

  pending.draining = (async () => {
    try {
      while (pendingWorkingTreeEdits.get(key) === pending) {
        if (pending.timer) {
          clearTimeout(pending.timer);
          pending.timer = undefined;
        }
        const revision = pending.revision;
        const content = pending.content;
        const openFile = openFileFor(path);

        if (openFile) {
          if (openFile.content !== content) {
            useIDEStore.getState().updateFileContent(openFile.id, content);
          }
        } else {
          await writeFileSerialized(
            pending.absPath,
            content,
            pending.encoding,
            pending.lineEndings,
            false
          );
        }

        if (pending.revision === revision) {
          pendingWorkingTreeEdits.delete(key);
          pending.onSaved?.();
          return;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      useIDEStore
        .getState()
        .showToast(`Failed to save ${pending.displayPath}: ${message}`, 'error');
      throw err;
    } finally {
      pending.draining = undefined;
    }
  })();

  return pending.draining;
}

/** Flush a pending diff edit before any editor surface reads the file. */
export function flushWorkingTreeEdit(path: string): Promise<void> {
  return drainWorkingTreeEdit(path);
}

/** Flush every debounced diff edit during the app's coordinated close. */
export async function flushAllWorkingTreeEdits(): Promise<void> {
  const results = await Promise.allSettled(
    [...pendingWorkingTreeEdits.keys()].map(drainWorkingTreeEdit)
  );
  const failure = results.find((result) => result.status === 'rejected');
  if (failure?.status === 'rejected') throw failure.reason;
}

/** Final close flush: settle diff drafts first, then persist the resulting
 * latest editor buffers through the same per-path write queues. */
export async function flushAllFileEdits(): Promise<void> {
  let diffFailure: unknown;
  try {
    await flushAllWorkingTreeEdits();
  } catch (err) {
    diffFailure = err;
  }
  const files = useIDEStore.getState().openFiles.filter((file) => file.isModified);
  const results = await Promise.allSettled(
    files.map((file) =>
      writeFileSerialized(file.path, file.content, file.encoding, file.lineEndings, false).catch(
        (err) => {
          const message = err instanceof Error ? err.message : String(err);
          useIDEStore.getState().showToast(`Failed to save ${file.name}: ${message}`, 'error');
          throw err;
        }
      )
    )
  );
  const failure = results.find((result) => result.status === 'rejected');
  const queued = await Promise.allSettled([...writeQueues.values()]);
  const queuedFailure = queued.find((result) => result.status === 'rejected');
  if (diffFailure !== undefined) throw diffFailure;
  if (failure?.status === 'rejected') throw failure.reason;
  if (queuedFailure?.status === 'rejected') throw queuedFailure.reason;
}
