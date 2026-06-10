import {
  FileIcon as FileIconSvg,
  FolderIcon,
  FolderOpenIcon,
  FirnGoGopherIcon,
  ImageIcon,
  TextFileIcon,
  ExecutableIcon,
  LibraryIcon,
  CompiledIcon,
  BinaryIcon,
  ArchiveIcon,
} from '../icons';
import TypescriptOriginal from 'devicons-react/icons/TypescriptOriginal';
import JavascriptOriginal from 'devicons-react/icons/JavascriptOriginal';
import PythonOriginal from 'devicons-react/icons/PythonOriginal';
import JsonOriginal from 'devicons-react/icons/JsonOriginal';
import MarkdownOriginal from 'devicons-react/icons/MarkdownOriginal';
import Css3Original from 'devicons-react/icons/Css3Original';
import Html5Original from 'devicons-react/icons/Html5Original';
import RustOriginal from 'devicons-react/icons/RustOriginal';
import ReactOriginal from 'devicons-react/icons/ReactOriginal';
import GitOriginal from 'devicons-react/icons/GitOriginal';
import YamlOriginal from 'devicons-react/icons/YamlOriginal';
import XmlOriginal from 'devicons-react/icons/XmlOriginal';
import {
  type FileType,
  type FolderType,
  getFileIconColor,
  getFileType,
  getFolderIconColor,
  getFolderType,
} from './fileIconUtils';

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

/** File type to devicon component mapping */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const FILE_TYPE_ICONS: Record<FileType, React.ComponentType<any> | null> = {
  typescript: TypescriptOriginal,
  javascript: JavascriptOriginal,
  react: ReactOriginal,
  go: null,
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
 * - markdown/yaml/xml: dark fills → invert to white
 */
const DEVICON_FILTERS: Partial<Record<FileType, string>> = {
  markdown: 'invert(1)',
  yaml: 'invert(1)',
  xml: 'invert(1)',
};

/** Custom SVG icons for specific file types */
const CUSTOM_ICONS: Partial<Record<FileType, React.ComponentType<React.SVGProps<SVGSVGElement>>>> =
  {
    go: FirnGoGopherIcon,
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
