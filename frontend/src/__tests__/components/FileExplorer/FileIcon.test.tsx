import { render, screen } from '@testing-library/react';
import {
  FileIcon,
  getFileIconColor,
  getFolderIconColor,
  getFileType,
  getFolderType,
} from '../../../components/FileExplorer/FileIcon';

describe('FileIcon', () => {
  describe('file icons', () => {
    it('renders typescript icon for .ts files', () => {
      render(<FileIcon name="index.ts" isDir={false} />);
      expect(screen.getByTestId('file-icon')).toBeInTheDocument();
      expect(screen.getByTestId('file-icon')).toHaveAttribute('data-type', 'typescript');
    });

    it('renders react icon for .tsx files', () => {
      render(<FileIcon name="App.tsx" isDir={false} />);
      expect(screen.getByTestId('file-icon')).toHaveAttribute('data-type', 'react');
    });

    it('renders javascript icon for .js files', () => {
      render(<FileIcon name="config.js" isDir={false} />);
      expect(screen.getByTestId('file-icon')).toHaveAttribute('data-type', 'javascript');
    });

    it('renders react icon for .jsx files', () => {
      render(<FileIcon name="Button.jsx" isDir={false} />);
      expect(screen.getByTestId('file-icon')).toHaveAttribute('data-type', 'react');
    });

    it('renders go icon for .go files', () => {
      render(<FileIcon name="main.go" isDir={false} />);
      expect(screen.getByTestId('file-icon')).toHaveAttribute('data-type', 'go');
    });

    it('renders python icon for .py files', () => {
      render(<FileIcon name="train.py" isDir={false} />);
      expect(screen.getByTestId('file-icon')).toHaveAttribute('data-type', 'python');
    });

    it('renders json icon for .json files', () => {
      render(<FileIcon name="package.json" isDir={false} />);
      expect(screen.getByTestId('file-icon')).toHaveAttribute('data-type', 'json');
    });

    it('renders markdown icon for .md files', () => {
      render(<FileIcon name="README.md" isDir={false} />);
      expect(screen.getByTestId('file-icon')).toHaveAttribute('data-type', 'markdown');
    });

    it('renders css icon for .css files', () => {
      render(<FileIcon name="styles.css" isDir={false} />);
      expect(screen.getByTestId('file-icon')).toHaveAttribute('data-type', 'css');
    });

    it('renders html icon for .html files', () => {
      render(<FileIcon name="index.html" isDir={false} />);
      expect(screen.getByTestId('file-icon')).toHaveAttribute('data-type', 'html');
    });

    it('renders default icon for unknown extensions', () => {
      render(<FileIcon name="file.xyz" isDir={false} />);
      expect(screen.getByTestId('file-icon')).toHaveAttribute('data-type', 'default');
    });

    it('renders image icon for .png files', () => {
      render(<FileIcon name="photo.png" isDir={false} />);
      expect(screen.getByTestId('file-icon')).toHaveAttribute('data-type', 'image');
    });

    it('renders image icon for .svg files', () => {
      render(<FileIcon name="logo.svg" isDir={false} />);
      expect(screen.getByTestId('file-icon')).toHaveAttribute('data-type', 'image');
    });

    it('renders git icon for .gitignore files', () => {
      render(<FileIcon name=".gitignore" isDir={false} />);
      expect(screen.getByTestId('file-icon')).toHaveAttribute('data-type', 'git');
    });

    it('renders text icon for .txt files', () => {
      render(<FileIcon name="notes.txt" isDir={false} />);
      expect(screen.getByTestId('file-icon')).toHaveAttribute('data-type', 'text');
    });

    it('renders text icon for .log files', () => {
      render(<FileIcon name="server.log" isDir={false} />);
      expect(screen.getByTestId('file-icon')).toHaveAttribute('data-type', 'text');
    });

    it('renders xml icon for .xml files', () => {
      render(<FileIcon name="config.xml" isDir={false} />);
      expect(screen.getByTestId('file-icon')).toHaveAttribute('data-type', 'xml');
    });

    it('renders executable icon for .exe files', () => {
      render(<FileIcon name="app.exe" isDir={false} />);
      expect(screen.getByTestId('file-icon')).toHaveAttribute('data-type', 'executable');
    });

    it('renders library icon for .dll files', () => {
      render(<FileIcon name="lib.dll" isDir={false} />);
      expect(screen.getByTestId('file-icon')).toHaveAttribute('data-type', 'library');
    });

    it('renders compiled icon for .o files', () => {
      render(<FileIcon name="main.o" isDir={false} />);
      expect(screen.getByTestId('file-icon')).toHaveAttribute('data-type', 'compiled');
    });

    it('renders binary icon for .wasm files', () => {
      render(<FileIcon name="module.wasm" isDir={false} />);
      expect(screen.getByTestId('file-icon')).toHaveAttribute('data-type', 'binary');
    });

    it('renders archive icon for .zip files', () => {
      render(<FileIcon name="package.zip" isDir={false} />);
      expect(screen.getByTestId('file-icon')).toHaveAttribute('data-type', 'archive');
    });
  });

  describe('folder icons', () => {
    it('renders folder icon for directories', () => {
      render(<FileIcon name="src" isDir={true} />);
      expect(screen.getByTestId('folder-icon')).toBeInTheDocument();
    });

    it('renders special icon for src folder', () => {
      render(<FileIcon name="src" isDir={true} />);
      expect(screen.getByTestId('folder-icon')).toHaveAttribute('data-folder', 'src');
    });

    it('renders special icon for components folder', () => {
      render(<FileIcon name="components" isDir={true} />);
      expect(screen.getByTestId('folder-icon')).toHaveAttribute('data-folder', 'components');
    });

    it('renders special icon for node_modules folder', () => {
      render(<FileIcon name="node_modules" isDir={true} />);
      expect(screen.getByTestId('folder-icon')).toHaveAttribute('data-folder', 'node_modules');
    });

    it('renders default folder icon for regular folders', () => {
      render(<FileIcon name="myFolder" isDir={true} />);
      expect(screen.getByTestId('folder-icon')).toHaveAttribute('data-folder', 'default');
    });

    it('renders hidden folder icon for dot-prefix folders', () => {
      render(<FileIcon name=".vscode" isDir={true} />);
      expect(screen.getByTestId('folder-icon')).toHaveAttribute('data-folder', 'hidden');
    });

    it('renders hidden folder icon for .github folder', () => {
      render(<FileIcon name=".github" isDir={true} />);
      expect(screen.getByTestId('folder-icon')).toHaveAttribute('data-folder', 'hidden');
    });
  });

  describe('getFileIconColor', () => {
    it('returns correct color for typescript', () => {
      expect(getFileIconColor('typescript')).toBe('#3178C6');
    });

    it('returns correct color for javascript', () => {
      expect(getFileIconColor('javascript')).toBe('#F7DF1E');
    });

    it('returns correct color for go', () => {
      expect(getFileIconColor('go')).toBe('#00ADD8');
    });

    it('returns correct color for python', () => {
      expect(getFileIconColor('python')).toBe('#3776AB');
    });

    it('returns correct color for json', () => {
      expect(getFileIconColor('json')).toBe('#F59E0B');
    });

    it('returns correct color for markdown', () => {
      expect(getFileIconColor('markdown')).toBe('#8b9cae');
    });

    it('returns correct color for image', () => {
      expect(getFileIconColor('image')).toBe('#a855f7');
    });

    it('returns correct color for git', () => {
      expect(getFileIconColor('git')).toBe('#F05032');
    });

    it('returns correct color for text', () => {
      expect(getFileIconColor('text')).toBe('#9ca3af');
    });

    it('returns correct color for xml', () => {
      expect(getFileIconColor('xml')).toBe('#e36209');
    });

    it('returns correct color for executable', () => {
      expect(getFileIconColor('executable')).toBe('#10b981');
    });

    it('returns correct color for library', () => {
      expect(getFileIconColor('library')).toBe('#8b5cf6');
    });

    it('returns correct color for compiled', () => {
      expect(getFileIconColor('compiled')).toBe('#f59e0b');
    });

    it('returns correct color for binary', () => {
      expect(getFileIconColor('binary')).toBe('#ef4444');
    });

    it('returns correct color for archive', () => {
      expect(getFileIconColor('archive')).toBe('#0ea5e9');
    });

    it('returns default color for unknown types', () => {
      expect(getFileIconColor('unknown')).toBe('#6B7280');
    });
  });

  describe('getFolderIconColor', () => {
    it('returns correct color for src folder', () => {
      expect(getFolderIconColor('src')).toBe('#3B82F6');
    });

    it('returns correct color for components folder', () => {
      expect(getFolderIconColor('components')).toBe('#a855f7');
    });

    it('returns correct color for node_modules folder', () => {
      expect(getFolderIconColor('node_modules')).toBe('#78716c');
    });

    it('returns correct color for hidden folder', () => {
      expect(getFolderIconColor('hidden')).toBe('#3f3f46');
    });

    it('returns default color for unknown folder types', () => {
      expect(getFolderIconColor('default')).toBe('#d97706');
    });
  });

  describe('getFolderType', () => {
    it('returns hidden for dot-prefix folders', () => {
      expect(getFolderType('.vscode')).toBe('hidden');
      expect(getFolderType('.config')).toBe('hidden');
      expect(getFolderType('.cache')).toBe('hidden');
    });

    it('returns mapped type over hidden for known dot folders', () => {
      // node_modules is not dot-prefixed, just checking known names still work
      expect(getFolderType('node_modules')).toBe('node_modules');
      expect(getFolderType('src')).toBe('src');
    });
  });

  describe('getFileType', () => {
    it('maps image extensions correctly', () => {
      expect(getFileType('photo.jpg')).toBe('image');
      expect(getFileType('photo.jpeg')).toBe('image');
      expect(getFileType('icon.gif')).toBe('image');
      expect(getFileType('icon.webp')).toBe('image');
      expect(getFileType('favicon.ico')).toBe('image');
      expect(getFileType('image.bmp')).toBe('image');
    });

    it('maps git files correctly', () => {
      expect(getFileType('.gitattributes')).toBe('git');
      expect(getFileType('.gitmodules')).toBe('git');
    });

    it('maps text extensions correctly', () => {
      expect(getFileType('.env')).toBe('text');
    });

    it('maps xml extensions correctly', () => {
      expect(getFileType('config.xml')).toBe('xml');
      expect(getFileType('style.xsl')).toBe('xml');
      expect(getFileType('Info.plist')).toBe('xml');
    });

    it('treats extensionless files as executable', () => {
      expect(getFileType('flux')).toBe('executable');
      expect(getFileType('node')).toBe('executable');
      expect(getFileType('Makefile')).toBe('executable');
    });

    it('maps binary-related extensions correctly', () => {
      expect(getFileType('app.exe')).toBe('executable');
      expect(getFileType('game.app')).toBe('executable');
      expect(getFileType('lib.so')).toBe('library');
      expect(getFileType('lib.dylib')).toBe('library');
      expect(getFileType('lib.a')).toBe('library');
      expect(getFileType('main.o')).toBe('compiled');
      expect(getFileType('Main.class')).toBe('compiled');
      expect(getFileType('module.pyc')).toBe('compiled');
      expect(getFileType('data.bin')).toBe('binary');
      expect(getFileType('app.wasm')).toBe('binary');
      expect(getFileType('files.tar')).toBe('archive');
      expect(getFileType('files.gz')).toBe('archive');
      expect(getFileType('files.7z')).toBe('archive');
      expect(getFileType('app.dmg')).toBe('archive');
      expect(getFileType('disk.iso')).toBe('archive');
    });
  });
});
