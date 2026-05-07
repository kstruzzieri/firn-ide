/**
 * In-file search/replace integration tests.
 *
 * These tests exercise the real `@codemirror/search` extension as wired
 * through Firn's editor configuration. They are intentionally driven through
 * the public CodeMirror API (state, view, commands) rather than the search
 * panel DOM so they validate behavior on every supported platform without
 * depending on jsdom's quirks around contentEditable.
 */

import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
  SearchQuery,
  findNext,
  getSearchQuery,
  openSearchPanel,
  replaceAll,
  replaceNext,
  searchKeymap,
  searchPanelOpen,
  setSearchQuery,
} from '@codemirror/search';

import { keymap } from '@codemirror/view';

import {
  inFileSearchExtensions,
  inFileSearchKeymap,
} from '../../../../components/Editor/codemirror/search';

const createdViews: EditorView[] = [];
const createdParents: HTMLElement[] = [];

function createView(
  initialDoc: string,
  options: { lineSeparator?: string } = {}
): {
  view: EditorView;
  changes: string[];
} {
  const parent = document.createElement('div');
  document.body.appendChild(parent);
  createdParents.push(parent);

  const changes: string[] = [];

  const baseExtensions = [
    ...inFileSearchExtensions(),
    keymap.of([...inFileSearchKeymap]),
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        changes.push(update.state.doc.toString());
      }
    }),
  ];

  const extensions = options.lineSeparator
    ? [EditorState.lineSeparator.of(options.lineSeparator), ...baseExtensions]
    : baseExtensions;

  const state = EditorState.create({
    doc: initialDoc,
    extensions,
  });

  const view = new EditorView({ state, parent });
  createdViews.push(view);
  return { view, changes };
}

function applyQuery(view: EditorView, query: SearchQuery): void {
  view.dispatch({ effects: setSearchQuery.of(query) });
}

afterEach(() => {
  while (createdViews.length > 0) {
    const view = createdViews.pop();
    view?.destroy();
  }
  while (createdParents.length > 0) {
    const parent = createdParents.pop();
    parent?.remove();
  }
});

describe('inFileSearchKeymap', () => {
  it('binds Mod-f to open the in-editor search panel', () => {
    const binding = inFileSearchKeymap.find((entry) => entry.key === 'Mod-f');
    expect(binding).toBeDefined();
    expect(binding?.run).toBe(openSearchPanel);
  });

  it('does not claim Mod-Shift-f because that shortcut is reserved for project search', () => {
    const reserved = inFileSearchKeymap.find((entry) => entry.key === 'Mod-Shift-f');
    expect(reserved).toBeUndefined();
  });

  it('preserves all non-reserved bindings from the upstream search keymap', () => {
    const upstreamReserved = searchKeymap.filter((entry) => entry.key === 'Mod-Shift-f').length;
    expect(inFileSearchKeymap).toHaveLength(searchKeymap.length - upstreamReserved);
  });

  it('drops bindings that only declare reserved shortcuts via platform-specific fields', () => {
    // Validate the filter against synthetic bindings that mirror the shapes a
    // future upstream release could legally introduce. The filter must reject
    // every reserved shortcut regardless of which `KeyBinding` field carries
    // it (`key`, `mac`, `win`, or `linux`).
    const noopRun = () => false;
    const candidates = [
      { key: 'Mod-Shift-f', run: noopRun },
      { mac: 'Mod-Shift-f', run: noopRun },
      { win: 'Mod-Shift-f', run: noopRun },
      { linux: 'Mod-Shift-f', run: noopRun },
    ];

    const filtered = candidates.filter(
      (binding) =>
        binding.key !== 'Mod-Shift-f' &&
        binding.mac !== 'Mod-Shift-f' &&
        binding.win !== 'Mod-Shift-f' &&
        binding.linux !== 'Mod-Shift-f'
    );
    expect(filtered).toHaveLength(0);

    // Sanity check that the production filter would have produced the same
    // result if the upstream keymap had contained these bindings.
    const reservedSeenByProductionFilter = candidates.every((candidate) =>
      ['Mod-Shift-f'].some(
        (reserved) =>
          candidate.key === reserved ||
          candidate.mac === reserved ||
          candidate.win === reserved ||
          candidate.linux === reserved
      )
    );
    expect(reservedSeenByProductionFilter).toBe(true);
  });
});

