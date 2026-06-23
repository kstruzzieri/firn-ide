import { renderHook, act } from '@testing-library/react';
import { useIDEStore } from '../../stores/ideStore';
import type { RunProfile } from '../../types/runProfile';

// Mock Wails App bindings
const mockLoadRunProfiles = jest.fn<Promise<void>, [string]>().mockResolvedValue(undefined);
const mockGetAllRunProfiles = jest.fn<Promise<RunProfile[]>, []>().mockResolvedValue([]);
jest.mock('../../../wailsjs/go/main/App', () => ({
  LoadRunProfiles: mockLoadRunProfiles,
  GetAllRunProfiles: mockGetAllRunProfiles,
}));

// Mock Wails runtime
const mockEventsOn = jest
  .fn<() => void, [string, (profiles: unknown) => void]>()
  .mockImplementation(() => jest.fn());
jest.mock('../../../wailsjs/runtime/runtime', () => ({
  EventsOn: mockEventsOn,
}));

// Import after mocks
import { useRunProfilesLoader } from '../../hooks/useRunProfiles';

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
  mockGetAllRunProfiles.mockResolvedValue(sampleProfiles);
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
    expect(mockGetAllRunProfiles).toHaveBeenCalled();
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
    mockGetAllRunProfiles.mockResolvedValueOnce(profilesB);

    rerender({ path: '/workspace-b' });

    // Let workspace B resolve
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(useIDEStore.getState().runProfiles).toEqual(profilesB);

    // Now let workspace A resolve — it should be discarded
    mockGetAllRunProfiles.mockResolvedValueOnce(sampleProfiles);
    resolveA();
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    // Store should still have workspace B's profiles
    expect(useIDEStore.getState().runProfiles).toEqual(profilesB);
  });

  it('carries workspace ownership fields through normalization', async () => {
    mockGetAllRunProfiles.mockResolvedValueOnce([
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
    ] as unknown as RunProfile[]);

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
    let eventCallback: (profiles: RunProfile[]) => void = () => {};
    mockEventsOn.mockImplementationOnce((_event: string, cb: (profiles: unknown) => void) => {
      eventCallback = cb as (profiles: RunProfile[]) => void;
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
      eventCallback(updatedProfiles);
    });

    expect(useIDEStore.getState().runProfiles).toEqual(updatedProfiles);
  });
});
