// Single stable import surface for the Wails runtime. Production uses
// exactly these four functions (verified by census 2026-08-31); add
// re-exports here only when a production caller appears.
export {
  EventsOn,
  WindowSetTitle,
  BrowserOpenURL,
  ClipboardSetText,
} from '../../wailsjs/runtime/runtime';
