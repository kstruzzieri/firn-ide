/**
 * Test: Header Component
 *
 * Tests for the Header component.
 */

import { render, screen } from '@testing-library/react';
import { Header } from '../components/Header';

describe('Header Component', () => {
  it('should render the app name', () => {
    render(<Header />);
    expect(screen.getByText('Flux')).toBeInTheDocument();
  });

  it('should render navigation buttons', () => {
    render(<Header />);
    // Check for window control buttons (close, minimize, maximize)
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThan(0);
  });

  it('should render search button with keyboard shortcut', () => {
    render(<Header />);
    expect(screen.getByText(/search/i)).toBeInTheDocument();
  });
});
