import { act, fireEvent, render, screen } from '@testing-library/react';
import type { MergeResolutionState } from '../../../components/Editor/codemirror';
import type { MergeResolutionEditor } from '../../../components/Editor/codemirror';
import type { MergeSession } from '../../../stores/gitStore';

const controller = {
  view: { requestMeasure: jest.fn() },
  getResult: jest.fn(() => 'resolved result'),
  getState: jest.fn(() => ({
    activeIndex: 0,
    decisions: {},
    order: 'current-first',
  })),
  undo: jest.fn(() => true),
  redo: jest.fn(() => true),
  next: jest.fn(() => true),
  activate: jest.fn(() => true),
  setFrozen: jest.fn(),
  setTheme: jest.fn(),
  destroy: jest.fn(),
} as unknown as MergeResolutionEditor;
let syntaxThemeId = 'glacier';
let onStateChange: ((state: MergeResolutionState) => void) | undefined;
const createMergeResolutionEditor = jest.fn(
  (
    _host: HTMLElement,
    _session: unknown,
    options: { onStateChange?: (state: MergeResolutionState) => void; syntaxThemeId?: string }
  ) => {
    onStateChange = options.onStateChange;
    return controller;
  }
);
const recordDecision = jest.fn();
const selectMergeSide = jest.fn();
const mergeFinalizeAndStage = jest.fn(() => Promise.resolve(true));

// CodeMirror is ESM-only under Jest. The view contract is tested here without
// mounting it; mergeResolution.test.ts covers the real editor behavior.
jest.mock('../../../components/Editor/codemirror', () => ({
  createMergeResolutionEditor: (
    host: HTMLElement,
    session: unknown,
    options: { onStateChange?: (state: MergeResolutionState) => void }
  ) => createMergeResolutionEditor(host, session, options),
}));
jest.mock('../../../stores/gitStore', () => ({
  useGitStore: {
    getState: () => ({ recordDecision, selectMergeSide, mergeFinalizeAndStage }),
  },
}));
jest.mock('../../../stores/ideStore', () => ({
  useEditorSyntaxTheme: () => syntaxThemeId,
}));

import { MergeResolutionView } from '../../../components/Editor/MergeResolutionView';

const textSession = {
  kind: 'text',
  path: 'src/conflict.ts',
  absPath: '/repo/src/conflict.ts',
  repoRoot: '/repo',
  labels: {
    operation: 'merge',
    ours: { label: 'current', hash: 'abc', subject: '' },
    theirs: { label: 'incoming', hash: 'def', subject: '' },
  },
  fileQueue: ['src/conflict.ts', 'src/next.ts'],
  requestRevision: 1,
  epoch: 1,
  fileWriteRevision: 1,
  content: '<<<<<<< current\nleft\n=======\nright\n>>>>>>> incoming\n',
  encoding: 'utf-8',
  lineEndings: 'lf',
  regions: [
    {
      index: 0,
      startLine: 1,
      endLine: 5,
      ours: ['left'],
      base: [],
      theirs: ['right'],
      hasBase: false,
      oursLabel: 'current',
      theirLabel: 'incoming',
    },
  ],
  decisions: {},
  readOnly: false,
} as unknown as MergeSession;

const sidesSession = {
  kind: 'sides',
  path: 'logo.png',
  absPath: '/repo/logo.png',
  repoRoot: '/repo',
  labels: {
    operation: 'merge',
    ours: { label: 'current', hash: 'abc', subject: '' },
    theirs: { label: 'incoming', hash: 'def', subject: '' },
  },
  fileQueue: ['logo.png'],
  requestRevision: 2,
  epoch: 1,
  fileWriteRevision: 1,
  stages: { path: 'logo.png', ours: { hash: 'abc', size: 1 }, binary: true },
} as unknown as MergeSession;

beforeEach(() => {
  jest.clearAllMocks();
  syntaxThemeId = 'glacier';
  onStateChange = undefined;
});

