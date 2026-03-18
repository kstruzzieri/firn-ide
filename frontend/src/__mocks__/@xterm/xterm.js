class Terminal {
  constructor() {
    this.rows = 24;
    this.cols = 80;
  }
  loadAddon() {}
  open() {}
  write() {}
  clear() {}
  onData() {
    return { dispose: jest.fn() };
  }
  dispose() {}
}

module.exports = { Terminal };
