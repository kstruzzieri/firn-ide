import { FileIcon as FileIconSvg, FolderIcon } from '../icons';

/** File type identifier for icon styling */
export type FileType =
  | 'typescript'
  | 'javascript'
  | 'go'
  | 'python'
  | 'json'
  | 'markdown'
  | 'css'
  | 'html'
  | 'yaml'
  | 'rust'
  | 'default';

/** Special folder type identifier */
export type FolderType =
  | 'src'
  | 'components'
  | 'hooks'
  | 'node_modules'
  | 'test'
  | 'docs'
  | 'public'
  | 'dist'
  | 'default';

/** Color mapping per design specification */
const FILE_TYPE_COLORS: Record<FileType, string> = {
  typescript: '#3178C6',
  javascript: '#F7DF1E',
  go: '#00ADD8',
  python: '#3776AB',
  json: '#F59E0B',
  markdown: '#083FA1',
  css: '#1572B6',
  html: '#E34F26',
  yaml: '#CB171E',
  rust: '#DEA584',
  default: '#6B7280',
};

/** Folder color mapping per design specification */
const FOLDER_TYPE_COLORS: Record<FolderType, string> = {
  src: '#3B82F6',
  components: '#61DAFB',
  hooks: '#61DAFB',
  node_modules: '#339933',
  test: '#22C55E',
  docs: '#2563EB',
  public: '#F59E0B',
  dist: '#6B7280',
  default: '#64748B',
};

/** Extension to file type mapping */
const EXTENSION_MAP: Record<string, FileType> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  go: 'go',
  py: 'python',
  pyi: 'python',
  json: 'json',
  md: 'markdown',
  mdx: 'markdown',
  css: 'css',
  scss: 'css',
  sass: 'css',
  less: 'css',
  html: 'html',
  htm: 'html',
  yaml: 'yaml',
  yml: 'yaml',
  rs: 'rust',
};

/** Special folder name mapping */
const FOLDER_NAME_MAP: Record<string, FolderType> = {
  src: 'src',
  source: 'src',
  components: 'components',
  hooks: 'hooks',
  node_modules: 'node_modules',
  test: 'test',
  tests: 'test',
  __tests__: 'test',
  docs: 'docs',
  documentation: 'docs',
  public: 'public',
  static: 'public',
  assets: 'public',
  dist: 'dist',
  build: 'dist',
  out: 'dist',
};

/**
 * Gets the file type from a filename based on its extension.
 */
export function getFileType(name: string): FileType {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return EXTENSION_MAP[ext] ?? 'default';
}

/**
 * Gets the folder type from a folder name.
 */
export function getFolderType(name: string): FolderType {
  return FOLDER_NAME_MAP[name.toLowerCase()] ?? 'default';
}

/**
 * Gets the color for a file type per design specification.
 */
export function getFileIconColor(fileType: FileType | string): string {
  return FILE_TYPE_COLORS[fileType as FileType] ?? FILE_TYPE_COLORS.default;
}

/**
 * Gets the color for a folder type per design specification.
 */
export function getFolderIconColor(folderType: FolderType): string {
  return FOLDER_TYPE_COLORS[folderType] ?? FOLDER_TYPE_COLORS.default;
}

interface FileIconProps {
  /** The filename (used to determine type from extension) */
  name: string;
  /** Whether this is a directory */
  isDir: boolean;
  /** Optional className for additional styling */
  className?: string;
}

/**
 * Renders an appropriate icon for a file or folder based on its name/extension.
 * Colors follow the design specification in docs/design-specification.md.
 */
export function FileIcon({ name, isDir, className }: FileIconProps) {
  if (isDir) {
    const folderType = getFolderType(name);
    const color = getFolderIconColor(folderType);

    return (
      <FolderIcon
        data-testid="folder-icon"
        data-folder={folderType}
        className={className}
        style={{ color }}
        aria-hidden="true"
      />
    );
  }

  const fileType = getFileType(name);
  const color = getFileIconColor(fileType);

  return (
    <FileIconSvg
      data-testid="file-icon"
      data-type={fileType}
      className={className}
      style={{ color }}
      aria-hidden="true"
    />
  );
}
