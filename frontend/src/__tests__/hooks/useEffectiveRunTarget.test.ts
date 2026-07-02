import { renderHook } from '@testing-library/react';
import { useEffectiveRunTarget } from '../../hooks/useEffectiveRunTarget';
import { useIDEStore } from '../../stores/ideStore';

beforeEach(() => {
  useIDEStore.setState({
    selectedProfileId: null,
    runProfiles: [
      { id: 'a', name: 'a', type: 'single', source: 'user', workspaceId: 'ws1' },
      { id: 'b', name: 'b', type: 'single', source: 'detected', workspaceId: 'ws1' },
    ],
    runProfileState: { b: { lastRunAt: 99 } },
    hiddenProfileIds: [],
    activeWorkspaceId: 'ws1',
  });
});

test('returns recency default when nothing selected', () => {
  const { result } = renderHook(() => useEffectiveRunTarget());
  expect(result.current).toBe('b'); // b ran most recently
});

test('reflects explicit selection', () => {
  useIDEStore.getState().setSelectedProfile('a');
  const { result } = renderHook(() => useEffectiveRunTarget());
  expect(result.current).toBe('a');
});
