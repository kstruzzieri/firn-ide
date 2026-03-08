import { useIDEStore } from '../../stores/ideStore';
import type { RunProfile } from '../../types/runProfile';

// Reset store between tests
beforeEach(() => {
  useIDEStore.setState({
    runProfiles: [],
    isLoadingProfiles: false,
    profilesError: null,
  });
});

const sampleDetected: RunProfile = {
  id: 'detected-go-mod-build',
  name: 'go build',
  type: 'single',
  source: 'detected',
  command: 'go build ./...',
  detectedFrom: 'go.mod',
  tags: ['build'],
};

const sampleSaved: RunProfile = {
  id: 'user-custom',
  name: 'Custom Build',
  type: 'single',
  source: 'user',
  command: 'make custom',
  tags: ['build'],
};

describe('ideStore - run profile state', () => {
  it('should start with empty profiles', () => {
    const state = useIDEStore.getState();
    expect(state.runProfiles).toEqual([]);
    expect(state.isLoadingProfiles).toBe(false);
    expect(state.profilesError).toBeNull();
  });

  it('should set run profiles and clear loading/error', () => {
    const { setProfilesLoading, setRunProfiles } = useIDEStore.getState();

    setProfilesLoading(true);
    expect(useIDEStore.getState().isLoadingProfiles).toBe(true);

    setRunProfiles([sampleDetected, sampleSaved]);

    const state = useIDEStore.getState();
    expect(state.runProfiles).toHaveLength(2);
    expect(state.isLoadingProfiles).toBe(false);
    expect(state.profilesError).toBeNull();
  });

  it('should set profiles error and clear loading', () => {
    const { setProfilesLoading, setProfilesError } = useIDEStore.getState();

    setProfilesLoading(true);
    setProfilesError('Failed to load');

    const state = useIDEStore.getState();
    expect(state.profilesError).toBe('Failed to load');
    expect(state.isLoadingProfiles).toBe(false);
  });
});

describe('ideStore - addOrUpdateProfile', () => {
  it('should add a new profile', () => {
    const { addOrUpdateProfile } = useIDEStore.getState();
    addOrUpdateProfile(sampleSaved);

    expect(useIDEStore.getState().runProfiles).toHaveLength(1);
    expect(useIDEStore.getState().runProfiles[0].id).toBe('user-custom');
  });

  it('should update an existing profile by id', () => {
    const { addOrUpdateProfile } = useIDEStore.getState();
    addOrUpdateProfile(sampleSaved);

    const updated = { ...sampleSaved, name: 'Updated Build' };
    addOrUpdateProfile(updated);

    const profiles = useIDEStore.getState().runProfiles;
    expect(profiles).toHaveLength(1);
    expect(profiles[0].name).toBe('Updated Build');
  });
});

describe('ideStore - removeProfile', () => {
  it('should remove a profile by id', () => {
    useIDEStore.setState({ runProfiles: [sampleDetected, sampleSaved] });
    const { removeProfile } = useIDEStore.getState();

    removeProfile('user-custom');

    const profiles = useIDEStore.getState().runProfiles;
    expect(profiles).toHaveLength(1);
    expect(profiles[0].id).toBe('detected-go-mod-build');
  });

  it('should handle removing non-existent id gracefully', () => {
    useIDEStore.setState({ runProfiles: [sampleSaved] });
    const { removeProfile } = useIDEStore.getState();

    removeProfile('nonexistent');

    expect(useIDEStore.getState().runProfiles).toHaveLength(1);
  });
});

describe('ideStore - profile selectors', () => {
  it('should filter detected profiles', () => {
    useIDEStore.setState({ runProfiles: [sampleDetected, sampleSaved] });

    const detected = useIDEStore.getState().runProfiles.filter((p) => p.source === 'detected');
    expect(detected).toHaveLength(1);
    expect(detected[0].source).toBe('detected');
  });

  it('should filter saved profiles', () => {
    useIDEStore.setState({ runProfiles: [sampleDetected, sampleSaved] });

    const saved = useIDEStore.getState().runProfiles.filter((p) => p.source === 'user');
    expect(saved).toHaveLength(1);
    expect(saved[0].source).toBe('user');
  });
});
