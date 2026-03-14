import { renderHook, waitFor } from '@testing-library/react';
import { useIDEStore } from '../../stores/ideStore';

const mockListRecentWorkspaces = jest.fn();

jest.mock('../../../wailsjs/go/main/App', () => ({
  ListRecentWorkspaces: mockListRecentWorkspaces,
}));

import { useRecentWorkspaces } from '../../hooks/useRecentWorkspaces';

beforeEach(() => {
  jest.clearAllMocks();
  useIDEStore.setState({
    workspace: null,
    recentWorkspaces: [],
    recentWorkspacesVersion: 0,
  });
});

describe('useRecentWorkspaces', () => {
  it('should fetch recent workspaces on mount', async () => {
    mockListRecentWorkspaces.mockResolvedValue([
      { name: 'project-a', path: '/projects/a', lastOpened: '2026-01-02T00:00:00Z' },
      { name: 'project-b', path: '/projects/b', lastOpened: '2026-01-01T00:00:00Z' },
    ]);

    renderHook(() => useRecentWorkspaces());

    await waitFor(() => {
      const state = useIDEStore.getState();
      expect(state.recentWorkspaces).toHaveLength(2);
      expect(state.recentWorkspaces[0].name).toBe('project-a');
    });
  });

  it('should limit to 10 recent workspaces', async () => {
    const many = Array.from({ length: 15 }, (_, i) => ({
      name: `project-${i}`,
      path: `/projects/${i}`,
      lastOpened: `2026-01-${String(15 - i).padStart(2, '0')}T00:00:00Z`,
    }));
    mockListRecentWorkspaces.mockResolvedValue(many);

    renderHook(() => useRecentWorkspaces());

    await waitFor(() => {
      expect(useIDEStore.getState().recentWorkspaces).toHaveLength(10);
    });
  });

  it('should handle null response from backend', async () => {
    mockListRecentWorkspaces.mockResolvedValue(null);

    renderHook(() => useRecentWorkspaces());

    await waitFor(() => {
      expect(useIDEStore.getState().recentWorkspaces).toEqual([]);
    });
  });

  it('should handle backend errors gracefully', async () => {
    const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    mockListRecentWorkspaces.mockRejectedValue(new Error('disk read error'));

    renderHook(() => useRecentWorkspaces());

    await waitFor(() => {
      expect(warnSpy).toHaveBeenCalledWith('Failed to load recent workspaces:', expect.any(Error));
    });

    // Store should remain empty (not corrupted)
    expect(useIDEStore.getState().recentWorkspaces).toEqual([]);
    warnSpy.mockRestore();
  });

  it('should NOT refetch when workspace path changes (optimistic updates handle in-session ordering)', async () => {
    mockListRecentWorkspaces.mockResolvedValue([
      { name: 'project-a', path: '/projects/a', lastOpened: '2026-01-01T00:00:00Z' },
    ]);

    const { rerender } = renderHook(() => useRecentWorkspaces());

    await waitFor(() => {
      expect(useIDEStore.getState().recentWorkspaces).toHaveLength(1);
    });

    // Simulate workspace switch — the hook should NOT refetch because the
    // backend hasn't persisted the new LastOpened yet. Refetching here would
    // overwrite the optimistic update from openWorkspaceByPath with stale data.
    useIDEStore.setState({
      workspace: { name: 'project-b', path: '/projects/b' },
    });

    rerender();

    // Only the initial mount fetch should have occurred
    expect(mockListRecentWorkspaces).toHaveBeenCalledTimes(1);
  });

  it('should discard stale backend response when an optimistic update occurs mid-flight', async () => {
    // Simulate a slow backend fetch that resolves after an optimistic update
    let resolveFetch!: (value: unknown) => void;
    mockListRecentWorkspaces.mockReturnValue(
      new Promise((resolve) => {
        resolveFetch = resolve;
      })
    );

    renderHook(() => useRecentWorkspaces());

    // While the backend fetch is in flight, simulate an optimistic update
    // (as openWorkspaceByPath would do)
    const optimisticEntry = {
      name: 'new-project',
      path: '/projects/new',
      lastOpened: '2026-03-13T00:00:00Z',
    };
    useIDEStore.setState(
      (s) => ({
        recentWorkspaces: [optimisticEntry],
        recentWorkspacesVersion: s.recentWorkspacesVersion + 1,
      }),
      false,
      'setRecentWorkspaces/optimistic'
    );

    // Now the backend fetch resolves with stale data
    resolveFetch([
      { name: 'old-project', path: '/projects/old', lastOpened: '2026-01-01T00:00:00Z' },
    ]);

    // Wait a tick for the async handler to run
    await waitFor(() => {
      expect(mockListRecentWorkspaces).toHaveBeenCalledTimes(1);
    });

    // The optimistic entry should still be in place — stale data was discarded
    const state = useIDEStore.getState();
    expect(state.recentWorkspaces).toHaveLength(1);
    expect(state.recentWorkspaces[0].name).toBe('new-project');
  });
});
