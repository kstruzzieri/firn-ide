import type { MatchRange } from '../types/search';

export interface SearchTextSegment {
  text: string;
  isMatch: boolean;
}

const encoder = new TextEncoder();

/**
 * Converts a UTF-8 byte offset (as reported by ripgrep) into the JavaScript
 * UTF-16 string index of the same boundary.
 *
 * Behavior:
 *   - Negative or non-finite offsets return 0.
 *   - Offsets past `text`'s UTF-8 byte length clamp to `text.length`.
 *   - Offsets that fall *inside* a multi-byte codepoint return the boundary
 *     before the codepoint (so the caller never lands inside a UTF-16
 *     surrogate pair, and never splits a Unicode character mid-stream).
 *
 * The conversion is approximate when the line text contains U+FFFD
 * replacement characters that the backend substituted for invalid UTF-8
 * (`internal/search/parser.go` does this), because the byte offsets refer
 * to the original ripgrep bytes while the substituted text differs in byte
 * length. Source-code lines with valid UTF-8 — the realistic case — convert
 * exactly.
 */
export function byteOffsetToCharIndex(text: string, byteOffset: number): number {
  if (!Number.isFinite(byteOffset) || byteOffset <= 0) return 0;

  const target = Math.trunc(byteOffset);
  let byteCount = 0;

  for (let index = 0; index < text.length; ) {
    const codePoint = text.codePointAt(index);
    if (codePoint === undefined) break;

    const char = String.fromCodePoint(codePoint);
    const nextByteCount = byteCount + encoder.encode(char).length;
    if (nextByteCount > target) {
      return index;
    }

    byteCount = nextByteCount;
    index += char.length;

    if (byteCount === target) {
      return index;
    }
  }

  return text.length;
}

/**
 * Converts a 1-based UTF-8 byte column (as reported by ripgrep on a
 * `LineMatch`) into a 1-based UTF-16 character column suitable for
 * `navigateToEditorLocation()`.
 *
 * Columns at or below 1 clamp to 1; columns past line end clamp to one past
 * the last character.
 */
export function byteColumnToCharColumn(text: string, byteColumn: number): number {
  const zeroBasedByteOffset = Math.max(0, Math.trunc(byteColumn) - 1);
  return byteOffsetToCharIndex(text, zeroBasedByteOffset) + 1;
}

/**
 * Normalizes match ranges by sorting, dropping zero/negative-width entries,
 * and merging overlaps so the renderer never produces unexpected gaps.
 *
 * ripgrep's submatches per match event are non-overlapping in practice, but
 * defensive normalization keeps `splitLineByByteRanges` correct under any
 * input — including unsorted ranges from upstream callers and overlap
 * artifacts that could arise once Task 3 layers regex group highlighting on
 * top of literal-match ranges.
 */
function normalizeRanges(ranges: readonly MatchRange[]): MatchRange[] {
  const cleaned = ranges
    .map((r) => ({
      start: Math.max(0, Math.trunc(r.start)),
      end: Math.max(0, Math.trunc(r.end)),
    }))
    .filter((r) => r.end > r.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  if (cleaned.length === 0) return [];

  const merged: MatchRange[] = [{ start: cleaned[0].start, end: cleaned[0].end }];
  for (let i = 1; i < cleaned.length; i++) {
    const last = merged[merged.length - 1];
    const curr = cleaned[i];
    if (curr.start < last.end) {
      // Strict overlap: extend the previous range. Touching ranges
      // (curr.start === last.end) stay separate so two adjacent literal
      // matches render as two highlights, preserving the user's match count.
      last.end = Math.max(last.end, curr.end);
    } else {
      merged.push({ start: curr.start, end: curr.end });
    }
  }
  return merged;
}

/**
 * Splits `text` into alternating match/non-match segments at the given byte
 * ranges. Used by the search panel to render highlighted spans.
 *
 * Overlapping or out-of-order input ranges are normalized first; the result
 * is a flat list of segments in document order, with adjacent matches
 * preserved as separate segments so the renderer can distinguish "two matches
 * touching" from "one wide match" if it ever needs to.
 */
export function splitLineByByteRanges(
  text: string,
  ranges: readonly MatchRange[]
): SearchTextSegment[] {
  const normalized = normalizeRanges(ranges);
  if (normalized.length === 0) {
    return [{ text, isMatch: false }];
  }

  const segments: SearchTextSegment[] = [];
  let cursor = 0;
  for (const range of normalized) {
    const start = Math.max(cursor, byteOffsetToCharIndex(text, range.start));
    const end = Math.max(start, byteOffsetToCharIndex(text, range.end));
    if (end <= start) continue;

    if (start > cursor) {
      segments.push({ text: text.slice(cursor, start), isMatch: false });
    }
    segments.push({ text: text.slice(start, end), isMatch: true });
    cursor = end;
  }

  if (cursor < text.length) {
    segments.push({ text: text.slice(cursor), isMatch: false });
  }

  return segments.length > 0 ? segments : [{ text, isMatch: false }];
}
