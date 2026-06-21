// src/__tests__/helpers/virtualTree.ts
/**
 * jsdom reports zero-sized layout, so @tanstack/react-virtual renders no window.
 * This installed @tanstack/virtual-core version reads offsetWidth/offsetHeight
 * for element rects, so patch those along with clientHeight/getBoundingClientRect
 * to simulate a fixed viewport. Returns a restore() to undo patches.
 */
export function installVirtualLayout(viewportHeight = 400): () => void {
  const origRect = Element.prototype.getBoundingClientRect;
  const heightDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientHeight');
  const widthDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
  const offsetHeightDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetHeight');
  const offsetWidthDesc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth');

  Element.prototype.getBoundingClientRect = function () {
    return {
      width: 300,
      height: viewportHeight,
      top: 0,
      left: 0,
      right: 300,
      bottom: viewportHeight,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    } as DOMRect;
  };

  Object.defineProperty(HTMLElement.prototype, 'clientHeight', {
    configurable: true,
    get() {
      return viewportHeight;
    },
  });

  Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
    configurable: true,
    get() {
      return 300;
    },
  });

  Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
    configurable: true,
    get() {
      return viewportHeight;
    },
  });

  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get() {
      return 300;
    },
  });

  return () => {
    Element.prototype.getBoundingClientRect = origRect;
    if (heightDesc) {
      Object.defineProperty(HTMLElement.prototype, 'clientHeight', heightDesc);
    } else {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientHeight;
    }
    if (widthDesc) {
      Object.defineProperty(HTMLElement.prototype, 'clientWidth', widthDesc);
    } else {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).clientWidth;
    }
    if (offsetHeightDesc) {
      Object.defineProperty(HTMLElement.prototype, 'offsetHeight', offsetHeightDesc);
    } else {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetHeight;
    }
    if (offsetWidthDesc) {
      Object.defineProperty(HTMLElement.prototype, 'offsetWidth', offsetWidthDesc);
    } else {
      delete (HTMLElement.prototype as unknown as Record<string, unknown>).offsetWidth;
    }
  };
}
