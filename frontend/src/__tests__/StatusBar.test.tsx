/**
 * Test: StatusBar Component
 *
 * Tests for the StatusBar component.
 */

import { render, screen } from '@testing-library/react';
import { act } from 'react';
import { StatusBar } from '../components/StatusBar';
import { useLSPStore } from '../stores/lspStore';

beforeEach(() => {
  useLSPStore.setState(useLSPStore.getInitialState());
});

describe('StatusBar Component', () => {
  it('should render without crashing', () => {
    render(<StatusBar />);
    expect(document.body).toBeInTheDocument();
  });

  it('should display "No issues" when there are no diagnostics', () => {
    render(<StatusBar />);
    expect(screen.getByText(/No issues/)).toBeInTheDocument();
  });

  it('should display error and warning counts from lspStore', () => {
    render(<StatusBar />);

    act(() => {
      useLSPStore.getState().setDiagnostics('file:///test.ts', [
        {
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
          severity: 1,
          message: 'Type error',
        },
        {
          range: { start: { line: 1, character: 0 }, end: { line: 1, character: 5 } },
          severity: 2,
          message: 'Unused variable',
        },
      ]);
    });

    expect(screen.getByText(/1 error, 1 warning/)).toBeInTheDocument();
  });

  it('should display info diagnostics instead of reporting "No issues"', () => {
    render(<StatusBar />);

    act(() => {
      useLSPStore.getState().setDiagnostics('file:///test.ts', [
        {
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
          severity: 3,
          message: 'Info diagnostic',
        },
      ]);
    });

    expect(screen.getByText(/1 info/)).toBeInTheDocument();
    expect(screen.queryByText(/No issues/)).not.toBeInTheDocument();
  });

  it('should clear counts when diagnostics are removed', () => {
    render(<StatusBar />);

    act(() => {
      useLSPStore.getState().setDiagnostics('file:///test.ts', [
        {
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
          severity: 1,
          message: 'Type error',
        },
      ]);
    });

    expect(screen.getByText(/1 error/)).toBeInTheDocument();

    act(() => {
      useLSPStore.getState().clearAllDiagnostics();
    });

    expect(screen.getByText(/No issues/)).toBeInTheDocument();
  });
});
