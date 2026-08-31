import { readdirSync, readFileSync, statSync } from 'fs';
import { join, resolve } from 'path';

const SRC = resolve(__dirname, '../..');
const ADAPTER_DIR = resolve(SRC, 'wails');

// Matches wailsjs inside import specifiers, dynamic imports, requires,
// bare side-effect imports, and jest.mock arguments. The adapter directory
// is the only exemption.
const DIRECT_REF =
  /(?:from\s+|import\(|require\(|jest\.mock\(\s*|import\s+)['"][^'"]*wailsjs[^'"]*['"]/;

function walk(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (full === ADAPTER_DIR) continue;
      walk(full, acc);
    } else if (/\.(ts|tsx|js)$/.test(entry)) {
      acc.push(full);
    }
  }
  return acc;
}

const files = walk(SRC);

it('scans a non-trivial number of files (anti-vacuity floor)', () => {
  expect(files.length).toBeGreaterThan(200);
});

it('no file outside src/wails references wailsjs', () => {
  const offenders = files.filter((f) => DIRECT_REF.test(readFileSync(f, 'utf-8')));
  expect(offenders).toEqual([]);
});
