import { useEffect } from 'react';
import { EventsOn } from '../wails/runtime';

/**
 * Hands each folder a filetree:stale event names to onStale. The backend
 * emits it when a git status refresh changes which tracked files .gitignore
 * matches (#536): a commit, `git rm --cached` or a branch switch moves files
 * in or out of the tree without touching a watched file.
 */
export function useFileTreeStale(onStale: (dir: string) => void): void {
  useEffect(
    () => EventsOn<string[]>('filetree:stale', (dirs) => dirs.forEach((dir) => onStale(dir))),
    [onStale]
  );
}
