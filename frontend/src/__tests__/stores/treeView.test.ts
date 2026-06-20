import { useIDEStore } from '../../stores/ideStore';
import type { workspace } from '../../../wailsjs/go/models';

const defs = [
  { id: 'project', name: 'Project', relDir: '', type: 'project', accent: 'project' },
  { id: 'frontend', name: 'Frontend', relDir: 'frontend', type: 'frontend', accent: 'blue' },
  { id: 'go', name: 'Go', relDir: 'backend/go', type: 'go', accent: 'cyan' },
] as workspace.WorkspaceDef[];

describe('treeView store — setActiveWorkspace + lastFocusedWorkspaceId', () => {
  beforeEach(() => {
    useIDEStore.setState({
      workspaces: [],
      activeWorkspaceId: 'project',
      lastFocusedWorkspaceId: null,
    });
  });

  it('records lastFocusedWorkspaceId when a real workspace is selected', () => {
    useIDEStore.getState().setWorkspaces(defs);
    useIDEStore.getState().setActiveWorkspace('frontend');
    expect(useIDEStore.getState().activeWorkspaceId).toBe('frontend');
    expect(useIDEStore.getState().lastFocusedWorkspaceId).toBe('frontend');
  });

  it('keeps lastFocusedWorkspaceId when switching to project', () => {
    useIDEStore.getState().setWorkspaces(defs);
    useIDEStore.getState().setActiveWorkspace('frontend');
    useIDEStore.getState().setActiveWorkspace('project');
    expect(useIDEStore.getState().activeWorkspaceId).toBe('project');
    expect(useIDEStore.getState().lastFocusedWorkspaceId).toBe('frontend');
  });

  it('does not record an invalid id as lastFocused', () => {
    useIDEStore.getState().setWorkspaces(defs);
    useIDEStore.getState().setActiveWorkspace('nope');
    expect(useIDEStore.getState().activeWorkspaceId).toBe('project');
    expect(useIDEStore.getState().lastFocusedWorkspaceId).toBeNull();
  });
});
