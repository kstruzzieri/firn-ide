import { createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

  it('uses manual keyboard navigation within the panel tablist', () => {
    render(<Terminal />);

    const panelTabs = within(screen.getByRole('tablist', { name: 'Terminal panels' }));
    const output = panelTabs.getByRole('tab', { name: 'Output' });
    const problems = panelTabs.getByRole('tab', { name: 'Problems' });
    const terminal = panelTabs.getByRole('tab', { name: 'Terminal' });
    expect([output.tabIndex, problems.tabIndex, terminal.tabIndex]).toEqual([-1, -1, 0]);

    terminal.focus();
    fireEvent.keyDown(terminal, { key: 'ArrowLeft' });
    expect(problems).toHaveFocus();
    expect(useIDEStore.getState().activeTerminalTab).toBe('terminal');

    fireEvent.keyDown(problems, { key: 'Home' });
    expect(output).toHaveFocus();
    fireEvent.keyDown(output, { key: 'ArrowLeft' });
    expect(terminal).toHaveFocus();
    fireEvent.keyDown(terminal, { key: 'End' });
    expect(terminal).toHaveFocus();
  });

  it('associates every panel tab with the named Terminal panel', () => {
    render(<Terminal />);

    const tablist = screen.getByRole('tablist', { name: 'Terminal panels' });
    const tabs = within(tablist).getAllByRole('tab');
    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveAttribute('id', 'terminal-panel-content');
    for (const tab of tabs) expect(tab).toHaveAttribute('aria-controls', panel.id);
    expect(panel).toHaveAttribute(
      'aria-labelledby',
      within(tablist).getByRole('tab', { name: 'Terminal' }).id
    );
  });

  it('keeps session tabs in a separate manual-activation tablist', () => {
    useIDEStore.setState({
      terminalSessions: [
        { id: 'term-1', title: 'Terminal 1' },
        { id: 'term-2', title: 'Terminal 2' },
      ],
      activeTerminalSessionId: 'term-1',
    });

    render(<Terminal />);

    const sessionList = screen.getByRole('tablist', { name: 'Terminal sessions' });
    const terminalOne = within(sessionList).getByRole('tab', { name: /Terminal 1/ });
    const terminalTwo = within(sessionList).getByRole('tab', { name: /Terminal 2/ });
    expect([terminalOne.tabIndex, terminalTwo.tabIndex]).toEqual([0, -1]);

    terminalOne.focus();
    fireEvent.keyDown(terminalOne, { key: 'ArrowRight' });
    expect(terminalTwo).toHaveFocus();
    expect(useIDEStore.getState().activeTerminalSessionId).toBe('term-1');

    fireEvent.keyDown(terminalTwo, { key: 'Home' });
    expect(terminalOne).toHaveFocus();
    fireEvent.keyDown(terminalOne, { key: 'ArrowLeft' });
    expect(terminalTwo).toHaveFocus();
    fireEvent.keyDown(terminalTwo, { key: 'Enter' });
    expect(useIDEStore.getState().activeTerminalSessionId).toBe('term-2');
  });

  it('associates each session tab with its terminal panel', () => {
    useIDEStore.setState({
      terminalSessions: [
        { id: 'term-1', title: 'Terminal 1' },
        { id: 'term-2', title: 'Terminal 2' },
      ],
      activeTerminalSessionId: 'term-1',
    });

    render(<Terminal />);

    const sessionList = screen.getByRole('tablist', { name: 'Terminal sessions' });
    for (const tab of within(sessionList).getAllByRole('tab')) {
      const panel = document.getElementById(tab.getAttribute('aria-controls') ?? '');
      expect(panel).not.toBeNull();
      expect(panel).toHaveAttribute('role', 'tabpanel');
      expect(panel).toHaveAttribute('aria-labelledby', tab.id);
    }
  });

  it('keeps rename and close controls outside session-tab semantics', () => {
    useIDEStore.setState({
      terminalSessions: [{ id: 'term-1', title: 'Terminal 1' }],
      activeTerminalSessionId: 'term-1',
    });

    render(<Terminal />);

    const tab = within(screen.getByRole('tablist', { name: 'Terminal sessions' })).getByRole(
      'tab',
      { name: /Terminal 1/ }
    );
    const close = screen.getByRole('button', { name: 'Close Terminal 1' });
    expect(close.closest('[role="tab"]')).toBeNull();

    fireEvent.doubleClick(tab);
    expect(
      screen.getByRole('textbox', { name: 'Rename Terminal 1' }).closest('[role="tab"]')
    ).toBeNull();
  });

  it('keeps the entire visual session tab interactive', () => {
    useIDEStore.setState({
      terminalSessions: [
        { id: 'term-1', title: 'Terminal 1' },
        { id: 'term-2', title: 'Terminal 2' },
      ],
      activeTerminalSessionId: 'term-1',
    });

    render(<Terminal />);

    const tab = within(screen.getByRole('tablist', { name: 'Terminal sessions' })).getByRole(
      'tab',
      { name: /Terminal 2/ }
    );
    const visualTab = tab.parentElement as HTMLElement;

    fireEvent.click(visualTab);
    expect(useIDEStore.getState().activeTerminalSessionId).toBe('term-2');

    fireEvent.contextMenu(visualTab, { clientX: 10, clientY: 20 });
    const menu = screen.getByRole('menu', { name: 'Actions for Terminal 2' });
    fireEvent.keyDown(within(menu).getByRole('menuitem', { name: 'Rename' }), { key: 'Escape' });

    fireEvent.doubleClick(visualTab);
    expect(screen.getByRole('textbox', { name: 'Rename Terminal 2' })).toBeInTheDocument();
  });

  it('does not route a close-button context menu to the session tab', () => {
    useIDEStore.setState({
      terminalSessions: [{ id: 'term-1', title: 'Terminal 1' }],
      activeTerminalSessionId: 'term-1',
    });

    render(<Terminal />);

    const event = createEvent.contextMenu(screen.getByRole('button', { name: 'Close Terminal 1' }));
    fireEvent(screen.getByRole('button', { name: 'Close Terminal 1' }), event);

    expect(event.defaultPrevented).toBe(false);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });

  it('leaves rename inputs and close buttons in control of their own keys', async () => {
    useIDEStore.setState({
      terminalSessions: [{ id: 'term-1', title: 'Terminal 1' }],
      activeTerminalSessionId: 'term-1',
    });

    render(<Terminal />);

    const sessionList = screen.getByRole('tablist', { name: 'Terminal sessions' });
    const tab = within(sessionList).getByRole('tab', { name: /Terminal 1/ });
    const close = screen.getByRole('button', { name: 'Close Terminal 1' });
    const closeSpace = createEvent.keyDown(close, { key: ' ' });
    fireEvent(close, closeSpace);
    expect(closeSpace.defaultPrevented).toBe(false);

    fireEvent.doubleClick(tab);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Renamed session' } });
    fireEvent.doubleClick(input);
    expect(input).toHaveValue('Renamed session');

    const inputContextMenu = createEvent.contextMenu(input);
    fireEvent(input, inputContextMenu);
    expect(inputContextMenu.defaultPrevented).toBe(false);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();

    const inputSpace = createEvent.keyDown(input, { key: ' ' });
    fireEvent(input, inputSpace);
    expect(inputSpace.defaultPrevented).toBe(false);

    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(tab).toHaveFocus());
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(useIDEStore.getState().terminalSessions[0].title).toBe('Terminal 1');
  });

  it('returns focus to the session tab after committing a rename with Enter', async () => {
    useIDEStore.setState({
      terminalSessions: [{ id: 'term-1', title: 'Terminal 1' }],
      activeTerminalSessionId: 'term-1',
    });

    render(<Terminal />);

    const tab = within(screen.getByRole('tablist', { name: 'Terminal sessions' })).getByRole(
      'tab',
      { name: /Terminal 1/ }
    );
    fireEvent.doubleClick(tab);
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Committed session' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(useIDEStore.getState().terminalSessions[0].title).toBe('Committed session');
    await waitFor(() => expect(tab).toHaveFocus());
  });

  it.each([
    ['ContextMenu', false],
    ['F10', true],
  ])('opens an accessible session menu with %s', (key, shiftKey) => {
    useIDEStore.setState({
      terminalSessions: [{ id: 'term-1', title: 'Terminal 1' }],
      activeTerminalSessionId: 'term-1',
    });

    render(<Terminal />);

    const tab = within(screen.getByRole('tablist', { name: 'Terminal sessions' })).getByRole(
      'tab',
      { name: /Terminal 1/ }
    );
    expect(tab).toHaveAttribute('aria-haspopup', 'menu');
    expect(tab).toHaveAttribute('aria-expanded', 'false');

    tab.focus();
    fireEvent.keyDown(tab, { key, shiftKey });

    const menu = screen.getByRole('menu', { name: 'Actions for Terminal 1' });
    const rename = within(menu).getByRole('menuitem', { name: 'Rename' });
    const close = within(menu).getByRole('menuitem', { name: 'Close Terminal' });
    expect(tab).toHaveAttribute('aria-expanded', 'true');
    expect([rename.tabIndex, close.tabIndex]).toEqual([-1, -1]);
    expect(rename).toHaveFocus();

    fireEvent.keyDown(rename, { key: 'ArrowDown' });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: 'ArrowDown' });
    expect(rename).toHaveFocus();
    fireEvent.keyDown(rename, { key: 'ArrowUp' });
    expect(close).toHaveFocus();
    fireEvent.keyDown(close, { key: 'Home' });
    expect(rename).toHaveFocus();
    fireEvent.keyDown(rename, { key: 'End' });
    expect(close).toHaveFocus();

    fireEvent.keyDown(close, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(tab).toHaveFocus();
    expect(tab).toHaveAttribute('aria-expanded', 'false');
  });

  it.each([
    ['Tab', false],
    ['Shift+Tab', true],
  ])('dismisses the session menu while %s moves focus onward', async (_label, shift) => {
    const user = userEvent.setup();
    useIDEStore.setState({
      terminalSessions: [{ id: 'term-1', title: 'Terminal 1' }],
      activeTerminalSessionId: 'term-1',
    });

    render(<Terminal />);

    const tab = within(screen.getByRole('tablist', { name: 'Terminal sessions' })).getByRole(
      'tab',
      { name: /Terminal 1/ }
    );
    fireEvent.keyDown(tab, { key: 'ContextMenu' });
    const menu = screen.getByRole('menu');
    const rename = within(menu).getByRole('menuitem', { name: 'Rename' });
    expect(rename).toHaveFocus();

    await user.tab({ shift });

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(rename).not.toHaveFocus();
    const destination = shift
      ? screen.getByRole('tabpanel', { name: 'Terminal' })
      : within(screen.getByRole('tablist', { name: 'Terminal panels' })).getByRole('tab', {
          name: 'Terminal',
        });
    expect(destination).toHaveFocus();
  });

  it('does not steal focus when the session menu is dismissed with the pointer', async () => {
    const user = userEvent.setup();
    useIDEStore.setState({
      terminalSessions: [{ id: 'term-1', title: 'Terminal 1' }],
      activeTerminalSessionId: 'term-1',
    });

    render(<Terminal />);

    const tab = within(screen.getByRole('tablist', { name: 'Terminal sessions' })).getByRole(
      'tab',
      { name: /Terminal 1/ }
    );
    fireEvent.contextMenu(tab, { clientX: 10, clientY: 20 });
    const menu = screen.getByRole('menu');
    const overlay = menu.previousElementSibling as HTMLElement;
    const newSession = screen.getByRole('button', { name: 'New terminal session' });
    newSession.focus();

    await user.click(overlay);

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(newSession).toHaveFocus();
  });

  it('restores the invoking tab when overlay dismissal has no new focus destination', async () => {
    const user = userEvent.setup();
    useIDEStore.setState({
      terminalSessions: [{ id: 'term-1', title: 'Terminal 1' }],
      activeTerminalSessionId: 'term-1',
    });

    render(<Terminal />);

    const tab = within(screen.getByRole('tablist', { name: 'Terminal sessions' })).getByRole(
      'tab',
      { name: /Terminal 1/ }
    );
    fireEvent.contextMenu(tab, { clientX: 10, clientY: 20 });
    const menu = screen.getByRole('menu');
    expect(within(menu).getByRole('menuitem', { name: 'Rename' })).toHaveFocus();

    await user.click(menu.previousElementSibling as HTMLElement);

    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(tab).toHaveFocus();
  });

  it('restores focus after cancelling rename and closing sessions from the menu', async () => {
    useIDEStore.setState({
      terminalSessions: [
        { id: 'term-1', title: 'Terminal 1' },
        { id: 'term-2', title: 'Terminal 2' },
      ],
      activeTerminalSessionId: 'term-1',
    });

    render(<Terminal />);

    let sessionList = screen.getByRole('tablist', { name: 'Terminal sessions' });
    const first = within(sessionList).getByRole('tab', { name: /Terminal 1/ });
    fireEvent.keyDown(first, { key: 'F10', shiftKey: true });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Rename' }));
    const input = screen.getByRole('textbox');
    fireEvent.change(input, { target: { value: 'Discard me' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(first).toHaveFocus());
    expect(useIDEStore.getState().terminalSessions[0].title).toBe('Terminal 1');

    fireEvent.keyDown(first, { key: 'ContextMenu' });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close Terminal' }));
    await waitFor(() => {
      sessionList = screen.getByRole('tablist', { name: 'Terminal sessions' });
      expect(within(sessionList).getByRole('tab', { name: /Terminal 2/ })).toHaveFocus();
    });

    const second = within(sessionList).getByRole('tab', { name: /Terminal 2/ });
    fireEvent.keyDown(second, { key: 'ContextMenu' });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Close Terminal' }));
    await waitFor(() => {
      expect(screen.queryByRole('tablist', { name: 'Terminal sessions' })).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'New terminal session' })).toHaveFocus();
    });
  });
});
