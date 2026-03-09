/**
 * Test: React Testing Library Works
 *
 * Tests that React components can be rendered and tested.
 * TDD: Written first to define expected behavior.
 */

import { render, screen } from '@testing-library/react';
import App from '../App';

// Mock Wails bindings
jest.mock('../../wailsjs/go/main/App', () => ({
  ReadDirectory: jest.fn(),
  ReadFile: jest.fn(),
  WriteFile: jest.fn(),
  OpenFolderDialog: jest.fn(),
  GetWatchedPath: jest.fn(),
  SetWatchedPath: jest.fn(),
  CreateTerminal: jest.fn(() => Promise.resolve('term-1')),
  WriteTerminal: jest.fn(),
  CloseTerminal: jest.fn(),
  ResizeTerminal: jest.fn(),
  ConfirmBeforeCloseReady: jest.fn(() => Promise.resolve()),
  SaveWorkspaceState: jest.fn(() => Promise.resolve()),
  LoadWorkspaceState: jest.fn(() => Promise.resolve(null)),
}));

jest.mock('../../wailsjs/runtime/runtime', () => ({
  WindowSetTitle: jest.fn(),
  EventsOn: jest.fn(() => jest.fn()),
}));

// Mock useDirectoryTree to prevent automatic fetching
jest.mock('../components/FileExplorer/useDirectoryTree', () => ({
  useDirectoryTree: () => ({ refetch: jest.fn() }),
}));

describe('App Component', () => {
  it('should render without crashing', () => {
    render(<App />);
    // The app should render the IDE shell
    expect(document.body).toBeInTheDocument();
  });

  it('should render the Firn IDE header', () => {
    render(<App />);
    // Look for the app name in the header
    expect(screen.getByText('Firn')).toBeInTheDocument();
  });
});
