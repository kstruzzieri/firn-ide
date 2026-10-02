import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ModelCardPopup, type CardInfo } from '../../../components/GolemConfig/ModelCardPopup';

const info = (over: Partial<CardInfo> = {}): CardInfo => ({
  name: 'gemma4:31b',
  type: 'Dense',
  facts: '31B parameters · 256000-token context',
  abilities: 'chat stream',
  notes: [{ role: 'agent', description: 'Agent / tool-use.' }],
  usedBy: ['agent', 'chat'],
  ...over,
});

// jsdom implements no layout: every offset reads 0, so a popup would never flip
// above an anchor or clamp against the right edge. These are the two numbers the
// placement arithmetic needs.
const OFFSETS = { offsetWidth: 300, offsetHeight: 200 };
const native = (Object.keys(OFFSETS) as (keyof typeof OFFSETS)[]).map(
  (key) => [key, Object.getOwnPropertyDescriptor(HTMLElement.prototype, key)!] as const
);

const anchors: HTMLElement[] = [];

/** The box jsdom will never compute. */
const mockRect = (node: HTMLElement, left: number, top: number, bottom: number) => {
  node.getBoundingClientRect = () =>
    ({
      x: left,
      y: top,
      left,
      top,
      right: left + 190,
      bottom,
      width: 190,
      height: bottom - top,
      toJSON: () => ({}),
    }) as DOMRect;
};

/** An anchor outside React's tree, optionally inside its own scroller. */
const anchorAt = (left: number, top: number, bottom: number, host?: HTMLElement): HTMLElement => {
  const node = document.createElement('div');
  (host ?? document.body).append(node);
  mockRect(node, left, top, bottom);
  anchors.push(host ?? node);
  return node;
};

const VIEWPORT = { innerWidth: 1024, innerHeight: 768 } as const;
const nativeViewport = (Object.keys(VIEWPORT) as (keyof typeof VIEWPORT)[]).map(
  (key) => [key, Object.getOwnPropertyDescriptor(window, key)!] as const
);

beforeEach(() => {
  for (const [key, descriptor] of native)
    Object.defineProperty(HTMLElement.prototype, key, { ...descriptor, get: () => OFFSETS[key] });
  for (const [key, descriptor] of nativeViewport)
    Object.defineProperty(window, key, { ...descriptor, value: VIEWPORT[key] });
});

afterEach(() => {
  for (const [key, descriptor] of native)
    Object.defineProperty(HTMLElement.prototype, key, descriptor);
  // The viewport is global too: 1024x768 left behind would silently seed every
  // later suite in this worker.
  for (const [key, descriptor] of nativeViewport) Object.defineProperty(window, key, descriptor);
  for (const node of anchors.splice(0)) node.remove();
});

const renderPopup = (over: Partial<Parameters<typeof ModelCardPopup>[0]> = {}) => {
  const onEnter = jest.fn();
  const onLeave = jest.fn();
  const props = {
    id: 'band-card-pop',
    open: true,
    anchor: anchorAt(40, 40, 100),
    info: info(),
    layoutKey: 'one',
    onEnter,
    onLeave,
    ...over,
  };
  const view = render(<ModelCardPopup {...props} />);
  return { ...view, onEnter, onLeave, props };
};

