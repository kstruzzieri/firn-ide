// Mock for the wails runtime adapter (src/wails/runtime.ts), which tests reach
// through the '(../)+wails/runtime' moduleNameMapper entry and routinely replace
// wholesale with jest.mock(..., factory). It must stay a SEPARATE module from
// wailsioRuntime.js: sharing one file would give both specifiers the same jest
// module id, so a test's adapter factory would also blank out @wailsio/runtime
// for the generated bindings.
module.exports = {
  EventsOn: jest.fn(() => jest.fn()),
  EventsOnce: jest.fn(() => jest.fn()),
  EventsOnMultiple: jest.fn(() => jest.fn()),
  EventsOff: jest.fn(),
  EventsOffAll: jest.fn(),
  EventsEmit: jest.fn(),
  WindowSetTitle: jest.fn(),
  BrowserOpenURL: jest.fn(),
  ClipboardSetText: jest.fn(() => Promise.resolve()),
  LogPrint: jest.fn(),
  LogTrace: jest.fn(),
  LogDebug: jest.fn(),
  LogInfo: jest.fn(),
  LogWarning: jest.fn(),
  LogError: jest.fn(),
  LogFatal: jest.fn(),
};
