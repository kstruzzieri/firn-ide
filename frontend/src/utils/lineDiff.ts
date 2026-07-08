// Line-level diff for the editor's git gutter. A small Myers diff over lines
// keeps this dependency-free and jest-friendly; the merge-view package does
// its own char-level diffing and is not needed here.

export interface LineHunk {
  /** 0-based line range removed from the baseline (fromA <= toA, exclusive). */
  fromA: number;
  toA: number;
  /** 0-based line range inserted in the current text (exclusive). */
  fromB: number;
  toB: number;
}

export interface GitLineMarker {
  /** 1-based line number in the current document. */
  line: number;
  type: 'added' | 'modified' | 'deleted';
}

export function splitLines(text: string): string[] {
  if (text === '') return [];
  const lines = text.split('\n');
  // A trailing newline produces a phantom empty last element.
  if (lines[lines.length - 1] === '') lines.pop();
  return lines;
}

/**
 * Myers O(ND) diff over lines, returning maximal change hunks.
 * ponytail: quadratic worst case on pathological inputs; the git backend
 * already caps diffable content at 1MB so N stays sane.
 */
export function diffLines(baseline: string, current: string): LineHunk[] {
  return diffSequences(splitLines(baseline), splitLines(current));
}

/**
 * Myers diff over two token sequences (lines or characters), returning change
 * hunks with 0-based ranges into each side.
 */
export function diffSequences(a: string[], b: string[]): LineHunk[] {
  const n = a.length;
  const m = b.length;

  // Trim common prefix/suffix — the usual case is a small edit in a big file.
  let start = 0;
  while (start < n && start < m && a[start] === b[start]) start++;
  let endA = n;
  let endB = m;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA--;
    endB--;
  }
  if (start === endA && start === endB) return [];

  const subA = a.slice(start, endA);
  const subB = b.slice(start, endB);
  const trace = myersTrace(subA, subB);
  return backtrackHunks(trace, subA, subB).map((h) => ({
    fromA: h.fromA + start,
    toA: h.toA + start,
    fromB: h.fromB + start,
    toB: h.toB + start,
  }));
}

function myersTrace(a: string[], b: string[]): Int32Array[] {
  const n = a.length;
  const m = b.length;
  const max = n + m;
  const offset = max;
  let v = new Int32Array(2 * max + 1);
  const trace: Int32Array[] = [];

  for (let d = 0; d <= max; d++) {
    trace.push(v.slice());
    for (let k = -d; k <= d; k += 2) {
      let x: number;
      if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) {
        x = v[offset + k + 1]; // down: insertion from b
      } else {
        x = v[offset + k - 1] + 1; // right: deletion from a
      }
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x++;
        y++;
      }
      v[offset + k] = x;
      if (x >= n && y >= m) {
        trace.push(v.slice());
        return trace;
      }
    }
    v = v.slice() as Int32Array<ArrayBuffer>;
  }
  return trace;
}

function backtrackHunks(trace: Int32Array[], a: string[], b: string[]): LineHunk[] {
  const offset = a.length + b.length;
  let x = a.length;
  let y = b.length;
  // Collect edit points (deleted a-lines, inserted b-lines) walking backwards.
  const deletedA = new Set<number>();
  const insertedB = new Set<number>();

  for (let d = trace.length - 2; d >= 0 && (x > 0 || y > 0); d--) {
    const v = trace[d];
    const k = x - y;
    let prevK: number;
    if (k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])) {
      prevK = k + 1;
    } else {
      prevK = k - 1;
    }
    const prevX = v[offset + prevK];
    const prevY = prevX - prevK;
    while (x > prevX && y > prevY) {
      x--;
      y--;
    }
    if (d > 0) {
      if (x === prevX) {
        insertedB.add(prevY); // moved down: b[prevY] inserted
      } else {
        deletedA.add(prevX); // moved right: a[prevX] deleted
      }
    }
    x = prevX;
    y = prevY;
  }

  // Coalesce edit points into hunks by walking both sequences forward.
  const hunks: LineHunk[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length || j < b.length) {
    if (deletedA.has(i) || insertedB.has(j)) {
      const fromA = i;
      const fromB = j;
      while (i < a.length && deletedA.has(i)) i++;
      while (j < b.length && insertedB.has(j)) j++;
      hunks.push({ fromA, toA: i, fromB, toB: j });
    } else {
      i++;
      j++;
    }
  }
  return hunks;
}

/**
 * Converts hunks into per-line gutter markers on the current document.
 * currentLineCount bounds deletion anchors: a removal is shown on the line
 * following the removal point, or the last line when it falls at EOF.
 */
