import { render, screen, fireEvent } from '@testing-library/react';
import type { DocumentSymbolNode } from '../../../utils/documentSymbols';
import type { UseDocumentSymbolsResult } from '../../../hooks/useDocumentSymbols';

const mockNavigate = jest.fn();
jest.mock('../../../utils/editorNavigation', () => ({
  navigateToEditorLocation: (...args: unknown[]) => mockNavigate(...args),
}));

let hookResult: UseDocumentSymbolsResult;
const mockRefresh = jest.fn();
jest.mock('../../../hooks/useDocumentSymbols', () => ({
  useDocumentSymbols: () => hookResult,
}));

import { StructureView } from '../../../components/Structure/StructureView';

function range(line: number, character = 0) {
  return { start: { line, character }, end: { line, character: character + 1 } };
}
function sym(
  name: string,
  kind: number,
  selLine: number,
  children: DocumentSymbolNode[] = []
): DocumentSymbolNode {
  return { name, kind, range: range(selLine), selectionRange: range(selLine), children };
}

beforeEach(() => {
  mockNavigate.mockClear();
  mockRefresh.mockClear();
  hookResult = { status: 'no-file', symbols: [], filePath: null, refresh: mockRefresh };
});

it('renders the no-file state', () => {
  render(<StructureView />);
  expect(screen.getByText('No file open')).toBeInTheDocument();
});

it('renders unsupported state', () => {
  hookResult = { status: 'unsupported', symbols: [], filePath: '/ws/x.env', refresh: mockRefresh };
  render(<StructureView />);
  expect(screen.getByText('Structure unavailable for this file')).toBeInTheDocument();
});

it('renders error state with a working Retry button', () => {
  hookResult = { status: 'error', symbols: [], filePath: '/ws/x.ts', refresh: mockRefresh };
  render(<StructureView />);
  expect(screen.getByText("Couldn't load structure")).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  expect(mockRefresh).toHaveBeenCalledTimes(1);
});

it('renders a nested symbol tree and jumps to the selection range on click', () => {
  hookResult = {
    status: 'ready',
    filePath: '/ws/main.ts',
    refresh: mockRefresh,
    symbols: [sym('Widget', 5, 0, [sym('render', 6, 4)])],
  };
  render(<StructureView />);

  expect(screen.getByText('Widget')).toBeInTheDocument();
  const child = screen.getByText('render');
  expect(child).toBeInTheDocument();

  fireEvent.click(child);
  // selectionRange.start is 0-based (line 4, char 0) → editor is 1-based (5, 1)
  expect(mockNavigate).toHaveBeenCalledWith('/ws/main.ts', 5, 1);
});

it('jumps via keyboard (Enter) so the tree is operable without a mouse', () => {
  hookResult = {
    status: 'ready',
    filePath: '/ws/main.ts',
    refresh: mockRefresh,
    symbols: [sym('Widget', 5, 0)],
  };
  render(<StructureView />);

  const row = screen.getByText('Widget').closest('[role="treeitem"]') as HTMLElement;
  expect(row).toHaveAttribute('tabindex', '0');
  fireEvent.keyDown(row, { key: 'Enter' });
  expect(mockNavigate).toHaveBeenCalledWith('/ws/main.ts', 1, 1);
});

it('collapses a subtree via ArrowLeft on the focused row', () => {
  hookResult = {
    status: 'ready',
    filePath: '/ws/main.ts',
    refresh: mockRefresh,
    symbols: [sym('Widget', 5, 0, [sym('render', 6, 4)])],
  };
  render(<StructureView />);

  const row = screen.getByText('Widget').closest('[role="treeitem"]') as HTMLElement;
  expect(screen.getByText('render')).toBeInTheDocument();
  fireEvent.keyDown(row, { key: 'ArrowLeft' });
  expect(screen.queryByText('render')).not.toBeInTheDocument();
  expect(mockNavigate).not.toHaveBeenCalled();
});

it('collapses a subtree via its twisty without triggering navigation', () => {
  hookResult = {
    status: 'ready',
    filePath: '/ws/main.ts',
    refresh: mockRefresh,
    symbols: [sym('Widget', 5, 0, [sym('render', 6, 4)])],
  };
  render(<StructureView />);

  const widgetRow = screen.getByText('Widget').closest('[role="treeitem"]') as HTMLElement;

  // Child visible initially
  expect(screen.getByText('render')).toBeInTheDocument();

  // Click the twisty span (first child of the row) — should collapse, not navigate
  const twistySpan = widgetRow.firstElementChild as HTMLElement;
  fireEvent.click(twistySpan);
  expect(screen.queryByText('render')).not.toBeInTheDocument();
  expect(mockNavigate).not.toHaveBeenCalled();
});

it('filters symbols by the filter input', () => {
  hookResult = {
    status: 'ready',
    filePath: '/ws/main.ts',
    refresh: mockRefresh,
    symbols: [sym('alpha', 12, 0), sym('beta', 12, 1)],
  };
  render(<StructureView />);

  fireEvent.change(screen.getByLabelText('Filter symbols'), { target: { value: 'alph' } });
  expect(screen.getByText('alpha')).toBeInTheDocument();
  expect(screen.queryByText('beta')).not.toBeInTheDocument();
});

it('collapse-all collapses the visible tree even while a filter is active', () => {
  // Two containers; filter narrows to one. Collapse-all must operate on the
  // rendered (filtered) tree, not the full symbol list.
  hookResult = {
    status: 'ready',
    filePath: '/ws/main.ts',
    refresh: mockRefresh,
    symbols: [sym('Widget', 5, 0, [sym('render', 6, 4)]), sym('Gadget', 5, 8, [sym('tick', 6, 9)])],
  };
  render(<StructureView />);

  fireEvent.change(screen.getByLabelText('Filter symbols'), { target: { value: 'Widget' } });
  expect(screen.getByText('render')).toBeInTheDocument();

  fireEvent.click(screen.getByTitle('Collapse all'));
  expect(screen.queryByText('render')).not.toBeInTheDocument();
});

it('resets collapse state when the active file changes', () => {
  hookResult = {
    status: 'ready',
    filePath: '/ws/a.ts',
    refresh: mockRefresh,
    symbols: [sym('Widget', 5, 0, [sym('render', 6, 4)])],
  };
  const { rerender } = render(<StructureView />);

  fireEvent.click(screen.getByTitle('Collapse all'));
  expect(screen.queryByText('render')).not.toBeInTheDocument();

  // Switch to a different file with a same-shaped tree — collapse must reset so
  // stale position-keyed collapse state can't hide the new file's symbols.
  hookResult = {
    status: 'ready',
    filePath: '/ws/b.ts',
    refresh: mockRefresh,
    symbols: [sym('Widget', 5, 0, [sym('render', 6, 4)])],
  };
  rerender(<StructureView />);
  expect(screen.getByText('render')).toBeInTheDocument();
});
