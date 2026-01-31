/**
 * Types for file system watcher events.
 */

/** The type of file system change event. */
export type FileEventType = 'created' | 'modified' | 'deleted' | 'renamed';

/** Represents a file system change event from the backend. */
export interface FileEvent {
  /** The type of change that occurred. */
  type: FileEventType;
  /** The absolute path to the affected file or directory. */
  path: string;
  /** The previous path for rename events. */
  oldPath?: string;
  /** Whether the path is a directory. */
  isDir: boolean;
  /** ISO timestamp of when the event occurred. */
  time: string;
}
