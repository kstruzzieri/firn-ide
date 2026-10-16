/**
 * Horizontal scrollbar pinned under a diff pane (issue #448).
 *
 * In the merge view each pane grows to its document's full height and only
 * `.cm-mergeView` scrolls vertically, so a pane's own horizontal scrollbar sits
 * below its last line, out of sight on any file taller than the view. Wrapping
 * is no fix (see GitDiffView: wrapped lines throw the panes out of alignment).
 * Instead `proxy`, a scroll container rendered under the merge view with one
 * child (the track), mirrors the pane: the track is sized so the proxy scrolls
 * exactly as far as the pane does, and the two scrollLeft values follow each
 * other. A pane that does not overflow leaves the track at its natural width,
 * so the browser draws no bar.
 */
import { ViewPlugin, type ViewUpdate } from '@codemirror/view';

export function pinnedScrollbar(proxy: HTMLElement) {
  return ViewPlugin.define((view) => {
    const scroller = view.scrollDOM;
    const track = proxy.firstElementChild as HTMLElement;

    const fromPane = () => {
      if (proxy.scrollLeft !== scroller.scrollLeft) proxy.scrollLeft = scroller.scrollLeft;
    };
    const fromProxy = () => {
      if (scroller.scrollLeft !== proxy.scrollLeft) scroller.scrollLeft = proxy.scrollLeft;
    };
    scroller.addEventListener('scroll', fromPane, { passive: true });
    proxy.addEventListener('scroll', fromProxy, { passive: true });

    // After the track resizes, the old range may have clamped the proxy short
    // of the pane. Re-sync in a measure of its own, so the pane's offset is
    // read in a read phase instead of forcing layout right after the resize.
    const resync = {
      key: scroller,
      read: () => scroller.scrollLeft,
      write: (left: number) => {
        proxy.scrollLeft = left;
      },
    };

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
          // Same width: nothing to re-sync, and syncing anyway could undo a
          // proxy drag whose scroll event has not reached the pane yet.
          if (track.style.width === width) return;
          track.style.width = width;
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
        scroller.removeEventListener('scroll', fromPane);
        proxy.removeEventListener('scroll', fromProxy);
        track.style.width = '';
      },
    };
  });
}
