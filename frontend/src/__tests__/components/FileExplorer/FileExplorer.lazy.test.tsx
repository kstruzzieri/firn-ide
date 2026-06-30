// src/__tests__/components/FileExplorer/FileExplorer.lazy.test.tsx
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
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

describe('FileExplorer lazy-load on expand', () => {
  let restoreVirtualLayout: () => void;

  beforeEach(() => {
    restoreVirtualLayout = installVirtualLayout(400);
    jest.clearAllMocks();
    __resetEnsurePathLoaded();

    // Seed store: workspace /r, one unloaded dir /r/a (children === undefined)
    useIDEStore.setState({
      workspace: { name: 'r', path: '/r' },
      isLoading: false,
      isLoadingTree: false,
      treeError: null,
      directoryTree: [dir('/r/a')], // children undefined = unloaded
      expandedPaths: new Set<string>(),
      isRootExpanded: true,
    });

    (ReadDirectoryShallow as jest.Mock).mockResolvedValue([dir('/r/a/x')]);
  });

  afterEach(() => {
    restoreVirtualLayout();
  });

  it('calls ReadDirectoryShallow with the dir path when a collapsed dir is expanded', async () => {
    render(<FileExplorer />);

    // /r/a is visible as a top-level entry (root is expanded)
    const toggle = screen.getByRole('button', { name: /toggle a/i });
    fireEvent.click(toggle);

    await waitFor(() => {
      expect(ReadDirectoryShallow).toHaveBeenCalledTimes(1);
      expect(ReadDirectoryShallow).toHaveBeenCalledWith('/r/a', '/r');
    });
  });

  it('does NOT call ReadDirectoryShallow when a dir is collapsed', async () => {
    // Pre-expand /r/a so clicking toggle will collapse it
    act(() => {
      useIDEStore.setState({ expandedPaths: new Set(['/r/a']) });
    });

    render(<FileExplorer />);

    const toggle = screen.getByRole('button', { name: /toggle a/i });
    fireEvent.click(toggle);

    // Give any async call a chance to fire
    await new Promise((r) => setTimeout(r, 10));
    expect(ReadDirectoryShallow).not.toHaveBeenCalled();
  });
});