describe('ModelCardPopup', () => {
  it('renders nothing while closed', () => {
    const { container } = renderPopup({ open: false });
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('hangs off the body, so no ancestor can clip it', () => {
    // `.root` is a query container with `overflow: auto`: WebKit before 18.2
    // (bug 284945) treats it as the containing block for a fixed child, and
    // Firn's macOS floor ships Safari 17.6. The portal is what keeps the popup
    // out of that subtree — and out of the grid's own scroller everywhere else.
    const { container } = renderPopup();
    const pop = screen.getByRole('tooltip');
    expect(container).not.toContainElement(pop);
    expect(pop.parentElement).toBe(document.body);
  });

  it('reads every row of the card out in full', () => {
    renderPopup();
    const pop = screen.getByRole('tooltip');
    expect(pop).toHaveAttribute('id', 'band-card-pop');
    expect(pop.textContent).toBe(
      'gemma4:31btypeDensesize31B parameters · 256000-token contextcan dochat streamnoteAgent / tool-use.used byagent, chat'
    );
  });

  it('names several notes by their roles and never prints an empty row', () => {
    renderPopup({
      info: info({
        facts: '',
        notes: [
          { role: 'agent', description: 'Agent / tool-use.' },
          { role: 'general', description: 'Dense reasoning.' },
        ],
        usedBy: [],
      }),
    });
    const pop = screen.getByRole('tooltip');
    // No size row at all for a model with no numbers — never a dash.
    expect(pop.textContent).toBe(
      'gemma4:31btypeDensecan dochat streamnotesagentAgent / tool-use.generalDense reasoning.used by—'
    );
  });

  it('places itself under the anchor, clamped to the left gutter', () => {
    renderPopup({ anchor: anchorAt(-50, 40, 100) });
    const pop = screen.getByRole('tooltip');
    expect(pop.style.left).toBe('16px');
    expect(pop.style.top).toBe('106px');
  });

  it('keeps itself inside the right edge', () => {
    // 1024 − 300 wide − 16 gutter: a card near the right edge pulls it back.
    renderPopup({ anchor: anchorAt(900, 40, 100) });
    expect(screen.getByRole('tooltip').style.left).toBe('708px');
  });

  it('flips above an anchor too close to the bottom of the viewport', () => {
    // 700 + 6 + 200 > 768 − 8, so the popup goes above: 640 − 200 − 6.
    renderPopup({ anchor: anchorAt(40, 640, 700) });
    expect(screen.getByRole('tooltip').style.top).toBe('434px');
  });

  it('never leaves the top of the viewport when neither side fits', () => {
    renderPopup({ anchor: anchorAt(40, 100, 760) });
    expect(screen.getByRole('tooltip').style.top).toBe('8px');
  });

  it('re-places on a new layoutKey alone, with no scroll or resize event', () => {
    const anchor = anchorAt(40, 40, 100);
    const { rerender, props } = renderPopup({ anchor });
    expect(screen.getByRole('tooltip').style.left).toBe('40px');

    // The grid moved the anchor: same node, same info, new key.
    mockRect(anchor, 300, 240, 300);
    rerender(<ModelCardPopup {...props} layoutKey="two" />);
    const pop = screen.getByRole('tooltip');
    expect(pop.style.left).toBe('300px');
    expect(pop.style.top).toBe('306px');
  });

  it('re-places when the window resizes', () => {
    const anchor = anchorAt(40, 40, 100);
    renderPopup({ anchor });
    expect(screen.getByRole('tooltip').style.left).toBe('40px');

    mockRect(anchor, 300, 240, 300);
    fireEvent(window, new Event('resize'));
    const pop = screen.getByRole('tooltip');
    expect(pop.style.left).toBe('300px');
    expect(pop.style.top).toBe('306px');
  });

  it('re-places on an ancestor scroll that does not bubble', () => {
    // A scroller's own `scroll` event does not bubble, so only a CAPTURE
    // listener on window hears it — this is what the `true` third argument
    // buys, and a bubble-phase listener would leave the popup behind.
    const scroller = document.createElement('div');
    document.body.append(scroller);
    const anchor = anchorAt(40, 40, 100, scroller);
    renderPopup({ anchor });
    expect(screen.getByRole('tooltip').style.top).toBe('106px');

    mockRect(anchor, 40, 180, 240);
    fireEvent(scroller, new Event('scroll', { bubbles: false }));
    expect(screen.getByRole('tooltip').style.top).toBe('246px');
  });

  it('tells its owner when the pointer arrives and leaves, so it can hold itself open', async () => {
    const { onEnter, onLeave } = renderPopup();
    const pop = screen.getByRole('tooltip');
    await userEvent.hover(pop);
    expect(onEnter).toHaveBeenCalledTimes(1);
    expect(onLeave).not.toHaveBeenCalled();
    await userEvent.unhover(pop);
    expect(onLeave).toHaveBeenCalledTimes(1);
  });
});
