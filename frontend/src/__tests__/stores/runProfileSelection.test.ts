// frontend/src/__tests__/stores/runProfileSelection.test.ts
import { useIDEStore } from '../../stores/ideStore';

beforeEach(() => {
  useIDEStore.setState({ selectedProfileId: null });
});

test('selectedProfileId defaults to null', () => {
  expect(useIDEStore.getState().selectedProfileId).toBeNull();
});

test('setSelectedProfile sets and clears the id', () => {
  useIDEStore.getState().setSelectedProfile('p1');
  expect(useIDEStore.getState().selectedProfileId).toBe('p1');
  useIDEStore.getState().setSelectedProfile(null);
  expect(useIDEStore.getState().selectedProfileId).toBeNull();
});
