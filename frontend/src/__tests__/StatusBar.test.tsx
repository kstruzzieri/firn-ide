/**
 * Test: StatusBar Component
 *
 * Tests for the StatusBar component.
 */

import { render, screen } from '@testing-library/react';
import { StatusBar } from '../components/StatusBar';

describe('StatusBar Component', () => {
  it('should render without crashing', () => {
    render(<StatusBar />);
    expect(document.body).toBeInTheDocument();
  });

  it('should display status information', () => {
    render(<StatusBar />);
    // Should show "No issues" when there are no errors/warnings
    expect(screen.getByText(/No issues/)).toBeInTheDocument();
  });
});
