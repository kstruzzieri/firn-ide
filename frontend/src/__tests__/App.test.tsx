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
  GetWatchedPath: jest.fn(),
  SetWatchedPath: jest.fn(),
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

  it('should render the Flux IDE header', () => {
    render(<App />);
    // Look for the app name in the header
    expect(screen.getByText('Flux')).toBeInTheDocument();
  });
});
