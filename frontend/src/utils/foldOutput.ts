import type { OutputEntry, FoldedRegion, FoldedItem } from '../types/runOutput';

const MIN_FOLD_SIZE = 10;
const PREFIX_LENGTH = 6;

function createFoldId(summary: string, entries: OutputEntry[]): string {
  const first = entries[0];
  const last = entries[entries.length - 1];
  const head = entries
    .slice(0, 3)
    .map((e) => e.text)
    .join('\n');
  const tail = entries
    .slice(-3)
    .map((e) => e.text)
    .join('\n');
  const raw = `${summary}|${entries.length}|${first?.timestamp}|${first?.text}|${first?.stream}|${last?.timestamp}|${last?.text}|${last?.stream}|${head}|${tail}`;
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = ((hash << 5) - hash + raw.charCodeAt(i)) | 0;
  }
  return `fold-${hash.toString(36)}`;
}

export function foldOutput(entries: OutputEntry[]): FoldedItem[] {
  if (entries.length < MIN_FOLD_SIZE) return entries;

  const result: FoldedItem[] = [];
  let i = 0;

  while (i < entries.length) {
    const prefix = getPrefix(entries[i].text);

    if (prefix.length >= PREFIX_LENGTH) {
      let j = i + 1;
      while (j < entries.length && getPrefix(entries[j].text) === prefix) {
        j++;
      }

      const runLength = j - i;
      if (runLength >= MIN_FOLD_SIZE) {
        const foldEntries = entries.slice(i, j);
        const summary = `${prefix.trim()} — ${inferCategory(prefix)}`;
        result.push({
          kind: 'fold',
          id: createFoldId(summary, foldEntries),
          summary,
          lineCount: runLength,
          entries: foldEntries,
        } as FoldedRegion);
        i = j;
        continue;
      }
    }

    result.push(entries[i]);
    i++;
  }

  return result;
}

function getPrefix(text: string): string {
  const spaceIdx = text.indexOf(' ', PREFIX_LENGTH);
  if (spaceIdx === -1) return text.slice(0, PREFIX_LENGTH);
  return text.slice(0, spaceIdx);
}

function inferCategory(prefix: string): string {
  const p = prefix.trim().toLowerCase();
  if (p.startsWith('added')) return 'packages installed';
  if (p.startsWith('npm warn') || p.startsWith('npm notice')) return 'npm warnings';
  if (p.startsWith('dist/') || p.startsWith('build/')) return 'build output';
  if (p.startsWith('downloading')) return 'downloads';
  return 'repeated output';
}
