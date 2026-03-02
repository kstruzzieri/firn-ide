/**
 * Test: Header Component
 *
 * Tests for the Header component.
 */

import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { Header } from '../components/Header';
import { useIDEStore } from '../stores/ideStore';

jest.mock('../../wailsjs/go/main/App', () => ({
  OpenFolderDialog: jest.fn(),
}));

jest.mock('../../wailsjs/runtime/runtime', () => ({
  WindowSetTitle: jest.fn(),
}));

import { OpenFolderDialog } from '../../wailsjs/go/main/App';
import { WindowSetTitle } from '../../wailsjs/runtime/runtime';

describe('Header Component', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    useIDEStore.setState({
      workspace: null,
    });
  });

  it('should render the app name', () => {
    render(<Header />);
    expect(screen.getByText('Firn')).toBeInTheDocument();
  });

  it('should render navigation buttons', () => {
    render(<Header />);
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThan(0);
  });

  it('should render search button with keyboard shortcut', () => {
    render(<Header />);
    expect(screen.getByText(/search/i)).toBeInTheDocument();
  });

  it('should show "No workspace" when no workspace is set', () => {
    render(<Header />);
    expect(screen.getByText('No workspace')).toBeInTheDocument();
  });

  it('should show workspace name when workspace is set', () => {
    useIDEStore.setState({
      workspace: { name: 'my-project', path: '/Users/test/my-project' },
    });
    render(<Header />);
    expect(screen.getByText('my-project')).toBeInTheDocument();
  });

  it('should call OpenFolderDialog when workspace button is clicked', async () => {
    (OpenFolderDialog as jest.Mock).mockResolvedValue('/Users/test/project');

    render(<Header />);

    const workspaceBtn = screen.getByRole('button', { name: /open folder/i });
    fireEvent.click(workspaceBtn);

    await waitFor(() => {
      expect(OpenFolderDialog).toHaveBeenCalled();
    });
  });

  it('should update workspace and window title after folder selection', async () => {
    (OpenFolderDialog as jest.Mock).mockResolvedValue('/Users/test/my-app');

    render(<Header />);

    fireEvent.click(screen.getByRole('button', { name: /open folder/i }));

    await waitFor(() => {
      const state = useIDEStore.getState();
      expect(state.workspace).toEqual({
        name: 'my-app',
        path: '/Users/test/my-app',
      });
      expect(WindowSetTitle).toHaveBeenCalledWith('my-app — Firn');
    });
  });
});
