/**
 * Test: React Testing Library Works
 *
 * Tests that React components can be rendered and tested.
 * TDD: Written first to define expected behavior.
 */

import { render, screen } from '@testing-library/react';
import App from '../App';

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
