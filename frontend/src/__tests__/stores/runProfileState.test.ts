import { useIDEStore } from '../../stores/ideStore';

beforeEach(() => {
  useIDEStore.setState({ runProfiles: [], runProfileState: {} });
});

test('setRunProfilesSnapshot hydrates profiles and state', () => {
  useIDEStore
    .getState()
    .setRunProfilesSnapshot([{ id: 'a', name: 'Dev', type: 'single', source: 'detected' }], {
      a: { adopted: true, lastRunAt: 5 },
    });
  expect(useIDEStore.getState().runProfiles).toHaveLength(1);
  expect(useIDEStore.getState().runProfileState.a).toEqual({ adopted: true, lastRunAt: 5 });
});

test('adoptProfileLocal sets adopted; unadopt of a stateless entry removes the key', () => {
  useIDEStore
    .getState()
    .setRunProfilesSnapshot([{ id: 'a', name: 'Dev', type: 'single', source: 'detected' }], {});
  useIDEStore.getState().adoptProfileLocal('a');
  expect(useIDEStore.getState().runProfileState.a.adopted).toBe(true);
  // No lastRunAt → unadopt mirrors the backend by dropping the entry entirely.
  useIDEStore.getState().unadoptProfileLocal('a');
  expect(useIDEStore.getState().runProfileState.a).toBeUndefined();
  expect('a' in useIDEStore.getState().runProfileState).toBe(false);
});

test('unadoptProfileLocal keeps an entry that has a lastRunAt, clearing adopted', () => {
  useIDEStore
    .getState()
    .setRunProfilesSnapshot([{ id: 'a', name: 'Dev', type: 'single', source: 'detected' }], {
      a: { adopted: true, lastRunAt: 1234 },
    });
  useIDEStore.getState().unadoptProfileLocal('a');
  expect(useIDEStore.getState().runProfileState.a).toEqual({ adopted: false, lastRunAt: 1234 });
});
