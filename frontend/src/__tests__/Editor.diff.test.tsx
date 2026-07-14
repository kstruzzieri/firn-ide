import { render, screen, fireEvent, act } from '@testing-library/react';
import { useIDEStore } from '../stores/ideStore';
import { useGitStore, type DiffSession } from '../stores/gitStore';
import type { workspace } from '../../wailsjs/go/models';

jest.mock('../../wailsjs/go/main/App', () => ({
  OpenFolderDialog: jest.fn(),
  ListRecentWorkspaces: jest.fn(() => Promise.resolve([])),
  GitStatus: jest.fn(),
  GitStage: jest.fn(),
  GitUnstage: jest.fn(),
  GitCommit: jest.fn(),
  GitPull: jest.fn(),
  GitPush: jest.fn(),
  GitBranches: jest.fn(),
  GitCheckout: jest.fn(),
  GitCommitMessageAvailable: jest.fn(),
  GitGenerateCommitMessage: jest.fn(),
  GitFileAtRev: jest.fn(),
  ReadFile: jest.fn(),
}));

jest.mock('../../wailsjs/runtime/runtime', () => ({
  WindowSetTitle: jest.fn(),
}));

// The merge view itself is unit-tested in GitDiffView.test; here it would
// drag CodeMirror into a tab-behavior test.
jest.mock('../components/Editor/GitDiffView', () => ({
  GitDiffView: ({ session }: { session: DiffSession }) => (
    <div data-testid="git-diff-view">{session.path}</div>
  ),
}));
// Both surfaces stay mounted now, so the editor renders even under a focused
// diff; stub CodeMirror to keep it out of these tab-behavior tests.
jest.mock('../components/Editor/CodeMirrorEditor', () => ({
  CodeMirrorEditor: () => <div data-testid="cm-editor" />,
}));

import { Editor } from '../components/Editor';

const session: DiffSession = {
  path: 'src/a.ts',
  absPath: '/repo/src/a.ts',
  context: 'unstaged',
  left: { label: 'Index', content: 'old' },
  right: { label: 'Working Tree', content: 'new' },
  binary: false,
  truncated: false,
  hunks: [],
};

function openFile(id: string, name: string) {
  return {
    id,
    name,
    path: `/repo/src/${name}`,
    content: '',
    isModified: false,
    language: 'typescript',
    encoding: 'UTF-8',
    lineEndings: 'LF' as const,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  useIDEStore.setState({
    workspace: { name: 'repo', path: '/repo' },
    workspaces: [],
    activeWorkspaceId: 'project',
    openFiles: [],
    activeFileId: null,
    recentWorkspaces: [],
  });
  useGitStore.setState({ diffSession: null, diffFocused: false });
});

describe('Editor git diff tab', () => {
  it('renders a diff tab and view when a session is focused', () => {
    useGitStore.setState({ diffSession: session, diffFocused: true });

    render(<Editor />);

    expect(screen.getByRole('tab', { name: /a\.ts.*diff/i })).toBeInTheDocument();
    expect(screen.getByTestId('git-diff-view')).toHaveTextContent('src/a.ts');
  });

  it('marks only the diff tab active while the diff is focused', () => {
    useIDEStore.setState({
      openFiles: [openFile('f1', 'other.ts')],
      activeFileId: 'f1',
    });
    useGitStore.setState({ diffSession: session, diffFocused: true });

    render(<Editor />);

    expect(screen.getByRole('tab', { name: /a\.ts.*diff/i })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getByRole('tab', { name: /other\.ts/i })).toHaveAttribute(
      'aria-selected',
      'false'
    );
  });

  it('marks only the file tab active once the diff is unfocused', () => {
    useIDEStore.setState({
      openFiles: [openFile('f1', 'other.ts')],
      activeFileId: 'f1',
    });
    useGitStore.setState({ diffSession: session, diffFocused: false });

    render(<Editor />);

    expect(screen.getByRole('tab', { name: /other\.ts/i })).toHaveAttribute(
      'aria-selected',
      'true'
    );
    expect(screen.getByRole('tab', { name: /a\.ts.*diff/i })).toHaveAttribute(
      'aria-selected',
      'false'
    );
  });

  it('shows the diff instead of the welcome screen even with no open files', () => {
    useGitStore.setState({ diffSession: session, diffFocused: true });

    render(<Editor />);

    expect(screen.queryByText('Command Palette')).not.toBeInTheDocument();
  });

  it('shows the diff when there is no active file, even if unfocused', () => {
    // After closing the file opened from a diff, the diff tab remains and
    // there is nothing else to show, so the diff must render (not blank).
    useIDEStore.setState({ openFiles: [], activeFileId: null });
    useGitStore.setState({ diffSession: session, diffFocused: false });

    render(<Editor />);

    expect(screen.getByTestId('git-diff-view')).toBeInTheDocument();
  });

  it('yields the diff when a file is opened (activeFileId changes)', () => {
    useIDEStore.setState({ openFiles: [openFile('f1', 'other.ts')], activeFileId: 'f1' });
    useGitStore.setState({ diffSession: session, diffFocused: true });

    const { rerender } = render(<Editor />);

    // Open a different file, as a tree double-click would.
    act(() => {
      useIDEStore.setState({
        openFiles: [openFile('f1', 'other.ts'), openFile('f2', 'new.ts')],
        activeFileId: 'f2',
      });
    });
    rerender(<Editor />);

    expect(useGitStore.getState().diffFocused).toBe(false);
  });

  it('closing the diff tab clears the session', () => {
    useGitStore.setState({ diffSession: session, diffFocused: true });

    render(<Editor />);
    fireEvent.click(screen.getByRole('button', { name: /close diff/i }));

    expect(useGitStore.getState().diffSession).toBeNull();
  });

  it('clicking a file tab unfocuses the diff without closing it', () => {
    useIDEStore.setState({
      openFiles: [openFile('f1', 'other.ts')],
      activeFileId: 'f1',
    });
    useGitStore.setState({ diffSession: session, diffFocused: true });

    render(<Editor />);
    fireEvent.click(screen.getByRole('tab', { name: /other\.ts/i }));

    expect(useGitStore.getState().diffFocused).toBe(false);
    expect(useGitStore.getState().diffSession).not.toBeNull();
  });

  it('clicking the diff tab refocuses an unfocused session', () => {
    useIDEStore.setState({
      openFiles: [openFile('f1', 'other.ts')],
      activeFileId: 'f1',
    });
    useGitStore.setState({ diffSession: session, diffFocused: false });

    render(<Editor />);
    act(() => {
      fireEvent.click(screen.getByRole('tab', { name: /a\.ts.*diff/i }));
    });

    expect(useGitStore.getState().diffFocused).toBe(true);
  });
});

