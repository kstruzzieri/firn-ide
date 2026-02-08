import {
  FileIcon as FileIconSvg,
  FolderIcon,
  FolderOpenIcon,
  ImageIcon,
  TextFileIcon,
  ExecutableIcon,
  LibraryIcon,
  CompiledIcon,
  BinaryIcon,
  ArchiveIcon,
} from '../icons';
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
  GitOriginal,
  YamlOriginal,
  XmlOriginal,
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
  | 'image'
  | 'git'
  | 'text'
  | 'xml'
  | 'executable'
  | 'library'
  | 'compiled'
  | 'binary'
  | 'archive'
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
  | 'hidden'
  | 'default';

/** Folder color mapping — warm, high-contrast palette */
const FOLDER_TYPE_COLORS: Record<FolderType, string> = {
  src: '#3B82F6',
  components: '#a855f7',
  hooks: '#ec4899',
  node_modules: '#78716c',
  test: '#22c55e',
  docs: '#06b6d4',
  public: '#f97316',
  dist: '#737373',
  hidden: '#3f3f46',
  default: '#d97706',
};

/** Open folder colors — lighter variant per folder type */
const FOLDER_TYPE_OPEN_COLORS: Record<FolderType, string> = {
  src: '#60a5fa',
  components: '#c084fc',
  hooks: '#f472b6',
  node_modules: '#a8a29e',
  test: '#4ade80',
  docs: '#22d3ee',
  public: '#fb923c',
  dist: '#a3a3a3',
  hidden: '#52525b',
  default: '#f59e0b',
};

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
  svg: 'image',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  ico: 'image',
  webp: 'image',
  bmp: 'image',
  gitignore: 'git',
  gitattributes: 'git',
  gitmodules: 'git',
  txt: 'text',
  log: 'text',
  env: 'text',
  xml: 'xml',
  xsl: 'xml',
  xslt: 'xml',
  plist: 'xml',
  exe: 'executable',
  app: 'executable',
  dll: 'library',
  so: 'library',
  dylib: 'library',
  a: 'library',
  lib: 'library',
  o: 'compiled',
  obj: 'compiled',
  class: 'compiled',
  pyc: 'compiled',
  pyo: 'compiled',
  bin: 'binary',
  dat: 'binary',
  wasm: 'binary',
  zip: 'archive',
  tar: 'archive',
  gz: 'archive',
  tgz: 'archive',
  bz2: 'archive',
  xz: 'archive',
  rar: 'archive',
  '7z': 'archive',
  jar: 'archive',
  dmg: 'archive',
  iso: 'archive',
};

/** Known extensionless filenames → file type */
const FILENAME_MAP: Record<string, FileType> = {
  makefile: 'executable',
  dockerfile: 'executable',
  procfile: 'executable',
  rakefile: 'executable',
  vagrantfile: 'executable',
  gemfile: 'text',
  readme: 'text',
  license: 'text',
  licence: 'text',
  authors: 'text',
  changelog: 'text',
  contributing: 'text',
  copying: 'text',
  notice: 'text',
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
  image: null,
  git: GitOriginal,
  text: null,
  xml: XmlOriginal,
  executable: null,
  library: null,
  compiled: null,
  binary: null,
  archive: null,
  yaml: YamlOriginal,
  default: null,
};

/**
 * CSS filters for devicons that don't render well on dark backgrounds.
 * - markdown/yaml: dark fills → invert to white
 * - go: bright blue/white clash → reduce brightness slightly
 */
const DEVICON_FILTERS: Partial<Record<FileType, string>> = {
  markdown: 'invert(1)',
  yaml: 'invert(1)',
  xml: 'invert(1)',
  go: 'brightness(0.8) saturate(0.7)',
};

/**
 * Gets the file type from a filename based on its extension.
 */
export function getFileType(name: string): FileType {
  // No dot at all → check known filenames, then fall back to default icon
  if (!name.includes('.')) {
    return FILENAME_MAP[name.toLowerCase()] ?? 'default';
  }
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  return EXTENSION_MAP[ext] ?? 'default';
}

/**
 * Gets the folder type from a folder name.
 */
export function getFolderType(name: string): FolderType {
  const mapped = FOLDER_NAME_MAP[name.toLowerCase()];
  if (mapped) return mapped;
  if (name.startsWith('.')) return 'hidden';
  return 'default';
}

/** File type to color mapping */
const FILE_TYPE_COLORS: Record<FileType, string> = {
  typescript: '#3178C6',
  javascript: '#F7DF1E',
  react: '#61DAFB',
  go: '#00ADD8',
  python: '#3776AB',
  json: '#F59E0B',
  markdown: '#8b9cae',
  css: '#1572B6',
  html: '#E34F26',
  yaml: '#ef4444',
  rust: '#DEA584',
  image: '#a855f7',
  git: '#F05032',
  text: '#9ca3af',
  xml: '#e36209',
  executable: '#10b981',
  library: '#8b5cf6',
  compiled: '#f59e0b',
  binary: '#ef4444',
  archive: '#0ea5e9',
  default: '#6B7280',
};

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

/** Custom SVG icons for types without devicons */
const CUSTOM_ICONS: Partial<Record<FileType, React.ComponentType<React.SVGProps<SVGSVGElement>>>> =
  {
    image: ImageIcon,
    text: TextFileIcon,
    executable: ExecutableIcon,
    library: LibraryIcon,
    compiled: CompiledIcon,
    binary: BinaryIcon,
    archive: ArchiveIcon,
  };

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
    const color = isExpanded
      ? (FOLDER_TYPE_OPEN_COLORS[folderType] ?? FOLDER_TYPE_OPEN_COLORS.default)
      : getFolderIconColor(folderType);
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
    const filter = DEVICON_FILTERS[fileType];
    return (
      <span
        data-testid="file-icon"
        data-type={fileType}
        className={className}
        aria-hidden="true"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          filter: filter || undefined,
        }}
      >
        <DevIcon size={16} />
      </span>
    );
  }

  // Use custom SVG icon for specific types without devicons
  const CustomIcon = CUSTOM_ICONS[fileType];
  const color = getFileIconColor(fileType);

  if (CustomIcon) {
    return (
      <CustomIcon
        data-testid="file-icon"
        data-type={fileType}
        className={className}
        style={{ color, width: 16, height: 16 }}
        aria-hidden="true"
      />
    );
  }

  // Fall back to generic colored file icon
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
