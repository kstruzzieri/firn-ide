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
    mockCreateTerminal.mockResolvedValueOnce('term-1').mockResolvedValueOnce('term-2');
    useIDEStore.setState({
      activeTerminalTab: 'terminal',
      terminalSessions: [],
      activeTerminalSessionId: null,
      hasAutoCreatedInitialTerminalSession: false,
      runOutputs: {},
      activeRunOutputId: null,
    });
  });

  it('leaves the terminal panel empty after closing the last session and resets the next default title', async () => {
    render(<Terminal />);

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
});
