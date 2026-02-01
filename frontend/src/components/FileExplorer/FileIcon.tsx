import { FileIcon as FileIconSvg, FolderIcon, FolderOpenIcon } from '../icons';
import {
  TypescriptOriginal,
  JavascriptOriginal,
  GoOriginal,
  PythonOriginal,
  JsonOriginal,
  MarkdownOriginal,
  Css3Original,
  Html5Original,
  RustOriginal,
  ReactOriginal,
} from 'devicons-react';

/** File type identifier for icon styling */
export type FileType =
  | 'typescript'
  | 'javascript'
  | 'react'
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
  default: '#4A7080',
};

/** Open folder color - lighter than closed per mockup */
const FOLDER_OPEN_COLOR = '#6A9AB0';

/** Extension to file type mapping */
const EXTENSION_MAP: Record<string, FileType> = {
  ts: 'typescript',
  tsx: 'react',
  js: 'javascript',
  jsx: 'react',
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

/** File type to devicon component mapping */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const FILE_TYPE_ICONS: Record<FileType, React.ComponentType<any> | null> = {
  typescript: TypescriptOriginal,
  javascript: JavascriptOriginal,
  react: ReactOriginal,
  go: GoOriginal,
  python: PythonOriginal,
  json: JsonOriginal,
  markdown: MarkdownOriginal,
  css: Css3Original,
  html: Html5Original,
  rust: RustOriginal,
  yaml: null, // No devicon for yaml, use default
  default: null,
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
  const FILE_TYPE_COLORS: Record<FileType, string> = {
    typescript: '#3178C6',
    javascript: '#F7DF1E',
    react: '#61DAFB',
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
  /** Whether the folder is expanded (only applies to directories) */
  isExpanded?: boolean;
  /** Optional className for additional styling */
  className?: string;
}

/**
 * Renders an appropriate icon for a file or folder based on its name/extension.
 * Uses devicons-react for programming language icons.
 */
export function FileIcon({ name, isDir, isExpanded, className }: FileIconProps) {
  if (isDir) {
    const folderType = getFolderType(name);
    const color = isExpanded ? FOLDER_OPEN_COLOR : getFolderIconColor(folderType);
    const Icon = isExpanded ? FolderOpenIcon : FolderIcon;

    return (
      <Icon
        data-testid={isExpanded ? 'folder-open-icon' : 'folder-icon'}
        data-folder={folderType}
        className={className}
        style={{ color }}
        aria-hidden="true"
      />
    );
  }

  const fileType = getFileType(name);
  const DevIcon = FILE_TYPE_ICONS[fileType];

  // Use devicon if available
  if (DevIcon) {
    return (
      <span
        data-testid="file-icon"
        data-type={fileType}
        className={className}
        aria-hidden="true"
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}
      >
        <DevIcon size={16} />
      </span>
    );
  }

  // Fall back to generic colored file icon
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
