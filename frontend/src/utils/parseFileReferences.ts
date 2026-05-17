export interface FileReference {
  path: string;
  line: number;
  column: number;
  startIndex: number;
  endIndex: number;
  text: string;
}

const CODE_EXTENSIONS = [
  'astro',
  'bash',
  'c',
  'cc',
  'cjs',
  'clj',
  'cljs',
  'cpp',
  'cs',
  'css',
  'cts',
  'cxx',
  'ex',
  'exs',
  'fs',
  'fsx',
  'go',
  'h',
  'hpp',
  'hs',
  'html',
  'java',
  'js',
  'json',
  'jsx',
  'kt',
  'kts',
  'less',
  'lua',
  'm',
  'md',
  'mdx',
  'mjs',
  'mm',
  'mts',
  'php',
  'py',
  'pyi',
  'r',
  'rb',
  'rs',
  'sass',
  'scala',
  'scss',
  'sh',
  'sql',
  'svelte',
  'swift',
  'toml',
  'ts',
  'tsx',
  'vue',
  'xml',
  'yaml',
  'yml',
  'zsh',
].join('|');

const PATH_SEGMENT = '[^:\\s()[\\]{}"\'`<>|]+';
const FILE_PATH = `(?:[A-Za-z]:)?(?:(?:\\.{1,2}|~)?[\\\\/])?(?:${PATH_SEGMENT}[\\\\/])*${PATH_SEGMENT}\\.(?:${CODE_EXTENSIONS})`;

const FILE_LINE_COLUMN_PATTERN = new RegExp(
  `(^|[^\\w./\\\\:-])(${FILE_PATH}):(\\d+)(?::(\\d+))?`,
  'gi'
);
const PAREN_FILE_LINE_COLUMN_PATTERN = new RegExp(
  `(^|[^\\w./\\\\:-])(${FILE_PATH})\\((\\d+),(\\d+)\\)`,
  'gi'
);
const WRAPPED_FILE_PATH = `(?:[A-Za-z]:)?[^:\r\n]*?\\.(?:${CODE_EXTENSIONS})`;
const WRAPPED_FILE_LINE_COLUMN_PATTERN = new RegExp(
  `([\\(\\[\\{"'\`])(${WRAPPED_FILE_PATH}):(\\d+)(?::(\\d+))?(?=[\\)\\]\\}"'\`])`,
  'gi'
);
const PYTHON_TRACEBACK_PATTERN = /(^|[^\w./\\:-])(File\s+"([^"\r\n]+)",\s+line\s+(\d+))/g;

