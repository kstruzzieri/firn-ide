class Terminal {
  constructor() {
    this.rows = 24;
    this.cols = 80;
    this.element = undefined;
    this.textarea = undefined;
  }
  loadAddon() {}
  // Like xterm, open() creates the element once; a second call is a no-op.
  open(parent) {
    if (this.element) return;
    this.element = document.createElement('div');
    this.element.className = 'xterm';
    // xterm takes keyboard input through a hidden textarea inside its element.
    this.textarea = document.createElement('textarea');
    this.textarea.className = 'xterm-helper-textarea';
    this.textarea.setAttribute('aria-label', 'Terminal input');
    this.element.appendChild(this.textarea);
    parent.appendChild(this.element);
  }
  focus() {
    this.textarea?.focus();
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
