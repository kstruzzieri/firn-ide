import { XTERM_OPTIONS } from './xtermConfig';

describe('XTERM_OPTIONS', () => {
  it('enables proposed API so shell-integration decorations cannot wedge the terminal', () => {
    // registerDecoration is proposed API in @xterm/xterm 6: without this flag
    // it throws inside the OSC 133 handler, which permanently stalls xterm's
    // write loop after the first command completes. The real parser cannot be
    // exercised under jsdom (term.parser is undefined even after open()), so
    // this pins the flag directly.
    expect(XTERM_OPTIONS.allowProposedApi).toBe(true);
  });
});