function toPositiveInteger(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function createReference(
  path: string,
  lineValue: string | undefined,
  columnValue: string | undefined,
  startIndex: number,
  endIndex: number,
  text: string
): FileReference | null {
  const cleanPath = path.trim();
  if (!cleanPath || cleanPath.includes('\0')) return null;

  const line = toPositiveInteger(lineValue, 1);
  const column = toPositiveInteger(columnValue, 1);

  return {
    path: cleanPath,
    line,
    column,
    startIndex,
    endIndex,
    text,
  };
}

function withoutOverlaps(references: FileReference[]): FileReference[] {
  const sorted = [...references].sort(
    (a, b) => a.startIndex - b.startIndex || b.endIndex - a.endIndex
  );
  const filtered: FileReference[] = [];

  for (const reference of sorted) {
    const overlaps = filtered.some(
      (existing) =>
        reference.startIndex < existing.endIndex && reference.endIndex > existing.startIndex
    );
    if (!overlaps) {
      filtered.push(reference);
    }
  }

  return filtered.sort((a, b) => a.startIndex - b.startIndex);
}

export function parseFileReferences(text: string): FileReference[] {
  const references: FileReference[] = [];

  for (const match of text.matchAll(WRAPPED_FILE_LINE_COLUMN_PATTERN)) {
    const boundary = match[1] ?? '';
    const referenceText = match[0].slice(boundary.length);
    const startIndex = (match.index ?? 0) + boundary.length;
    const reference = createReference(
      match[2],
      match[3],
      match[4],
      startIndex,
      startIndex + referenceText.length,
      referenceText
    );
    if (reference) {
      references.push(reference);
    }
  }

  for (const match of text.matchAll(FILE_LINE_COLUMN_PATTERN)) {
    const boundary = match[1] ?? '';
    const referenceText = match[0].slice(boundary.length);
    const startIndex = (match.index ?? 0) + boundary.length;
    const reference = createReference(
      match[2],
      match[3],
      match[4],
      startIndex,
      startIndex + referenceText.length,
      referenceText
    );
    if (reference) {
      references.push(reference);
    }
  }

  for (const match of text.matchAll(PAREN_FILE_LINE_COLUMN_PATTERN)) {
    const boundary = match[1] ?? '';
    const referenceText = match[0].slice(boundary.length);
    const startIndex = (match.index ?? 0) + boundary.length;
    const reference = createReference(
      match[2],
      match[3],
      match[4],
      startIndex,
      startIndex + referenceText.length,
      referenceText
    );
    if (reference) {
      references.push(reference);
    }
  }

  for (const match of text.matchAll(PYTHON_TRACEBACK_PATTERN)) {
    const boundary = match[1] ?? '';
    const referenceText = match[2];
    const startIndex = (match.index ?? 0) + boundary.length;
    const reference = createReference(
      match[3],
      match[4],
      undefined,
      startIndex,
      startIndex + referenceText.length,
      referenceText
    );
    if (reference) {
      references.push(reference);
    }
  }

  return withoutOverlaps(references);
}

function isAbsoluteLocalPath(path: string): boolean {
  return (
    /^[A-Za-z]:[\\/]/.test(path) ||
    path.startsWith('/') ||
    path.startsWith('\\\\') ||
    path.startsWith('//') ||
    path.startsWith('~/') ||
    path.startsWith('~\\')
  );
}

function normalizeLocalPath(path: string): string {
  if (!path) return path;

  const slashPath = path.replace(/\\/g, '/');
  let root = '';
  let rest = slashPath;

  const driveMatch = /^([A-Za-z]:)(?:\/|$)/.exec(slashPath);
  if (driveMatch) {
    root = `${driveMatch[1]}/`;
    rest = slashPath.slice(root.length);
  } else if (slashPath.startsWith('//')) {
    root = '//';
    rest = slashPath.slice(2);
  } else if (slashPath.startsWith('/')) {
    root = '/';
    rest = slashPath.slice(1);
  }

  const segments: string[] = [];
  for (const segment of rest.split('/')) {
    if (!segment || segment === '.') continue;
    if (segment === '..') {
      if (segments.length > 0 && segments[segments.length - 1] !== '..') {
        segments.pop();
      } else if (!root) {
        segments.push(segment);
      }
      continue;
    }
    segments.push(segment);
  }

  return `${root}${segments.join('/')}`;
}

function resolveProfileWorkingDir(workingDir?: string, workspacePath?: string): string {
  const cleanWorkingDir = workingDir?.trim();
  const cleanWorkspacePath = workspacePath?.trim();

  if (cleanWorkingDir && isAbsoluteLocalPath(cleanWorkingDir)) {
    return normalizeLocalPath(cleanWorkingDir);
  }
  if (cleanWorkingDir && cleanWorkspacePath) {
    return normalizeLocalPath(`${cleanWorkspacePath}/${cleanWorkingDir}`);
  }
  if (cleanWorkingDir) {
    return normalizeLocalPath(cleanWorkingDir);
  }
  return cleanWorkspacePath ? normalizeLocalPath(cleanWorkspacePath) : '';
}

export function resolveFileReferencePath(
  referencePath: string,
  workingDir?: string,
  workspacePath?: string
): string {
  const cleanReferencePath = referencePath.trim();
  if (isAbsoluteLocalPath(cleanReferencePath)) {
    return normalizeLocalPath(cleanReferencePath);
  }

  const basePath = resolveProfileWorkingDir(workingDir, workspacePath);
  if (!basePath) {
    return normalizeLocalPath(cleanReferencePath);
  }

  return normalizeLocalPath(`${basePath}/${cleanReferencePath}`);
}
