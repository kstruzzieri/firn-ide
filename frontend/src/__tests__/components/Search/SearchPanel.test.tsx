import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { SearchPanel } from '../../../components/Search';
import { useIDEStore } from '../../../stores/ideStore';
import { useSearchStore } from '../../../stores/searchStore';
import type { FileResult, SearchUIState } from '../../../types/search';

const mockNavigate = jest.fn();
jest.mock('../../../utils/editorNavigation', () => ({
  navigateToEditorLocation: (...args: unknown[]) => mockNavigate(...args),
}));

function setUIState(
  partial: Partial<{
    query: string;
    uiState: SearchUIState;
    expandedFiles: Set<string>;
    options: { regex: boolean; caseSensitive: boolean; wholeWord: boolean };
  }>
) {
  useSearchStore.setState((state) => ({
    ...state,
    ...partial,
  }));
}

function makeFile(
  relativePath: string,
  matches: Array<{
    line: number;
    column?: number;
    text: string;
    submatches?: Array<{ start: number; end: number }>;
  }>
): FileResult {
  return {
    path: `/workspace/${relativePath}`,
    relativePath,
    matches: matches.map((m) => ({
      line: m.line,
      column: m.column ?? 1,
      text: m.text,
      submatches: m.submatches ?? [{ start: 0, end: m.text.length }],
    })),
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  // Reset the search store between tests by rebuilding the default state.
  useSearchStore.setState({
    query: '',
    options: { regex: false, caseSensitive: false, wholeWord: false },
    uiState: { kind: 'no-workspace' },
    expandedFiles: new Set(),
    activeRequestId: null,
    focusInputRevision: 0,
  });
});

afterEach(() => {
  // Clean up any DOM nodes appended directly to document.body by tests
  // (testing-library's auto-cleanup only unmounts React roots).
  document.getElementById('mount-focus-sibling')?.remove();
});

describe('SearchPanel — empty-style states', () => {
  it('renders the no-workspace state', () => {
    setUIState({ uiState: { kind: 'no-workspace' } });
    render(<SearchPanel />);
    expect(screen.getByText('No workspace open')).toBeInTheDocument();
    expect(screen.getByText(/Open a folder to search/)).toBeInTheDocument();
  });

  it('renders the empty-query state', () => {
    setUIState({ uiState: { kind: 'empty-query' } });
    render(<SearchPanel />);
    expect(screen.getByText(/Type to search the workspace/)).toBeInTheDocument();
  });

  it('renders the loading state', () => {
    setUIState({ uiState: { kind: 'loading', requestId: 'r1' } });
    render(<SearchPanel />);
    expect(screen.getByText(/Searching/)).toBeInTheDocument();
  });

  it('renders the no-matches state with formatted duration', () => {
    setUIState({ uiState: { kind: 'no-matches', durationMs: 142 } });
    render(<SearchPanel />);
    expect(screen.getByText('No matches')).toBeInTheDocument();
    expect(screen.getByText(/142 ms/)).toBeInTheDocument();
  });

  it('renders the missing-tool state as an alert', () => {
    setUIState({
      uiState: { kind: 'missing-tool', message: 'ripgrep is not on PATH.' },
    });
    render(<SearchPanel />);
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByText('ripgrep is not available')).toBeInTheDocument();
    expect(screen.getByText('ripgrep is not on PATH.')).toBeInTheDocument();
  });

  it('renders the invalid-regex state and marks the input invalid', () => {
    setUIState({
      query: 'foo[',
      uiState: { kind: 'invalid-regex', message: 'unclosed character class' },
    });
    render(<SearchPanel />);
    expect(screen.getByText('Invalid regular expression')).toBeInTheDocument();
    const input = screen.getByLabelText('Search query');
    expect(input).toHaveAttribute('aria-invalid', 'true');
  });

  it('renders the failed state with the message', () => {
    setUIState({ uiState: { kind: 'failed', message: 'spawn failure' } });
    render(<SearchPanel />);
    expect(screen.getByText('Search failed')).toBeInTheDocument();
    expect(screen.getByText('spawn failure')).toBeInTheDocument();
  });

  it('renders the canceled state', () => {
    setUIState({ uiState: { kind: 'canceled' } });
    render(<SearchPanel />);
    expect(screen.getByText(/Search canceled/)).toBeInTheDocument();
  });
});

