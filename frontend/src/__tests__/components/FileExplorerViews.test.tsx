import { render, screen, waitFor } from '@testing-library/react';
import { FileExplorer } from '../../components/FileExplorer/FileExplorer';
import { useIDEStore } from '../../stores/ideStore';
import type { workspace } from '../../../wailsjs/go/models';
import type { FileEntry } from '../../stores/ideStore';
import { ReadDirectoryShallow } from '../../../wailsjs/go/main/App';
import { __resetEnsurePathLoaded } from '../../hooks/useEnsurePathLoaded';
import { installVirtualLayout } from '../helpers/virtualTree';

// Mock Wails bindings (pulled in transitively via layout/IDEShell and useDirectoryTree)
jest.mock('../../../wailsjs/go/main/App', () => ({
  ToggleMaximize: jest.fn(),
  ReadDirectory: jest.fn(),
  ReadDirectoryShallow: jest.fn().mockResolvedValue([]),
  OpenFolderDialog: jest.fn(),
}));

jest.mock('../../../wailsjs/runtime/runtime', () => ({
  WindowSetTitle: jest.fn(),
}));

// Prevent automatic fetching inside useDirectoryTree hook
jest.mock('../../components/FileExplorer/useDirectoryTree', () => ({
  useDirectoryTree: () => ({ refetch: jest.fn() }),
}));

const root = '/repo';
const defs = [
  { id: 'project', name: 'Project', relDir: '', type: 'project', accent: 'project' },
  { id: 'frontend', name: 'Frontend', relDir: 'frontend', type: 'frontend', accent: 'blue' },
] as workspace.WorkspaceDef[];

const nestedDockerfile = {
  name: 'Dockerfile',
  path: `${root}/frontend/Dockerfile`,
  isDir: false,
} as FileEntry;

const tree: FileEntry[] = [
  { name: 'README.md', path: `${root}/README.md`, isDir: false } as FileEntry,
  {
    name: 'frontend',
    path: `${root}/frontend`,
    isDir: true,
    children: [
      { name: 'App.tsx', path: `${root}/frontend/App.tsx`, isDir: false } as FileEntry,
      nestedDockerfile,
    ],
  } as FileEntry,
];

function seed(
  activeWorkspaceId: string,
  extra: Partial<ReturnType<typeof useIDEStore.getState>> = {}
) {
  useIDEStore.setState({
    workspace: { name: 'repo', path: root },
    workspaces: defs,
    activeWorkspaceId,
    lastFocusedWorkspaceId: activeWorkspaceId !== 'project' ? activeWorkspaceId : null,
    directoryTree: tree,
    expandedPaths: new Set([`${root}/frontend`]),
    isRootExpanded: true,
    isLoadingTree: false,
    treeError: null,
    ...extra,
  });
}

beforeEach(() => {
  __resetEnsurePathLoaded();
  jest.clearAllMocks();
  // Default: shallow reads return nothing
  (ReadDirectoryShallow as jest.Mock).mockResolvedValue([]);
});

describe('FileExplorer views', () => {
  it('renders the segmented toggle and no tabs in Project View', () => {
    seed('project');
    render(<FileExplorer />);
    expect(screen.getByRole('button', { name: 'Project' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('tablist')).toBeNull();
  });

  it('shows the workspace tab strip in Workspace View', () => {
    seed('frontend');
    render(<FileExplorer />);
    expect(screen.getByRole('tablist')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Frontend' })).toHaveAttribute('aria-selected', 'true');
  });

  it.each(['project', 'frontend'])('renders nested infra accents in %s view', (activeId) => {
    const restoreVirtualLayout = installVirtualLayout(400);
    try {
      seed(activeId);
      render(<FileExplorer />);

      const row = screen.getByRole('treeitem', { name: 'Dockerfile' });
      expect(row.style.getPropertyValue('--region-accent')).toBe('var(--accent-blue)');
      expect(row.style.getPropertyValue('--file-accent')).toBe('var(--accent-purple)');
      expect(screen.getByTestId('file-accent-marker')).toHaveAttribute('aria-hidden', 'true');
    } finally {
      restoreVirtualLayout();
    }
  });

  it('renders the scoped-error state when the workspace folder is missing', async () => {
    seed('frontend', {
      workspaces: [
        defs[0],
        { id: 'frontend', name: 'Frontend', relDir: 'missing', type: 'frontend', accent: 'blue' },
      ] as workspace.WorkspaceDef[],
    });
    render(<FileExplorer />);
    // Scoped hydration runs briefly (loading the relDir chain) then surfaces the
    // error once it determines the path does not exist in the loaded tree.
    await waitFor(() => {
      expect(screen.getByText(/workspace folder not found/i)).toBeInTheDocument();
    });
  });

  it('hydrates a present-but-unloaded scoped node instead of showing empty', async () => {
    // The scoped dir node EXISTS in the tree but has children === undefined (unloaded).
    // This happens after a reconcile (Fix 1 preserves it, but it might not be loaded yet)
    // or on a partial restore. scopedError must be true so the hydration effect fires.
    const restoreVirtualLayout = installVirtualLayout(400);

    const scopedChild = {
      name: 'App.tsx',
      path: `${root}/frontend/App.tsx`,
      isDir: false,
      size: 0,
      modTime: '',
    } as FileEntry;

    // The unloaded scoped node: frontend dir exists but children === undefined
    const unloadedTree: FileEntry[] = [
      { name: 'README.md', path: `${root}/README.md`, isDir: false } as FileEntry,
      {
        name: 'frontend',
        path: `${root}/frontend`,
        isDir: true,
        // children intentionally undefined — unloaded
      } as FileEntry,
    ];

    seed('frontend', { directoryTree: unloadedTree });

    // Mock ReadDirectoryShallow to resolve the scoped dir's children when asked
    (ReadDirectoryShallow as jest.Mock).mockImplementation((path: string) => {
      if (path === `${root}/frontend`) {
        return Promise.resolve([scopedChild]);
      }
      return Promise.resolve([]);
    });

    render(<FileExplorer />);

    // After hydration completes, App.tsx must be visible — not "No files in workspace"
    await waitFor(() => {
      expect(screen.queryByText(/no files in workspace/i)).not.toBeInTheDocument();
      expect(screen.getByText('App.tsx')).toBeInTheDocument();
    });

    restoreVirtualLayout();
  });
});
