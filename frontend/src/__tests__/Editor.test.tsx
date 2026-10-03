import fs from 'fs';
import path from 'path';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { cssRule } from './helpers/cssRule';
import { useIDEStore } from '../stores/ideStore';
import { useGitStore, type DiffSession, type MergeSession } from '../stores/gitStore';
import { __resetGolemStore, useGolemStore } from '../stores/golemStore';
import { showGolemConfiguration } from '../utils/commands';
import { focusConfigTab, focusEditorSurface } from '../utils/editorSurface';
import { registerConfigCloseHandler } from '../components/GolemConfig/configCloseGuard';

jest.mock('../wails/bindings', () => ({
  OpenFolderDialog: jest.fn(),
  ListRecentWorkspaces: jest.fn(() => Promise.resolve([])),
  CancelGolemRun: jest.fn(),
  RunGolemTurn: jest.fn(),
}));

const mockWindowSetTitle = jest.fn();
jest.mock('../wails/runtime', () => ({
  // Indirected, not referenced: `utils/commands` now reaches the runtime
  // adapter through the #271 window relay, so this factory runs during the
  // imports above — while `mockWindowSetTitle` is still in its temporal dead
  // zone. Every other suite in this repo already spells its mocks this way.
  WindowSetTitle: (...args: unknown[]) => mockWindowSetTitle(...args),
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

const otherDiffSession = { ...diffSession, path: 'src/b.ts', absPath: '/repo/src/b.ts' };

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

const otherMergeSession = {
  ...mergeSession,
  path: 'other.go',
  absPath: '/repo/other.go',
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
      focusConfigTab();
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
      focusConfigTab();
    });
    act(() => {
      // A file tab takes focus back, then the palette/dock re-opens.
      fireEvent.click(screen.getByRole('tab', { name: /a\.ts/i }));
    });
    act(() => {
      focusConfigTab();
    });

    expect(screen.getAllByRole('tab', { name: 'Golem Configuration' })).toHaveLength(1);
    expect(screen.getAllByTestId('golem-config-mock')).toHaveLength(1);
    expect(configTab()).toHaveAttribute('aria-selected', 'true');
  });

  it('carries the specified tab id, label, and tablist name', () => {
    render(<Editor />);
    act(() => {
      focusConfigTab();
    });

    expect(configTab()).toHaveAttribute('id', 'tab-golem-config');
    expect(screen.getByRole('tablist', { name: 'Open editors' })).toBeInTheDocument();
    expect(screen.getByRole('tabpanel')).toHaveAttribute('aria-labelledby', 'tab-golem-config');
  });

  it('joins the roving tab order and activates from the keyboard', () => {
    useIDEStore.setState({ openFiles: [openFile('f1', 'a.ts')], activeFileId: 'f1' });
    render(<Editor />);
    act(() => {
      focusConfigTab();
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
      focusConfigTab();
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

  // §6.3: the dialog the guard raises lives inside the configuration pane, and
  // a pane inside a railed Files column cannot show one.
  it('reveals a railed Files column when the dirty configuration tab is asked to close', async () => {
    useIDEStore.setState({ openFiles: [openFile('f1', 'a.ts')], activeFileId: 'f1' });
    render(<Editor />);
    act(() => {
      focusConfigTab();
    });

    const confirm = jest.fn().mockResolvedValue(false);
    registerConfigCloseHandler({ hasUnsavedWork: () => true, confirm });
    try {
      act(() => useIDEStore.getState().setFilesPanelCollapsed(true));

      fireEvent.click(screen.getByRole('button', { name: 'Close Golem Configuration' }));

      expect(useIDEStore.getState().isFilesPanelCollapsed).toBe(false);
      await waitFor(() => expect(confirm).toHaveBeenCalledWith('close'));
      // Refused: the tab stays, still selected on the revealed column.
      expect(configTab()).toHaveAttribute('aria-selected', 'true');
    } finally {
      registerConfigCloseHandler(null);
    }
  });

  it('closes cleanly from the tab and from the surface, restoring focus', async () => {
    useIDEStore.setState({ openFiles: [openFile('f1', 'a.ts')], activeFileId: 'f1' });
    render(<Editor />);
    act(() => {
      focusConfigTab();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Close Golem Configuration' }));

    // Closing now asks the surface first (§4.6a). Nothing is mounted to answer
    // here, so the guard resolves clean — one microtask later, not synchronously.
    await waitFor(() =>
      expect(screen.queryByRole('tab', { name: 'Golem Configuration' })).not.toBeInTheDocument()
    );
    expect(screen.queryByTestId('golem-config-mock')).not.toBeInTheDocument();
    expect(useGolemStore.getState().configTabOpen).toBe(false);
    await waitFor(() => expect(screen.getByRole('tab', { name: /a\.ts/i })).toHaveFocus());

    // The surface's own Close is the same clean teardown.
    act(() => {
      focusConfigTab();
    });
    fireEvent.click(screen.getByRole('button', { name: 'Close configuration' }));
    await waitFor(() => expect(screen.queryByTestId('golem-config-mock')).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole('tab', { name: /a\.ts/i })).toHaveFocus());
  });

  // gitStore.openDiff only ever RAISES diffFocused (`focus ? true : state.…`),
  // so a second diff opened while the flag is already true is no rising edge at
  // all. Without the configuration tab also parking the git-side focus, the
  // session swaps behind this surface and the Git-panel click is dead.
  it('reveals a diff opened from the Git panel while a diff was already focused', () => {
    useIDEStore.setState({ openFiles: [openFile('f1', 'a.ts')], activeFileId: 'f1' });
    render(<Editor />);

    act(() => {
      useGitStore.setState({ diffSession, diffFocused: true });
    });
    expect(screen.getByTestId('diff-mock')).toBeVisible();

    act(() => {
      showGolemConfiguration(); // the palette command, not the raw store action
    });
    expect(screen.getByTestId('golem-config-mock')).toBeVisible();

    act(() => {
      // Another file's diff row: openDiff swaps the session and re-raises the
      // already-true focus flag.
      useGitStore.setState({ diffSession: otherDiffSession, diffFocused: true });
    });

    expect(screen.getByTestId('diff-mock')).toBeVisible();
    expect(screen.getByTestId('golem-config-mock')).not.toBeVisible();
    expect(configTab()).toHaveAttribute('aria-selected', 'false');
  });

  it('reveals a merge re-opened while a merge was already focused', () => {
    useIDEStore.setState({ openFiles: [openFile('f1', 'a.ts')], activeFileId: 'f1' });
    render(<Editor />);

    act(() => {
      useGitStore.setState({ mergeSession, mergeFocused: true });
    });
    expect(screen.getByTestId('merge-mock')).toBeVisible();

    act(() => {
      focusConfigTab();
    });
    expect(screen.getByTestId('golem-config-mock')).toBeVisible();

    act(() => {
      // The conflict queue advancing: openMergeResolution replaces the session
      // and re-asserts mergeFocused: true.
      useGitStore.setState({ mergeSession: otherMergeSession, mergeFocused: true });
    });

    expect(screen.getByTestId('merge-mock')).toBeVisible();
    expect(screen.getByTestId('golem-config-mock')).not.toBeVisible();
    expect(configTab()).toHaveAttribute('aria-selected', 'false');
  });

  it('stays open and mounted across a workspace switch, selection following the restored file', () => {
    useIDEStore.setState({ openFiles: [openFile('f1', 'a.ts')], activeFileId: 'f1' });
    render(<Editor />);
    act(() => {
      focusConfigTab();
    });

    act(() => {
      // Opening another project retires that workspace's editors...
      useIDEStore.setState({
        workspace: { name: 'other', path: '/other' },
        openFiles: [],
        activeFileId: null,
      });
    });
    // ...and the app-global surface survives, showing while nothing else can.
    expect(screen.getByTestId('golem-config-mock')).toBeVisible();

    act(() => {
      // Then the new workspace restores its own layout, which activates a file
      // and so runs the real focusEditorSurface('file') path.
      useIDEStore.setState({ openFiles: [openFile('f2', 'b.ts')] });
      useIDEStore.getState().setActiveFile('f2');
    });

    // The contract is open + mounted (spec §3.1/§4.6a); selection legitimately
    // follows the restored file.
    expect(useGolemStore.getState().configTabOpen).toBe(true);
    expect(configTab()).toBeInTheDocument();
    expect(screen.getByTestId('golem-config-mock')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /b\.ts/i })).toHaveAttribute('aria-selected', 'true');
    expect(configTab()).toHaveAttribute('aria-selected', 'false');
  });
});

// #406: the strip scrolls with its scrollbar hidden (#118), so overflow needs a
// visible, mouse-operable control, and every activation must bring its tab into
// view. jsdom has no layout, so each test states the geometry it needs.
describe('Editor tab strip overflow (#406)', () => {
  const CONTROL = 28;
  const strip = () => screen.getByRole('tablist', { name: 'Open editors' });
  const leftControl = () => screen.queryByRole('button', { name: 'Scroll tabs left' });
  const rightControl = () => screen.queryByRole('button', { name: 'Scroll tabs right' });
  const tabBox = (name: RegExp | string) => screen.getByRole('tab', { name }).parentElement!;
  const closeButton = (name: string) => screen.getByRole('button', { name: `Close ${name}` });

  function setStripMetrics(scrollWidth: number, clientWidth: number, scrollLeft = 0) {
    const el = strip();
    Object.defineProperty(el, 'scrollWidth', { configurable: true, value: scrollWidth });
    Object.defineProperty(el, 'clientWidth', { configurable: true, value: clientWidth });
    el.scrollLeft = scrollLeft;
  }

  function scrollStripTo(scrollLeft: number) {
    strip().scrollLeft = scrollLeft;
    fireEvent.scroll(strip());
  }

  type ObserverMock = { observe: jest.Mock };
  const observerMock = () => global.ResizeObserver as unknown as jest.Mock;
  /** Elements the editor's resize observers watch. */
  const observedElements = () =>
    observerMock().mock.results.flatMap((result) =>
      (result.value as ObserverMock).observe.mock.calls.map(([target]) => target as Element)
    );
  /** Deliver a resize to every observer, as the browser would after a layout change. */
  function fireResize() {
    act(() => {
      for (const [callback] of observerMock().mock.calls) callback([], {});
    });
  }

  // Horizontal geometry by element; anything not placed has an empty box.
  const boxes = new Map<Element, [number, number]>();
  function place(el: Element, left: number, right: number) {
    boxes.set(el, [left, right]);
  }
  /** The strip spans 0–300 with 28px controls, leaving 28–272 clear of them. */
  function layOutStrip() {
    strip().style.setProperty('--tab-scroll-control-width', `${CONTROL}px`);
    place(strip(), 0, 300);
  }

  let scrollTo: jest.Mock;
  let scrollBy: jest.Mock;
  beforeEach(() => {
    boxes.clear();
    jest.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (
      this: Element
    ) {
      const [left, right] = boxes.get(this) ?? [0, 0];
      return { left, right, width: right - left } as DOMRect;
    });
    // setupTests stubs element scrolling, which jsdom does not implement.
    scrollTo = jest.spyOn(Element.prototype, 'scrollTo') as unknown as jest.Mock;
    scrollBy = jest.spyOn(Element.prototype, 'scrollBy') as unknown as jest.Mock;
  });
  afterEach(() => {
    jest.restoreAllMocks();
  });
  /** Where the strip was last asked to scroll, if it was. */
  const stripScrolledTo = () =>
    scrollTo.mock.contexts.includes(strip()) ? scrollTo.mock.calls.at(-1)?.[0].left : undefined;

  function renderWithFiles(count: number) {
    const files = Array.from({ length: count }, (_, i) => openFile(`f${i}`, `file${i}.ts`));
    useIDEStore.setState({ openFiles: files, activeFileId: 'f0' });
    return render(<Editor />);
  }

  it('shows no scroll control while every tab fits', () => {
    renderWithFiles(3);
    setStripMetrics(300, 300);
    fireResize();

    expect(leftControl()).toBeNull();
    expect(rightControl()).toBeNull();
  });

  it('shows a control on each side that hides tabs, and drops it once that side is fully scrolled', () => {
    renderWithFiles(8);
    setStripMetrics(900, 300);
    fireResize();
    expect(leftControl()).toBeNull();
    expect(rightControl()).toBeInTheDocument();

    scrollStripTo(300);
    expect(leftControl()).toBeInTheDocument();
    expect(rightControl()).toBeInTheDocument();

    scrollStripTo(600);
    expect(leftControl()).toBeInTheDocument();
    expect(rightControl()).toBeNull();
  });

  it('re-measures when the panel narrows and when tabs are added or removed', () => {
    renderWithFiles(2);
    setStripMetrics(200, 300);
    fireResize();
    expect(rightControl()).toBeNull();

    // A narrower panel resizes the strip itself.
    setStripMetrics(200, 150);
    fireResize();
    expect(rightControl()).toBeInTheDocument();

    // A tab added or removed resizes the row that holds the tabs, not the
    // strip, so that row has to be observed too.
    const firstTab = screen.getAllByRole('tab')[0];
    expect(observedElements()).toContain(strip());
    expect(observedElements().some((el) => el !== strip() && el.contains(firstTab))).toBe(true);

    act(() => {
      useIDEStore.getState().closeFile('f1');
    });
    setStripMetrics(100, 150);
    fireResize();
    expect(rightControl()).toBeNull();
  });

  it('scrolls the strip a page per click, without taking focus or joining the tablist', () => {
    renderWithFiles(8);
    setStripMetrics(900, 300);
    fireResize();

    const right = rightControl()!;
    Object.defineProperty(right, 'offsetWidth', { configurable: true, value: CONTROL });
    // A mouse press would otherwise move focus out of the editor and onto a
    // control that may vanish under it.
    expect(fireEvent.mouseDown(right)).toBe(false);
    fireEvent.click(right);
    // A page is the strip less both controls.
    expect(scrollBy).toHaveBeenLastCalledWith({ left: 300 - 2 * CONTROL });

    scrollStripTo(300);
    const left = leftControl()!;
    Object.defineProperty(left, 'offsetWidth', { configurable: true, value: CONTROL });
    fireEvent.click(left);
    expect(scrollBy).toHaveBeenLastCalledWith({ left: -(300 - 2 * CONTROL) });

    // Keyboard reach stays the tablist's arrow keys: the controls are neither
    // tabs nor tab stops.
    expect(strip()).not.toContainElement(right);
    expect(right).toHaveAttribute('tabindex', '-1');
    expect(left).toHaveAttribute('tabindex', '-1');
  });

  it('hides a close button cut off by the strip edge or covered by a control', () => {
    renderWithFiles(3);
    layOutStrip();
    setStripMetrics(600, 300);
    place(closeButton('file0.ts'), 110, 126);
    place(closeButton('file1.ts'), 260, 276); // under the right control
    place(closeButton('file2.ts'), 400, 416); // past the edge

    fireEvent.scroll(strip());
    expect(closeButton('file0.ts')).not.toHaveAttribute('data-clipped');
    expect(closeButton('file1.ts')).toHaveAttribute('data-clipped');
    expect(closeButton('file2.ts')).toHaveAttribute('data-clipped');

    // Scrolled on: the first tab's start is now hidden under the left control,
    // but its close button is clear of it, so it stays.
    place(closeButton('file0.ts'), 60, 76);
    place(closeButton('file1.ts'), 210, 226);
    place(closeButton('file2.ts'), 350, 366);
    scrollStripTo(50);
    expect(closeButton('file0.ts')).not.toHaveAttribute('data-clipped');
    expect(closeButton('file1.ts')).not.toHaveAttribute('data-clipped');
    expect(closeButton('file2.ts')).toHaveAttribute('data-clipped');
  });

  it('styles a clipped close button out of sight while keeping it a tab stop', () => {
    const css = fs.readFileSync(
      path.resolve(__dirname, '../components/Editor/Editor.module.css'),
      'utf8'
    );
    const clipped = cssRule(css, '.tab .tabClose[data-clipped]');
    expect(clipped).toMatch(/opacity:\s*0;/);
    expect(clipped).toMatch(/pointer-events:\s*none;/);
    // No fade: a fading half-`×` is the glyph this hides.
    expect(clipped).toMatch(/transition:\s*none;/);
    // visibility or display would drop it from the Tab order.
    expect(clipped).not.toMatch(/visibility|display/);
    // Equal specificity with the hover and active rules, so it must come later.
    expect(css.indexOf('.tab .tabClose[data-clipped]')).toBeGreaterThan(
      css.indexOf('.tab.active .tabClose')
    );
  });

  describe('active-tab reveal', () => {
    /** Tab i spans 8+150i to 158+150i, so file2's tab ends 186px past the clear area. */
    function layOutTabs() {
      layOutStrip();
      screen
        .getAllByRole('tab')
        .forEach((tab, i) => place(tab.parentElement!, 8 + 150 * i, 158 + 150 * i));
    }

    it('reveals a file tab activated from outside the strip, close button included', () => {
      renderWithFiles(3);
      layOutTabs();

      // The explorer, search results and the command palette all open through
      // ensureEditorFileOpen, which is exactly this pair of calls.
      act(() => {
        useIDEStore.getState().setActiveFile('f2');
        focusEditorSurface('file');
      });

      // The tab's whole box (it holds the close button) ends at 458; the clear
      // area ends at 300 - 28.
      expect(tabBox('file2.ts')).toContainElement(closeButton('file2.ts'));
      expect(stripScrolledTo()).toBe(458 - (300 - CONTROL));
    });

    it('reveals the already-active tab again when it is re-activated', () => {
      useIDEStore.setState({
        openFiles: [0, 1, 2].map((i) => openFile(`f${i}`, `file${i}.ts`)),
        activeFileId: 'f2',
      });
      render(<Editor />);
      layOutTabs();
      scrollTo.mockClear();

      act(() => {
        useIDEStore.getState().setActiveFile('f2');
        focusEditorSurface('file');
      });

      expect(stripScrolledTo()).toBe(458 - (300 - CONTROL));
    });

    it('reveals a clicked tab, and a diff tab opened from the Git panel', () => {
      renderWithFiles(2);
      layOutTabs();

      fireEvent.click(screen.getByRole('tab', { name: /file1\.ts/ }));
      expect(stripScrolledTo()).toBe(308 - (300 - CONTROL));

      act(() => {
        useGitStore.setState({ diffSession });
      });
      place(tabBox(/\(diff\)/), 308, 520);
      act(() => {
        useGitStore.setState({ diffFocused: true });
      });
      expect(stripScrolledTo()).toBe(520 - (300 - CONTROL));
    });

    it('reveals the Golem Configuration tab on activation and again on a click (#309)', () => {
      renderWithFiles(2);
      layOutTabs();
      act(() => {
        useGolemStore.getState().openConfigTab();
      });
      place(tabBox('Golem Configuration'), 308, 480);

      act(() => {
        focusConfigTab();
      });
      expect(configTab()).toHaveAttribute('aria-selected', 'true');
      expect(stripScrolledTo()).toBe(480 - (300 - CONTROL));

      scrollTo.mockClear();
      fireEvent.click(configTab());
      expect(stripScrolledTo()).toBe(480 - (300 - CONTROL));
    });

    it('reveals the tab that becomes active when the active one closes', () => {
      renderWithFiles(3);
      layOutTabs();
      act(() => {
        useIDEStore.getState().setActiveFile('f1');
      });
      scrollTo.mockClear();

      act(() => {
        useIDEStore.getState().closeFile('f1');
      });

      expect(stripScrolledTo()).toBe(458 - (300 - CONTROL));
    });

    it('reveals a tab that keyboard focus moves to, and a close button tabbed to', () => {
      renderWithFiles(3);
      layOutTabs();
      scrollTo.mockClear();

      fireEvent.keyDown(screen.getByRole('tab', { name: /file0\.ts/ }), { key: 'End' });
      expect(screen.getByRole('tab', { name: /file2\.ts/ })).toHaveFocus();
      expect(stripScrolledTo()).toBe(458 - (300 - CONTROL));

      // A clipped close button stays a tab stop: focusing it reveals its tab.
      scrollTo.mockClear();
      place(tabBox('file1.ts'), -150, 0);
      act(() => {
        closeButton('file1.ts').focus();
      });
      expect(stripScrolledTo()).toBe(-150 - CONTROL);
    });

    it('leaves the strip still while a mouse press focuses a close button', () => {
      renderWithFiles(3);
      layOutTabs();
      // file1's start is hidden but its close button is in view.
      place(tabBox('file1.ts'), -100, 50);
      const close = closeButton('file1.ts');
      // A pointer focus is not :focus-visible (jsdom alone cannot tell).
      jest.spyOn(close, 'matches').mockImplementation((selector) => selector !== ':focus-visible');
      scrollTo.mockClear();

      // Scrolling here would move the button out from under the pointer before
      // mouseup, and the click would miss it.
      fireEvent.mouseDown(close);
      act(() => {
        close.focus();
      });
      expect(scrollTo).not.toHaveBeenCalled();

      fireEvent.click(close);
      expect(useIDEStore.getState().openFiles.map((f) => f.id)).toEqual(['f0', 'f2']);
    });

    it('shows the start of a tab wider than the room between the controls', () => {
      renderWithFiles(2);
      layOutTabs();
      place(tabBox('file1.ts'), 100, 500);

      fireEvent.click(screen.getByRole('tab', { name: /file1\.ts/ }));

      expect(stripScrolledTo()).toBe(100 - CONTROL);
    });

    it('reveals the selected tab when the strip first mounts', () => {
      render(<Editor />);
      // Geometry the strip has from its first layout, before any activation.
      (Element.prototype.getBoundingClientRect as jest.Mock).mockImplementation(function (
        this: Element
      ) {
        if (this.getAttribute('role') === 'tablist') return { left: 0, right: 300 } as DOMRect;
        if (this.firstElementChild?.id === 'tab-file-f2')
          return { left: 308, right: 458 } as DOMRect;
        return { left: 0, right: 0 } as DOMRect;
      });

      // Leaving the welcome screen mounts the strip with an offscreen tab selected.
      act(() => {
        useIDEStore.setState({
          openFiles: [0, 1, 2].map((i) => openFile(`f${i}`, `file${i}.ts`)),
          activeFileId: 'f2',
        });
      });

      expect(stripScrolledTo()).toBe(458 - 300);
    });

    it('stops an earlier smooth scroll when the tab activated next is already in view', () => {
      renderWithFiles(3);
      layOutTabs();
      act(() => {
        useIDEStore.getState().setActiveFile('f2');
        focusEditorSurface('file');
      });
      expect(stripScrolledTo()).toBe(458 - (300 - CONTROL));

      // Mid-animation, file1 sits inside the clear area: no movement is needed,
      // but a new scroll request is what cancels the one in flight.
      place(tabBox('file1.ts'), 100, 250);
      scrollTo.mockClear();
      act(() => {
        useIDEStore.getState().setActiveFile('f1');
        focusEditorSurface('file');
      });
      expect(stripScrolledTo()).toBe(0);
    });

    it('holds still while a merge queue hands off to its next file', () => {
      useIDEStore.setState({ openFiles: [openFile('f0', 'file0.ts')], activeFileId: 'f0' });
      useGitStore.setState({ mergeSession, mergeFocused: true });
      render(<Editor />);
      layOutTabs();
      place(tabBox('file0.ts'), -200, -50);
      scrollTo.mockClear();

      // Between files the session is briefly null, which selects the file tab.
      act(() => {
        useGitStore.setState({ mergeSession: null, mergeAdvancePending: true });
      });
      expect(scrollTo).not.toHaveBeenCalled();

      act(() => {
        useGitStore.setState({ mergeSession, mergeAdvancePending: false });
      });
      place(tabBox(/\(merge\)/), 200, 420);
      act(() => {
        useIDEStore.getState().requestEditorTabReveal();
      });
      expect(stripScrolledTo()).toBe(420 - (300 - CONTROL));
    });
  });
});
