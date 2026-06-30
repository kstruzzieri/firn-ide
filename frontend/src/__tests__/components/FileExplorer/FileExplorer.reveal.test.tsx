// src/__tests__/components/FileExplorer/FileExplorer.reveal.test.tsx
import { render, waitFor, act } from '@testing-library/react';
import { FileExplorer } from '../../../components/FileExplorer';
import { useIDEStore } from '../../../stores/ideStore';
import { ReadDirectoryShallow } from '../../../../wailsjs/go/main/App';
import { filesystem } from '../../../../wailsjs/go/models';
import { installVirtualLayout } from '../../helpers/virtualTree';
import { __resetEnsurePathLoaded } from '../../../hooks/useEnsurePathLoaded';

jest.mock('../../../../wailsjs/go/main/App', () => ({
  ReadDirectory: jest.fn(),
  ReadDirectoryShallow: jest.fn(),
  ReadFile: jest.fn(),
  OpenFolderDialog: jest.fn(),
}));

jest.mock('../../../../wailsjs/runtime/runtime', () => ({
  WindowSetTitle: jest.fn(),
}));

const mockRefetch = jest.fn();
jest.mock('../../../components/FileExplorer/useDirectoryTree', () => ({
  useDirectoryTree: () => ({ refetch: mockRefetch }),
}));

const dir = (path: string, children?: filesystem.FileEntry[]) =>
  filesystem.FileEntry.createFrom({
    name: path.split('/').pop()!,
    path,
    isDir: true,
    size: 0,
    modTime: new Date().toISOString(),
    children,
  }) as filesystem.FileEntry;

describe('FileExplorer active-file reveal with lazy loading', () => {
  let restoreVirtualLayout: () => void;

  beforeEach(() => {
    restoreVirtualLayout = installVirtualLayout(400);
    jest.clearAllMocks();
    __resetEnsurePathLoaded();

    // Base store: workspace /r, /r/a loaded (children=[]), /r/a/b NOT loaded (children=undefined)
    useIDEStore.setState({
      workspace: { name: 'r', path: '/r' },
      isLoading: false,
      isLoadingTree: false,
      treeError: null,
      directoryTree: [
        dir('/r/a', [
          dir('/r/a/b'), // children=undefined = unloaded
        ]),
      ],
      expandedPaths: new Set<string>(),
      selectedPath: null,
      activeFileId: null,
      isRootExpanded: true,
    });
  });

  afterEach(() => {
    restoreVirtualLayout();
  });

  describe('(a) reveal loads ancestors', () => {
    it('calls ReadDirectoryShallow for each unloaded ancestor and expands them', async () => {
      // /r/a is loaded (has children array), /r/a/b is NOT loaded (children=undefined)
      // Setting activeFileId to /r/a/b/file.ts should load /r/a/b then expand both.
      (ReadDirectoryShallow as jest.Mock).mockImplementation((path: string) => {
        if (path === '/r/a/b') {
          return Promise.resolve([
            filesystem.FileEntry.createFrom({
              name: 'file.ts',
              path: '/r/a/b/file.ts',
              isDir: false,
              size: 0,
              modTime: new Date().toISOString(),
            }) as filesystem.FileEntry,
          ]);
        }
        return Promise.resolve([]);
      });

      render(<FileExplorer />);

      act(() => {
        useIDEStore.setState({ activeFileId: '/r/a/b/file.ts' });
      });

      await waitFor(() => {
        // /r/a was already loaded (children array present), so ReadDirectoryShallow
        // should only be called for /r/a/b (the unloaded ancestor)
        expect(ReadDirectoryShallow).toHaveBeenCalledWith('/r/a/b', '/r');
      });

      await waitFor(() => {
        const { expandedPaths } = useIDEStore.getState();
        expect(expandedPaths.has('/r/a')).toBe(true);
        expect(expandedPaths.has('/r/a/b')).toBe(true);
      });
    });

    it('sets selectedPath to the active file', async () => {
      (ReadDirectoryShallow as jest.Mock).mockResolvedValue([]);

      render(<FileExplorer />);

      act(() => {
        useIDEStore.setState({ activeFileId: '/r/a/b/file.ts' });
      });

      await waitFor(() => {
        expect(useIDEStore.getState().selectedPath).toBe('/r/a/b/file.ts');
      });
    });
  });

  describe('(b) reveal aborts on workspace change', () => {
    it('does not expand stale path when workspace changes mid-flight', async () => {
      let resolveB!: () => void;
      const pendingB = new Promise<filesystem.FileEntry[]>((res) => {
        resolveB = () => res([]);
      });

      (ReadDirectoryShallow as jest.Mock).mockImplementation((path: string) => {
        if (path === '/r/a/b') return pendingB;
        return Promise.resolve([]);
      });

      render(<FileExplorer />);

      // Start reveal for /r/a/b/file.ts — triggers async load of /r/a/b
      act(() => {
        useIDEStore.setState({ activeFileId: '/r/a/b/file.ts' });
      });

      // Bump to a new workspace (workspace change = generation guard triggers)
      act(() => {
        useIDEStore.setState({
          workspace: { name: 'other', path: '/other' },
          activeFileId: null,
          directoryTree: [],
          expandedPaths: new Set<string>(),
        });
      });

      // Now resolve the pending load
      resolveB();
      await new Promise((r) => setTimeout(r, 20));

      // /r/a/b must NOT have been expanded (stale generation)
      const { expandedPaths } = useIDEStore.getState();
      expect(expandedPaths.has('/r/a/b')).toBe(false);
    });

    it('generation guard exists: new activeFileId supersedes in-flight reveal', async () => {
      let resolveFirst!: () => void;
      const firstPending = new Promise<filesystem.FileEntry[]>((res) => {
        resolveFirst = () => res([]);
      });

      (ReadDirectoryShallow as jest.Mock).mockImplementation((path: string) => {
        if (path === '/r/a/b') return firstPending;
        return Promise.resolve([]);
      });

      render(<FileExplorer />);

      // First reveal
      act(() => {
        useIDEStore.setState({ activeFileId: '/r/a/b/file.ts' });
      });

      // Immediately start a second reveal with a different file (same ancestors are loaded)
      // This bumps the generation ref, invalidating the first flight
      act(() => {
        useIDEStore.setState({ activeFileId: '/r/a/b/other.ts' });
      });

      // Resolve the first (now stale) flight
      resolveFirst();
      await new Promise((r) => setTimeout(r, 20));

      // selectedPath should be the second file, not the first
      // (or null if second also needed loads — either way not stale first file)
      const { selectedPath } = useIDEStore.getState();
      expect(selectedPath).not.toBe('/r/a/b/file.ts');
    });
  });
});
