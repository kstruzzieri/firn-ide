import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

import {
  createScrollGroup,
  pinnedScrollbar,
} from '../../../../components/Editor/codemirror/pinnedScrollbar';

// jsdom has no layout: scrollWidth/clientWidth read 0. Stub the pane's and the
// proxy's sizes so the plugin sees a pane whose lines overflow it.
function setSize(el: HTMLElement, size: { scrollWidth?: number; clientWidth: number }) {
  Object.defineProperty(el, 'clientWidth', { configurable: true, value: size.clientWidth });
  if (size.scrollWidth !== undefined) {
    Object.defineProperty(el, 'scrollWidth', { configurable: true, value: size.scrollWidth });
  }
}

function makeProxy(): { proxy: HTMLDivElement; track: HTMLDivElement } {
  const proxy = document.createElement('div');
  const track = document.createElement('div');
  proxy.appendChild(track);
  document.body.appendChild(proxy);
  return { proxy, track };
}

// A browser clamps scrollLeft to the scroll range; jsdom does not. Model the
// proxy's range from its track so syncing before the track grows would fail.
function clampProxyScroll(proxy: HTMLElement, track: HTMLElement) {
  let left = 0;
  Object.defineProperty(proxy, 'scrollLeft', {
    configurable: true,
    get: () => left,
    set: (value: number) => {
      const width = Number.parseFloat(track.style.width) || proxy.clientWidth;
      left = Math.min(Math.max(0, value), Math.max(0, width - proxy.clientWidth));
    },
  });
}

// CodeMirror runs measure requests on the next animation frame.
const nextFrame = () => new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
// The element the user last scrolled stays the driver for two frames.
const settle = async () => {
  await nextFrame();
  await nextFrame();
  await nextFrame();
};
const scrolled = (el: HTMLElement) => el.dispatchEvent(new Event('scroll'));

