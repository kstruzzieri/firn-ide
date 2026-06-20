import { render } from '@testing-library/react';
import { TreeNode } from '../../components/FileExplorer/TreeNode';
import type { FileEntry, WorkspaceAccent } from '../../stores/ideStore';

const folder: FileEntry = {
  name: 'frontend',
  path: '/repo/frontend',
  isDir: true,
  children: [{ name: 'App.tsx', path: '/repo/frontend/App.tsx', isDir: false } as FileEntry],
} as FileEntry;

const noop = () => {};

describe('TreeNode region tinting', () => {
  it('adds the tinted class and --region-accent var when the resolver returns an accent', () => {
    const getRegionAccent = (e: FileEntry): WorkspaceAccent | null =>
      e.path.startsWith('/repo/frontend') ? 'blue' : null;
    const { container } = render(
      <TreeNode
        entry={folder}
        depth={1}
        isExpanded
        expandedPaths={new Set(['/repo/frontend'])}
        onToggle={noop}
        onSelect={noop}
        onOpen={noop}
        getRegionAccent={getRegionAccent}
      />
    );
    const rows = container.querySelectorAll('.row.tinted');
    // folder row + visible child row both tinted
    expect(rows.length).toBe(2);
    const folderRow = rows[0] as HTMLElement;
    expect(folderRow.style.getPropertyValue('--region-accent')).toBe('var(--accent-blue)');
  });

  it('does not tint when no resolver is provided', () => {
    const { container } = render(
      <TreeNode entry={folder} depth={1} isExpanded onToggle={noop} onSelect={noop} onOpen={noop} />
    );
    expect(container.querySelector('.row.tinted')).toBeNull();
  });
});
