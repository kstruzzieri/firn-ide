import { act, fireEvent, render, screen } from '@testing-library/react';
import { Toast } from '../../../components/Toast';
import { useIDEStore } from '../../../stores/ideStore';

// Reset store between tests
beforeEach(() => {
  useIDEStore.setState({ toast: null, heldToasts: [] });
});

describe('Toast', () => {
  it('should render no toast when there is none', () => {
    render(<Toast />);
    expect(screen.getByRole('alert')).toBeEmptyDOMElement();
    expect(screen.queryByRole('button', { name: /dismiss/i })).not.toBeInTheDocument();
  });

  // WebKit posts AXLiveRegionCreated, not AXLiveRegionChanged, for a live
  // region inserted together with its text, and VoiceOver says nothing; the
  // packaged app recorded exactly that for a failed push's toast. jsdom has no
  // accessibility tree, so this pins the cause: the alert region is in the
  // document before the toast and is the same unstyled element once it shows.
  it('keeps the alert region mounted and unstyled while empty, so a toast is announced', () => {
    render(<Toast />);
    const region = screen.getByRole('alert');

    act(() => useIDEStore.setState({ toast: { message: 'Git push failed', type: 'error' } }));
    expect(screen.getByRole('alert')).toBe(region);
    expect(region).toHaveTextContent('Git push failed');
    expect(region).not.toHaveAttribute('class');

    act(() => useIDEStore.setState({ toast: null }));
    expect(screen.getByRole('alert')).toBe(region);
    expect(region).toBeEmptyDOMElement();
  });

  it('should render error toast message', () => {
    useIDEStore.setState({
      toast: { message: 'Failed to save file.ts', type: 'error' },
    });
    render(<Toast />);
    expect(screen.getByText('Failed to save file.ts')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });

  it('should render info toast message', () => {
    useIDEStore.setState({
      toast: { message: 'File saved', type: 'info' },
    });
    render(<Toast />);
    expect(screen.getByText('File saved')).toBeInTheDocument();
  });

  it('should have a dismiss button', () => {
    useIDEStore.setState({
      toast: { message: 'Error', type: 'error' },
    });
    render(<Toast />);
    expect(screen.getByRole('button', { name: /dismiss/i })).toBeInTheDocument();
  });

  it('auto-dismisses an ordinary toast but keeps a sticky one until dismissed', () => {
    jest.useFakeTimers();
    try {
      useIDEStore.setState({ toast: { message: 'Transient', type: 'error' } });
      const { rerender } = render(<Toast />);
      act(() => {
        jest.advanceTimersByTime(4000);
      });
      expect(useIDEStore.getState().toast).toBeNull();

      // A sticky toast carries a message the user must act on (#290's
      // refused save): no timer, only the Dismiss button clears it.
      act(() => {
        useIDEStore.setState({ toast: { message: 'Act on me', type: 'error', sticky: true } });
      });
      rerender(<Toast />);
      act(() => {
        jest.advanceTimersByTime(60_000);
      });
      expect(useIDEStore.getState().toast?.message).toBe('Act on me');
      fireEvent.click(screen.getByRole('button', { name: /dismiss/i }));
      expect(useIDEStore.getState().toast).toBeNull();
    } finally {
      jest.useRealTimers();
    }
  });
});
