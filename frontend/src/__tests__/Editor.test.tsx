import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { useIDEStore } from '../stores/ideStore';
import { useGitStore, type DiffSession, type MergeSession } from '../stores/gitStore';
import { __resetGolemStore, useGolemStore } from '../stores/golemStore';

jest.mock('../../wailsjs/go/main/App', () => ({
  OpenFolderDialog: jest.fn(),
  ListRecentWorkspaces: jest.fn(() => Promise.resolve([])),
  CancelGolemRun: jest.fn(),
  RunGolemTurn: jest.fn(),
}));

const mockWindowSetTitle = jest.fn();
jest.mock('../../wailsjs/runtime/runtime', () => ({
  WindowSetTitle: mockWindowSetTitle,
}));

// The real CodeMirrorEditor drags the full CM6 + LSP extension graph into
// jsdom; the suppression tests below only need the Editor shell to mount.
jest.mock('../components/Editor/CodeMirrorEditor', () => {
  const mockReact = require('react');
  return {
    CodeMirrorEditor: () => mockReact.createElement('div', { 'data-testid': 'codemirror-mock' }),
  };
});

// The surfaces themselves are unit-tested in their own suites; here they would
// only drag CodeMirror and the Golem settings transport into a tab-behaviour
// test.
jest.mock('../components/Editor/GitDiffView', () => {
  const mockReact = require('react');
  return { GitDiffView: () => mockReact.createElement('div', { 'data-testid': 'diff-mock' }) };
});
jest.mock('../components/Editor/MergeResolutionView', () => {
  const mockReact = require('react');
  return {
    MergeResolutionView: () => mockReact.createElement('div', { 'data-testid': 'merge-mock' }),
  };
});
jest.mock('../components/GolemConfig/GolemConfigWorkspace', () => {
  const mockReact = require('react');
  return {
    GolemConfigWorkspace: ({ onClose }: { onClose: () => void }) =>
      mockReact.createElement(
        'div',
        { 'data-testid': 'golem-config-mock' },
        mockReact.createElement(
          'button',
          { type: 'button', onClick: onClose },
          'Close configuration'
        )
      ),
  };
});

import { Editor } from '../components/Editor';
import * as platform from '../utils/platform';

beforeEach(() => {
  jest.clearAllMocks();
  useIDEStore.setState({
    workspace: null,
    workspaces: [],
    activeWorkspaceId: 'project',
    openFiles: [],
    activeFileId: null,
    recentWorkspaces: [],
  });
  useGitStore.setState({
    diffSession: null,
    diffFocused: false,
    mergeSession: null,
    mergeFocused: false,
    mergeAdvancePending: false,
  });
  __resetGolemStore();
});

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

const diffSession = {
  path: 'src/a.ts',
  absPath: '/repo/src/a.ts',
  context: 'unstaged',
  left: { label: 'Index', content: 'old' },
  right: { label: 'Working Tree', content: 'new' },
  binary: false,
  truncated: false,
  hunks: [],
} as unknown as DiffSession;

const mergeSession = {
  kind: 'sides',
  path: 'clash.go',
  absPath: '/repo/clash.go',
  repoRoot: '/repo',
  labels: {
    operation: 'merge',
    ours: { label: 'current', hash: 'abc', subject: '' },
    theirs: { label: 'incoming', hash: 'def', subject: '' },
  },
  fileQueue: ['clash.go'],
  requestRevision: 1,
  epoch: 1,
  fileWriteRevision: 1,
  stages: { path: 'clash.go', binary: true },
} as unknown as MergeSession;

const configTab = () => screen.getByRole('tab', { name: 'Golem Configuration' });

