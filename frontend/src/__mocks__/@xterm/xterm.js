class Terminal {
  constructor() {
    this.rows = 24;
    this.cols = 80;
    this.element = undefined;
  }
  loadAddon() {}
  // Like xterm, open() creates the element once; a second call is a no-op.
  open(parent) {
    if (this.element) return;
    this.element = document.createElement('div');
    this.element.className = 'xterm';
    parent.appendChild(this.element);
  }
  write() {}
  clear() {}
  onData() {
    return { dispose: jest.fn() };
  }
  dispose() {
    this.element?.remove();
  }
}

module.exports = { Terminal };
