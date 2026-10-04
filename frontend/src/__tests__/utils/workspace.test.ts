jest.mock('../../wails/runtime', () => ({
  WindowSetTitle: jest.fn(),
}));

jest.mock('../../wails/bindings', () => ({ ReadDirectoryShallow: jest.fn() }));

import { openWorkspaceByPath, shortenPath } from '../../utils/workspace';
import { useIDEStore, type FileEntry } from '../../stores/ideStore';
import { ReadDirectoryShallow } from '../../wails/bindings';
import { __resetEnsurePathLoaded } from '../../hooks/useEnsurePathLoaded';
import { act } from 'react';
import { waitFor } from '@testing-library/react';

const mockRead = ReadDirectoryShallow as jest.Mock;
const dir = (path: string, children?: FileEntry[]): FileEntry =>
  ({
    name: path.split('/').pop()!,
    path,
    isDir: true,
    size: 0,
    modTime: '',
    children,
  }) as FileEntry;

describe('openWorkspaceByPath on the already-active path (#256)', () => {
  beforeEach(() => {
    __resetEnsurePathLoaded();
    mockRead.mockReset();
    useIDEStore.setState({
      workspace: { name: 'ws', path: '/ws' },
      directoryTree: [dir('/ws/src', [dir('/ws/src/a')])],
      expandedPaths: new Set(['/ws/src']),
      loadingPaths: new Set(),
      dirtyPaths: new Set(),
      recentWorkspacesVersion: 7,
    });
  });

  it('re-reads the root and expanded dirs from disk without reopening the workspace', async () => {
    const workspaceBefore = useIDEStore.getState().workspace;
    mockRead.mockImplementation((path: string) =>
      Promise.resolve(
        path === '/ws'
          ? [dir('/ws/src'), dir('/ws/created-while-closed')]
          : [dir('/ws/src/a'), dir('/ws/src/b')]
      )
    );

    act(() => {
      openWorkspaceByPath('/ws');
    });
    await waitFor(() =>
      expect(useIDEStore.getState().directoryTree[0]?.children?.map((e) => e.path)).toEqual([
        '/ws/src/a',
        '/ws/src/b',
      ])
    );

    expect(mockRead.mock.calls.map((c) => c[0])).toEqual(['/ws', '/ws/src']);
    const state = useIDEStore.getState();
    expect(state.directoryTree.map((e) => e.path)).toEqual(['/ws/src', '/ws/created-while-closed']);
    expect(state.directoryTree[0].children?.map((e) => e.path)).toEqual(['/ws/src/a', '/ws/src/b']);
    // Tree-only: no workspace switch, no run-state reset, no recent-list bump.
    expect(state.workspace).toBe(workspaceBefore);
    expect(state.recentWorkspacesVersion).toBe(7);
  });

  it('treats a trailing slash as the same path and reconciles under the active root', async () => {
    const workspaceBefore = useIDEStore.getState().workspace;
    mockRead.mockResolvedValue([]);

    act(() => {
      openWorkspaceByPath('/ws/');
    });
    await waitFor(() => expect(mockRead).toHaveBeenCalledWith('/ws', '/ws'));

    expect(useIDEStore.getState().workspace).toBe(workspaceBefore);
    expect(useIDEStore.getState().recentWorkspacesVersion).toBe(7);
  });

  it('treats a drive-letter case difference as the same path on Windows', async () => {
    const workspace = { name: 'ws', path: 'C:\\ws' };
    useIDEStore.setState({
      workspace,
      directoryTree: [],
      expandedPaths: new Set(),
    });
    mockRead.mockResolvedValue([]);

    act(() => {
      openWorkspaceByPath('c:\\ws');
    });
    await waitFor(() => expect(mockRead).toHaveBeenCalledWith('C:\\ws', 'C:\\ws'));

    expect(useIDEStore.getState().workspace).toBe(workspace);
    expect(useIDEStore.getState().recentWorkspacesVersion).toBe(7);
  });

  it('marks loaded-but-collapsed dirs dirty instead of reading them', async () => {
    useIDEStore.setState({
      directoryTree: [dir('/ws/src', [dir('/ws/src/a')]), dir('/ws/lib', [dir('/ws/lib/x')])],
      expandedPaths: new Set(['/ws/src']),
    });
    mockRead.mockImplementation((path: string) =>
      Promise.resolve(path === '/ws' ? [dir('/ws/src'), dir('/ws/lib')] : [dir(`${path}/a`)])
    );

    act(() => {
      openWorkspaceByPath('/ws');
    });
    await waitFor(() => expect(mockRead).toHaveBeenCalledWith('/ws/src', '/ws'));
    await waitFor(() => expect(useIDEStore.getState().dirtyPaths.has('/ws/src')).toBe(false));

    expect(mockRead).not.toHaveBeenCalledWith('/ws/lib', '/ws');
    expect(useIDEStore.getState().dirtyPaths.has('/ws/lib')).toBe(true);
  });
});

describe('shortenPath', () => {
  it('should shorten /Users/<name>/... paths', () => {
    expect(shortenPath('/Users/alice/projects/my-app')).toBe('~/projects/my-app');
  });

  it('should shorten /home/<name>/... paths', () => {
    expect(shortenPath('/home/alice/projects/my-app')).toBe('~/projects/my-app');
  });

  it('should shorten Windows C:\\Users\\<name>\\... paths', () => {
    expect(shortenPath('C:\\Users\\alice\\projects\\my-app')).toBe('~\\projects\\my-app');
  });

  it('should return ~ for paths exactly at the home directory level', () => {
    expect(shortenPath('/Users/alice/my-project')).toBe('~/my-project');
    expect(shortenPath('/home/alice/my-project')).toBe('~/my-project');
  });

  it('should return ~ when path is just the home directory', () => {
    expect(shortenPath('/Users/alice')).toBe('~');
    expect(shortenPath('/home/alice')).toBe('~');
  });

  it('should return non-home paths unchanged', () => {
    expect(shortenPath('/var/data/project')).toBe('/var/data/project');
    expect(shortenPath('/opt/workspace')).toBe('/opt/workspace');
  });

  it('should handle empty/falsy input', () => {
    expect(shortenPath('')).toBe('');
  });
});
