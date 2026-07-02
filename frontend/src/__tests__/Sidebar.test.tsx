/**
 * Test: Sidebar Component
 *
 * Tests for the Sidebar component.
 */

import { render, screen } from '@testing-library/react';
import { Sidebar } from '../components/Sidebar';

describe('Sidebar Component', () => {
  it('should render sidebar icons', () => {
    render(<Sidebar />);
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThan(0);
  });

  it('should render explorer button', () => {
    render(<Sidebar />);
    expect(screen.getByLabelText('Explorer')).toBeInTheDocument();
  });

  it('should render search button', () => {
    render(<Sidebar />);
    expect(screen.getByLabelText('Search')).toBeInTheDocument();
  });

  it('should render source control button', () => {
    render(<Sidebar />);
    expect(screen.getByLabelText('Source Control')).toBeInTheDocument();
  });

  it('should render settings button', () => {
    render(<Sidebar />);
    expect(screen.getByLabelText('Settings')).toBeInTheDocument();
  });
});
