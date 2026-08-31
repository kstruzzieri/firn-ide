import { EventsOn, WindowSetTitle, BrowserOpenURL, ClipboardSetText } from '../../wails/runtime';
import * as bindings from '../../wails/bindings';

describe('wails adapter surface', () => {
  it('adapter re-exports the four production runtime functions', () => {
    expect(typeof EventsOn).toBe('function');
    expect(typeof WindowSetTitle).toBe('function');
    expect(typeof BrowserOpenURL).toBe('function');
    expect(typeof ClipboardSetText).toBe('function');
  });

  it('exposes bindings functions and model namespaces', () => {
    expect(typeof (bindings as Record<string, unknown>).OpenFolderDialog).toBe('function');
    expect(typeof (bindings as Record<string, unknown>).ToggleMaximize).toBe('function');
    expect(bindings.git).toBeDefined();
    expect(bindings.runprofile).toBeDefined();
  });
});