describe('MergeResolutionView', () => {
  it('mounts a text Result editor, reflects its decisions, and finalizes only its live document', async () => {
    render(<MergeResolutionView session={textSession} visible />);

    expect(screen.getByText('src/conflict.ts')).toBeInTheDocument();
    expect(screen.getByText('File 1 of 2')).toBeInTheDocument();
    expect(screen.getByText('1 unresolved')).toBeInTheDocument();
    const unresolvedRail = screen.getByRole('button', { name: 'Conflict 1: unresolved' });
    expect(unresolvedRail).toHaveTextContent('1');
    expect(unresolvedRail).toHaveClass('active');
    expect(unresolvedRail).toHaveAttribute('aria-current', 'true');
    expect(unresolvedRail).not.toHaveAttribute('aria-pressed');
    expect(screen.getByRole('button', { name: 'Write & stage' })).toBeDisabled();
    expect(createMergeResolutionEditor).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      textSession,
      expect.objectContaining({ onStateChange: expect.any(Function) })
    );

    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next unresolved' }));
    fireEvent.click(screen.getByRole('button', { name: 'Conflict 1: unresolved' }));
    expect(controller.undo).toHaveBeenCalled();
    expect(controller.next).toHaveBeenCalledWith(1);
    expect(controller.activate).toHaveBeenCalledWith(0);

    act(() =>
      onStateChange?.({ activeIndex: null, decisions: { 0: 'I' }, order: 'current-first' })
    );
    expect(recordDecision).toHaveBeenCalledWith(0, 'I');
    const enabledFinalize = screen.getByRole('button', { name: 'Write & stage' });
    expect(enabledFinalize).toBeEnabled();
    await act(async () => {
      fireEvent.click(enabledFinalize);
      await Promise.resolve();
    });
    expect(mergeFinalizeAndStage).toHaveBeenCalledWith('resolved result', {
      suppressQueueAdvance: true,
    });
  });

  it('applies the active syntax theme and updates it without remounting the editor', () => {
    const { rerender } = render(<MergeResolutionView session={textSession} visible />);

    expect(createMergeResolutionEditor).toHaveBeenCalledWith(
      expect.any(HTMLElement),
      textSession,
      expect.objectContaining({ syntaxThemeId: 'glacier' })
    );
    expect(createMergeResolutionEditor).toHaveBeenCalledTimes(1);

    jest.mocked(controller.setTheme).mockClear();
    syntaxThemeId = 'abyssal';
    rerender(<MergeResolutionView session={textSession} visible />);

    expect(controller.setTheme).toHaveBeenCalledWith('abyssal');
    expect(createMergeResolutionEditor).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['C', 'Current'],
    ['I', 'Incoming'],
    ['B', 'Both'],
    ['M', 'Manual'],
  ] as const)('renders resolved %s rail entries with an explicit %s name', (_decision, word) => {
    render(<MergeResolutionView session={textSession} visible />);
    act(() =>
      onStateChange?.({ activeIndex: 0, decisions: { 0: _decision }, order: 'current-first' })
    );

    const rail = screen.getByRole('button', { name: `Conflict 1: ${word}` });
    expect(rail).toHaveTextContent(_decision);
    expect(rail).toHaveAttribute('aria-current', 'true');
    expect(rail).not.toHaveAttribute('aria-pressed');
  });

  it('renders whole-file sides from stage presence and finalizes only a selected side', async () => {
    const { rerender } = render(<MergeResolutionView session={sidesSession} visible />);

    expect(
      screen.getByRole('button', { name: 'CURRENT — current keeps this file' })
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'INCOMING — incoming deletes this file' })
    ).toBeInTheDocument();
    const finalize = screen.getByRole('button', { name: 'Write & stage' });
    expect(finalize).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: 'CURRENT — current keeps this file' }));
    expect(selectMergeSide).toHaveBeenCalledWith('ours');
    rerender(
      <MergeResolutionView
        session={{ ...sidesSession, selectedSide: 'ours' } as MergeSession}
        visible
      />
    );
    const enabledFinalize = screen.getByRole('button', { name: 'Write & stage' });
    expect(enabledFinalize).toBeEnabled();
    await act(async () => {
      fireEvent.click(enabledFinalize);
      await Promise.resolve();
    });
    expect(mergeFinalizeAndStage).toHaveBeenCalledWith(undefined, { suppressQueueAdvance: true });
  });

  it('freezes the text controller and blocks mutating controls while finalizing, then releases after failure', async () => {
    let finish: ((result: boolean) => void) | undefined;
    mergeFinalizeAndStage.mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        finish = resolve;
      })
    );
    render(
      <MergeResolutionView
        session={{ ...textSession, decisions: { 0: 'C' } } as MergeSession}
        visible
      />
    );
    act(() =>
      onStateChange?.({ activeIndex: null, decisions: { 0: 'C' }, order: 'current-first' })
    );

    const finalize = screen.getByRole('button', { name: 'Write & stage' });
    fireEvent.click(finalize);
    expect(finalize).toBeDisabled();
    expect(mergeFinalizeAndStage).toHaveBeenCalledTimes(1);
    expect(controller.setFrozen).toHaveBeenCalledWith(true);
    const undo = screen.getByRole('button', { name: 'Undo' });
    const next = screen.getByRole('button', { name: 'Next unresolved' });
    const rail = screen.getByRole('button', { name: 'Conflict 1: Current' });
    expect(undo).toBeDisabled();
    expect(next).toBeDisabled();
    expect(rail).toBeDisabled();
    fireEvent.click(undo);
    fireEvent.click(next);
    fireEvent.click(rail);
    expect(controller.undo).not.toHaveBeenCalled();
    expect(controller.next).not.toHaveBeenCalled();
    expect(controller.activate).not.toHaveBeenCalled();

    await act(async () => {
      finish?.(false);
      await Promise.resolve();
    });
    expect(controller.setFrozen).toHaveBeenLastCalledWith(false);
    expect(screen.getByRole('button', { name: 'Write & stage' })).toBeEnabled();
    expect(undo).toBeEnabled();
    expect(next).toBeEnabled();
    expect(rail).toBeEnabled();
  });

  it('blocks side changes while finalizing and re-enables them after failure', async () => {
    let finish: ((result: boolean) => void) | undefined;
    mergeFinalizeAndStage.mockReturnValueOnce(
      new Promise<boolean>((resolve) => {
        finish = resolve;
      })
    );
    render(
      <MergeResolutionView
        session={{ ...sidesSession, selectedSide: 'ours' } as MergeSession}
        visible
      />
    );

    const current = screen.getByRole('button', { name: 'CURRENT — current keeps this file' });
    const incoming = screen.getByRole('button', {
      name: 'INCOMING — incoming deletes this file',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Write & stage' }));
    expect(current).toBeDisabled();
    expect(incoming).toBeDisabled();
    fireEvent.click(incoming);
    expect(selectMergeSide).not.toHaveBeenCalled();

    await act(async () => {
      finish?.(false);
      await Promise.resolve();
    });
    expect(incoming).toBeEnabled();
    fireEvent.click(incoming);
    expect(selectMergeSide).toHaveBeenCalledWith('theirs');
  });

  it('keeps the live Result controller across a revision-only session revival', async () => {
    const { rerender } = render(<MergeResolutionView session={textSession} visible />);
    act(() =>
      onStateChange?.({ activeIndex: null, decisions: { 0: 'C' }, order: 'current-first' })
    );

    rerender(
      <MergeResolutionView
        session={{ ...textSession, requestRevision: 2, decisions: { 0: 'C' } } as MergeSession}
        visible
      />
    );

    expect(createMergeResolutionEditor).toHaveBeenCalledTimes(1);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Write & stage' }));
      await Promise.resolve();
    });
    expect(mergeFinalizeAndStage).toHaveBeenCalledWith('resolved result', {
      suppressQueueAdvance: true,
    });
  });

  it('keeps the live Result controller across a failed-stage baseline rebase', async () => {
    const { rerender } = render(<MergeResolutionView session={textSession} visible />);
    act(() =>
      onStateChange?.({ activeIndex: null, decisions: { 0: 'C' }, order: 'current-first' })
    );

    rerender(
      <MergeResolutionView
        session={
          {
            ...textSession,
            content: (textSession as { content: string }).content + '\nrebased baseline',
            fileWriteRevision: 2,
            decisions: { 0: 'C' },
          } as MergeSession
        }
        visible
      />
    );

    expect(createMergeResolutionEditor).toHaveBeenCalledTimes(1);
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Write & stage' }));
      await Promise.resolve();
    });
    expect(mergeFinalizeAndStage).toHaveBeenCalledWith('resolved result', {
      suppressQueueAdvance: true,
    });
  });

  it('rebuilds the Result controller for a new snapshot at the same path', () => {
    const { rerender } = render(<MergeResolutionView session={textSession} visible />);
    const newRegions = [...(textSession as { regions: unknown[] }).regions];
    const newLabels = { ...(textSession as { labels: object }).labels };

    rerender(
      <MergeResolutionView
        session={{ ...textSession, regions: newRegions, labels: newLabels } as MergeSession}
        visible
      />
    );

    expect(createMergeResolutionEditor).toHaveBeenCalledTimes(2);
  });

  it('explains why a non-lossless text session is read-only', () => {
    render(
      <MergeResolutionView
        session={
          {
            ...textSession,
            encoding: 'UTF-16LE',
            lineEndings: 'CRLF',
            readOnly: true,
          } as MergeSession
        }
        visible
      />
    );

    expect(screen.getByText(/UTF-16LE.*CRLF.*losslessly/i)).toBeVisible();
    expect(screen.getByRole('button', { name: 'Write & stage' })).toBeDisabled();
  });
});
