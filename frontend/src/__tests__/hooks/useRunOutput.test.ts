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

  it('should subscribe to run:compound and route to handleCompoundRun', () => {
    const handleCompoundRun = jest.fn();
    useIDEStore.setState({ handleCompoundRun });

    renderHook(() => useRunOutputListener());

    expect(mockEventsOn).toHaveBeenCalledWith('run:compound', expect.any(Function));

    const compoundCallback = mockEventsOn.mock.calls.find(
      ([event]) => event === 'run:compound'
    )?.[1];
    expect(compoundCallback).toBeDefined();

    const event = {
      compoundId: 'ci',
      name: 'CI',
      state: 'running',
      currentStep: 0,
      steps: [],
    };
    compoundCallback!(event);

    expect(handleCompoundRun).toHaveBeenCalledWith(event);
  });

  it('should not count composite step output toward waveform data', () => {
    jest.useFakeTimers();
    try {
      const updateWaveform = jest.fn();
      useIDEStore.setState({ updateWaveform, appendRunOutput: jest.fn() });

      renderHook(() => useRunOutputListener());

      const outputCallback = mockEventsOn.mock.calls.find(([event]) => event === 'run:output')?.[1];
      expect(outputCallback).toBeDefined();

      // A chunk with a parentRunInstanceId is compound step output and must NOT
      // be counted; a plain chunk ("real") is a normal profile and SHOULD be.
      outputCallback!({
        runInstanceId: 'step-r1',
        profileId: 'build',
        parentRunInstanceId: 'agg-r1',
        stepIdx: 0,
        stream: 'stdout',
        data: 'x\n',
        timestamp: 1,
      });
      outputCallback!({
        runInstanceId: 'r1',
        profileId: 'real',
        stepIdx: 0,
        stream: 'stdout',
        data: 'y\n',
        timestamp: 2,
      });

      // Drive the 500ms waveform flush interval.
      jest.advanceTimersByTime(600);

      expect(updateWaveform).toHaveBeenCalledWith('real', expect.any(Number));
      expect(updateWaveform).not.toHaveBeenCalledWith('build', expect.anything());
    } finally {
      jest.useRealTimers();
    }
  });
});
