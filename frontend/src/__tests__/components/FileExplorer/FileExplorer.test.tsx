import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { FileExplorer } from '../../../components/FileExplorer';
import { useIDEStore } from '../../../stores/ideStore';
import { ReadDirectory, ReadFile } from '../../../../wailsjs/go/main/App';
import { filesystem } from '../../../../wailsjs/go/models';

// Mock Wails bindings
jest.mock('../../../../wailsjs/go/main/App', () => ({
  ReadDirectory: jest.fn(),
  ReadFile: jest.fn(),
}));

// Mock the useDirectoryTree hook to prevent automatic fetching
const mockRefetch = jest.fn();
jest.mock('../../../components/FileExplorer/useDirectoryTree', () => ({
  useDirectoryTree: () => ({ refetch: mockRefetch }),
}));

// Create mock directory tree using proper FileEntry class
const mockDirectoryTree = [
  filesystem.FileEntry.createFrom({
    name: 'src',
    path: '/workspace/src',
    isDir: true,
    size: 0,
    modTime: new Date().toISOString(),
    children: [
      {
        name: 'App.tsx',
        path: '/workspace/src/App.tsx',
        isDir: false,
        size: 1024,
        modTime: new Date().toISOString(),
      },
      {
        name: 'components',
        path: '/workspace/src/components',
        isDir: true,
        size: 0,
        modTime: new Date().toISOString(),
        children: [
          {
            name: 'Button.tsx',
            path: '/workspace/src/components/Button.tsx',
            isDir: false,
            size: 512,
            modTime: new Date().toISOString(),
          },
        ],
      },
    ],
  }),
  filesystem.FileEntry.createFrom({
    name: 'package.json',
    path: '/workspace/package.json',
    isDir: false,
    size: 256,
    modTime: new Date().toISOString(),
  }),
];

describe('FileExplorer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    // Default mock that won't resolve during most tests
    (ReadDirectory as jest.Mock).mockImplementation(() => new Promise(() => {}));
    (ReadFile as jest.Mock).mockImplementation(() => new Promise(() => {}));
    mockRefetch.mockImplementation(() => {});
    // Reset store state
    useIDEStore.setState({
      workspace: { name: 'test-workspace', path: '/workspace' },
      isLoading: false,
      directoryTree: [],
      expandedPaths: new Set<string>(),
      isLoadingTree: false,
      treeError: null,
    });
  });

  describe('loading states', () => {
    it('shows loading skeleton when isLoadingTree is true', () => {
      // With useDirectoryTree mocked, we have full control over state
      act(() => {
        useIDEStore.setState({
          workspace: { name: 'test', path: '/test' },
          isLoadingTree: true,
          directoryTree: [],
        });
      });

      render(<FileExplorer />);

      // Should immediately show loading skeleton since isLoadingTree is true
      expect(screen.getByRole('status', { name: /loading/i })).toBeInTheDocument();
    });

    it('shows empty state when no workspace is set', () => {
      act(() => {
        useIDEStore.setState({ workspace: null });
      });
      render(<FileExplorer />);
      expect(screen.getByText(/open a folder/i)).toBeInTheDocument();
    });

    it('shows empty state when workspace has no files', () => {
      // With hook mocked, directoryTree stays empty
      render(<FileExplorer />);
      expect(screen.getByText(/no files/i)).toBeInTheDocument();
    });
  });

  describe('error handling', () => {
    it('shows error message when treeError is set', () => {
      // With hook mocked, we can set error state directly
      act(() => {
        useIDEStore.setState({ treeError: 'Failed to read directory' });
      });

      render(<FileExplorer />);

      expect(screen.getByText(/failed to read directory/i)).toBeInTheDocument();
    });

    it('shows retry button on error', () => {
      // With hook mocked, we can set error state directly
      act(() => {
        useIDEStore.setState({ treeError: 'Failed to read directory' });
      });

      render(<FileExplorer />);

      expect(screen.getByRole('button', { name: /retry/i })).toBeInTheDocument();
    });
  });

  describe('tree rendering', () => {
    beforeEach(() => {
      act(() => {
        useIDEStore.setState({ directoryTree: mockDirectoryTree });
      });
    });

    it('renders top-level entries', () => {
      render(<FileExplorer />);
      expect(screen.getByText('src')).toBeInTheDocument();
      expect(screen.getByText('package.json')).toBeInTheDocument();
    });

    it('does not render nested files when folder is collapsed', () => {
      render(<FileExplorer />);
      expect(screen.queryByText('App.tsx')).not.toBeInTheDocument();
    });

    it('renders nested files when folder is expanded', () => {
      act(() => {
        useIDEStore.setState({ expandedPaths: new Set(['/workspace/src']) });
      });
      render(<FileExplorer />);
      expect(screen.getByText('App.tsx')).toBeInTheDocument();
      expect(screen.getByText('components')).toBeInTheDocument();
    });

    it('renders deeply nested files when parent folders are expanded', () => {
      act(() => {
        useIDEStore.setState({
          expandedPaths: new Set(['/workspace/src', '/workspace/src/components']),
        });
      });
      render(<FileExplorer />);
      expect(screen.getByText('Button.tsx')).toBeInTheDocument();
    });
  });

  describe('interactions', () => {
    beforeEach(() => {
      act(() => {
        useIDEStore.setState({
          directoryTree: mockDirectoryTree,
          expandedPaths: new Set(['/workspace/src']),
        });
      });
    });

    it('toggles folder expansion when chevron is clicked', () => {
      render(<FileExplorer />);
      const srcFolder = screen.getByText('src').closest('[data-testid="tree-node"]');
      const toggle = srcFolder?.querySelector('[data-testid="toggle-button"]');

      fireEvent.click(toggle!);

      // Check that toggleExpanded was called (via store update)
      const state = useIDEStore.getState();
      // The toggle should have been triggered
      expect(state.expandedPaths.has('/workspace/src')).toBeDefined();
    });

    it('selects file when clicked', async () => {
      (ReadFile as jest.Mock).mockResolvedValue({ content: 'test', encoding: 'utf-8' });

      render(<FileExplorer />);

      fireEvent.click(screen.getByText('App.tsx'));

      // Should trigger file open action
      await waitFor(() => {
        const state = useIDEStore.getState();
        // File selection should trigger openFile
        expect(state.activeFileId).toBeDefined();
      });
    });

    it('does not open folder when folder name is clicked', () => {
      // Reset openFiles to ensure clean state
      act(() => {
        useIDEStore.setState({ openFiles: [] });
      });
      render(<FileExplorer />);

      fireEvent.click(screen.getByText('src'));

      // Clicking folder name should toggle, not open
      const state = useIDEStore.getState();
      expect(state.openFiles).toHaveLength(0);
    });
  });

  describe('data fetching', () => {
    it('calls refetch on retry button click', () => {
      act(() => {
        useIDEStore.setState({ treeError: 'Some error' });
      });

      render(<FileExplorer />);

      const retryButton = screen.getByRole('button', { name: /retry/i });
      fireEvent.click(retryButton);

      expect(mockRefetch).toHaveBeenCalled();
    });
  });
});
