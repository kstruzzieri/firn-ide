/**
 * Everything a card cut short, in full, beside the card: fixed-position, placed
 * from the card's rect, and PORTALED to the body so no ancestor can clip it —
 * the git BranchSwitcher's pattern, the one the spec names for this. Both halves
 * are load-bearing: the grid is a bounded scroller, and `.root` is a query
 * container with `overflow: auto`, which WebKit before 18.2 treats as the
 * containing block for a fixed descendant (bug 284945). Firn's macOS floor still
 * ships Safari 17.6, so left inside that subtree the popup would be placed
 * against the workspace and clipped by it. Every token it reads is `:root`-scoped,
 * so the portal costs it nothing.
 *
 * Hoverable (WCAG 1.4.13): the owner keeps it open while the pointer is on it.
 * The strip's note line is the keyboard-reachable copy of the long text.
 */
import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import styles from './GolemConfig.module.css';

export interface CardInfo {
  name: string;
  type: string;
  facts: string;
  abilities: string;
  notes: { role: string; description: string }[];
  usedBy: string[];
}

export function ModelCardPopup({
  id,
  open,
  anchor,
  info,
  layoutKey,
  onEnter,
  onLeave,
}: {
  id: string;
  open: boolean;
  anchor: HTMLElement | null;
  info: CardInfo | null;
  layoutKey: string;
  onEnter: () => void;
  /** The pointer left the popup; `buttons` says whether a drag is still going. */
  onLeave: (event: React.MouseEvent) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState({ left: 16, top: 8 });
  useLayoutEffect(() => {
    // Same condition the render bails on: no listeners around a measure that
    // could only ever return early.
    if (!open || anchor === null || info === null) return;
    const measure = () => {
      const node = ref.current;
      if (node === null) return;
      const r = anchor.getBoundingClientRect();
      const w = node.offsetWidth;
      const h = node.offsetHeight;
      let top = r.bottom + 6;
      if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 6);
      setPlace({ left: Math.max(16, Math.min(r.left, window.innerWidth - w - 16)), top });
    };
    measure();
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    // The island the workspace lives in resizes without a window resize (its
    // drag handle): watch the grid the anchor sits in. The guard is for hosts
    // with no ResizeObserver; Jest installs an inert mock, so the tests ride on
    // `layoutKey` and the two events instead of on the observer.
    const grid = anchor.parentElement; // HTMLElement | null under strict TS
    const observer =
      typeof ResizeObserver === 'undefined' || grid === null
        ? null
        : new ResizeObserver(() => measure());
    if (grid !== null) observer?.observe(grid);
    return () => {
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
      observer?.disconnect();
    };
    // layoutKey: a neighbour leaving the grid, or a blocked card being
    // revealed, moves a surviving anchor with no scroll or resize event;
    // React compares these by identity, so the key re-runs placement then.
  }, [open, anchor, info, layoutKey]);
  if (!open || info === null) return null;
  return createPortal(
    <div
      ref={ref}
      className={styles.cardPop}
      role="tooltip"
      id={id}
      style={{ left: place.left, top: place.top }}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
    >
      <div className={styles.cardPopHead}>
        <span className={styles.cardPopName}>{info.name}</span>
      </div>
      <div className={styles.cardPopRow}>
        <span className={styles.cardPopKey}>type</span>
        <span className={styles.cardPopVal}>{info.type}</span>
      </div>
      {info.facts !== '' && (
        <div className={styles.cardPopRow}>
          <span className={styles.cardPopKey}>size</span>
          <span className={styles.cardPopVal}>{info.facts}</span>
        </div>
      )}
      <div className={styles.cardPopRow}>
        <span className={styles.cardPopKey}>can do</span>
        <span className={styles.cardPopVal}>{info.abilities}</span>
      </div>
      {info.notes.length > 0 && (
        <div className={styles.cardPopRow}>
          <span className={styles.cardPopKey}>{info.notes.length > 1 ? 'notes' : 'note'}</span>
          <span className={`${styles.cardPopVal} ${styles.cardPopProse}`}>
            {info.notes.map((note) => (
              <p key={note.role}>
                {info.notes.length > 1 && <span className={styles.cardPopRole}>{note.role}</span>}
                {note.description}
              </p>
            ))}
          </span>
        </div>
      )}
      <div className={styles.cardPopRow}>
        <span className={styles.cardPopKey}>used by</span>
        <span className={styles.cardPopVal}>
          {info.usedBy.length > 0 ? info.usedBy.join(', ') : '—'}
        </span>
      </div>
    </div>,
    document.body
  );
}
