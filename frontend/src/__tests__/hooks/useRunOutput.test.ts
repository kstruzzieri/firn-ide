const mockEventsOn = jest
  .fn<() => void, [string, (...args: unknown[]) => void]>()
  .mockImplementation(() => jest.fn());

jest.mock('../../../wailsjs/runtime/runtime', () => ({
  EventsOn: mockEventsOn,
}));

jest.mock('../../../wailsjs/go/main/App', () => ({}));

import { renderHook } from '@testing-library/react';
import { useRunOutputListener } from '../../hooks/useRunOutput';
import { useIDEStore } from '../../stores/ideStore';

beforeEach(() => {
  jest.clearAllMocks();
  useIDEStore.setState({
    runOutputs: {},
    activeRunOutputId: null,
    runOutputViewMode: 'merged',
    runOutputAutoScroll: true,
  });
});

describe('useRunOutputListener', () => {
  it('should subscribe to run:output and run:status events', () => {
    renderHook(() => useRunOutputListener());

    expect(mockEventsOn).toHaveBeenCalledWith('run:output', expect.any(Function));
    expect(mockEventsOn).toHaveBeenCalledWith('run:status', expect.any(Function));
  });

  it('should clean up event listeners on unmount', () => {
    const cleanupOutput = jest.fn();
    const cleanupStatus = jest.fn();
    mockEventsOn.mockReturnValueOnce(cleanupOutput).mockReturnValueOnce(cleanupStatus);

    const { unmount } = renderHook(() => useRunOutputListener());
    unmount();

    expect(cleanupOutput).toHaveBeenCalled();
    expect(cleanupStatus).toHaveBeenCalled();
  });

  it('should auto-select first running profile', () => {
    renderHook(() => useRunOutputListener());

    const statusCallback = mockEventsOn.mock.calls.find(([event]) => event === 'run:status')?.[1];

    expect(statusCallback).toBeDefined();
    statusCallback!({ profileId: 'test-1', state: 'running', exitCode: 0 });

    expect(useIDEStore.getState().activeRunOutputId).toBe('test-1');
  });
});