describe('SearchPanel — controls', () => {
  it('updates query on input change', () => {
    setUIState({ uiState: { kind: 'empty-query' } });
    render(<SearchPanel />);
    const input = screen.getByLabelText('Search query');
    fireEvent.change(input, { target: { value: 'hello' } });
    expect(useSearchStore.getState().query).toBe('hello');
  });

  it('toggles each option independently', () => {
    setUIState({ uiState: { kind: 'empty-query' } });
    render(<SearchPanel />);
    const caseBtn = screen.getByRole('button', { name: 'Match case' });
    const wordBtn = screen.getByRole('button', { name: 'Match whole word' });
    const regexBtn = screen.getByRole('button', { name: 'Use regular expression' });

    expect(caseBtn).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(caseBtn);
    expect(useSearchStore.getState().options.caseSensitive).toBe(true);
    fireEvent.click(wordBtn);
    expect(useSearchStore.getState().options.wholeWord).toBe(true);
    fireEvent.click(regexBtn);
    expect(useSearchStore.getState().options.regex).toBe(true);
  });

  it('shows the clear button only when there is a query', () => {
    setUIState({ uiState: { kind: 'empty-query' } });
    const { rerender } = render(<SearchPanel />);
    expect(screen.queryByLabelText('Clear search')).not.toBeInTheDocument();

    act(() => {
      useSearchStore.getState().setQuery('foo');
    });
    rerender(<SearchPanel />);
    fireEvent.click(screen.getByLabelText('Clear search'));
    expect(useSearchStore.getState().query).toBe('');
  });

  it('focuses the input on mount regardless of starting focusInputRevision', () => {
    // Render an unrelated focusable sibling first and focus it; this ensures
    // any subsequent activeElement === input observation reflects the panel's
    // mount-time focus effect, not jsdom's body-default behavior. Sibling
    // is removed by the suite-level afterEach below to survive assertion
    // failures without leaking into later tests.
    const sibling = document.createElement('button');
    sibling.id = 'mount-focus-sibling';
    sibling.textContent = 'sibling';
    document.body.appendChild(sibling);
    sibling.focus();
    expect(document.activeElement?.id).toBe('mount-focus-sibling');

    // Mount with a non-zero revision to prove the effect fires on mount and
    // doesn't depend on a 0-valued dep.
    setUIState({ uiState: { kind: 'empty-query' } });
    useSearchStore.setState({ focusInputRevision: 5 });

    render(<SearchPanel />);
    const input = screen.getByLabelText('Search query');
    expect(document.activeElement).toBe(input);
  });

  it('refocuses the input when requestInputFocus bumps the revision', () => {
    setUIState({ uiState: { kind: 'empty-query' } });
    render(<SearchPanel />);
    const input = screen.getByLabelText('Search query');

    (document.activeElement as HTMLElement | null)?.blur();
    expect(document.activeElement).not.toBe(input);

    act(() => {
      useSearchStore.getState().requestInputFocus();
    });
    expect(document.activeElement).toBe(input);
  });
});

