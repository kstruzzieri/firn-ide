import { useIDEStore } from '../../stores/ideStore';
import type { RunProfile } from '../../types/runProfile';

const profile: RunProfile = {
  id: 'p1',
  name: 'Dev',
  type: 'single',
  source: 'user',
  command: 'npm run dev',
};

describe('ideStore — runProfileForm', () => {
  beforeEach(() => useIDEStore.getState().closeRunProfileForm());

  it('defaults to null (list view)', () => {
    expect(useIDEStore.getState().runProfileForm).toBeNull();
  });

  it('opens create and edit states', () => {
    useIDEStore.getState().openRunProfileForm({ mode: 'create' });
    expect(useIDEStore.getState().runProfileForm).toEqual({ mode: 'create' });

    useIDEStore.getState().openRunProfileForm({ mode: 'edit', profile });
    expect(useIDEStore.getState().runProfileForm).toEqual({ mode: 'edit', profile });
  });

  it('closes back to null', () => {
    useIDEStore.getState().openRunProfileForm({ mode: 'create' });
    useIDEStore.getState().closeRunProfileForm();
    expect(useIDEStore.getState().runProfileForm).toBeNull();
  });
});
