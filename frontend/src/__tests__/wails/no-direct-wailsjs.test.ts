import { readdirSync, readFileSync, statSync } from 'fs';
import { join, resolve } from 'path';

const SRC = resolve(__dirname, '../..');
const ADAPTER_DIR = resolve(SRC, 'wails');
// This guard's own source contains the literal substrings both patterns
// below look for (the regexes are built out of the same words they scan
// for), so it would flag itself if scanned. Exempt it by exact path rather
// than contorting the regexes to dodge their own source text.
const SELF = resolve(__filename);

// Matches wailsjs inside import specifiers, dynamic imports, requires,
// bare side-effect imports, and every jest mocking entry point that can name
// a module path by string. The adapter directory (and this file) are the
// only exemptions.
const DIRECT_REF =
  /(?:from\s+|import\(|require\(|jest\.mock\(\s*|jest\.requireActual\(\s*|jest\.doMock\(\s*|jest\.setMock\(\s*|jest\.unmock\(\s*|import\s+)['"`][^'"`]*wailsjs[^'"`]*['"`]/;

// The raw v2 `window.runtime` / `window.go` globals need no import at all,
// so DIRECT_REF can't see them.
const RAW_GLOBAL = /window\s*\.\s*(runtime|go)\b/;

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (full === ADAPTER_DIR) continue;
      walk(full, acc);
    } else if (/\.(ts|tsx|js|jsx|mjs|cjs|mts)$/.test(entry) && full !== SELF) {
      acc.push(full);
    }
  }
  return acc;
}

const files = walk(SRC);

// firstOffenseLine returns the 1-based line number of whichever pattern
// matches earliest in the file, or null if neither matches.
function firstOffenseLine(content: string): number | null {
  const directIdx = content.search(DIRECT_REF);
  const globalIdx = content.search(RAW_GLOBAL);
  const idx =
    directIdx === -1 ? globalIdx : globalIdx === -1 ? directIdx : Math.min(directIdx, globalIdx);
  return idx === -1 ? null : content.slice(0, idx).split('\n').length;
}

it('scans a non-trivial number of files (anti-vacuity floor)', () => {
  expect(files.length).toBeGreaterThan(200);
});

it('no file outside src/wails references wailsjs directly or reaches the raw v2 globals', () => {
  const offenders: string[] = [];
  for (const f of files) {
    const line = firstOffenseLine(readFileSync(f, 'utf-8'));
    if (line !== null) offenders.push(`${f}:${line}`);
  }
  expect(offenders).toEqual([]);
});
