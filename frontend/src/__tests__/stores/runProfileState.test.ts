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

test('adoptProfileLocal / unadoptProfileLocal toggle adopted optimistically', () => {
  useIDEStore
    .getState()
    .setRunProfilesSnapshot([{ id: 'a', name: 'Dev', type: 'single', source: 'detected' }], {});
  useIDEStore.getState().adoptProfileLocal('a');
  expect(useIDEStore.getState().runProfileState.a.adopted).toBe(true);
  useIDEStore.getState().unadoptProfileLocal('a');
  expect(useIDEStore.getState().runProfileState.a.adopted).toBe(false);
});