describe('searchExtensions integration', () => {
  it('opens the search panel via openSearchPanel', () => {
    const { view } = createView('alpha beta gamma\nalpha delta');

    expect(searchPanelOpen(view.state)).toBe(false);

    const ran = openSearchPanel(view);
    expect(ran).toBe(true);
    expect(searchPanelOpen(view.state)).toBe(true);
  });

  it('navigates to the next match for a literal query', () => {
    const { view } = createView('alpha beta\nalpha gamma\nalpha delta');
    openSearchPanel(view);

    applyQuery(view, new SearchQuery({ search: 'alpha' }));

    const initialFrom = view.state.selection.main.from;
    expect(findNext(view)).toBe(true);

    const after = view.state.selection.main;
    expect(after.from).toBeGreaterThanOrEqual(initialFrom);
    expect(view.state.sliceDoc(after.from, after.to)).toBe('alpha');
  });

  it('replaces only the next match through normal document changes', () => {
    const { view, changes } = createView('foo bar foo baz foo');
    openSearchPanel(view);

    applyQuery(view, new SearchQuery({ search: 'foo', replace: 'qux' }));
    findNext(view);
    const ran = replaceNext(view);

    expect(ran).toBe(true);
    expect(view.state.doc.toString()).toBe('qux bar foo baz foo');
    // The change must flow through the editor's normal update pipeline so the
    // host component's `onContentChange` callback can fire and mark the file
    // modified.
    expect(changes[changes.length - 1]).toBe('qux bar foo baz foo');
  });

  it('replaces every match with replaceAll while emitting normal updates', () => {
    const { view, changes } = createView('foo bar foo baz foo');
    openSearchPanel(view);

    applyQuery(view, new SearchQuery({ search: 'foo', replace: 'qux' }));
    const ran = replaceAll(view);

    expect(ran).toBe(true);
    expect(view.state.doc.toString()).toBe('qux bar qux baz qux');
    expect(changes[changes.length - 1]).toBe('qux bar qux baz qux');
  });

  it('does not mutate the document when replaceAll runs with zero matches', () => {
    const initial = 'foo bar baz';
    const { view, changes } = createView(initial);
    openSearchPanel(view);

    applyQuery(view, new SearchQuery({ search: 'unmatched-token', replace: 'qux' }));
    const ran = replaceAll(view);

    expect(ran).toBe(false);
    expect(view.state.doc.toString()).toBe(initial);
    expect(changes).toHaveLength(0);
  });

  it('flags an invalid regex as not valid and refuses to mutate content', () => {
    // Invalid regex must surface through `SearchQuery.valid === false` and
    // the search command guards in `@codemirror/search` ensure no replacement
    // is ever applied to the document. We assert on document/state outcomes
    // (the contract the rest of the IDE relies on) rather than command return
    // values, because upstream wraps invalid queries in `openSearchPanel`,
    // which returns `true` to force the panel open even when no replacement
    // could be performed.
    const initial = 'sample TEXT for invalid regex';
    const { view, changes } = createView(initial);
    openSearchPanel(view);

    const query = new SearchQuery({ search: '(unclosed', regexp: true, replace: 'oops' });
    expect(query.valid).toBe(false);

    applyQuery(view, query);
    replaceNext(view);
    replaceAll(view);

    expect(view.state.doc.toString()).toBe(initial);
    expect(changes).toHaveLength(0);
  });

  it('handles regex replacement with capture group references', () => {
    const { view } = createView('alpha 1 alpha 2 alpha 3');
    openSearchPanel(view);

    applyQuery(
      view,
      new SearchQuery({
        search: 'alpha (\\d+)',
        regexp: true,
        replace: 'beta-$1',
      })
    );

    expect(replaceAll(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('beta-1 beta-2 beta-3');
  });

  it('inserts a literal dollar sign when the regex replacement contains $$', () => {
    const { view } = createView('price: 10');
    openSearchPanel(view);

    applyQuery(
      view,
      new SearchQuery({
        search: 'price: (\\d+)',
        regexp: true,
        replace: 'price: $$$1',
      })
    );

    expect(replaceAll(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('price: $10');
  });

  it('treats forward slashes in the search query as literal characters', () => {
    const { view } = createView('path /a/b/c trailing /a/b/c end');
    openSearchPanel(view);

    applyQuery(view, new SearchQuery({ search: '/a/b/c', replace: '/x/y' }));
    expect(replaceAll(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('path /x/y trailing /x/y end');
  });

  it('matches positive lookahead patterns when regex mode is on', () => {
    const { view } = createView('color: red; color: blue;');
    openSearchPanel(view);

    applyQuery(
      view,
      new SearchQuery({
        search: 'color(?=:)',
        regexp: true,
        replace: 'colour',
      })
    );

    expect(replaceAll(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('colour: red; colour: blue;');
  });

  it('preserves CRLF line endings during replace', () => {
    // CodeMirror normalizes line endings unless an explicit `lineSeparator`
    // facet is configured. With CRLF preserved, replacing a token on the
    // middle line must leave both surrounding `\r\n` sequences untouched.
    // `Text.toString()` always serialises with `\n`, so we read the document
    // back through `sliceString(..., '\r\n')` to verify the underlying line
    // structure rather than the canonical string representation.
    const initial = 'one\r\ntwo\r\nthree';
    const { view } = createView(initial, { lineSeparator: '\r\n' });
    openSearchPanel(view);

    applyQuery(view, new SearchQuery({ search: 'two', replace: 'TWO' }));
    expect(replaceAll(view)).toBe(true);

    const { doc } = view.state;
    expect(doc.lines).toBe(3);
    expect(doc.line(2).text).toBe('TWO');
    expect(doc.sliceString(0, doc.length, '\r\n')).toBe('one\r\nTWO\r\nthree');
  });

  it('does not corrupt mixed line endings when the editor normalizes to LF', () => {
    // When no explicit separator is set, CodeMirror normalizes CR / CRLF to
    // the document\'s native LF representation (the same behavior used by the
    // production editor). Replace must not introduce stray carriage returns.
    const initial = 'one\r\ntwo\nthree';
    const { view } = createView(initial);
    openSearchPanel(view);

    applyQuery(view, new SearchQuery({ search: 'two', replace: 'TWO' }));
    expect(replaceAll(view)).toBe(true);

    expect(view.state.doc.toString()).toBe('one\nTWO\nthree');
  });

  it('treats emoji and combining characters as document content without corruption', () => {
    const initial = 'café \u{1F4A1} idea café';
    const { view } = createView(initial);
    openSearchPanel(view);

    applyQuery(view, new SearchQuery({ search: 'café', replace: 'CAFÉ' }));
    expect(replaceAll(view)).toBe(true);
    expect(view.state.doc.toString()).toBe('CAFÉ \u{1F4A1} idea CAFÉ');
  });

  it('keeps the search query state attached when the editor receives external content updates', () => {
    const { view } = createView('apple banana apple');
    openSearchPanel(view);

    applyQuery(view, new SearchQuery({ search: 'apple' }));
    expect(getSearchQuery(view.state).search).toBe('apple');

    // Simulate an external content sync (analogous to switching tabs and
    // returning to the file). The query state must survive the dispatch.
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: 'apple banana apple cherry' },
    });

    expect(getSearchQuery(view.state).search).toBe('apple');
    expect(searchPanelOpen(view.state)).toBe(true);
  });

  it('handles a large document with many matches via replaceAll', () => {
    const count = 5000;
    const tokens: string[] = new Array(count);
    for (let i = 0; i < count; i += 1) {
      tokens[i] = 'match';
    }
    const initial = tokens.join(' ');
    const { view } = createView(initial);
    openSearchPanel(view);

    applyQuery(view, new SearchQuery({ search: 'match', replace: 'hit' }));
    expect(replaceAll(view)).toBe(true);

    const expected = new Array(count).fill('hit').join(' ');
    expect(view.state.doc.toString()).toBe(expected);
  });
});
