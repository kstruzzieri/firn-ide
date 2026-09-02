// Mock for @wailsio/runtime, the v3 package. The generated bindings execute
// $Call/$Create at module load, so this must stay live for every suite —
// including the many that replace the adapter mock (wailsRuntime.js) with their
// own factory. Keeping the two mocks in separate files keeps their jest module
// ids distinct, so one cannot clobber the other.
const pass = (value) => value;

class CancellablePromise extends Promise {
  cancel() {
    return CancellablePromise.resolve();
  }
}

const Events = {
  On: jest.fn(() => jest.fn()),
  Off: jest.fn(),
  Emit: jest.fn(),
};
const Window = { SetTitle: jest.fn() };
const Browser = { OpenURL: jest.fn() };
const Clipboard = { SetText: jest.fn(() => Promise.resolve()) };
const Call = {
  ByID: jest.fn(() => CancellablePromise.resolve()),
  ByName: jest.fn(() => CancellablePromise.resolve()),
};
// NOTE: the real dist/create.js null-checks strictly (`source === null`) and
// mutates arrays/maps in place. These stand-ins are deliberately looser; see the
// Task 7 report for the one place where that difference is observable.
const Create = {
  Any: pass,
  ByteSlice: (value) => value ?? '',
  Array: (create) => (value) => (value == null ? [] : value.map(create)),
  Map: (_createKey, createValue) => (value) => {
    if (value == null) return {};
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, createValue(item)]));
  },
  Nullable: (create) => (value) => (value == null ? null : create(value)),
  Struct: (fields) => (value) => {
    if (value == null) return value;
    for (const [name, create] of Object.entries(fields)) {
      if (name in value) value[name] = create(value[name]);
    }
    return value;
  },
  DateFromTime: (value) => new Date(value),
  Events: {},
};

module.exports = {
  Events,
  Window,
  Browser,
  Clipboard,
  Call,
  Create,
  CancellablePromise,
};