export function markersFromHunks(hunks: LineHunk[], currentLineCount: number): GitLineMarker[] {
  const markers: GitLineMarker[] = [];
  for (const h of hunks) {
    if (h.fromB === h.toB) {
      markers.push({
        line: Math.max(1, Math.min(h.fromB + 1, currentLineCount)),
        type: 'deleted',
      });
      continue;
    }
    const type = h.fromA === h.toA ? 'added' : 'modified';
    for (let line = h.fromB + 1; line <= h.toB; line++) {
      markers.push({ line, type });
    }
  }
  return markers;
}

/** One-call convenience: markers for `current` against `baseline`. */
export function gitLineMarkers(baseline: string, current: string): GitLineMarker[] {
  return markersFromHunks(diffLines(baseline, current), splitLines(current).length);
}

export interface InlineDiffSegment {
  text: string;
  /** `same` = unchanged, `del` = only in the baseline, `ins` = only in the working tree. */
  type: 'same' | 'del' | 'ins';
}

/** Splits text into whitespace and non-whitespace runs, preserving content. */
function tokenizeWords(text: string): string[] {
  return text.match(/\s+|\S+/g) ?? [];
}

/**
 * Unified word-level diff of `oldText` (baseline) against `newText` (working
 * tree) as a segment list. Word granularity keeps boundaries clean (whole-word
 * replaces, no mid-word splits). The concatenation of non-`ins` segments
 * reproduces `oldText`, and of non-`del` segments reproduces `newText`, so the
 * peek can render both sides distinctly (JetBrains-style inline diff).
 */
export function inlineWordDiff(oldText: string, newText: string): InlineDiffSegment[] {
  const oldTokens = tokenizeWords(oldText);
  const newTokens = tokenizeWords(newText);
  const segments: InlineDiffSegment[] = [];
  let ai = 0;
  for (const h of diffSequences(oldTokens, newTokens)) {
    if (h.fromA > ai) segments.push({ text: oldTokens.slice(ai, h.fromA).join(''), type: 'same' });
    if (h.toA > h.fromA) {
      segments.push({ text: oldTokens.slice(h.fromA, h.toA).join(''), type: 'del' });
    }
    if (h.toB > h.fromB) {
      segments.push({ text: newTokens.slice(h.fromB, h.toB).join(''), type: 'ins' });
    }
    ai = h.toA;
  }
  if (ai < oldTokens.length) segments.push({ text: oldTokens.slice(ai).join(''), type: 'same' });
  return segments;
}

/**
 * Character-range edit that reverts a single hunk back to its baseline text,
 * as a `{ from, to, insert }` suitable for CodeMirror's `changes`. Pure over
 * strings so it stays testable without a live editor. Restoring every hunk of
 * a diff (applied right-to-left to keep offsets stable) reproduces `baseline`.
 */
export function revertHunkChange(
  currentText: string,
  baselineText: string,
  hunk: LineHunk
): { from: number; to: number; insert: string } {
  const curLines = splitLines(currentText);
  const restored = splitLines(baselineText).slice(hunk.fromA, hunk.toA);

  // Char offset of the start of each current line; lineStart[i] is valid for
  // 0 <= i <= curLines.length (the last entry points just past the document).
  const lineStart: number[] = [0];
  for (let i = 0; i < curLines.length; i++) {
    lineStart.push(lineStart[i] + curLines[i].length + 1);
  }
  const lineEnd = (i: number) => lineStart[i] + curLines[i].length;

  // Pure deletion in the working tree (baseline lines vanished): re-insert them.
  if (hunk.fromB === hunk.toB) {
    if (curLines.length === 0) {
      return { from: 0, to: 0, insert: restored.join('\n') };
    }
    if (hunk.fromB < curLines.length) {
      const pos = lineStart[hunk.fromB];
      return { from: pos, to: pos, insert: restored.join('\n') + '\n' };
    }
    const pos = lineEnd(curLines.length - 1); // append past the final line
    return { from: pos, to: pos, insert: '\n' + restored.join('\n') };
  }

  // Replace / delete current lines [fromB, toB).
  let from = lineStart[hunk.fromB];
  let to = lineEnd(hunk.toB - 1);
  if (restored.length > 0) {
    return { from, to, insert: restored.join('\n') };
  }
  // Pure addition being reverted: also consume one line break so no blank line
  // is left behind.
  if (hunk.toB < curLines.length) {
    to = lineStart[hunk.toB];
  } else if (hunk.fromB > 0) {
    from = lineEnd(hunk.fromB - 1);
  }
  return { from, to, insert: '' };
}
