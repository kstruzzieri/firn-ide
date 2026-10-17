/**
 * Horizontal scrollbar pinned under a diff pane (issue #448).
 *
 * In the merge view each pane grows to its document's full height and only
 * `.cm-mergeView` scrolls vertically, so a pane's own horizontal scrollbar sits
 * below its last line, out of sight on any file taller than the view. Wrapping
 * is no fix (see GitDiffView: wrapped lines throw the panes out of alignment).
 * Instead `proxy`, a scroll container rendered under the merge view with one
 * child (the track), mirrors the pane: the track is sized so the proxy scrolls
 * exactly as far as the pane does, and the two scroll together. A pane that
 * does not overflow leaves the track at its natural width, so the browser
 * draws no bar.
 *
 * Panes sharing a `group` also scroll sideways together, by offset: a
 * narrower pane stops at its end.
 */
import { ViewPlugin, type ViewUpdate } from '@codemirror/view';

/**
 * Scroll containers that move sideways together (each pane and its proxy).
 * `landed` holds the offset each one was last left at, read back after the
 * write; `target` is the offset the last real move asked for.
 *
 * A scroll event at an element's landed offset is a sync arriving, or nothing
 * new, and is ignored. Any other offset is a real move, whatever caused it (a
 * swipe, a bar drag, the cursor, F7), and the other elements follow it. An
 * element that has moved on from its landed offset has a move of its own still
 * to report, so a sync leaves it alone and its event decides: the last move
 * wins. Deciding from live offsets rather than from which element scrolled
 * first keeps this right however late, or out of order, the browser dispatches
 * a frame's scroll events. Moves are net: one that returns an element to its
 * landed offset before its event fires is no move.
 */
export type ScrollGroup = { landed: Map<HTMLElement, number>; target: number };

export function createScrollGroup(): ScrollGroup {
  return { landed: new Map(), target: 0 };
}

function follow(group: ScrollGroup, source: HTMLElement) {
  const left = source.scrollLeft;
  if (group.landed.get(source) === left) return;
  group.target = left;
  group.landed.set(source, left);
  for (const [el, landed] of group.landed) {
    if (el === source || el.scrollLeft !== landed) continue;
    el.scrollLeft = left;
    // Keep the offset it actually took: a narrower pane stops at its end.
    group.landed.set(el, el.scrollLeft);
  }
}

export function pinnedScrollbar(proxy: HTMLElement, group: ScrollGroup = createScrollGroup()) {
  return ViewPlugin.define((view) => {
    const scroller = view.scrollDOM;
    const track = proxy.firstElementChild as HTMLElement;

    const onScroll = (event: Event) => follow(group, event.currentTarget as HTMLElement);
    for (const el of [scroller, proxy]) {
      group.landed.set(el, el.scrollLeft);
      el.addEventListener('scroll', onScroll, { passive: true });
    }

    // After the track resizes the pane's range has changed: a pane that had
    // stopped short of the shared offset can now go further, and the old range
    // may have clamped the proxy. Re-sync in a measure of its own, reading in
    // the read phase rather than forcing layout right after the resize. Writes
    // are recorded like a sync, so their scroll events move nothing; a pane
    // with a move of its own still to report is left to report it.
    const resync = {
      key: scroller,
      read: () => scroller.scrollLeft === group.landed.get(scroller),
      write: (settled: boolean) => {
        if (settled) {
          scroller.scrollLeft = group.target;
          group.landed.set(scroller, scroller.scrollLeft);
        }
        proxy.scrollLeft = scroller.scrollLeft;
        group.landed.set(proxy, proxy.scrollLeft);
      },
    };

    // The pane's range at the last measure. The track's width alone can stay
    // put while the range changes: a pane and proxy that narrow alike.
    let range = 0;
    const measure = () =>
      view.requestMeasure({
        key: proxy,
        read: () => ({
          overflow: Math.max(0, scroller.scrollWidth - scroller.clientWidth),
          // The proxy may be wider than the pane (it also spans the merge
          // view's vertical scrollbar): size the track from the proxy's own
          // width so both scroll ranges equal the pane's overflow.
          proxyWidth: proxy.clientWidth,
        }),
        write: ({ overflow, proxyWidth }) => {
          const width = overflow > 0 ? `${proxyWidth + overflow}px` : '';
          // Same width and range: nothing to re-sync.
          if (track.style.width === width && range === overflow) return;
          track.style.width = width;
          range = overflow;
          view.requestMeasure(resync);
        },
      });
    measure();

    // Divider drags, panel resizes and the merge view's vertical scrollbar
    // coming and going resize the pane and its proxy. CodeMirror reports no
    // geometry change for an overflowing pane that narrows (its content stays
    // as wide as the longest line), so watch both sizes here.
    const resize = new ResizeObserver(measure);
    resize.observe(scroller);
    resize.observe(proxy);

    return {
      // Longer lines scrolled into view or typed widen the content.
      update(update: ViewUpdate) {
        if (update.geometryChanged || update.viewportChanged || update.docChanged) measure();
      },
      destroy() {
        resize.disconnect();
        for (const el of [scroller, proxy]) {
          group.landed.delete(el);
          el.removeEventListener('scroll', onScroll);
        }
        track.style.width = '';
      },
    };
  });
}
