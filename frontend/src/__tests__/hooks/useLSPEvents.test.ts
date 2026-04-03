import { renderHook, act } from '@testing-library/react';
import { useLSPEvents } from '../../hooks/useLSPEvents';
import { useLSPStore } from '../../stores/lspStore';
import { useIDEStore } from '../../stores/ideStore';
import { EventsOn } from '../../../wailsjs/runtime/runtime';

const mockEventsOn = EventsOn as jest.MockedFunction<typeof EventsOn>;

function captureEventHandlers() {
  const handlers: Record<string, (...args: unknown[]) => void> = {};
  mockEventsOn.mockImplementation((event: string, callback: (...args: unknown[]) => void) => {
    handlers[event] = callback;
    return jest.fn(); // cancel function
  });
  return handlers;
}

beforeEach(() => {
  jest.clearAllMocks();
  useLSPStore.setState(useLSPStore.getInitialState());
  useIDEStore.setState({ toast: null } as Partial<ReturnType<typeof useIDEStore.getState>>);
});

describe('useLSPEvents', () => {
  it('subscribes to lsp:diagnostics, lsp:status, and lsp:error', () => {
    renderHook(() => useLSPEvents());

    const events = mockEventsOn.mock.calls.map((call) => call[0]);
    expect(events).toContain('lsp:diagnostics');
    expect(events).toContain('lsp:status');
    expect(events).toContain('lsp:error');
  });

  it('updates lspStore on lsp:diagnostics event', () => {
    const handlers = captureEventHandlers();
    renderHook(() => useLSPEvents());

    act(() => {
      handlers['lsp:diagnostics']({
        workspace: '/project',
        uri: 'file:///test.ts',
        diagnostics: [
          {
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
            severity: 1,
            message: 'Type error',
          },
        ],
      });
    });

    const diags = useLSPStore.getState().diagnostics.get('file:///test.ts');
    expect(diags).toHaveLength(1);
    expect(diags![0].message).toBe('Type error');
  });

  it('ignores lsp:diagnostics from a different workspace', () => {
    const handlers = captureEventHandlers();
    // Set active workspace
    useIDEStore.setState({
      workspace: { name: 'project', path: '/project' },
    } as Partial<ReturnType<typeof useIDEStore.getState>>);
    renderHook(() => useLSPEvents());

    act(() => {
      handlers['lsp:diagnostics']({
        workspace: '/other-project',
        uri: 'file:///other/test.ts',
        diagnostics: [
          {
            range: { start: { line: 0, character: 0 }, end: { line: 0, character: 5 } },
            severity: 1,
            message: 'Stale error',
          },
        ],
      });
    });

    expect(useLSPStore.getState().diagnostics.size).toBe(0);
  });

  it('updates lspStore on lsp:status event', () => {
    const handlers = captureEventHandlers();
    renderHook(() => useLSPEvents());

    act(() => {
      handlers['lsp:status']({
        family: 'typescript',
        workspace: '/project',
        state: 'ready',
      });
    });

    const status = useLSPStore.getState().serverStatuses.get('/project::typescript');
    expect(status?.state).toBe('ready');
  });

  it('shows Toast on lsp:status with state=error (e.g., missing server binary)', () => {
    const handlers = captureEventHandlers();
    renderHook(() => useLSPEvents());

    act(() => {
      handlers['lsp:status']({
        family: 'typescript',
        workspace: '/project',
        state: 'error',
        error:
          'typescript-language-server not found: install it with "npm install -g typescript-language-server typescript"',
      });
    });

    const toast = useIDEStore.getState().toast;
    expect(toast).not.toBeNull();
    expect(toast!.type).toBe('error');
    expect(toast!.message).toContain('typescript-language-server not found');
  });

  it('does not show Toast on non-error lsp:status events', () => {
    const handlers = captureEventHandlers();
    renderHook(() => useLSPEvents());

    act(() => {
      handlers['lsp:status']({
        family: 'typescript',
        workspace: '/project',
        state: 'ready',
      });
    });

    expect(useIDEStore.getState().toast).toBeNull();
  });

  it('does not show duplicate Toast for same error', () => {
    const handlers = captureEventHandlers();
    renderHook(() => useLSPEvents());

    // First error status — should set toast
    act(() => {
      handlers['lsp:status']({
        family: 'typescript',
        workspace: '/project',
        state: 'error',
        error: 'server crashed, restarting in 1s (attempt 1/5)',
      });
    });

    const firstToast = useIDEStore.getState().toast;
    expect(firstToast).not.toBeNull();

    // Clear the toast to detect if a second one is set
    useIDEStore.getState().clearToast();
    expect(useIDEStore.getState().toast).toBeNull();

    // Second error status for same workspace::family — should NOT set toast
    act(() => {
      handlers['lsp:status']({
        family: 'typescript',
        workspace: '/project',
        state: 'error',
        error: 'server crashed, restarting in 2s (attempt 2/5)',
      });
    });

    expect(useIDEStore.getState().toast).toBeNull();
  });

  it('shows Toast on lsp:error event (crash recovery exhausted)', () => {
    const handlers = captureEventHandlers();
    renderHook(() => useLSPEvents());

    act(() => {
      handlers['lsp:error']({
        family: 'typescript',
        workspace: '/project',
        message: 'Language server for typescript crashed repeatedly.',
      });
    });

    const toast = useIDEStore.getState().toast;
    expect(toast).not.toBeNull();
    expect(toast!.type).toBe('error');
    expect(toast!.message).toContain('crashed repeatedly');
  });

  it('cleans up subscriptions on unmount', () => {
    const cancelFns = [jest.fn(), jest.fn(), jest.fn()];
    let callIdx = 0;
    mockEventsOn.mockImplementation(() => cancelFns[callIdx++]);

    const { unmount } = renderHook(() => useLSPEvents());
    unmount();

    cancelFns.forEach((fn) => expect(fn).toHaveBeenCalled());
  });
});