describe('Editor Welcome Screen', () => {
  it('should show keyboard shortcuts when no files are open', () => {
    render(<Editor />);
    expect(screen.getByText('Open File')).toBeInTheDocument();
    expect(screen.getByText('Command Palette')).toBeInTheDocument();
    expect(screen.getByText('Quick Search')).toBeInTheDocument();
  });

  it('should show recent projects section when recent workspaces exist', () => {
    useIDEStore.setState({
      recentWorkspaces: [
        { name: 'project-a', path: '/Users/test/project-a', lastOpened: '2026-01-01T00:00:00Z' },
        { name: 'project-b', path: '/Users/test/project-b', lastOpened: '2025-12-31T00:00:00Z' },
      ],
    });

    render(<Editor />);
    expect(screen.getByText('Recent Projects')).toBeInTheDocument();
    expect(screen.getByText('project-a')).toBeInTheDocument();
    expect(screen.getByText('project-b')).toBeInTheDocument();
  });

  it('should not show recent projects section when list is empty', () => {
    render(<Editor />);
    expect(screen.queryByText('Recent Projects')).not.toBeInTheDocument();
  });

  it('should filter out the current workspace from recent projects', () => {
    useIDEStore.setState({
      workspace: { name: 'current', path: '/Users/test/current' },
      recentWorkspaces: [
        { name: 'current', path: '/Users/test/current', lastOpened: '2026-01-02T00:00:00Z' },
        { name: 'other', path: '/Users/test/other', lastOpened: '2026-01-01T00:00:00Z' },
      ],
    });

    render(<Editor />);
    expect(screen.getByText('other')).toBeInTheDocument();
    // "current" should only appear once (in the store, not in the list)
    const currentElements = screen.queryAllByText('current');
    expect(currentElements).toHaveLength(0);
  });

  it('should open a workspace when a recent project is clicked', () => {
    useIDEStore.setState({
      recentWorkspaces: [
        { name: 'my-project', path: '/Users/test/my-project', lastOpened: '2026-01-01T00:00:00Z' },
      ],
    });

    render(<Editor />);

    fireEvent.click(screen.getByText('my-project'));

    const state = useIDEStore.getState();
    expect(state.workspace).toEqual({
      name: 'my-project',
      path: '/Users/test/my-project',
    });
    expect(mockWindowSetTitle).toHaveBeenCalledWith('my-project \u2014 Firn');
  });

  it('should shorten displayed paths with ~ for home directories', () => {
    useIDEStore.setState({
      recentWorkspaces: [
        {
          name: 'my-project',
          path: '/Users/testuser/projects/my-project',
          lastOpened: '2026-01-01T00:00:00Z',
        },
      ],
    });

    render(<Editor />);
    expect(screen.getByText('~/projects/my-project')).toBeInTheDocument();
  });

  it('suppresses the browser native find dialog when no files are open', () => {
    const isMacSpy = jest.spyOn(platform, 'isMac').mockReturnValue(true);
    try {
      render(<Editor />);

      const event = new KeyboardEvent('keydown', {
        key: 'f',
        metaKey: true,
        bubbles: true,
        cancelable: true,
      });

      window.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
    } finally {
      isMacSpy.mockRestore();
    }
  });

  it('leaves Cmd+Shift+F untouched so it can be claimed by project search', () => {
    render(<Editor />);

    const event = new KeyboardEvent('keydown', {
      key: 'F',
      ctrlKey: true,
      metaKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });

    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });

  it('does not suppress unmodified F keystrokes when no files are open', () => {
    render(<Editor />);

    const event = new KeyboardEvent('keydown', {
      key: 'f',
      bubbles: true,
      cancelable: true,
    });

    window.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(false);
  });

  it('keeps suppressing native find when files are open but the editor is unfocused', () => {
    useIDEStore.setState({
      openFiles: [
        {
          id: 'file-1',
          name: 'a.ts',
          path: '/ws/a.ts',
          language: 'typescript',
          encoding: 'utf-8',
          lineEndings: 'lf',
          content: '',
          isModified: false,
        },
      ],
      activeFileId: 'file-1',
    });

    const isMacSpy = jest.spyOn(platform, 'isMac').mockReturnValue(false);
    try {
      render(<Editor />);

      const event = new KeyboardEvent('keydown', {
        key: 'f',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });

      window.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
    } finally {
      isMacSpy.mockRestore();
    }
  });

  it('suppresses plain Cmd+F on macOS', () => {
    const isMacSpy = jest.spyOn(platform, 'isMac').mockReturnValue(true);
    try {
      render(<Editor />);

      const event = new KeyboardEvent('keydown', {
        key: 'f',
        metaKey: true,
        bubbles: true,
        cancelable: true,
      });

      window.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
    } finally {
      isMacSpy.mockRestore();
    }
  });

  it('shows the welcome screen only while no editor surface — configuration included — is open', () => {
    render(<Editor />);
    expect(screen.getByText('Open File')).toBeInTheDocument();

    act(() => {
      useGolemStore.getState().openConfigTab();
    });

    expect(screen.queryByText('Open File')).not.toBeInTheDocument();
    expect(screen.getByTestId('golem-config-mock')).toBeVisible();
  });

  it('does not swallow Ctrl+Cmd+F, the macOS toggle-fullscreen shortcut', () => {
    const isMacSpy = jest.spyOn(platform, 'isMac').mockReturnValue(true);
    try {
      render(<Editor />);

      const event = new KeyboardEvent('keydown', {
        key: 'f',
        ctrlKey: true,
        metaKey: true,
        bubbles: true,
        cancelable: true,
      });

      window.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(false);
    } finally {
      isMacSpy.mockRestore();
    }
  });
});

