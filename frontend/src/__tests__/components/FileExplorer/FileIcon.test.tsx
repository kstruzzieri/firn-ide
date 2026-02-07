import { render, screen } from '@testing-library/react';
import { FileIcon, getFileIconColor, getFileType } from '../../../components/FileExplorer/FileIcon';

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

    it('returns default color for unknown types', () => {
      expect(getFileIconColor('unknown')).toBe('#6B7280');
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
  });
});
