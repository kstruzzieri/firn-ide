import { renderHook, act } from '@testing-library/react';
import { useIDEStore } from '../../stores/ideStore';
import type { RunProfile } from '../../types/runProfile';

// Mock Wails App bindings
const mockLoadRunProfiles = jest.fn().mockResolvedValue(undefined);
const mockGetAllRunProfiles = jest.fn().mockResolvedValue([]);
jest.mock('../../../wailsjs/go/main/App', () => ({
  LoadRunProfiles: (...args: unknown[]) => mockLoadRunProfiles(...args),
  GetAllRunProfiles: (...args: unknown[]) => mockGetAllRunProfiles(...args),
}));

// Mock Wails runtime
const mockEventsOn = jest.fn(() => jest.fn());
jest.mock('../../../wailsjs/runtime/runtime', () => ({
  EventsOn: (...args: unknown[]) => mockEventsOn(...args),
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

  it('should update profiles when reactive event fires', async () => {
    let eventCallback: (profiles: RunProfile[]) => void = () => {};
    mockEventsOn.mockImplementationOnce((_event: string, cb: (profiles: RunProfile[]) => void) => {
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
      eventCallback(updatedProfiles);
    });

    expect(useIDEStore.getState().runProfiles).toEqual(updatedProfiles);
  });
});