describe('pinnedScrollbar (#448)', () => {
  let view: EditorView | null = null;

  afterEach(() => {
    view?.destroy();
    view = null;
    document.body.replaceChildren();
  });

  function mount(proxy: HTMLElement, pane: { scrollWidth: number; clientWidth: number }) {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    view = new EditorView({
      state: EditorState.create({ doc: 'a long line', extensions: [pinnedScrollbar(proxy)] }),
      parent,
    });
    setSize(view.scrollDOM, pane);
    return view;
  }

  it("gives the proxy the pane's scroll range", async () => {
    const { proxy, track } = makeProxy();
    // The proxy can be wider than the pane (it also spans the merge view's
    // vertical scrollbar); only the overflow must match.
    setSize(proxy, { clientWidth: 408 });
    const v = mount(proxy, { scrollWidth: 1000, clientWidth: 400 });
    v.requestMeasure();
    await nextFrame();

    expect(track.style.width).toBe('1008px');
  });

  it('drops the scroll range once the pane stops overflowing', async () => {
    const { proxy, track } = makeProxy();
    setSize(proxy, { clientWidth: 408 });
    const v = mount(proxy, { scrollWidth: 1000, clientWidth: 400 });
    v.requestMeasure();
    await nextFrame();
    expect(track.style.width).toBe('1008px');

    // The long line was deleted.
    setSize(v.scrollDOM, { scrollWidth: 400, clientWidth: 400 });
    v.dispatch({ changes: { from: 0, to: 1 } });
    await nextFrame();

    expect(track.style.width).toBe('');
  });

  it('re-measures when the document changes', async () => {
    const { proxy, track } = makeProxy();
    setSize(proxy, { clientWidth: 400 });
    const v = mount(proxy, { scrollWidth: 400, clientWidth: 400 });
    v.requestMeasure();
    await nextFrame();
    expect(track.style.width).toBe('');

    setSize(v.scrollDOM, { scrollWidth: 700, clientWidth: 400 });
    v.dispatch({ changes: { from: 0, insert: 'an even longer line ' } });
    await nextFrame();

    expect(track.style.width).toBe('700px');
  });

  it('scrolls the pane with the proxy and the proxy with the pane', async () => {
    const { proxy } = makeProxy();
    const v = mount(proxy, { scrollWidth: 1000, clientWidth: 400 });

    proxy.scrollLeft = 120;
    scrolled(proxy);
    expect(v.scrollDOM.scrollLeft).toBe(120);

    await settle();
    v.scrollDOM.scrollLeft = 300;
    scrolled(v.scrollDOM);
    expect(proxy.scrollLeft).toBe(300);
  });

  it('ignores a stale proxy event that lands after a newer pane scroll', () => {
    const { proxy } = makeProxy();
    const v = mount(proxy, { scrollWidth: 1000, clientWidth: 400 });

    // The pane scrolls; syncing the proxy queues the proxy's scroll event.
    v.scrollDOM.scrollLeft = 400;
    scrolled(v.scrollDOM);
    // Next frame the wheel has moved the pane on before that event fires.
    v.scrollDOM.scrollLeft = 450;
    scrolled(proxy);
    scrolled(v.scrollDOM);

    expect(v.scrollDOM.scrollLeft).toBe(450);
    expect(proxy.scrollLeft).toBe(450);
  });

  it('lets a proxy drag take over right after a wheel scroll on the pane', () => {
    const { proxy } = makeProxy();
    const v = mount(proxy, { scrollWidth: 1000, clientWidth: 400 });
    v.scrollDOM.dispatchEvent(new Event('wheel'));
    v.scrollDOM.scrollLeft = 400;
    scrolled(v.scrollDOM);

    proxy.dispatchEvent(new Event('pointerdown'));
    proxy.scrollLeft = 100;
    scrolled(proxy);

    expect(v.scrollDOM.scrollLeft).toBe(100);
  });

  it('moves the proxy to the pane when the track is resized', async () => {
    const { proxy, track } = makeProxy();
    setSize(proxy, { clientWidth: 400 });
    clampProxyScroll(proxy, track);
    const v = mount(proxy, { scrollWidth: 400, clientWidth: 400 });
    v.requestMeasure();
    await nextFrame();

    // Typing past the edge widens the line and scrolls the pane before the
    // track has grown, so the proxy cannot follow yet.
    setSize(v.scrollDOM, { scrollWidth: 1000, clientWidth: 400 });
    v.scrollDOM.scrollLeft = 500;
    scrolled(v.scrollDOM);
    expect(proxy.scrollLeft).toBe(0);

    v.dispatch({ changes: { from: 0, insert: 'x' } });
    await nextFrame();

    expect(track.style.width).toBe('1000px');
    expect(proxy.scrollLeft).toBe(500);
  });

  it('leaves a proxy move alone when a measure finds the same width', async () => {
    const { proxy } = makeProxy();
    setSize(proxy, { clientWidth: 400 });
    const v = mount(proxy, { scrollWidth: 1000, clientWidth: 400 });
    v.requestMeasure();
    await nextFrame();
    v.scrollDOM.scrollLeft = 500;
    scrolled(v.scrollDOM);
    await settle();

    // The user dragged the proxy, and a pane update (say, the viewport moving
    // with a vertical scroll) measures before the proxy's scroll event reaches
    // the pane.
    proxy.scrollLeft = 0;
    v.dispatch({ changes: { from: 0, insert: 'x' } });
    await nextFrame();
    scrolled(proxy);

    expect(proxy.scrollLeft).toBe(0);
    expect(v.scrollDOM.scrollLeft).toBe(0);
  });

  it('re-measures when the pane or the proxy is resized', async () => {
    // CodeMirror reports no geometry change when an overflowing pane narrows
    // (its content stays as wide as the longest line), so the plugin watches
    // both sizes itself. Record the observers to drive and inspect them.
    type FakeObserver = { callback: () => void; targets: Element[]; disconnected: boolean };
    const observers: FakeObserver[] = [];
    const original = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      targets: Element[] = [];
      disconnected = false;
      constructor(public callback: () => void) {
        observers.push(this);
      }
      observe(target: Element) {
        this.targets.push(target);
      }
      unobserve() {}
      disconnect() {
        this.disconnected = true;
      }
    } as unknown as typeof ResizeObserver;
    try {
      const { proxy, track } = makeProxy();
      setSize(proxy, { clientWidth: 400 });
      const v = mount(proxy, { scrollWidth: 1000, clientWidth: 400 });
      v.requestMeasure();
      await nextFrame();
      expect(track.style.width).toBe('1000px');
      const ours = observers.find((o) => o.targets.includes(proxy));
      expect(ours?.targets).toContain(v.scrollDOM);

      // A divider drag narrows the pane and its proxy by slightly different
      // amounts (the proxy also spans the merge view's vertical scrollbar).
      setSize(v.scrollDOM, { scrollWidth: 1000, clientWidth: 300 });
      setSize(proxy, { clientWidth: 303 });
      ours!.callback();
      await nextFrame();
      expect(track.style.width).toBe('1003px');

      v.destroy();
      view = null;
      expect(ours!.disconnected).toBe(true);
    } finally {
      globalThis.ResizeObserver = original;
    }
  });

  it('unlinks the proxy when the pane is destroyed', async () => {
    const { proxy, track } = makeProxy();
    setSize(proxy, { clientWidth: 400 });
    const v = mount(proxy, { scrollWidth: 1000, clientWidth: 400 });
    v.requestMeasure();
    await nextFrame();
    const scroller = v.scrollDOM;

    v.destroy();
    view = null;

    expect(track.style.width).toBe('');
    proxy.scrollLeft = 50;
    scrolled(proxy);
    expect(scroller.scrollLeft).toBe(0);
  });
});

