import { readFileSync } from 'fs';
import { resolve } from 'path';

const css = readFileSync(resolve(__dirname, '../../styles/tokens.css'), 'utf8');
const terminalCss = readFileSync(
  resolve(__dirname, '../../components/Terminal/Terminal.module.css'),
  'utf8'
);
const treeRowCss = readFileSync(
  resolve(__dirname, '../../components/FileExplorer/TreeRow.module.css'),
  'utf8'
);
const fileExplorerCss = readFileSync(
  resolve(__dirname, '../../components/FileExplorer/FileExplorer.module.css'),
  'utf8'
);
const editorCss = readFileSync(
  resolve(__dirname, '../../components/Editor/Editor.module.css'),
  'utf8'
);

type RGB = [number, number, number];

const WORKSPACE_ACCENTS = [
  'project',
  'blue',
  'green',
  'cyan',
  'orange',
  'purple',
  'amber',
  'general',
] as const;

function token(name: string): string {
  const value = css.match(new RegExp(`--${name}:\\s*(#[0-9a-f]{6})\\b`, 'i'))?.[1];
  if (!value) throw new Error(`Missing hex token --${name}`);
  return value;
}

function parseHex(hex: string): RGB {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as RGB;
}

function composite(foreground: RGB, background: RGB, alpha: number): RGB {
  return foreground.map(
    (channel, index) => channel * alpha + background[index] * (1 - alpha)
  ) as RGB;
}

function luminance(rgb: RGB): number {
  const linear = rgb
    .map((channel) => channel / 255)
    .map((channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrast(a: RGB, b: RGB): number {
  const aLuminance = luminance(a);
  const bLuminance = luminance(b);
  return (Math.max(aLuminance, bLuminance) + 0.05) / (Math.min(aLuminance, bLuminance) + 0.05);
}

function rule(source: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const body = source.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`, 's'))?.[1];
  if (!body) throw new Error(`Missing CSS rule ${selector}`);
  return body;
}

function opacity(source: string, selector: string): number {
  return Number(rule(source, selector).match(/opacity:\s*([\d.]+)/)?.[1] ?? 1);
}

function focusColor(selector: string, accent: (typeof WORKSPACE_ACCENTS)[number]): string {
  const focusVariable = rule(editorCss, selector).match(
    /outline(?:-color)?:[^;]*var\(--([\w-]+)\)/
  )?.[1];
  if (!focusVariable) throw new Error(`Missing focus color for ${selector}`);
  return focusVariable === 'tab-accent' || focusVariable === 'accent'
    ? token(`accent-${accent}`)
    : token(focusVariable);
}

it('uses one full-strength outer rail and one adjacent 50% ownership rail without shadows', () => {
  const outerRail = rule(fileExplorerCss, '.workspaceTree');
  const ownershipRail = rule(treeRowCss, '.row.ownershipRail::before');

  expect(outerRail).toMatch(/border-left:\s*3px solid var\(--tree-accent\)/);
  expect(ownershipRail).toMatch(/background:\s*var\(--ownership-accent\)/);
  expect(ownershipRail).toMatch(/opacity:\s*0\.5/);
  expect(`${outerRail}\n${ownershipRail}`).not.toMatch(/(?:box-shadow|filter):/);
  expect(treeRowCss).not.toMatch(/\.row\.ownershipRail::after/);
});

it.each([
  'surface-base',
  'surface-frame',
  'surface-panel',
  'surface-elevated',
  'surface-hover',
  'surface-active',
])('keeps muted text at 4.5:1 or better on --%s', (surface) => {
  expect(contrast(parseHex(token('text-muted')), parseHex(token(surface)))).toBeGreaterThanOrEqual(
    4.5
  );
});

it.each([
  ['Terminal problem source', terminalCss, '.problemsSource', 'surface-panel'],
  ['hidden folder name', treeRowCss, '.row[data-hidden] .name', 'surface-panel'],
  ['hidden folder name on hover', treeRowCss, '.row[data-hidden] .name', 'surface-hover'],
] as const)('keeps the real %s consumer at 4.5:1 or better', (_name, source, selector, surface) => {
  const background = parseHex(token(surface));
  const foreground = composite(
    parseHex(token('text-muted')),
    background,
    opacity(source, selector)
  );
  expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
});

it.each(WORKSPACE_ACCENTS)(
  'keeps a hidden folder name at 4.5:1 or better on the selected %s tint',
  (accent) => {
    const selectedRule = rule(treeRowCss, ".row.tinted[aria-selected='true']");
    const tint = Number(
      selectedRule.match(/var\(--region-accent\)\s*([\d.]+)%,\s*transparent/)?.[1]
    );
    if (!Number.isFinite(tint)) throw new Error('Missing selected tree-row tint');

    const panel = parseHex(token('surface-panel'));
    const background = composite(parseHex(token(`accent-${accent}`)), panel, tint / 100);
    const foreground = composite(
      parseHex(token('text-muted')),
      background,
      opacity(treeRowCss, '.row[data-hidden] .name')
    );
    expect(contrast(foreground, background)).toBeGreaterThanOrEqual(4.5);
  }
);

it.each(['surface-panel', 'surface-hover', 'surface-active'])(
  'keeps the unreadable marker at 3:1 or better on --%s',
  (surface) => {
    expect(rule(treeRowCss, '.unreadable')).toMatch(/color:\s*var\(--status-warning\)/);
    expect(
      contrast(parseHex(token('status-warning')), parseHex(token(surface)))
    ).toBeGreaterThanOrEqual(3);
  }
);

it.each(WORKSPACE_ACCENTS)(
  'keeps the unreadable marker at 3:1 or better on the selected %s tint',
  (accent) => {
    const selectedRule = rule(treeRowCss, ".row.tinted[aria-selected='true']");
    const tint = Number(
      selectedRule.match(/var\(--region-accent\)\s*([\d.]+)%,\s*transparent/)?.[1]
    );
    if (!Number.isFinite(tint)) throw new Error('Missing selected tree-row tint');

    const background = composite(
      parseHex(token(`accent-${accent}`)),
      parseHex(token('surface-panel')),
      tint / 100
    );
    expect(contrast(parseHex(token('status-warning')), background)).toBeGreaterThanOrEqual(3);
  }
);

it.each(WORKSPACE_ACCENTS)(
  'keeps the %s active editor-tab focus indicator at 3:1 or better',
  (accent) => {
    expect(
      contrast(
        parseHex(focusColor('.tabTarget:focus-visible', accent)),
        parseHex(token('surface-active'))
      )
    ).toBeGreaterThanOrEqual(3);
  }
);

it.each(WORKSPACE_ACCENTS)(
  'keeps the %s editor close-button focus indicator at 3:1 or better',
  (accent) => {
    expect(
      contrast(
        parseHex(focusColor('.tabClose:focus-visible', accent)),
        parseHex(token('surface-active'))
      )
    ).toBeGreaterThanOrEqual(3);
  }
);

it.each(['.tabTarget:focus-visible', '.tabClose:focus-visible'])(
  'uses the shared focus-ring token for %s',
  (selector) => {
    expect(rule(editorCss, selector)).toMatch(/outline:\s*2px solid var\(--focus-ring\)/);
  }
);
