import { render, screen, fireEvent } from '@testing-library/react';
import { useIDEStore } from '../stores/ideStore';

jest.mock('../../wailsjs/go/main/App', () => ({
  OpenFolderDialog: jest.fn(),
  ListRecentWorkspaces: jest.fn(() => Promise.resolve([])),
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

import { Editor } from '../components/Editor';
import * as platform from '../utils/platform';

beforeEach(() => {
  jest.clearAllMocks();
  useIDEStore.setState({
    workspace: null,
    openFiles: [],
    activeFileId: null,
    recentWorkspaces: [],
  });
});

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