describe('Golem configuration tab (#263 Slice B)', () => {
  it('is one app-global tab: reopening focuses the existing instance', () => {
    useIDEStore.setState({ openFiles: [openFile('f1', 'a.ts')], activeFileId: 'f1' });
    render(<Editor />);

    act(() => {
      useGolemStore.getState().openConfigTab();
    });
    act(() => {
      // A file tab takes focus back, then the palette/dock re-opens.
      fireEvent.click(screen.getByRole('tab', { name: /a\.ts/i }));
    });
    act(() => {
      useGolemStore.getState().openConfigTab();
    });

    expect(screen.getAllByRole('tab', { name: 'Golem Configuration' })).toHaveLength(1);
    expect(screen.getAllByTestId('golem-config-mock')).toHaveLength(1);
    expect(configTab()).toHaveAttribute('aria-selected', 'true');
  });

  it('carries the specified tab id, label, and tablist name', () => {
    render(<Editor />);
    act(() => {
      useGolemStore.getState().openConfigTab();
    });

    expect(configTab()).toHaveAttribute('id', 'tab-golem-config');
    expect(screen.getByRole('tablist', { name: 'Open editors' })).toBeInTheDocument();
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'tab-golem-config');
  });

  it('joins the roving tab order and activates from the keyboard', () => {
    useIDEStore.setState({ openFiles: [openFile('f1', 'a.ts')], activeFileId: 'f1' });
    render(<Editor />);
    act(() => {
      useGolemStore.getState().openConfigTab();
    });

    const fileTab = screen.getByRole('tab', { name: /a\.ts/i });
    expect([fileTab.tabIndex, configTab().tabIndex]).toEqual([-1, 0]);

    configTab().focus();
    fireEvent.keyDown(configTab(), { key: 'ArrowLeft' });
    expect(fileTab).toHaveFocus();

    fireEvent.keyDown(fileTab, { key: 'End' });
    expect(configTab()).toHaveFocus();

    // Focus alone must not switch surfaces; Enter is what selects.
    fireEvent.click(fileTab);
    expect(screen.getByTestId('golem-config-mock')).not.toBeVisible();
    configTab().focus();
    fireEvent.keyDown(configTab(), { key: 'Enter' });
    expect(screen.getByTestId('golem-config-mock')).toBeVisible();
  });

  it('switches between the configuration tab and file, diff, and merge surfaces', () => {
    useIDEStore.setState({ openFiles: [openFile('f1', 'a.ts')], activeFileId: 'f1' });
    render(<Editor />);
    act(() => {
      useGolemStore.getState().openConfigTab();
    });
    expect(screen.getByTestId('codemirror-mock')).not.toBeVisible();

    fireEvent.click(screen.getByRole('tab', { name: /a\.ts/i }));
    expect(screen.getByTestId('codemirror-mock')).toBeVisible();
    expect(screen.getByTestId('golem-config-mock')).not.toBeVisible();

    // A diff opened from the Git panel while the configuration tab is selected
    // has to become visible, not open behind it.
    fireEvent.click(configTab());
    act(() => {
      useGitStore.setState({ diffSession, diffFocused: true });
    });
    expect(screen.getByTestId('diff-mock')).toBeVisible();
    expect(screen.getByTestId('golem-config-mock')).not.toBeVisible();

    fireEvent.click(configTab());
    expect(screen.getByTestId('golem-config-mock')).toBeVisible();
    expect(screen.getByTestId('diff-mock')).not.toBeVisible();

    act(() => {
      useGitStore.setState({ mergeSession, mergeFocused: true, diffFocused: false });
    });
    expect(screen.getByTestId('merge-mock')).toBeVisible();
    expect(screen.getByTestId('golem-config-mock')).not.toBeVisible();

    fireEvent.click(configTab());
    expect(screen.getByTestId('golem-config-mock')).toBeVisible();
  });

  it('closes cleanly from the tab and from the surface, restoring focus', async () => {
    useIDEStore.setState({ openFiles: [openFile('f1', 'a.ts')], activeFileId: 'f1' });
    render(<Editor />);
    act(() => {
      useGolemStore.getState().openConfigTab();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Close Golem Configuration' }));

    expect(screen.queryByRole('tab', { name: 'Golem Configuration' })).not.toBeInTheDocument();
    expect(screen.queryByTestId('golem-config-mock')).not.toBeInTheDocument();
    expect(useGolemStore.getState().configTabOpen).toBe(false);
    await waitFor(() => expect(screen.getByRole('tab', { name: /a\.ts/i })).toHaveFocus());

    // The surface's own Close is the same clean teardown.
    act(() => {
      useGolemStore.getState().openConfigTab();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Close configuration' }));
    expect(screen.queryByTestId('golem-config-mock')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole('tab', { name: /a\.ts/i })).toHaveFocus());
  });

  it('stays open and selected across a workspace switch', () => {
    useIDEStore.setState({ openFiles: [openFile('f1', 'a.ts')], activeFileId: 'f1' });
    render(<Editor />);
    act(() => {
      useGolemStore.getState().openConfigTab();
    });

    act(() => {
      // Opening another project retires that workspace's editors; the app-global
      // configuration surface is not one of them.
      useIDEStore.setState({
        workspace: { name: 'other', path: '/other' },
        openFiles: [],
        activeFileId: null,
      });
    });

    expect(configTab()).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('golem-config-mock')).toBeVisible();
  });
});