describe('Editor workspace tab accents', () => {
  const workspaces = [
    { id: 'project', name: 'Project', relDir: '', type: 'project', accent: 'project' },
    { id: 'root:go', name: 'Root Go', relDir: '', type: 'go', accent: 'amber' },
    { id: 'frontend', name: 'Frontend', relDir: 'frontend', type: 'web', accent: 'blue' },
    { id: 'backend', name: 'Backend', relDir: 'backend', type: 'go', accent: 'cyan' },
    { id: 'api', name: 'API', relDir: 'backend/api', type: 'go', accent: 'green' },
  ] as workspace.WorkspaceDef[];

  it('resolves root, nested, boundary, and unrelated tabs independently of the active workspace', () => {
    useIDEStore.setState({
      workspaces,
      activeWorkspaceId: 'frontend',
      openFiles: [
        { ...openFile('f1', 'App.tsx'), path: '/repo/frontend/src/App.tsx' },
        { ...openFile('f2', 'root.go'), path: '/repo/root.go' },
        { ...openFile('f3', 'api.go'), path: '/repo/backend/api/api.go' },
        { ...openFile('f4', 'apiary.go'), path: '/repo/backend/apiary/apiary.go' },
        { ...openFile('f5', 'notes.md'), path: '/outside/notes.md' },
      ],
      activeFileId: 'f1',
    });

    render(<Editor />);

    expect(screen.getByRole('tab', { name: /App\.tsx/i })).toHaveStyle(
      '--tab-accent: var(--accent-blue)'
    );
    expect(screen.getByRole('tab', { name: /root\.go/i })).toHaveStyle(
      '--tab-accent: var(--accent-amber)'
    );
    expect(screen.getByRole('tab', { name: /api\.go/i })).toHaveStyle(
      '--tab-accent: var(--accent-green)'
    );
    expect(screen.getByRole('tab', { name: /apiary\.go/i })).toHaveStyle(
      '--tab-accent: var(--accent-cyan)'
    );
    expect(
      screen.getByRole('tab', { name: /notes\.md/i }).style.getPropertyValue('--tab-accent')
    ).toBe('');
  });

  it('colors a diff tab with its file workspace rather than the active workspace', () => {
    useIDEStore.setState({ workspaces, activeWorkspaceId: 'frontend' });
    useGitStore.setState({
      diffSession: {
        ...session,
        path: 'backend/api/diff.go',
        absPath: '/repo/backend/api/diff.go',
      },
      diffFocused: true,
    });

    render(<Editor />);

    expect(screen.getByRole('tab', { name: /diff\.go.*diff/i })).toHaveStyle(
      '--tab-accent: var(--accent-green)'
    );
  });

  it('falls back to the neutral project token for an accent without a CSS token', () => {
    useIDEStore.setState({
      workspaces: [
        { id: 'project', name: 'Project', relDir: '', type: 'project', accent: 'project' },
        { id: 'legacy', name: 'Legacy', relDir: 'legacy', type: 'web', accent: 'magenta' },
      ] as workspace.WorkspaceDef[],
      openFiles: [{ ...openFile('f1', 'old.ts'), path: '/repo/legacy/old.ts' }],
      activeFileId: 'f1',
    });

    render(<Editor />);

    const tab = screen.getByRole('tab', { name: /old\.ts/i });
    expect(tab).toHaveStyle('--tab-accent: var(--accent-project)');
    expect(tab.className).toContain('workspaceTab');
  });
});
