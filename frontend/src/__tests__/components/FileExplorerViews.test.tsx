import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { FileExplorer } from '../../components/FileExplorer/FileExplorer';
import { useIDEStore } from '../../stores/ideStore';
import type { workspace } from '../../wails/bindings';
import type { FileEntry } from '../../stores/ideStore';
import { ReadDirectoryShallow } from '../../wails/bindings';
import { __resetEnsurePathLoaded } from '../../hooks/useEnsurePathLoaded';
import { openWorkspaceByPath } from '../../utils/workspace';
import { installVirtualLayout } from '../helpers/virtualTree';

// Mock Wails bindings (pulled in transitively via layout/IDEShell and useDirectoryTree)
jest.mock('../../wails/bindings', () => ({
  ToggleMaximize: jest.fn(),
  ReadDirectory: jest.fn(),
  ReadDirectoryShallow: jest.fn().mockResolvedValue([]),
  OpenFolderDialog: jest.fn(),
}));

jest.mock('../../wails/runtime', () => ({
  WindowSetTitle: jest.fn(),
}));

// Prevent automatic fetching inside useDirectoryTree hook
jest.mock('../../components/FileExplorer/useDirectoryTree', () => ({
  useDirectoryTree: () => ({ refetch: jest.fn() }),
}));