describe('SearchPanel — results rendering', () => {
  const fileA = makeFile('src/components/Foo.tsx', [
    { line: 12, column: 5, text: '  const foo = bar();', submatches: [{ start: 8, end: 11 }] },
    { line: 30, column: 9, text: 'function foo() {}', submatches: [{ start: 9, end: 12 }] },
  ]);
  const fileB = makeFile('Bar.ts', [
    { line: 4, column: 1, text: 'foo();', submatches: [{ start: 0, end: 3 }] },
  ]);

  function setResults(opts?: { truncated?: boolean; matchCap?: number }) {
    setUIState({
      query: 'foo',
      uiState: {
        kind: 'results',
        files: [fileA, fileB],
        totalFiles: 2,
        totalLines: 3,
        truncated: opts?.truncated ?? false,
        matchCap: opts?.matchCap ?? 5000,
        durationMs: 180,
      },
      expandedFiles: new Set([fileA.path, fileB.path]),
    });
  }

  it('renders the summary with file/match counts and duration', () => {
    setResults();
    render(<SearchPanel />);
    expect(screen.getByText('3 matches in 2 files')).toBeInTheDocument();
    expect(screen.getByText('180 ms')).toBeInTheDocument();
  });

  it('groups matches by file and shows match counts on the header', () => {
    setResults();
    render(<SearchPanel />);
    const fooHeader = screen.getByRole('button', { name: /Foo\.tsx \(2 matches\)/ });
    expect(fooHeader).toBeInTheDocument();
    expect(within(fooHeader).getByText('2')).toBeInTheDocument();

    const barHeader = screen.getByRole('button', { name: /Bar\.ts \(1 match\)/ });
    expect(within(barHeader).getByText('1')).toBeInTheDocument();
  });

  it('renders highlighted match segments via <mark>', () => {
    setResults();
    render(<SearchPanel />);
    const marks = document.querySelectorAll('mark');
    // 3 total matches across both files → 3 highlight elements.
    expect(marks.length).toBe(3);
    expect(marks[0].textContent).toBe('foo');
  });

  it('renders the truncation banner with a non-color cue when results are capped', () => {
    setResults({ truncated: true, matchCap: 5000 });
    render(<SearchPanel />);
    // Color-only signaling fails WCAG; assert the explicit warning glyph
    // and word are present so the cue is reachable without color.
    expect(screen.getByText(/⚠ Truncated at 5,000 matches/)).toBeInTheDocument();
  });

  it('makes the first item tabbable when no row is focused (Tab-only access)', () => {
    setResults();
    render(<SearchPanel />);
    const firstHeader = screen.getByRole('button', { name: /Foo\.tsx \(2 matches\)/ });
    expect(firstHeader).toHaveAttribute('tabindex', '0');
    // The Bar.ts header is not the focused row and is not at index 0, so it
    // must NOT be in the tab order.
    const secondHeader = screen.getByRole('button', { name: /Bar\.ts \(1 match\)/ });
    expect(secondHeader).toHaveAttribute('tabindex', '-1');
  });

  it('refocuses the previously focused row after a same-shape result refresh', () => {
    setResults();
    render(<SearchPanel />);
    const firstHeader = screen.getByRole('button', { name: /Foo\.tsx \(2 matches\)/ });
    act(() => {
      firstHeader.focus();
    });
    expect(document.activeElement).toBe(firstHeader);

    // Refresh the store with structurally identical results (different
    // object identity, same shape). The button DOM nodes are recreated.
    act(() => {
      useSearchStore.setState({
        uiState: {
          kind: 'results',
          files: [{ ...fileA }, { ...fileB }],
          totalFiles: 2,
          totalLines: 3,
          truncated: false,
          matchCap: 5000,
          durationMs: 60,
        },
      });
    });

    const refreshedHeader = screen.getByRole('button', { name: /Foo\.tsx \(2 matches\)/ });
    expect(document.activeElement).toBe(refreshedHeader);
  });

  it('skips navigation if there is no workspace open at click time', async () => {
    act(() => {
      useIDEStore.setState({ workspace: null });
    });
    const file = makeFile('foo.ts', [
      { line: 1, column: 1, text: 'foo', submatches: [{ start: 0, end: 3 }] },
    ]);
    setUIState({
      query: 'foo',
      uiState: {
        kind: 'results',
        files: [file],
        totalFiles: 1,
        totalLines: 1,
        truncated: false,
        matchCap: 5000,
        durationMs: 5,
      },
      expandedFiles: new Set([file.path]),
    });

    render(<SearchPanel />);
    const row = screen.getByRole('button', { name: /Line 1 in foo\.ts/ });

    await act(async () => {
      fireEvent.click(row);
      await Promise.resolve();
    });

    expect(mockNavigate).not.toHaveBeenCalled();
  });

  it('clicking a match calls navigateToEditorLocation with byte→char column', async () => {
    // The activateMatch guard requires a workspace; mock one that contains
    // the file path. The test assertion is on byte→char column conversion,
    // not on the workspace gate.
    act(() => {
      useIDEStore.setState({ workspace: { name: 'w', path: '/workspace' } });
    });
    // Multi-byte case: the line text starts with a 2-byte char (é) and the
    // backend reports column=3 (1-based byte offset just past 'é '), which
    // equals char column 3 in JS. Use a clearer 4-byte case: emoji.
    const file = makeFile('emoji.ts', [
      // "🙂 const x" — 🙂 is 4 bytes in UTF-8 (and 2 UTF-16 code units).
      // Backend column 6 = byte index 5 = right after "🙂 " (4 + 1 = 5 bytes).
      // In UTF-16, that's char index 3 (2 surrogates + 1 space) → 1-based 4.
      { line: 1, column: 6, text: '🙂 const x', submatches: [{ start: 5, end: 10 }] },
    ]);
    setUIState({
      query: 'const',
      uiState: {
        kind: 'results',
        files: [file],
        totalFiles: 1,
        totalLines: 1,
        truncated: false,
        matchCap: 5000,
        durationMs: 5,
      },
      expandedFiles: new Set([file.path]),
    });

    render(<SearchPanel />);
    const row = screen.getByRole('button', { name: /Line 1 in emoji\.ts/ });

    await act(async () => {
      fireEvent.click(row);
    });

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    expect(mockNavigate).toHaveBeenCalledWith(
      '/workspace/emoji.ts',
      1,
      4,
      expect.objectContaining({ shouldApply: expect.any(Function) })
    );

    const options = mockNavigate.mock.calls[0][3] as { shouldApply: () => boolean };
    expect(options.shouldApply()).toBe(true);

    act(() => {
      useIDEStore.setState({ workspace: { name: 'other', path: '/other-workspace' } });
    });

    expect(options.shouldApply()).toBe(false);
  });

  it('clicking a file header collapses then expands the group', () => {
    setResults();
    render(<SearchPanel />);
    expect(useSearchStore.getState().expandedFiles.has(fileA.path)).toBe(true);

    const header = screen.getByRole('button', { name: /Foo\.tsx \(2 matches\)/ });
    fireEvent.click(header);
    expect(useSearchStore.getState().expandedFiles.has(fileA.path)).toBe(false);

    fireEvent.click(header);
    expect(useSearchStore.getState().expandedFiles.has(fileA.path)).toBe(true);
  });

  it('restores focus to the input when results refresh and the focused row unmounts', () => {
    setResults();
    render(<SearchPanel />);
    const input = screen.getByLabelText('Search query');
    const lastRow = screen.getByRole('button', { name: 'Line 4 in Bar.ts' });

    act(() => {
      lastRow.focus();
    });
    expect(document.activeElement).toBe(lastRow);

    // Simulate a fresh response that drops Bar.ts entirely. The previously
    // focused row unmounts; without restoration, focus would move to body.
    act(() => {
      useSearchStore.setState({
        uiState: {
          kind: 'results',
          files: [fileA],
          totalFiles: 1,
          totalLines: 2,
          truncated: false,
          matchCap: 5000,
          durationMs: 50,
        },
        expandedFiles: new Set([fileA.path]),
      });
    });

    expect(document.activeElement).toBe(input);
  });
});

