import * as bindings from '../../wails/bindings';
import names from './v2-api-names.json';

it('adapter exports every v2-bound method name', () => {
  const missing = (names as string[]).filter(
    (n) => typeof (bindings as Record<string, unknown>)[n] !== 'function'
  );
  expect(missing).toEqual([]);
});