const root = '/repo';
const defs = [
  { id: 'project', name: 'Project', relDir: '', type: 'project', accent: 'project' },
  { id: 'frontend', name: 'Frontend', relDir: 'frontend', type: 'frontend', accent: 'frontend' },
  { id: 'go', name: 'Go', relDir: 'frontend/go', type: 'go', accent: 'go' },
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
      {
        name: 'go',
        path: `${root}/frontend/go`,
        isDir: true,
        children: [
          { name: 'main.go', path: `${root}/frontend/go/main.go`, isDir: false } as FileEntry,
        ],
      } as FileEntry,
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
    expandedPaths: new Set([`${root}/frontend`, `${root}/frontend/go`]),
    selectedPath: null,
    activeFileId: null,
    isRootExpanded: true,
    isLoadingTree: false,
    treeError: null,
    dirtyPaths: new Set(),
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
      expect(row.style.getPropertyValue('--region-accent')).toBe('var(--accent-frontend)');
      expect(row.style.getPropertyValue('--file-accent')).toBe('var(--accent-docker)');
      expect(screen.getByTestId('file-accent-marker')).toHaveAttribute('aria-hidden', 'true');
    } finally {
      restoreVirtualLayout();
    }
  });

  it('renders exactly the two approved Workspace rails and clears them in Project View', () => {
    const restoreVirtualLayout = installVirtualLayout(400);
    try {
      seed('frontend', { selectedPath: nestedDockerfile.path });
      render(<FileExplorer />);

      const workspaceTree = screen.getByRole('tree');
      const workspaceRow = screen.getByRole('treeitem', { name: 'Dockerfile' });
      const ownedWorkspaceRow = screen.getByRole('treeitem', { name: 'App.tsx' });
      const nestedWorkspaceRow = screen.getByRole('treeitem', { name: 'main.go' });
      expect(workspaceTree).toHaveClass('workspaceTree');
      expect(workspaceTree.style.getPropertyValue('--tree-accent')).toBe('var(--accent-frontend)');
      expect(ownedWorkspaceRow.style.getPropertyValue('--ownership-accent')).toBe(
        'var(--accent-frontend)'
      );
      expect(ownedWorkspaceRow.style.getPropertyValue('--region-accent')).toBe(
        'var(--accent-frontend)'
      );
      expect(nestedWorkspaceRow.style.getPropertyValue('--region-accent')).toBe('var(--accent-go)');
      expect(nestedWorkspaceRow.style.getPropertyValue('--ownership-accent')).toBe(
        'var(--accent-go)'
      );
      expect(workspaceRow).toHaveClass('ownershipRail');
      expect(workspaceRow.style.getPropertyValue('--ownership-accent')).toBe(
        'var(--accent-docker)'
      );
      expect(workspaceRow.style.getPropertyValue('--region-accent')).toBe('var(--accent-frontend)');
      expect(workspaceRow).toHaveAttribute('aria-selected', 'true');

      act(() => {
        useIDEStore.setState({ activeWorkspaceId: 'project', lastFocusedWorkspaceId: null });
      });

      const projectTree = screen.getByRole('tree');
      const projectRow = screen.getByRole('treeitem', { name: 'Dockerfile' });
      expect(projectTree).not.toHaveClass('workspaceTree');
      expect(projectTree.style.getPropertyValue('--tree-accent')).toBe('');
      expect(projectRow).not.toHaveClass('ownershipRail');
      expect(projectRow.style.getPropertyValue('--ownership-accent')).toBe('');
      expect(projectRow.style.getPropertyValue('--region-accent')).toBe('var(--accent-frontend)');
      expect(projectRow.style.getPropertyValue('--file-accent')).toBe('var(--accent-docker)');
    } finally {
      restoreVirtualLayout();
    }
  });

  it('renders the scoped-error state when the workspace folder is missing', async () => {
    seed('frontend', {
      workspaces: [
        defs[0],
        {
          id: 'frontend',
          name: 'Frontend',
          relDir: 'missing',
          type: 'frontend',
          accent: 'frontend',
        },
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

  it('re-reads a dirty scoped root instead of trusting its cached children (#256)', async () => {
    // The scope dir is the visible root in Workspace View, driven by isRootExpanded,
    // not expandedPaths. A disk reconcile marks it dirty but only reads what is in
    // expandedPaths, so the explorer must reload its own dirty root.
    const restoreVirtualLayout = installVirtualLayout(400);
    const staleTree: FileEntry[] = [
      {
        name: 'frontend',
        path: `${root}/frontend`,
        isDir: true,
        children: [
          { name: 'Old.tsx', path: `${root}/frontend/Old.tsx`, isDir: false } as FileEntry,
        ],
      } as FileEntry,
    ];
    seed('frontend', {
      directoryTree: staleTree,
      expandedPaths: new Set(),
      dirtyPaths: new Set([`${root}/frontend`]),
    });
    (ReadDirectoryShallow as jest.Mock).mockImplementation((path: string) =>
      Promise.resolve(
        path === `${root}/frontend`
          ? [{ name: 'New.tsx', path: `${root}/frontend/New.tsx`, isDir: false } as FileEntry]
          : []
      )
    );

    render(<FileExplorer />);

    await waitFor(() => {
      expect(screen.getByText('New.tsx')).toBeInTheDocument();
    });
    expect(screen.queryByText('Old.tsx')).not.toBeInTheDocument();
    expect(ReadDirectoryShallow).toHaveBeenCalledWith(`${root}/frontend`, root);
    expect(useIDEStore.getState().dirtyPaths.has(`${root}/frontend`)).toBe(false);

    restoreVirtualLayout();
  });

  it('retries a failed visible workspace root when its project is reselected (#256)', async () => {
    const restoreVirtualLayout = installVirtualLayout(400);
    try {
      const scope = { name: 'frontend', path: `${root}/frontend`, isDir: true } as FileEntry;
      const recoveredChild = {
        name: 'Recovered.tsx',
        path: `${root}/frontend/Recovered.tsx`,
        isDir: false,
      } as FileEntry;
      seed('frontend', {
        directoryTree: [{ ...scope, children: [] }],
        expandedPaths: new Set(),
        dirtyPaths: new Set([scope.path]),
        loadingPaths: new Set(),
      });
      let scopeAvailable = false;
      (ReadDirectoryShallow as jest.Mock).mockImplementation((path: string) => {
        if (path === root) return Promise.resolve([scope]);
        if (path === scope.path && scopeAvailable) return Promise.resolve([recoveredChild]);
        return Promise.reject(new Error('temporary read failure'));
      });

      render(<FileExplorer />);
      await waitFor(() => {
        expect(useIDEStore.getState().directoryTree[0].unreadable).toBe(true);
        expect(useIDEStore.getState().loadingPaths.size).toBe(0);
      });
      expect(useIDEStore.getState().dirtyPaths.has(scope.path)).toBe(true);

      scopeAvailable = true;
      act(() => {
        openWorkspaceByPath(root);
      });

      await waitFor(() => {
        expect(screen.getByRole('treeitem', { name: 'Recovered.tsx' })).toBeInTheDocument();
      });
      expect(useIDEStore.getState().directoryTree[0].unreadable).toBe(false);
      expect(useIDEStore.getState().dirtyPaths.has(scope.path)).toBe(false);
      expect(useIDEStore.getState().expandedPaths.size).toBe(0);
    } finally {
      restoreVirtualLayout();
    }
  });

  it('re-reads a dirty scoped root even when it is collapsed and shows as empty (#256)', async () => {
    // isRootExpanded is shared across views; a root collapsed in Project View
    // plus a cached-empty scope renders the empty state, which has no toggle to
    // expand. The reload must not wait for an expand that cannot happen.
    const restoreVirtualLayout = installVirtualLayout(400);
    seed('frontend', {
      directoryTree: [
        {
          name: 'frontend',
          path: `${root}/frontend`,
          isDir: true,
          children: [] as FileEntry[],
        } as FileEntry,
      ],
      expandedPaths: new Set(),
      isRootExpanded: false,
      dirtyPaths: new Set([`${root}/frontend`]),
    });
    (ReadDirectoryShallow as jest.Mock).mockImplementation((path: string) =>
      Promise.resolve(
        path === `${root}/frontend`
          ? [{ name: 'New.tsx', path: `${root}/frontend/New.tsx`, isDir: false } as FileEntry]
          : []
      )
    );

    render(<FileExplorer />);

    await waitFor(() =>
      expect(ReadDirectoryShallow).toHaveBeenCalledWith(`${root}/frontend`, root)
    );
    await waitFor(() =>
      expect(useIDEStore.getState().dirtyPaths.has(`${root}/frontend`)).toBe(false)
    );

    restoreVirtualLayout();
  });

  it('renders an unreadable scoped workspace on its synthetic root row', () => {
    const restoreVirtualLayout = installVirtualLayout(400);
    try {
      seed('frontend', {
        directoryTree: [
          {
            name: 'frontend',
            path: `${root}/frontend`,
            isDir: true,
            children: [],
            unreadable: true,
          } as unknown as FileEntry,
        ],
      });

      render(<FileExplorer />);

      expect(
        screen.getByRole('treeitem', { name: `Frontend, unreadable, ${root}/frontend` })
      ).toBeInTheDocument();
      expect(screen.getByTestId('unreadable-indicator')).toHaveAttribute(
        'title',
        'Unable to read this item'
      );
      expect(screen.queryByText(/no files in workspace/i)).not.toBeInTheDocument();
    } finally {
      restoreVirtualLayout();
    }
  });

  it('retries an unreadable ancestor before hydrating a nested workspace', async () => {
    const restoreVirtualLayout = installVirtualLayout(400);
    const nestedDefs = [
      defs[0],
      { id: 'go', name: 'Go', relDir: 'backend/go', type: 'go', accent: 'go' },
    ] as workspace.WorkspaceDef[];
    const goDir = {
      name: 'go',
      path: `${root}/backend/go`,
      isDir: true,
      size: 0,
      modTime: '',
    } as FileEntry;
    const mainGo = {
      name: 'main.go',
      path: `${root}/backend/go/main.go`,
      isDir: false,
      size: 0,
      modTime: '',
    } as FileEntry;

    try {
      seed('go', {
        workspaces: nestedDefs,
        directoryTree: [
          {
            name: 'backend',
            path: `${root}/backend`,
            isDir: true,
            unreadable: true,
          } as unknown as FileEntry,
        ],
        expandedPaths: new Set(),
      });
      (ReadDirectoryShallow as jest.Mock).mockImplementation((path: string) => {
        if (path === `${root}/backend`) return Promise.resolve([goDir]);
        if (path === `${root}/backend/go`) return Promise.resolve([mainGo]);
        return Promise.resolve([]);
      });

      render(<FileExplorer />);

      // The accessible name carries the blocking ancestor path, not the scoped dir.
      expect(
        screen.getByRole('treeitem', { name: `Go, unreadable, ${root}/backend` })
      ).toBeInTheDocument();
      expect(screen.queryByText(/workspace folder not found/i)).not.toBeInTheDocument();
      const toggle = screen.getByRole('button', { name: 'Toggle Go' });
      fireEvent.click(toggle);
      fireEvent.click(toggle);

      await waitFor(() => {
        expect(screen.getByRole('treeitem', { name: 'main.go' })).toBeInTheDocument();
      });
      expect(ReadDirectoryShallow).toHaveBeenCalledWith(`${root}/backend`, root);
      expect(ReadDirectoryShallow).toHaveBeenCalledWith(`${root}/backend/go`, root);
      expect(screen.queryByTestId('unreadable-indicator')).not.toBeInTheDocument();
    } finally {
      restoreVirtualLayout();
    }
  });

  it('stops nested workspace hydration at the first unreadable ancestor', async () => {
    const nestedDefs = [
      defs[0],
      { id: 'go', name: 'Go', relDir: 'backend/go', type: 'go', accent: 'go' },
    ] as workspace.WorkspaceDef[];
    seed('go', {
      workspaces: nestedDefs,
      directoryTree: [],
      dirtyPaths: new Set(),
      toast: null,
    });
    (ReadDirectoryShallow as jest.Mock).mockRejectedValue(new Error('permission denied'));

    render(<FileExplorer />);

    await waitFor(() => {
      expect(useIDEStore.getState().dirtyPaths.has(`${root}/backend`)).toBe(true);
    });
    await Promise.resolve();
    expect(ReadDirectoryShallow).toHaveBeenCalledWith(`${root}/backend`, root);
    expect(ReadDirectoryShallow).not.toHaveBeenCalledWith(`${root}/backend/go`, root);
    expect(useIDEStore.getState().dirtyPaths.has(`${root}/backend/go`)).toBe(false);
    expect(useIDEStore.getState().toast).toEqual({
      message: 'Failed to load backend',
      type: 'error',
    });
  });

  it('stops scoped hydration when a same-path workspace is reopened', async () => {
    let resolveBackend!: (entries: FileEntry[]) => void;
    const nestedDefs = [
      defs[0],
      { id: 'go', name: 'Go', relDir: 'backend/go', type: 'go', accent: 'go' },
    ] as workspace.WorkspaceDef[];
    seed('go', {
      workspaces: nestedDefs,
      directoryTree: [],
      dirtyPaths: new Set(),
      toast: null,
    });
    (ReadDirectoryShallow as jest.Mock).mockImplementation(
      (path: string) =>
        new Promise<FileEntry[]>((resolve) => {
          if (path === `${root}/backend`) {
            resolveBackend = resolve;
            return;
          }
          resolve([]);
        })
    );

    render(<FileExplorer />);
    await waitFor(() => {
      expect(ReadDirectoryShallow).toHaveBeenCalledWith(`${root}/backend`, root);
    });

    await act(async () => {
      useIDEStore.setState({
        workspace: { name: 'reopened', path: root },
        workspaces: nestedDefs,
        activeWorkspaceId: 'go',
        directoryTree: [],
      });
      resolveBackend([]);
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(ReadDirectoryShallow).not.toHaveBeenCalledWith(`${root}/backend/go`, root);
  });
});
