import { useIDEStore } from '../../stores/ideStore';

describe('lifecycle flag clearing on run:status events', () => {
  beforeEach(() => {
    useIDEStore.setState({
      stoppingProfileIds: ['p1'],
      restartingProfileIds: ['p2'],
      runHistory: {},
      runStartTimestamps: {},
    });
  });

  it('clearProfileStopping removes the profile id', () => {
    useIDEStore.getState().clearProfileStopping('p1');
    expect(useIDEStore.getState().stoppingProfileIds).toEqual([]);
  });

  it('clearProfileRestarting removes the profile id', () => {
    useIDEStore.getState().clearProfileRestarting('p2');
    expect(useIDEStore.getState().restartingProfileIds).toEqual([]);
  });

  it('appendRunHistory stores entry with duration', () => {
    useIDEStore.setState({ runStartTimestamps: { p1: 1000 } });
    useIDEStore.getState().appendRunHistory('p1', {
      state: 'success',
      duration: 5000,
      timestamp: 6000,
    });
    const history = useIDEStore.getState().runHistory['p1'];
    expect(history).toHaveLength(1);
    expect(history![0].duration).toBe(5000);
  });

  it('clearProfileStopping does not affect other profile ids', () => {
    useIDEStore.setState({ stoppingProfileIds: ['p1', 'p3'] });
    useIDEStore.getState().clearProfileStopping('p1');
    expect(useIDEStore.getState().stoppingProfileIds).toEqual(['p3']);
  });

  it('clearProfileRestarting does not affect other profile ids', () => {
    useIDEStore.setState({ restartingProfileIds: ['p2', 'p4'] });
    useIDEStore.getState().clearProfileRestarting('p2');
    expect(useIDEStore.getState().restartingProfileIds).toEqual(['p4']);
  });

  it('appendRunHistory stores failed state correctly', () => {
    useIDEStore.setState({ runStartTimestamps: { p2: 2000 } });
    useIDEStore.getState().appendRunHistory('p2', {
      state: 'failed',
      duration: 3000,
      timestamp: 5000,
    });
    const history = useIDEStore.getState().runHistory['p2'];
    expect(history).toHaveLength(1);
    expect(history![0].state).toBe('failed');
    expect(history![0].timestamp).toBe(5000);
  });

  it('appendRunHistory accumulates multiple entries', () => {
    useIDEStore.getState().appendRunHistory('p1', {
      state: 'success',
      duration: 1000,
      timestamp: 2000,
    });
    useIDEStore.getState().appendRunHistory('p1', {
      state: 'stopped',
      duration: 2000,
      timestamp: 4000,
    });
    const history = useIDEStore.getState().runHistory['p1'];
    expect(history).toHaveLength(2);
  });
});
