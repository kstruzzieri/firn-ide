import { readFileSync } from 'fs';
import { resolve } from 'path';

/**
 * A workspace accent is defined in three places that no compiler checks against
 * each other: Go emits the string, TypeScript narrows it, CSS resolves it to a
 * colour. Drift is silent — accentVar() falls back to the neutral "project"
 * accent, so a workspace simply loses its colour with no error anywhere.
 *
 * These tests close that loop.
 */
const repoRoot = resolve(__dirname, '../../..');
const detectGo = readFileSync(resolve(repoRoot, 'internal/workspace/detect.go'), 'utf8');
const ideStore = readFileSync(resolve(__dirname, '../stores/ideStore.ts'), 'utf8');
const tokensCss = readFileSync(resolve(__dirname, '../styles/tokens.css'), 'utf8');

/** Accent strings Go can emit: markerRules entries, the frontend special case, and the synthetic project entry. */
function goAccents(): string[] {
  const matches = detectGo.matchAll(
    /(?:accent|Accent):\s*"([a-z]+)"|return\s+Type\w+,\s*"([a-z]+)",\s*true/g
  );
  return [...new Set([...matches].map((m) => m[1] ?? m[2]))].sort();
}

function unionAccents(): string[] {
  const body = ideStore.match(/export type WorkspaceAccent =([^;]*);/)?.[1];
  if (!body) throw new Error('Missing WorkspaceAccent union in ideStore.ts');
  return [...body.matchAll(/'([a-z]+)'/g)].map((m) => m[1]).sort();
}

/**
 * --accent-dark/dim/glow are per-accent derived values, re-set inside every
 * [data-accent] block rather than being accents themselves. They are excluded by
 * name because that is a structural fact of the token system, not a value list.
 */
const DERIVED_ACCENT_VARS = ['dark', 'dim', 'glow'];

function tokenAccents(): string[] {
  // Scoped to :root so the derived --accent-dark hex inside each [data-accent]
  // block cannot be mistaken for an accent definition.
  const root = tokensCss.match(/:root\s*\{([\s\S]*?)\n\}/)?.[1];
  if (!root) throw new Error('Missing :root block in tokens.css');
  return [...root.matchAll(/^\s*--accent-([a-z]+):\s*#/gm)]
    .map((m) => m[1])
    .filter((name) => !DERIVED_ACCENT_VARS.includes(name))
    .sort();
}

function dataAccentBlocks(): string[] {
  return [...tokensCss.matchAll(/\[data-accent='([a-z]+)'\]/g)].map((m) => m[1]).sort();
}

/**
 * Every assertion below is a `.filter(...).toEqual([])`, which passes trivially
 * on an empty scan. If detect.go stopped using accent string literals — deriving
 * them from the type, say — the Go scan would silently find nothing and the
 * cross-language guards would all go green while checking nothing at all.
 * These floors make that refactor fail loudly instead.
 */
it('finds the accents it claims to be checking, rather than scanning nothing', () => {
  // Every workspace type a marker rule can currently produce, plus the
  // synthetic project entry. Adding a type should raise this, not bypass it.
  expect(goAccents()).toEqual(
    expect.arrayContaining(['docker', 'frontend', 'go', 'node', 'project', 'python', 'terraform'])
  );
  expect(unionAccents().length).toBeGreaterThanOrEqual(goAccents().length);
  expect(tokenAccents().length).toBeGreaterThanOrEqual(unionAccents().length);
  expect(dataAccentBlocks().length).toBeGreaterThanOrEqual(unionAccents().length);
});

it('emits no accent from Go that TypeScript does not accept', () => {
  const union = unionAccents();
  expect(goAccents().filter((accent) => !union.includes(accent))).toEqual([]);
});

it('emits no accent from Go without a --accent-* token', () => {
  const tokens = tokenAccents();
  expect(goAccents().filter((accent) => !tokens.includes(accent))).toEqual([]);
});

it('declares no accent in the union without a token and a [data-accent] block', () => {
  const tokens = tokenAccents();
  const blocks = dataAccentBlocks();
  // 'project' is the neutral fallback and is defined via --accent-project.
  expect(unionAccents().filter((accent) => !tokens.includes(accent))).toEqual([]);
  expect(unionAccents().filter((accent) => !blocks.includes(accent))).toEqual([]);
});

it('leaves no --accent-* token unreachable from the union', () => {
  const union = unionAccents();
  expect(tokenAccents().filter((accent) => !union.includes(accent))).toEqual([]);
});

it('keeps the generic --palette-* ramp out of the workspace accent set', () => {
  // The ramp exists for UI needing distinguishable colours with no workspace
  // meaning. If a palette name leaks into the union, a hue change starts
  // repointing a workspace.
  const ramp = [...tokensCss.matchAll(/^\s*--palette-([a-z]+):/gm)].map((m) => m[1]);
  expect(ramp.length).toBeGreaterThan(0);
  expect(ramp.filter((name) => unionAccents().includes(name))).toEqual([]);
});
