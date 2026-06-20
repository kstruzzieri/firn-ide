// src/components/FileExplorer/useTreeKeyboardNav.ts
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FlatRow } from '../../utils/flattenTree';
import { rowDomId } from './TreeRow';

export interface TreeKeyboardActions {
  /** Toggle expand/collapse (root → root toggle, entry dir → expandedPaths). */
  toggle: (row: FlatRow) => void;
  /** Select an entry (highlight). */
  select: (row: FlatRow) => void;
  /** Open an entry (files only). */
  open: (row: FlatRow) => void;
}

/** Minimal slice of the virtualizer the hook needs. */
export interface ScrollToIndex {
  scrollToIndex: (index: number, options?: { align?: 'auto' | 'start' | 'center' | 'end' }) => void;
}

export interface UseTreeKeyboardNavArgs {
  rows: FlatRow[];
  actions: TreeKeyboardActions;
  virtualizer: ScrollToIndex;
}

export interface TreeKeyboardNav {
  activeKey: string | null;
  setActiveKey: (key: string) => void;
  /** DOM id of the active row for aria-activedescendant; undefined if none. */
  activeId: string | undefined;
  onKeyDown: (e: React.KeyboardEvent) => void;
}

/**
 * WAI-ARIA tree keyboard navigation over the flat row list. The container is the
 * single tab stop; this hook tracks the active descendant and translates arrow
 * keys to focus moves / expand-collapse, keeping the active row scrolled in view.
 */
export function useTreeKeyboardNav({
  rows,
  actions,
  virtualizer,
}: UseTreeKeyboardNavArgs): TreeKeyboardNav {
  const [storedKey, setStoredKey] = useState<string | null>(rows[0]?.key ?? null);

  // Derive the effective active key in-render: if storedKey is no longer in the
  // visible row list (rows collapsed, workspace changed), fall back to the first row.
  // This avoids calling setState inside an effect, satisfying react-hooks/set-state-in-effect.
  const rowKeys = rows.map((r) => r.key);
  const activeKey =
    storedKey !== null && rowKeys.includes(storedKey) ? storedKey : (rows[0]?.key ?? null);

  // Sync storedKey when activeKey was derived to a different value.
  // We keep storedKey === activeKey so future renders don't repeat the derivation cost.
  if (storedKey !== activeKey) {
    setStoredKey(activeKey);
  }

  // Ref gives callbacks non-stale access to the latest row list without
  // re-creating the callbacks on every rows change.
  const rowsRef = useRef(rows);
  useEffect(() => {
    rowsRef.current = rows;
  });

  const moveTo = useCallback(
    (index: number) => {
      const list = rowsRef.current;
      const clamped = Math.max(0, Math.min(index, list.length - 1));
      const row = list[clamped];
      if (!row) return;
      setStoredKey(row.key);
      virtualizer.scrollToIndex(clamped, { align: 'auto' });
    },
    [virtualizer]
  );

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
    activeId: activeKey ? rowDomId(activeKey) : undefined,
    onKeyDown,
  };
}
