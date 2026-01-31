import { render, screen, fireEvent } from '@testing-library/react';
import { TreeNode } from '../../../components/FileExplorer/TreeNode';
import { filesystem } from '../../../../wailsjs/go/models';

// Mock FileEntry data using the proper class
const mockFile = filesystem.FileEntry.createFrom({
  name: 'test.ts',
  path: '/workspace/test.ts',
  isDir: false,
  size: 1024,
  modTime: new Date().toISOString(),
});

const mockFolder = filesystem.FileEntry.createFrom({
  name: 'src',
  path: '/workspace/src',
  isDir: true,
  size: 0,
  modTime: new Date().toISOString(),
  children: [
    {
      name: 'index.ts',
      path: '/workspace/src/index.ts',
      isDir: false,
      size: 512,
      modTime: new Date().toISOString(),
    },
  ],
});

describe('TreeNode', () => {
  const defaultProps = {
    entry: mockFile,
    depth: 0,
    isExpanded: false,
    onToggle: jest.fn(),
    onSelect: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders file with correct name', () => {
    render(<TreeNode {...defaultProps} />);
    expect(screen.getByText('test.ts')).toBeInTheDocument();
  });

  it('renders file without expand chevron', () => {
    render(<TreeNode {...defaultProps} />);
    expect(screen.queryByRole('button', { name: /expand/i })).not.toBeInTheDocument();
  });

  it('renders folder with expand chevron', () => {
    render(<TreeNode {...defaultProps} entry={mockFolder} />);
    expect(screen.getByRole('button', { name: /toggle/i })).toBeInTheDocument();
  });

  it('renders folder name correctly', () => {
    render(<TreeNode {...defaultProps} entry={mockFolder} />);
    expect(screen.getByText('src')).toBeInTheDocument();
  });

  it('calls onToggle when folder chevron is clicked', () => {
    const onToggle = jest.fn();
    render(<TreeNode {...defaultProps} entry={mockFolder} onToggle={onToggle} />);

    fireEvent.click(screen.getByRole('button', { name: /toggle/i }));
    expect(onToggle).toHaveBeenCalledWith('/workspace/src');
  });

  it('calls onSelect when file is clicked', () => {
    const onSelect = jest.fn();
    render(<TreeNode {...defaultProps} onSelect={onSelect} />);

    fireEvent.click(screen.getByText('test.ts'));
    expect(onSelect).toHaveBeenCalledWith(mockFile);
  });

  it('renders children when folder is expanded', () => {
    render(<TreeNode {...defaultProps} entry={mockFolder} isExpanded={true} />);
    expect(screen.getByText('index.ts')).toBeInTheDocument();
  });

  it('does not render children when folder is collapsed', () => {
    render(<TreeNode {...defaultProps} entry={mockFolder} isExpanded={false} />);
    expect(screen.queryByText('index.ts')).not.toBeInTheDocument();
  });

  it('applies correct indentation based on depth', () => {
    const { container } = render(<TreeNode {...defaultProps} depth={2} />);
    const treeItem = container.querySelector('[data-depth="2"]');
    expect(treeItem).toBeInTheDocument();
  });

  it('shows different chevron icon based on expanded state', () => {
    const { rerender } = render(
      <TreeNode {...defaultProps} entry={mockFolder} isExpanded={false} />
    );
    expect(screen.getByTestId('chevron-right')).toBeInTheDocument();

    rerender(<TreeNode {...defaultProps} entry={mockFolder} isExpanded={true} />);
    expect(screen.getByTestId('chevron-down')).toBeInTheDocument();
  });
});
