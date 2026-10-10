import type { Terminal as XTerm } from '@xterm/xterm';
import { useIDEStore } from '../../stores/ideStore';
import { EventsOn } from '../../wails/runtime';

jest.unmock('@xterm/xterm');
jest.unmock('@xterm/addon-fit');
jest.mock('../../wails/bindings', () => ({
  WriteTerminal: jest.fn().mockResolvedValue(undefined),
  ResizeTerminal: jest.fn().mockResolvedValue(undefined),
}));

afterEach(() => {
  useIDEStore.setState({ terminalSessions: [], activeTerminalSessionId: null });
  document.body.replaceChildren();
  jest.restoreAllMocks();
});

it('preserves real scrollback, viewport and OSC markers while detached, until session close', async () => {
  // xterm probes canvas at import; jsdom supports only its DOM rendering fallback.
  jest.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(null);
  const { Terminal } = await import('@xterm/xterm');
  const { acquireTerminal, ensureGlobalOutputListener } = await import('./terminalRegistry');
  // jsdom has no font geometry; the container still measures 0x0, so fitting is skipped.
  jest.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(256);
  jest.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(16);
  const open = jest.spyOn(Terminal.prototype, 'open');
  const sessionId = 'retained-real-xterm';
  useIDEStore.getState().addTerminalSession({ id: sessionId, title: 'Terminal 1' });
  ensureGlobalOutputListener();
  const registration = jest
    .mocked(EventsOn)
    .mock.calls.find(([event]) => event === 'terminal:output');
  if (!registration) throw new Error('terminal:output listener not registered');
  const output = registration[1] as (evt: { termId: string; data: string }) => void;
  const firstContainer = document.createElement('div');
  document.body.appendChild(firstContainer);
  acquireTerminal(sessionId, firstContainer);
  const term = open.mock.contexts[0] as XTerm;
  const buffer = term.buffer.active;
  const element = term.element!;
  const flush = () => new Promise<void>((resolve) => term.write('', resolve));

  output({
    termId: sessionId,
    data:
      '\x1b]133;A\x07before collapse\x1b]133;C\x07\x1b]133;D;0\x07\r\n' +
      Array.from({ length: 40 }, (_, i) => `line ${i}\r\n`).join(''),
  });
  await flush();
  expect(buffer.getLine(0)?.translateToString(true)).toBe('before collapse');
  expect(buffer.baseY).toBeGreaterThan(0);
  const firstMarker = term.markers[0];
  expect(firstMarker).toBeDefined();
  term.scrollToLine(5);
  expect(buffer.viewportY).toBe(5);

  firstContainer.remove();
  output({
    termId: sessionId,
    data: '\x1b]133;A\x07during collapse\x1b]133;C\x07\x1b]133;D;1\x07\r\n',
  });
  await flush();
  expect(buffer.getLine(41)?.translateToString(true)).toBe('during collapse');
  expect(buffer.viewportY).toBe(5);
  const secondMarker = term.markers[1];
  expect(secondMarker).toBeDefined();
  expect(secondMarker.line).toBe(41);

  const nextContainer = document.createElement('div');
  document.body.appendChild(nextContainer);
  acquireTerminal(sessionId, nextContainer);
  expect(open).toHaveBeenCalledTimes(1);
  expect(nextContainer).toContainElement(element);
  expect(term.buffer.active).toBe(buffer);
  expect(buffer.getLine(0)?.translateToString(true)).toBe('before collapse');
  expect(buffer.getLine(41)?.translateToString(true)).toBe('during collapse');
  expect(buffer.viewportY).toBe(5);
  expect(term.markers).toEqual([firstMarker, secondMarker]);
  expect(firstMarker.isDisposed).toBe(false);

  useIDEStore.getState().removeTerminalSession(sessionId);
  expect(firstMarker.isDisposed).toBe(true);
  expect(secondMarker.isDisposed).toBe(true);
  expect(element.isConnected).toBe(false);
  expect(nextContainer).toBeEmptyDOMElement();
});
