import { render, screen } from '@testing-library/react';
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

/** An anchor outside React's tree, with the box jsdom will never compute. */
const anchorAt = (left: number, top: number, bottom: number): HTMLElement => {
  const node = document.createElement('div');
  document.body.append(node);
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
  anchors.push(node);
  return node;
};

beforeEach(() => {
  for (const [key, descriptor] of native)
    Object.defineProperty(HTMLElement.prototype, key, { ...descriptor, get: () => OFFSETS[key] });
  for (const [key, value] of Object.entries({ innerWidth: 1024, innerHeight: 768 }))
    Object.defineProperty(window, key, { configurable: true, value });
});

afterEach(() => {
  for (const [key, descriptor] of native)
    Object.defineProperty(HTMLElement.prototype, key, descriptor);
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
    anchor.getBoundingClientRect = () =>
      ({
        x: 300,
        y: 240,
        left: 300,
        top: 240,
        right: 490,
        bottom: 300,
        width: 190,
        height: 60,
        toJSON: () => ({}),
      }) as DOMRect;
    rerender(<ModelCardPopup {...props} layoutKey="two" />);
    const pop = screen.getByRole('tooltip');
    expect(pop.style.left).toBe('300px');
    expect(pop.style.top).toBe('306px');
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
