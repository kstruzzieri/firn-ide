import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Terminal } from '../../components/Terminal';
import { useIDEStore } from '../../stores/ideStore';

const mockCreateTerminal = jest.fn();
const mockCloseTerminal = jest.fn();

jest.mock('../../../wailsjs/go/main/App', () => ({
  CreateTerminal: (...args: unknown[]) => mockCreateTerminal(...args),
  WriteTerminal: jest.fn(),
  CloseTerminal: (...args: unknown[]) => mockCloseTerminal(...args),
  ResizeTerminal: jest.fn(),
}));

jest.mock('../../../wailsjs/runtime', () => ({
  EventsOn: jest.fn(() => jest.fn()),
}));

describe('Terminal component', () => {
  beforeEach(() => {
    mockCreateTerminal.mockReset();
    mockCloseTerminal.mockReset();
    mockCloseTerminal.mockResolvedValue(undefined);
    mockCreateTerminal.mockResolvedValueOnce('term-1').mockResolvedValueOnce('term-2');
    useIDEStore.setState({
      activeTerminalTab: 'terminal',
      terminalSessions: [],
      activeTerminalSessionId: null,
      runOutputs: {},
      activeRunOutputId: null,
      toast: null,
    });
  });

  it('does not auto-create a session; the panel waits for an explicit +', () => {
    render(<Terminal />);

    // No PTY is spawned on mount — a shell only starts when the user asks.
    expect(mockCreateTerminal).not.toHaveBeenCalled();
    expect(screen.queryByText('Terminal 1')).not.toBeInTheDocument();
    expect(screen.getByLabelText('New terminal session')).toBeInTheDocument();
  });

  it('creates a session on demand, starting the shell in the loaded workspace root', async () => {
    useIDEStore.setState({
      workspace: { name: 'flux-ml', path: '/repo/flux-ml' } as ReturnType<
        typeof useIDEStore.getState
      >['workspace'],
    });

    render(<Terminal />);
    fireEvent.click(screen.getByLabelText('New terminal session'));

    expect(await screen.findByText('Terminal 1')).toBeInTheDocument();
    // The PTY must spawn in the workspace, not the app process's cwd (which
    // under wails dev is the firn checkout itself).
    expect(mockCreateTerminal).toHaveBeenCalledWith('/repo/flux-ml');
  });

  it('leaves the terminal panel empty after closing the last session and resets the next default title', async () => {
    render(<Terminal />);
    fireEvent.click(screen.getByLabelText('New terminal session'));

    expect(await screen.findByText('Terminal 1')).toBeInTheDocument();
    expect(mockCreateTerminal).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByLabelText('Close Terminal 1'));

    await waitFor(() => {
      expect(screen.queryByText('Terminal 1')).not.toBeInTheDocument();
    });
    expect(mockCloseTerminal).toHaveBeenCalledWith('term-1');
    expect(mockCreateTerminal).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText('New terminal session')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('New terminal session'));

    expect(await screen.findByText('Terminal 1')).toBeInTheDocument();
    expect(screen.queryByText('Terminal 2')).not.toBeInTheDocument();
    expect(mockCreateTerminal).toHaveBeenCalledTimes(2);
  });

  it('surfaces a failed spawn and lets the user retry with +', async () => {
    mockCreateTerminal.mockReset();
    mockCreateTerminal.mockRejectedValueOnce(new Error('pty unavailable'));
    mockCreateTerminal.mockResolvedValueOnce('term-1');

    render(<Terminal />);
    fireEvent.click(screen.getByLabelText('New terminal session'));

    await waitFor(() => {
      expect(useIDEStore.getState().toast?.message).toContain('pty unavailable');
    });
    expect(mockCreateTerminal).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByLabelText('New terminal session'));

    expect(await screen.findByText('Terminal 1')).toBeInTheDocument();
    expect(mockCreateTerminal).toHaveBeenCalledTimes(2);
  });
});
