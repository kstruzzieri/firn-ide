import { renderHook, waitFor } from '@testing-library/react';
import { useDirectoryTree } from '../../../components/FileExplorer/useDirectoryTree';
import { useIDEStore, type FileEntry } from '../../../stores/ideStore';
import { ReadDirectoryShallow } from '../../../../wailsjs/go/main/App';
import { act } from 'react';

jest.mock('../../../../wailsjs/go/main/App', () => ({
  ReadDirectory: jest.fn(),
  ReadDirectoryShallow: jest.fn(),
  ReadFile: jest.fn(),
  OpenFolderDialog: jest.fn(),
}));

jest.mock('../../../../wailsjs/runtime/runtime', () => ({
  WindowSetTitle: jest.fn(),
}));

// ponytail: mock cache so every test starts with no cached tree (forces loading path)
jest.mock('../../../utils/workspaceTreeCache', () => ({
  getCachedWorkspaceTree: jest.fn().mockReturnValue(undefined),
  setCachedWorkspaceTree: jest.fn(),
}));

const dir = (path: string, children?: FileEntry[]): FileEntry =>
  ({
    name: path.split('/').pop()!,
    path,
    isDir: true,
    size: 0,
    modTime: '',
    children,
  }) as FileEntry;
const file = (path: string): FileEntry =>
  ({
    name: path.split('/').pop()!,
    path,
    isDir: false,
    size: 0,
    modTime: '',
  }) as FileEntry;

describe('useDirectoryTree', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    act(() => {
      useIDEStore.setState({
        workspace: { name: 'test-project', path: '/workspace' },
        directoryTree: [],
        isLoadingTree: false,
        treeError: null,
      });
    });
  });

  it('calls ReadDirectoryShallow with the workspace path on mount', async () => {
    (ReadDirectoryShallow as jest.Mock).mockResolvedValue([]);

    renderHook(() => useDirectoryTree());

    await waitFor(() => {
      expect(ReadDirectoryShallow).toHaveBeenCalledWith('/workspace', '/workspace');
    });
  });

  it('preserves hydrated subtrees when the shallow root fetch resolves', async () => {
    (ReadDirectoryShallow as jest.Mock).mockResolvedValue([dir('/workspace/src')]);
    act(() => {
      useIDEStore.setState({
        directoryTree: [dir('/workspace/src', [file('/workspace/src/main.ts')])],
      });
    });

    renderHook(() => useDirectoryTree());

    await waitFor(() => {
      expect(useIDEStore.getState().directoryTree[0].children).toEqual([
        file('/workspace/src/main.ts'),
      ]);
    });
  });

  it('does not call ReadDirectoryShallow when workspace has no path', async () => {
    act(() => {
      useIDEStore.setState({ workspace: null });
    });

    renderHook(() => useDirectoryTree());

    // Give effects a tick to settle
    await act(async () => {});

    expect(ReadDirectoryShallow).not.toHaveBeenCalled();
  });
});
