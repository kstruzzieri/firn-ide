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

/** Folder color mapping - warm, high-contrast palette */
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

/** Known extensionless filenames to file type */
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
 * Gets the file type from a filename based on its extension.
 */
export function getFileType(name: string): FileType {
  // No dot at all: check known filenames, then fall back to default icon
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