describe('pinnedScrollbar scroll group (#448)', () => {
  const views: EditorView[] = [];

  // Frames run by hand, as a browser runs them: a frame's scroll events are
  // dispatched first, then the animation-frame callbacks queued before the
  // batch starts. A callback queued while the batch runs waits for the next
  // frame. CodeMirror's measure requests share the same queue.
  let queue: FrameRequestCallback[] = [];
  const realRaf = window.requestAnimationFrame;
  const realCancel = window.cancelAnimationFrame;
  const runFrame = () => {
    const batch = queue;
    queue = [];
    batch.forEach((callback) => callback(performance.now()));
  };

  beforeEach(() => {
    queue = [];
    window.requestAnimationFrame = (callback) => queue.push(callback);
    window.cancelAnimationFrame = () => {};
  });

  afterEach(() => {
    views.splice(0).forEach((v) => v.destroy());
    document.body.replaceChildren();
    window.requestAnimationFrame = realRaf;
    window.cancelAnimationFrame = realCancel;
  });

  // A browser clamps scrollLeft to the element's range; jsdom does not.
  function clampScroll(el: HTMLElement, max: () => number) {
    let left = 0;
    Object.defineProperty(el, 'scrollLeft', {
      configurable: true,
      get: () => left,
      set: (value: number) => {
        left = Math.min(Math.max(0, value), max());
      },
    });
  }

  // Two panes sharing one group, as the diff's INDEX and WORKING TREE do. The
  // right pane's content is narrower: it and its proxy can scroll only 600px.
  // `max` holds each element's range, so a test can grow one.
  function mountPair() {
    const group = createScrollGroup();
    const max = { a: 1200, leftProxy: 1200, b: 600, rightProxy: 600 };
    const pane = (proxy: HTMLElement, side: 'a' | 'b') => {
      clampScroll(proxy, () => (side === 'a' ? max.leftProxy : max.rightProxy));
      const parent = document.createElement('div');
      document.body.appendChild(parent);
      const v = new EditorView({
        state: EditorState.create({
          doc: 'a long line',
          extensions: [pinnedScrollbar(proxy, group)],
        }),
        parent,
      });
      clampScroll(v.scrollDOM, () => max[side]);
      views.push(v);
      return v;
    };
    const left = makeProxy().proxy;
    const right = makeProxy().proxy;
    const a = pane(left, 'a');
    const b = pane(right, 'b');
    runFrame(); // the panes' first measure
    return { group, max, a, b, leftProxy: left, rightProxy: right };
  }

  // An element moves (by a swipe, a bar drag, the cursor or F7) and its scroll
  // event fires.
  const userScroll = (el: HTMLElement, left: number) => {
    el.scrollLeft = left;
    scrolled(el);
  };

  it('scrolls the other pane and both proxies with the pane the user moved', () => {
    const { a, b, leftProxy, rightProxy } = mountPair();

    userScroll(a.scrollDOM, 400.5);

    expect(b.scrollDOM.scrollLeft).toBe(400.5);
    expect(leftProxy.scrollLeft).toBe(400.5);
    expect(rightProxy.scrollLeft).toBe(400.5);
  });

  it("ignores its own writes' scroll events, however late they land", () => {
    const { a, b, leftProxy, rightProxy } = mountPair();

    userScroll(a.scrollDOM, 1000);
    expect(b.scrollDOM.scrollLeft).toBe(600);
    runFrame();
    // Next frame: the writes' scroll events.
    scrolled(leftProxy);
    scrolled(b.scrollDOM);
    scrolled(rightProxy);
    runFrame();
    runFrame();
    // Several frames on, an engine delivers one again.
    scrolled(b.scrollDOM);

    expect(a.scrollDOM.scrollLeft).toBe(1000);
    expect(leftProxy.scrollLeft).toBe(1000);
  });

  it('ignores input on the narrower pane that does not move it before its echo lands', () => {
    const { a, b } = mountPair();
    userScroll(a.scrollDOM, 1000);

    // A vertical wheel or a click to place the cursor on the right pane.
    b.scrollDOM.dispatchEvent(new Event('wheel'));
    b.scrollDOM.dispatchEvent(new Event('pointerdown'));
    runFrame();
    scrolled(b.scrollDOM);

    expect(a.scrollDOM.scrollLeft).toBe(1000);
  });

  it('lets a pending move on the other pane land, so the last move wins', () => {
    const { a, b, leftProxy, rightProxy } = mountPair();
    userScroll(a.scrollDOM, 400);
    runFrame();
    scrolled(b.scrollDOM);
    scrolled(leftProxy);
    scrolled(rightProxy);

    // In one frame the user swipes the left pane on and F7 takes the right
    // pane back to the start; the browser then dispatches both, swipe first.
    a.scrollDOM.scrollLeft = 500;
    b.scrollDOM.scrollLeft = 0;
    scrolled(a.scrollDOM);
    scrolled(b.scrollDOM);
    runFrame();

    expect(a.scrollDOM.scrollLeft).toBe(0);
    expect(b.scrollDOM.scrollLeft).toBe(0);
    expect(leftProxy.scrollLeft).toBe(0);
    expect(rightProxy.scrollLeft).toBe(0);
  });

  it('follows a sub-pixel move off a recorded offset', () => {
    const { a, b } = mountPair();
    userScroll(a.scrollDOM, 1000);

    userScroll(b.scrollDOM, 599.5);

    expect(a.scrollDOM.scrollLeft).toBe(599.5);
  });

  it('treats a move that returns to the same offset before its event as no move', () => {
    const { a, b } = mountPair();
    userScroll(a.scrollDOM, 1000);

    // The browser coalesces scroll events per element: one event, net zero.
    b.scrollDOM.scrollLeft = 500;
    b.scrollDOM.scrollLeft = 600;
    scrolled(b.scrollDOM);

    expect(a.scrollDOM.scrollLeft).toBe(1000);
    expect(b.scrollDOM.scrollLeft).toBe(600);
  });

  it('moves a clamped pane on when it and its proxy narrow alike (same track width)', () => {
    const { max, a, b, rightProxy } = mountPair();
    setSize(b.scrollDOM, { scrollWidth: 1000, clientWidth: 400 });
    setSize(rightProxy, { clientWidth: 400 });
    b.dispatch({ changes: { from: 0, insert: 'x' } });
    runFrame();
    userScroll(a.scrollDOM, 1000);
    runFrame();
    scrolled(b.scrollDOM);
    scrolled(rightProxy);
    expect(b.scrollDOM.scrollLeft).toBe(600);

    // The divider narrows the right pane and its proxy by the same 200px: the
    // range grows to 800 while the track keeps its 1000px width.
    max.b = 800;
    max.rightProxy = 800;
    setSize(b.scrollDOM, { scrollWidth: 1000, clientWidth: 200 });
    setSize(rightProxy, { clientWidth: 200 });
    b.dispatch({ changes: { from: 0, insert: 'x' } });
    runFrame();

    expect(b.scrollDOM.scrollLeft).toBe(800);
    expect(rightProxy.scrollLeft).toBe(800);
    expect(a.scrollDOM.scrollLeft).toBe(1000);
  });

  it('moves a clamped pane on to the shared offset when its range grows', () => {
    const { max, a, b, rightProxy } = mountPair();
    userScroll(a.scrollDOM, 1000);
    runFrame();
    scrolled(b.scrollDOM);
    scrolled(rightProxy);
    expect(b.scrollDOM.scrollLeft).toBe(600);

    // The right pane's lines grow (an edit, or the divider narrows it).
    max.b = 1200;
    max.rightProxy = 1200;
    setSize(b.scrollDOM, { scrollWidth: 1600, clientWidth: 400 });
    setSize(rightProxy, { clientWidth: 400 });
    b.dispatch({ changes: { from: 0, insert: 'x' } });
    runFrame();
    scrolled(b.scrollDOM);
    scrolled(rightProxy);

    expect(b.scrollDOM.scrollLeft).toBe(1000);
    expect(rightProxy.scrollLeft).toBe(1000);
    expect(a.scrollDOM.scrollLeft).toBe(1000);
  });

  it('follows the other pane the moment it moves, before the first sync lands', () => {
    const { a, b, leftProxy, rightProxy } = mountPair();
    userScroll(a.scrollDOM, 400);

    userScroll(b.scrollDOM, 300);
    runFrame();
    runFrame();

    expect(a.scrollDOM.scrollLeft).toBe(300);
    expect(leftProxy.scrollLeft).toBe(300);
    expect(rightProxy.scrollLeft).toBe(300);
  });

  it('follows the user back to a previously synced offset', () => {
    const { a, b } = mountPair();
    userScroll(a.scrollDOM, 1000);
    runFrame();
    scrolled(b.scrollDOM);
    runFrame();

    userScroll(b.scrollDOM, 500);
    expect(a.scrollDOM.scrollLeft).toBe(500);
    runFrame();
    scrolled(a.scrollDOM);
    runFrame();

    // Back to the offset the right pane was given at the start.
    userScroll(b.scrollDOM, 600);
    expect(a.scrollDOM.scrollLeft).toBe(600);
  });

  it('scrolls both panes from a proxy drag', () => {
    const { a, b, rightProxy } = mountPair();

    userScroll(rightProxy, 300);

    expect(a.scrollDOM.scrollLeft).toBe(300);
    expect(b.scrollDOM.scrollLeft).toBe(300);
  });

  it('follows a pane that F7 or the cursor scrolls, with no input on it, mid-scroll', () => {
    const { a, b, leftProxy, rightProxy } = mountPair();
    userScroll(leftProxy, 400);
    runFrame();

    // Toolbar navigation scrolls the right pane in a measure callback; its
    // scroll event lands next frame, before the left proxy's writes settle.
    b.scrollDOM.scrollLeft = 0;
    scrolled(a.scrollDOM);
    scrolled(b.scrollDOM);
    runFrame();

    expect(a.scrollDOM.scrollLeft).toBe(0);
    expect(leftProxy.scrollLeft).toBe(0);
    expect(rightProxy.scrollLeft).toBe(0);
  });

  it('ignores a track re-sync whose scroll event lands the next frame', () => {
    const { max, a, b, rightProxy } = mountPair();
    // The right pane's content has grown to 1000px of overflow, but its
    // proxy's track has not been resized yet.
    max.b = 1000;
    userScroll(a.scrollDOM, 1200);
    expect(b.scrollDOM.scrollLeft).toBe(1000);
    expect(rightProxy.scrollLeft).toBe(600);

    // The track catches up while the left pane's sync is still landing; the
    // re-sync moves the proxy to its pane.
    max.rightProxy = 1000;
    setSize(b.scrollDOM, { scrollWidth: 1400, clientWidth: 400 });
    setSize(rightProxy, { clientWidth: 400 });
    b.dispatch({ changes: { from: 0, insert: 'x' } });
    runFrame();
    expect(rightProxy.scrollLeft).toBe(1000);
    scrolled(rightProxy);
    runFrame();

    expect(a.scrollDOM.scrollLeft).toBe(1200);
  });

  it('ignores a track re-sync whose scroll event lands after the panes settled', () => {
    const { max, a, b, rightProxy } = mountPair();
    max.b = 1000;
    userScroll(a.scrollDOM, 1200);
    runFrame();
    scrolled(b.scrollDOM);
    scrolled(rightProxy);
    runFrame();

    max.rightProxy = 1000;
    setSize(b.scrollDOM, { scrollWidth: 1400, clientWidth: 400 });
    setSize(rightProxy, { clientWidth: 400 });
    b.dispatch({ changes: { from: 0, insert: 'x' } });
    runFrame();
    expect(rightProxy.scrollLeft).toBe(1000);
    scrolled(rightProxy);

    expect(a.scrollDOM.scrollLeft).toBe(1200);
  });

  it('leaves the group when a pane is destroyed', () => {
    const { group, a, b, rightProxy } = mountPair();
    expect(group.landed.size).toBe(4);
    userScroll(b.scrollDOM, 100);

    b.destroy();
    views.splice(views.indexOf(b), 1);

    expect(group.landed.size).toBe(2);
    a.scrollDOM.scrollLeft = 200;
    scrolled(a.scrollDOM);
    expect(b.scrollDOM.scrollLeft).toBe(100);
    expect(rightProxy.scrollLeft).toBe(100);
  });
});
