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

describe('treeView store — setTreeViewMode', () => {
  const rootGoDefs = [
    { id: 'project', name: 'Project', relDir: '', type: 'project', accent: 'project' },
    { id: 'root:go', name: 'Go', relDir: '', type: 'go', accent: 'cyan' },
  ] as workspace.WorkspaceDef[];

  beforeEach(() => {
    useIDEStore.setState({
      workspaces: [],
      activeWorkspaceId: 'project',
      lastFocusedWorkspaceId: null,
    });
  });

  it("'project' mode sets activeWorkspaceId to project, keeps lastFocused", () => {
    useIDEStore.getState().setWorkspaces(defs);
    useIDEStore.getState().setActiveWorkspace('frontend');
    useIDEStore.getState().setTreeViewMode('project');
    expect(useIDEStore.getState().activeWorkspaceId).toBe('project');
    expect(useIDEStore.getState().lastFocusedWorkspaceId).toBe('frontend');
  });

  it("'workspace' mode restores lastFocusedWorkspaceId when still valid", () => {
    useIDEStore.getState().setWorkspaces(defs);
    useIDEStore.getState().setActiveWorkspace('go');
    useIDEStore.getState().setTreeViewMode('project');
    useIDEStore.getState().setTreeViewMode('workspace');
    expect(useIDEStore.getState().activeWorkspaceId).toBe('go');
  });

  it("'workspace' mode falls back to first non-root workspace when no lastFocused", () => {
    useIDEStore.getState().setWorkspaces(defs); // frontend (relDir frontend) is first non-root
    useIDEStore.getState().setTreeViewMode('workspace');
    expect(useIDEStore.getState().activeWorkspaceId).toBe('frontend');
  });

  it("'workspace' mode prefers a non-root workspace over a root-typed one", () => {
    const mixed = [
      { id: 'project', name: 'Project', relDir: '', type: 'project', accent: 'project' },
      { id: 'root:go', name: 'Go', relDir: '', type: 'go', accent: 'cyan' },
      { id: 'frontend', name: 'Frontend', relDir: 'frontend', type: 'frontend', accent: 'blue' },
    ] as workspace.WorkspaceDef[];
    useIDEStore.getState().setWorkspaces(mixed);
    useIDEStore.getState().setTreeViewMode('workspace');
    expect(useIDEStore.getState().activeWorkspaceId).toBe('frontend');
  });

  it("'workspace' mode falls back to a root-typed workspace when no non-root exists", () => {
    useIDEStore.getState().setWorkspaces(rootGoDefs);
    useIDEStore.getState().setTreeViewMode('workspace');
    expect(useIDEStore.getState().activeWorkspaceId).toBe('root:go');
  });

  it("'workspace' mode stays project when there are no real workspaces", () => {
    useIDEStore.getState().setWorkspaces([defs[0]]); // project only
    useIDEStore.getState().setTreeViewMode('workspace');
    expect(useIDEStore.getState().activeWorkspaceId).toBe('project');
  });
});
