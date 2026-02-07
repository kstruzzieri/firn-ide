import { render, screen } from '@testing-library/react';
import { Toast } from '../../../components/Toast';
import { useIDEStore } from '../../../stores/ideStore';

// Reset store between tests
beforeEach(() => {
  useIDEStore.setState({ toast: null });
});

describe('Toast', () => {
  it('should render nothing when no toast', () => {
    const { container } = render(<Toast />);
    expect(container.firstChild).toBeNull();
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
});
