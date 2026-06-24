import { renderHook, act } from '@testing-library/react';
import { useIDEStore } from '../../stores/ideStore';
import type { RunProfile } from '../../types/runProfile';

// Mock Wails App bindings
const mockLoadRunProfiles = jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined);
const mockGetRunProfilesSnapshot = jest.fn().mockResolvedValue({ profiles: [], profileState: {} });
jest.mock('../../../wailsjs/go/main/App', () => ({
  LoadRunProfiles: mockLoadRunProfiles,
  GetRunProfilesSnapshot: mockGetRunProfilesSnapshot,
}));

// Mock Wails runtime
const mockEventsOn = jest
  .fn<() => void, [string, (profiles: unknown) => void]>()
  .mockImplementation(() => jest.fn());
jest.mock('../../../wailsjs/runtime/runtime', () => ({
  EventsOn: mockEventsOn,
}));

// Import after mocks
import { useRunProfilesLoader, normalizeProfileState } from '../../hooks/useRunProfiles';

const sampleProfiles: RunProfile[] = [
  {
    id: 'detected-go-mod-build',
    name: 'go build',
    type: 'single',
    source: 'detected',
    command: 'go build ./...',
    detectedFrom: 'go.mod',
    tags: ['build'],
  },
];

beforeEach(() => {
  jest.clearAllMocks();
  useIDEStore.setState({
    runProfiles: [],
    isLoadingProfiles: false,
    profilesError: null,
  });
  mockLoadRunProfiles.mockResolvedValue(undefined);
  mockGetRunProfilesSnapshot.mockResolvedValue({ profiles: sampleProfiles, profileState: {} });
});

describe('normalizeProfileState', () => {
  test('normalizeProfileState keeps valid entries, drops malformed', () => {
    const out = normalizeProfileState({
      a: { adopted: true, lastRunAt: 5 },
      b: { adopted: 'nope', lastRunAt: 'x' },
      c: null,
    });
    expect(out.a).toEqual({ adopted: true, lastRunAt: 5 });
    expect(out.b).toEqual({ adopted: false, lastRunAt: 0 });
    expect(out.c).toBeUndefined();
  });
});

describe('useRunProfilesLoader', () => {
  it('should not load when path is null', () => {
    renderHook(() => useRunProfilesLoader(null));
    expect(mockLoadRunProfiles).not.toHaveBeenCalled();
  });

  it('should load profiles on mount with valid path', async () => {
    renderHook(() => useRunProfilesLoader('/workspace'));

    // Should set loading
    expect(useIDEStore.getState().isLoadingProfiles).toBe(true);

    // Wait for promises
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(mockLoadRunProfiles).toHaveBeenCalledWith('/workspace');
    expect(mockGetRunProfilesSnapshot).toHaveBeenCalled();
    expect(useIDEStore.getState().runProfiles).toEqual(sampleProfiles);
    expect(useIDEStore.getState().isLoadingProfiles).toBe(false);
  });

  it('should subscribe to runprofiles:changed event', () => {
    renderHook(() => useRunProfilesLoader('/workspace'));

    expect(mockEventsOn).toHaveBeenCalledWith('runprofiles:changed', expect.any(Function));
  });

  it('should clean up event listener on unmount', () => {
    const mockCleanup = jest.fn();
    mockEventsOn.mockReturnValueOnce(mockCleanup);

    const { unmount } = renderHook(() => useRunProfilesLoader('/workspace'));
    unmount();

    expect(mockCleanup).toHaveBeenCalled();
  });

  it('should set error on load failure', async () => {
    mockLoadRunProfiles.mockRejectedValueOnce(new Error('Permission denied'));

    renderHook(() => useRunProfilesLoader('/workspace'));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(useIDEStore.getState().profilesError).toBe('Permission denied');
    expect(useIDEStore.getState().isLoadingProfiles).toBe(false);
  });

  it('should discard stale load when workspace changes', async () => {
    // First render with workspace A — make it resolve slowly
    let resolveA: () => void = () => {};
    mockLoadRunProfiles.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveA = resolve;
        })
    );

    const { rerender } = renderHook(
      ({ path }: { path: string | null }) => useRunProfilesLoader(path),
      { initialProps: { path: '/workspace-a' } }
    );

    // Switch to workspace B before A resolves
    const profilesB: RunProfile[] = [
      { id: 'b1', name: 'B profile', type: 'single', source: 'user', command: 'echo b' },
    ];
    mockLoadRunProfiles.mockResolvedValueOnce(undefined);
    mockGetRunProfilesSnapshot.mockResolvedValueOnce({ profiles: profilesB, profileState: {} });

    rerender({ path: '/workspace-b' });

    // Let workspace B resolve
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(useIDEStore.getState().runProfiles).toEqual(profilesB);

    // Now let workspace A resolve — it should be discarded
    mockGetRunProfilesSnapshot.mockResolvedValueOnce({
      profiles: sampleProfiles,
      profileState: {},
    });
    resolveA();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Store should still have workspace B's profiles
    expect(useIDEStore.getState().runProfiles).toEqual(profilesB);
  });

  it('carries workspace ownership fields through normalization', async () => {
    mockGetRunProfilesSnapshot.mockResolvedValueOnce({
      profiles: [
        {
          id: 'detected-frontend-package-json-dev',
          name: 'npm run dev',
          type: 'single',
          source: 'detected',
          command: 'npm run dev',
          workingDir: 'frontend',
          workspaceId: 'frontend',
          workspaceName: 'Frontend',
          workspaceRelDir: 'frontend',
        },
      ],
      profileState: {},
    });

    renderHook(() => useRunProfilesLoader('/workspace'));

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    const profiles = useIDEStore.getState().runProfiles;
    expect(profiles[0]?.workspaceId).toBe('frontend');
    expect(profiles[0]?.workspaceName).toBe('Frontend');
    expect(profiles[0]?.workspaceRelDir).toBe('frontend');
  });

  it('should update profiles when reactive event fires', async () => {
    let eventCallback: (snap: unknown) => void = () => {};
    mockEventsOn.mockImplementationOnce((_event: string, cb: (snap: unknown) => void) => {
      eventCallback = cb;
      return jest.fn();
    });

    renderHook(() => useRunProfilesLoader('/workspace'));

    const updatedProfiles: RunProfile[] = [
      ...sampleProfiles,
      {
        id: 'detected-pkg-start',
        name: 'npm run start',
        type: 'single',
        source: 'detected',
        command: 'npm run start',
        tags: ['dev'],
      },
    ];

    act(() => {
      eventCallback({ profiles: updatedProfiles, profileState: {} });
    });

    expect(useIDEStore.getState().runProfiles).toEqual(updatedProfiles);
  });
});
