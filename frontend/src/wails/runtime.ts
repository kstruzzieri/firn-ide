import { Browser, Clipboard, Events, Window } from '@wailsio/runtime';
import { registerEvent } from './runtime-helpers';

// v2-shaped runtime surface backed by the v3 runtime. Consumers are
// untouched by the migration; only this file knows @wailsio/runtime.

// Generated binding functions return CancellablePromise, so tests need the
// class to build doubles. Re-exported here (value + type) so they get it
// without importing @wailsio/runtime themselves.
export { CancellablePromise } from '@wailsio/runtime';

export function EventsOn<T>(name: string, cb: (data: T) => void): () => void {
  return registerEvent(Events, name, cb);
}

export function WindowSetTitle(title: string): void {
  Window.SetTitle(title);
}

export function BrowserOpenURL(url: string): void {
  Browser.OpenURL(url);
}

export function ClipboardSetText(text: string): Promise<void> {
  return Clipboard.SetText(text);
}
