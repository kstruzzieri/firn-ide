import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';

import { pinnedScrollbar } from '../../../../components/Editor/codemirror/pinnedScrollbar';

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

  it('scrolls the pane with the proxy and the proxy with the pane', () => {
    const { proxy } = makeProxy();
    const v = mount(proxy, { scrollWidth: 1000, clientWidth: 400 });

    proxy.scrollLeft = 120;
    proxy.dispatchEvent(new Event('scroll'));
    expect(v.scrollDOM.scrollLeft).toBe(120);

    v.scrollDOM.scrollLeft = 300;
    v.scrollDOM.dispatchEvent(new Event('scroll'));
    expect(proxy.scrollLeft).toBe(300);
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
    v.scrollDOM.dispatchEvent(new Event('scroll'));
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
    v.scrollDOM.dispatchEvent(new Event('scroll'));

    // The user dragged the proxy, and a pane update (say, the viewport moving
    // with a vertical scroll) measures before the proxy's scroll event reaches
    // the pane.
    proxy.scrollLeft = 0;
    v.dispatch({ changes: { from: 0, insert: 'x' } });
    await nextFrame();
    proxy.dispatchEvent(new Event('scroll'));

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
    proxy.dispatchEvent(new Event('scroll'));
    expect(scroller.scrollLeft).toBe(0);
  });
});
