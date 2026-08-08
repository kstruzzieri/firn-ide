/**
 * Task B8 — right-panel mode switcher.
 *
 * TDD: written before `components/layout/RightPanel.tsx` exists.
 *
 * The switcher is a real tab list, not a pair of toggle buttons: the two views
 * are alternative contents of one region, which is exactly what `tablist`
 * describes. Selection lives in `golemStore` because the panel unmounts
 * whenever the right panel collapses.
 */

import { act, fireEvent, render, screen } from '@testing-library/react';
import { RightPanel } from '../../components/layout/RightPanel';
import { __resetGolemStore, useGolemStore } from '../../stores/golemStore';
import { useIDEStore } from '../../stores/ideStore';

jest.mock('../../../wailsjs/go/main/App', () => ({
  StartRunProfile: jest.fn(() => Promise.resolve()),
  StopRunProfile: jest.fn(() => Promise.resolve()),
  RestartRunProfile: jest.fn(() => Promise.resolve()),
  RunGolemTurn: jest.fn(() => Promise.resolve()),
  CancelGolemRun: jest.fn(() => Promise.resolve()),
}));

beforeEach(() => {
  __resetGolemStore();
  useIDEStore.setState(useIDEStore.getInitialState());
});

const tabs = () => screen.getAllByRole('tab');
const golemTab = () => screen.getByRole('tab', { name: 'Golem' });
const runsTab = () => screen.getByRole('tab', { name: 'Runs' });

describe('RightPanel mode switcher', () => {
  it('starts in Runs mode, preserving the panel the workspace already had', () => {
    render(<RightPanel />);

    expect(runsTab()).toHaveAttribute('aria-selected', 'true');
    expect(golemTab()).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByText(/Run Profiles/)).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /message golem/i })).not.toBeInTheDocument();
  });

  it('mounts the Golem panel when Golem is selected and persists the choice in the store', () => {
    render(<RightPanel />);

    fireEvent.click(golemTab());

    expect(useGolemStore.getState().panelMode).toBe('golem');
    expect(golemTab()).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('textbox', { name: /message golem/i })).toBeInTheDocument();
    expect(screen.queryByText(/Run Profiles/)).not.toBeInTheDocument();
  });

  it('renders the mode the store already holds, so a remount restores it', () => {
    useGolemStore.setState({ panelMode: 'golem' });

    const { unmount } = render(<RightPanel />);
    expect(golemTab()).toHaveAttribute('aria-selected', 'true');
    unmount();

    render(<RightPanel />);
    expect(golemTab()).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('textbox', { name: /message golem/i })).toBeInTheDocument();
  });

  it('switches back to Runs, remounting the existing RunProfiles panel', () => {
    useGolemStore.setState({ panelMode: 'golem' });
    render(<RightPanel />);

    fireEvent.click(runsTab());

    expect(useGolemStore.getState().panelMode).toBe('runs');
    expect(screen.getByText(/Run Profiles/)).toBeInTheDocument();
  });

  it('exposes exactly one tabbable tab and moves the roving tabIndex with selection', () => {
    render(<RightPanel />);

    expect(golemTab()).toHaveAttribute('tabindex', '-1');
    expect(runsTab()).toHaveAttribute('tabindex', '0');

    fireEvent.click(golemTab());

    expect(golemTab()).toHaveAttribute('tabindex', '0');
    expect(runsTab()).toHaveAttribute('tabindex', '-1');
  });

  it('moves focus with ArrowRight/ArrowLeft/Home/End without changing the selection', () => {
    render(<RightPanel />);
    const [first, second] = tabs();
    act(() => second.focus());

    fireEvent.keyDown(second, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(first, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(second);

    fireEvent.keyDown(second, { key: 'Home' });
    expect(document.activeElement).toBe(first);

    fireEvent.keyDown(first, { key: 'End' });
    expect(document.activeElement).toBe(second);

    // Arrow keys move focus only; activation stays explicit.
    expect(useGolemStore.getState().panelMode).toBe('runs');
  });

  it('wraps arrow focus at both ends', () => {
    render(<RightPanel />);
    const [first, second] = tabs();
    act(() => first.focus());

    fireEvent.keyDown(first, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(second);

    fireEvent.keyDown(second, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(first);
  });

  it('names the tab list and wires each tab to the one panel region', () => {
    render(<RightPanel />);

    expect(screen.getByRole('tablist')).toHaveAccessibleName('Right panel view');
    const panel = screen.getByRole('tabpanel');
    expect(golemTab()).toHaveAttribute('aria-controls', panel.id);
    expect(runsTab()).toHaveAttribute('aria-controls', panel.id);
    expect(panel).toHaveAttribute('aria-labelledby', runsTab().id);
  });
});
