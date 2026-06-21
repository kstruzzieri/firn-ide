// src/__tests__/components/FileExplorer/TreeRow.test.tsx
import { render, screen, fireEvent } from '@testing-library/react';
import { TreeRow, rowDomId } from '../../../components/FileExplorer/TreeRow';

const noop = () => {};

const baseProps = {
  rowId: rowDomId('/repo/a.ts'),
  isActive: false,
  onToggle: noop,
  onSelect: noop,
  onOpen: noop,
};

describe('TreeRow', () => {
  it('renders a file with its name and no chevron', () => {
    render(
      <TreeRow
        {...baseProps}
        kind="entry"
        path="/repo/a.ts"
        name="a.ts"
        depth={1}
        level={2}
        isDir={false}
        isExpanded={false}
        isSelected={false}
        regionAccent={null}
        setSize={1}
        posInSet={1}
      />
    );
    expect(screen.getByText('a.ts')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /toggle/i })).not.toBeInTheDocument();
  });

  it('creates a sanitized active-descendant id from a path key', () => {
    expect(rowDomId('/repo/src/App test.tsx')).toBe('treeitem-%2Frepo%2Fsrc%2FApp%20test.tsx');
  });

  it('renders a folder with a toggle button and fires onToggle', () => {
    const onToggle = jest.fn();
    render(
      <TreeRow
        {...baseProps}
        onToggle={onToggle}
        kind="entry"
        path="/repo/src"
        name="src"
        depth={1}
        level={2}
        isDir={true}
        isExpanded={false}
        isSelected={false}
        regionAccent={null}
        setSize={1}
        posInSet={1}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: /toggle/i }));
    expect(onToggle).toHaveBeenCalledWith('entry', '/repo/src');
  });

  it('calls onSelect when the row is clicked', () => {
    const onSelect = jest.fn();
    render(
      <TreeRow
        {...baseProps}
        onSelect={onSelect}
        kind="entry"
        path="/repo/a.ts"
        name="a.ts"
        depth={1}
        level={2}
        isDir={false}
        isExpanded={false}
        isSelected={false}
        regionAccent={null}
        setSize={1}
        posInSet={1}
      />
    );
    fireEvent.click(screen.getByRole('treeitem'));
    expect(onSelect).toHaveBeenCalledWith('/repo/a.ts');
  });

  it('applies the tinted class and --region-accent var when an accent is set', () => {
    const { container } = render(
      <TreeRow
        {...baseProps}
        kind="entry"
        path="/repo/frontend/x.ts"
        name="x.ts"
        depth={2}
        level={3}
        isDir={false}
        isExpanded={false}
        isSelected={false}
        regionAccent="blue"
        setSize={1}
        posInSet={1}
      />
    );
    const row = container.querySelector('[role="treeitem"]') as HTMLElement;
    expect(row.className).toContain('tinted');
    expect(row.getAttribute('style')).toContain('--region-accent');
  });

  it('exposes both tinted and aria-selected when a region file is selected', () => {
    // Precondition for the .row.tinted[aria-selected='true'] rule that makes a
    // selected file inherit its region/workspace accent (Project + Workspace
    // consistent). Both hooks must coexist on the row.
    const { container } = render(
      <TreeRow
        {...baseProps}
        kind="entry"
        path="/repo/frontend/x.ts"
        name="x.ts"
        depth={2}
        level={3}
        isDir={false}
        isExpanded={false}
        isSelected={true}
        regionAccent="blue"
        setSize={1}
        posInSet={1}
      />
    );
    const row = container.querySelector('[role="treeitem"]') as HTMLElement;
    expect(row.className).toContain('tinted');
    expect(row.getAttribute('style')).toContain('--region-accent');
    expect(row).toHaveAttribute('aria-selected', 'true');
  });

  it('exposes both tinted and active classes for the active region row', () => {
    // Precondition for the .row.tinted.active rule that draws the focus/active
    // outline in the region accent instead of the global --accent.
    const { container } = render(
      <TreeRow
        {...baseProps}
        isActive={true}
        kind="entry"
        path="/repo/frontend/x.ts"
        name="x.ts"
        depth={2}
        level={3}
        isDir={false}
        isExpanded={false}
        isSelected={false}
        regionAccent="blue"
        setSize={1}
        posInSet={1}
      />
    );
    const row = container.querySelector('[role="treeitem"]') as HTMLElement;
    expect(row.className).toContain('tinted');
    expect(row.className).toContain('active');
  });

  it('sets aria attributes from the flat data', () => {
    render(
      <TreeRow
        {...baseProps}
        kind="entry"
        path="/repo/src"
        name="src"
        depth={1}
        level={2}
        isDir={true}
        isExpanded={true}
        isSelected={true}
        regionAccent={null}
        setSize={3}
        posInSet={2}
      />
    );
    const row = screen.getByRole('treeitem');
    expect(row).toHaveAttribute('aria-level', '2');
    expect(row).toHaveAttribute('aria-setsize', '3');
    expect(row).toHaveAttribute('aria-posinset', '2');
    expect(row).toHaveAttribute('aria-expanded', 'true');
    expect(row).toHaveAttribute('aria-selected', 'true');
  });

  it('dims hidden (dot-prefixed) folders via data-hidden', () => {
    const { container } = render(
      <TreeRow
        {...baseProps}
        kind="entry"
        path="/repo/.git"
        name=".git"
        depth={1}
        level={2}
        isDir={true}
        isExpanded={false}
        isSelected={false}
        regionAccent={null}
        setSize={1}
        posInSet={1}
      />
    );
    expect(container.querySelector('[data-hidden]')).toBeInTheDocument();
  });

  it('renders the root row with its label and path and toggles the root', () => {
    const onToggle = jest.fn();
    render(
      <TreeRow
        {...baseProps}
        onToggle={onToggle}
        kind="root"
        name="repo"
        rootPath="/Users/me/repo"
        depth={0}
        level={1}
        isDir={true}
        isExpanded={true}
        isSelected={false}
        regionAccent={null}
        setSize={1}
        posInSet={1}
      />
    );
    expect(screen.getByText('repo')).toBeInTheDocument();
    expect(screen.getByText('~/repo')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /toggle/i }));
    expect(onToggle).toHaveBeenCalledWith('root', undefined);
  });
});