describe('SearchPanel — keyboard navigation', () => {
  const file = makeFile('a.ts', [
    { line: 1, column: 1, text: 'foo', submatches: [{ start: 0, end: 3 }] },
    { line: 2, column: 1, text: 'foo', submatches: [{ start: 0, end: 3 }] },
  ]);

  function setupResults() {
    // activateMatch requires a workspace; without it the click is a no-op.
    useIDEStore.setState({ workspace: { name: 'w', path: '/workspace' } });
    setUIState({
      query: 'foo',
      uiState: {
        kind: 'results',
        files: [file],
        totalFiles: 1,
        totalLines: 2,
        truncated: false,
        matchCap: 5000,
        durationMs: 10,
      },
      expandedFiles: new Set([file.path]),
    });
  }

  it('ArrowDown from the input focuses the first item', () => {
    setupResults();
    render(<SearchPanel />);
    const input = screen.getByLabelText('Search query');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    const fileHeader = screen.getByRole('button', { name: /a\.ts \(2 matches\)/ });
    expect(document.activeElement).toBe(fileHeader);
  });

  it('ArrowDown moves through the flat item list', () => {
    setupResults();
    render(<SearchPanel />);
    const input = screen.getByLabelText('Search query');
    fireEvent.keyDown(input, { key: 'ArrowDown' });

    const fileHeader = screen.getByRole('button', { name: /a\.ts \(2 matches\)/ });
    fireEvent.keyDown(fileHeader, { key: 'ArrowDown' });

    const firstResult = screen.getByRole('button', { name: 'Line 1 in a.ts' });
    expect(document.activeElement).toBe(firstResult);
  });

  it('ArrowUp on the first item returns focus to the input', () => {
    setupResults();
    render(<SearchPanel />);
    const input = screen.getByLabelText('Search query');
    fireEvent.keyDown(input, { key: 'ArrowDown' });

    const fileHeader = screen.getByRole('button', { name: /a\.ts \(2 matches\)/ });
    fireEvent.keyDown(fileHeader, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(input);
  });

  it('Enter on a result row navigates', async () => {
    setupResults();
    render(<SearchPanel />);
    const firstResult = screen.getByRole('button', { name: 'Line 1 in a.ts' });
    // act() flushes onFocus state update so focusedItemIndex is set before
    // the keyDown handler reads it.
    act(() => {
      firstResult.focus();
    });
    await act(async () => {
      fireEvent.keyDown(firstResult, { key: 'Enter' });
    });
    expect(mockNavigate).toHaveBeenCalledWith(
      file.path,
      1,
      1,
      expect.objectContaining({ shouldApply: expect.any(Function) })
    );
  });

  it('Enter on a file header toggles expansion', () => {
    setupResults();
    render(<SearchPanel />);
    const fileHeader = screen.getByRole('button', { name: /a\.ts \(2 matches\)/ });
    act(() => {
      fileHeader.focus();
    });
    fireEvent.keyDown(fileHeader, { key: 'Enter' });
    expect(useSearchStore.getState().expandedFiles.has(file.path)).toBe(false);
  });

  it('ArrowLeft on a match row moves focus to the parent file header', () => {
    setupResults();
    render(<SearchPanel />);
    const firstResult = screen.getByRole('button', { name: 'Line 1 in a.ts' });
    act(() => {
      firstResult.focus();
    });
    fireEvent.keyDown(firstResult, { key: 'ArrowLeft' });

    const fileHeader = screen.getByRole('button', { name: /a\.ts \(2 matches\)/ });
    expect(document.activeElement).toBe(fileHeader);
  });

  it('ArrowLeft on a collapsed file header returns focus to the input', () => {
    setUIState({
      query: 'foo',
      uiState: {
        kind: 'results',
        files: [file],
        totalFiles: 1,
        totalLines: 2,
        truncated: false,
        matchCap: 5000,
        durationMs: 10,
      },
      expandedFiles: new Set(),
    });
    render(<SearchPanel />);
    const fileHeader = screen.getByRole('button', { name: /a\.ts \(2 matches\)/ });
    act(() => {
      fileHeader.focus();
    });
    fireEvent.keyDown(fileHeader, { key: 'ArrowLeft' });

    const input = screen.getByLabelText('Search query');
    expect(document.activeElement).toBe(input);
  });

  it('ArrowRight on a collapsed file header expands it', () => {
    setUIState({
      query: 'foo',
      uiState: {
        kind: 'results',
        files: [file],
        totalFiles: 1,
        totalLines: 2,
        truncated: false,
        matchCap: 5000,
        durationMs: 10,
      },
      expandedFiles: new Set(),
    });
    render(<SearchPanel />);
    const fileHeader = screen.getByRole('button', { name: /a\.ts \(2 matches\)/ });
    act(() => {
      fileHeader.focus();
    });
    fireEvent.keyDown(fileHeader, { key: 'ArrowRight' });
    expect(useSearchStore.getState().expandedFiles.has(file.path)).toBe(true);
  });

  it('Escape on the input clears a non-empty query', () => {
    setUIState({ query: 'foo', uiState: { kind: 'empty-query' } });
    render(<SearchPanel />);
    const input = screen.getByLabelText('Search query');
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(useSearchStore.getState().query).toBe('');
  });
});
