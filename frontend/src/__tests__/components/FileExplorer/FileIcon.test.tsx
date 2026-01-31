import { render, screen } from '@testing-library/react';
import { FileIcon, getFileIconColor } from '../../../components/FileExplorer/FileIcon';

describe('FileIcon', () => {
  describe('file icons', () => {
    it('renders typescript icon for .ts files', () => {
      render(<FileIcon name="index.ts" isDir={false} />);
      expect(screen.getByTestId('file-icon')).toBeInTheDocument();
      expect(screen.getByTestId('file-icon')).toHaveAttribute('data-type', 'typescript');
    });

    it('renders typescript icon for .tsx files', () => {
      render(<FileIcon name="App.tsx" isDir={false} />);
      expect(screen.getByTestId('file-icon')).toHaveAttribute('data-type', 'typescript');
    });

    it('renders javascript icon for .js files', () => {
      render(<FileIcon name="config.js" isDir={false} />);
      expect(screen.getByTestId('file-icon')).toHaveAttribute('data-type', 'javascript');
    });

    it('renders javascript icon for .jsx files', () => {
      render(<FileIcon name="Button.jsx" isDir={false} />);
      expect(screen.getByTestId('file-icon')).toHaveAttribute('data-type', 'javascript');
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
      expect(getFileIconColor('markdown')).toBe('#083FA1');
    });

    it('returns default color for unknown types', () => {
      expect(getFileIconColor('unknown')).toBe('#6B7280');
    });
  });
});
