import { useIDEStore } from '../../stores/ideStore';

beforeEach(() => {
  useIDEStore.setState(useIDEStore.getInitialState());
});

describe('navigation history', () => {
  const loc1 = { fileId: '/a.ts', line: 10, column: 5 };
  const loc2 = { fileId: '/b.ts', line: 20, column: 1 };
  const loc3 = { fileId: '/c.ts', line: 30, column: 8 };

  it('starts with empty stacks', () => {
    const state = useIDEStore.getState();
    expect(state.navigationHistory).toEqual([]);
    expect(state.navigationForward).toEqual([]);
  });

  it('pushNavigationHistory adds to back stack', () => {
    useIDEStore.getState().pushNavigationHistory(loc1);
    expect(useIDEStore.getState().navigationHistory).toEqual([loc1]);
  });

  it('pushNavigationHistory clears forward stack', () => {
    const store = useIDEStore.getState();
    store.pushNavigationHistory(loc1);
    store.pushNavigationHistory(loc2);
    store.goBack();
    expect(useIDEStore.getState().navigationForward).toHaveLength(1);
    store.pushNavigationHistory(loc3);
    expect(useIDEStore.getState().navigationForward).toEqual([]);
  });

  it('goBack pops from back stack and pushes to forward stack', () => {
    const store = useIDEStore.getState();
    store.pushNavigationHistory(loc1);
    store.pushNavigationHistory(loc2);
    const result = useIDEStore.getState().goBack();
    expect(result).toEqual(loc2);
    expect(useIDEStore.getState().navigationHistory).toEqual([loc1]);
    expect(useIDEStore.getState().navigationForward).toEqual([loc2]);
  });

  it('goBack returns undefined when stack is empty', () => {
    const result = useIDEStore.getState().goBack();
    expect(result).toBeUndefined();
  });

  it('goForward pops from forward stack and pushes to back stack', () => {
    const store = useIDEStore.getState();
    store.pushNavigationHistory(loc1);
    store.pushNavigationHistory(loc2);
    store.goBack();
    const result = useIDEStore.getState().goForward();
    expect(result).toEqual(loc2);
    expect(useIDEStore.getState().navigationForward).toEqual([]);
    expect(useIDEStore.getState().navigationHistory).toEqual([loc1, loc2]);
  });

  it('goForward returns undefined when forward stack is empty', () => {
    const result = useIDEStore.getState().goForward();
    expect(result).toBeUndefined();
  });

  it('caps navigation history at 50 entries', () => {
    const store = useIDEStore.getState();
    for (let i = 0; i < 55; i++) {
      store.pushNavigationHistory({ fileId: `/file${i}.ts`, line: i, column: 1 });
    }
    expect(useIDEStore.getState().navigationHistory).toHaveLength(50);
    expect(useIDEStore.getState().navigationHistory[0].fileId).toBe('/file5.ts');
  });

  it('resetWorkspaceSession clears navigation stacks', () => {
    const store = useIDEStore.getState();
    store.pushNavigationHistory(loc1);
    store.pushNavigationHistory(loc2);
    store.goBack();
    store.resetWorkspaceSession();
    expect(useIDEStore.getState().navigationHistory).toEqual([]);
    expect(useIDEStore.getState().navigationForward).toEqual([]);
  });
});
