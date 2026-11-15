// src/components/FileExplorer/useTreeKeyboardNav.ts
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { FlatRow } from '../../utils/flattenTree';

export interface TreeKeyboardActions {
  /** Toggle expand/collapse (root → root toggle, entry dir → expandedPaths). */
  toggle: (row: FlatRow) => void;
  /** Select an entry (highlight). */
  select: (row: FlatRow) => void;
  /** Open an entry (files only). */
  open: (row: FlatRow) => void;
}

export interface UseTreeKeyboardNavArgs {
  rows: FlatRow[];
  actions: TreeKeyboardActions;
}

export interface TreeKeyboardNav {
  activeKey: string | null;
  setActiveKey: (key: string) => void;
  /** Changes even for a navigation key that keeps the same boundary row active. */
  navigationVersion: number;
  onKeyDown: (e: React.KeyboardEvent) => void;
}

/**
 * Of the rows around `key` in `previous`, the first still shown after it, which
 * now stands where it stood, else the last still shown before it.
 */
function nearestShownKey(
  previous: FlatRow[],
  key: string | null,
  shown: Set<string>
): string | null {
  const index = previous.findIndex((row) => row.key === key);
  if (index < 0) return null;
  for (let i = index + 1; i < previous.length; i++) {
    if (shown.has(previous[i].key)) return previous[i].key;
  }
  for (let i = index - 1; i >= 0; i--) {
    if (shown.has(previous[i].key)) return previous[i].key;
  }
  return null;
}

/**
 * WAI-ARIA tree keyboard navigation over the flat row list. The explorer moves
 * DOM focus and scrolls after this hook changes the active row.
 */
export function useTreeKeyboardNav({ rows, actions }: UseTreeKeyboardNavArgs): TreeKeyboardNav {
  const [storedKey, setStoredKey] = useState<string | null>(rows[0]?.key ?? null);
  const [navigationVersion, requestNavigation] = useReducer((version: number) => version + 1, 0);
  // The rows of the last render, where a row that has since gone still stands.
  const [previousRows, setPreviousRows] = useState(rows);

  // Derive the effective active key in-render: if storedKey is no longer in the
  // visible row list (deleted or renamed, an ancestor collapsed, workspace
  // changed), fall back to the nearest row that is still shown (#521), else the
  // first row. This avoids calling setState inside an effect, satisfying
  // react-hooks/set-state-in-effect.
  const rowKeySet = useMemo(() => new Set(rows.map((r) => r.key)), [rows]);
  const activeKey =
    storedKey !== null && rowKeySet.has(storedKey)
      ? storedKey
      : (nearestShownKey(previousRows, storedKey, rowKeySet) ?? rows[0]?.key ?? null);

  // Sync storedKey when activeKey was derived to a different value.
  // We keep storedKey === activeKey so future renders don't repeat the derivation cost.
  if (storedKey !== activeKey) {
    setStoredKey(activeKey);
  }
  if (previousRows !== rows) {
    setPreviousRows(rows);
  }

  // Ref gives callbacks non-stale access to the latest row list without
  // re-creating the callbacks on every rows change.
  const rowsRef = useRef(rows);
  useEffect(() => {
    rowsRef.current = rows;
  });

  const moveTo = useCallback((index: number) => {
    const list = rowsRef.current;
    const clamped = Math.max(0, Math.min(index, list.length - 1));
    const row = list[clamped];
    if (!row) return;
    setStoredKey(row.key);
    requestNavigation();
  }, []);

  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const list = rowsRef.current;
      const activeIndex = Math.max(
        0,
        list.findIndex((r) => r.key === activeKey)
      );
      const row = list[activeIndex];
      if (!row) return;

      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault();
          moveTo(activeIndex + 1);
          break;
        case 'ArrowUp':
          e.preventDefault();
          moveTo(activeIndex - 1);
          break;
        case 'ArrowRight':
          e.preventDefault();
          if (row.isDir && !row.isExpanded) {
            actions.toggle(row);
          } else if (row.isDir && row.isExpanded) {
            moveTo(activeIndex + 1);
          }
          break;
        case 'ArrowLeft': {
          e.preventDefault();
          if (row.isDir && row.isExpanded) {
            actions.toggle(row);
          } else {
            for (let i = activeIndex - 1; i >= 0; i--) {
              if (list[i].depth < row.depth) {
                moveTo(i);
                break;
              }
            }
          }
          break;
        }
        case 'Home':
          e.preventDefault();
          moveTo(0);
          break;
        case 'End':
          e.preventDefault();
          moveTo(list.length - 1);
          break;
        case 'Enter':
          e.preventDefault();
          if (row.isDir) actions.toggle(row);
          else actions.open(row);
          break;
        case ' ':
          e.preventDefault();
          actions.select(row);
          break;
        default:
          break;
      }
    },
    [activeKey, actions, moveTo]
  );

  return {
    activeKey,
    setActiveKey: setStoredKey,
    navigationVersion,
    onKeyDown,
  };
}
