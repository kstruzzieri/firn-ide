import * as bindings from '../../wails/bindings';
// v2-api-names.json is a migration tripwire for #273: delete it and this test
// once Phase B lands and generated-bindings parity is re-anchored against the
// v3 surface (or this file is superseded by whatever replaces it).
import names from './v2-api-names.json';

it('adapter exports every v2-bound method name', () => {
  const missing = (names as string[]).filter(
    (n) => typeof (bindings as Record<string, unknown>)[n] !== 'function'
  );
  expect(missing).toEqual([]);
});

it('no binding function missing from the inventory', () => {
  const extra = Object.keys(bindings).filter(
    (k) =>
      typeof (bindings as Record<string, unknown>)[k] === 'function' &&
      !(names as string[]).includes(k)
  );
  expect(extra).toEqual([]);
});
