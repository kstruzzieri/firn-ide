import { redo } from '@codemirror/commands';
import { searchPanelOpen } from '@codemirror/search';
import { EditorState } from '@codemirror/state';
import { runScopeHandlers } from '@codemirror/view';

jest.mock('./extensions', () => ({}));
jest.mock('./diagnostics', () => ({}));
jest.mock('./completion', () => ({}));
jest.mock('./hover', () => ({}));
jest.mock('./definition', () => ({}));
jest.mock('./reconcileDoc', () => ({}));
jest.mock('./gitGutter', () => ({}));

import {
  changedRegionIndexes,
  createMergeResolutionEditor,
  markerBlockRange,
  markerBlockRanges,
  nextUnresolved,
  resolutionLines,
} from './mergeResolution';
import { createMergeResolutionEditor as createMergeResolutionEditorFromBarrel } from './index';
import type { TextMergeSession } from '../../../stores/gitStore';

const content = [
  'before',
  '<<<<<<< current',
  'current line',
  '=======',
  'incoming line',
  '>>>>>>> incoming',
  'between',
  '<<<<<<< current',
  'second current',
  '=======',
  'second incoming',
  '>>>>>>> incoming',
  'after',
  '',
].join('\n');

function session(overrides: Partial<TextMergeSession> = {}): TextMergeSession {
  return {
    kind: 'text',
    path: 'conflict.txt',
    absPath: '/repo/conflict.txt',
    repoRoot: '/repo',
    labels: {
      operation: 'merge',
      ours: { label: 'main', hash: '111', subject: '' },
      theirs: { label: 'feature', hash: '222', subject: '' },
    },
    fileQueue: ['conflict.txt'],
    requestRevision: 1,
    epoch: 1,
    fileWriteRevision: 1,
    content,
    encoding: 'utf-8',
    lineEndings: 'lf',
    regions: [
      {
        index: 0,
        startLine: 2,
        endLine: 6,
        ours: ['current line'],
        base: [],
        theirs: ['incoming line'],
        hasBase: false,
        oursLabel: 'current',
        theirLabel: 'incoming',
      },
      {
        index: 1,
        startLine: 8,
        endLine: 12,
        ours: ['second current'],
        base: [],
        theirs: ['second incoming'],
        hasBase: false,
        oursLabel: 'current',
        theirLabel: 'incoming',
      },
    ],
    decisions: {},
    readOnly: false,
    ...overrides,
  } as TextMergeSession;
}

describe('merge resolution helpers', () => {
  it('exposes the mount API through the CodeMirror barrel', () => {
    expect(createMergeResolutionEditorFromBarrel).toBe(createMergeResolutionEditor);
  });

  it('maps a marker block once without consuming its following line boundary', () => {
    const range = markerBlockRange(content, 2, 6);

    expect(content.slice(range.from, range.to)).toBe(
      '<<<<<<< current\ncurrent line\n=======\nincoming line\n>>>>>>> incoming'
    );
    expect(content[range.to]).toBe('\n');
  });

  it('maps many marker blocks from one line index with stable offsets', () => {
    const regions = Array.from({ length: 40 }, (_, index) => ({
      startLine: index * 5 + 1,
      endLine: index * 5 + 5,
    }));
    const document = regions
      .map(
        (_, index) =>
          `<<<<<<< current\ncurrent ${index}\n=======\nincoming ${index}\n>>>>>>> incoming`
      )
      .join('\n')
      .concat('\n');

    const ranges = markerBlockRanges(document, regions);

    expect(ranges).toHaveLength(regions.length);
    expect(ranges.map((range) => document.slice(range.from, range.to))).toEqual(
      regions.map(
        (_, index) =>
          `<<<<<<< current\ncurrent ${index}\n=======\nincoming ${index}\n>>>>>>> incoming`
      )
    );
    expect(ranges[20].from).toBe(document.indexOf('<<<<<<< current', ranges[19].to));
  });

  it('cycles unresolved regions in both directions', () => {
    const decisions = { 0: 'C' as const, 2: 'I' as const };

    expect(nextUnresolved(decisions, 5, 3, 1)).toBe(4);
    expect(nextUnresolved(decisions, 5, 3, -1)).toBe(1);
    expect(nextUnresolved({ 0: 'C' }, 1, 0, 1)).toBeNull();
  });

  it('returns side lines in the requested resolution order', () => {
    const region = session().regions[0];

    expect(resolutionLines(region, 'C', 'current-first')).toEqual(['current line']);
    expect(resolutionLines(region, 'I', 'current-first')).toEqual(['incoming line']);
    expect(resolutionLines(region, 'B', 'current-first')).toEqual([
      'current line',
      'incoming line',
    ]);
    expect(resolutionLines(region, 'B', 'incoming-first')).toEqual([
      'incoming line',
      'current line',
    ]);
  });

  it('detects inserts, replacements, and deletions touching mapped regions', () => {
    const first = markerBlockRange(content, 2, 6);
    const second = markerBlockRange(content, 8, 12);

    expect(
      changedRegionIndexes(
        [
          { index: 0, ...first },
          { index: 1, ...second },
        ],
        [
          { from: first.from, to: first.from },
          { from: second.to - 2, to: second.to },
        ]
      )
    ).toEqual([0, 1]);
  });

  it('does not treat non-empty changes adjacent to a region as manual edits', () => {
    const region = { index: 0, from: 10, to: 20, trailingNewline: true };

    expect(changedRegionIndexes([region], [{ from: 9, to: 10 }])).toEqual([]);
    expect(changedRegionIndexes([region], [{ from: 20, to: 21 }])).toEqual([]);
    expect(changedRegionIndexes([region], [{ from: 10, to: 10 }])).toEqual([0]);
    expect(changedRegionIndexes([region], [{ from: 19, to: 19 }])).toEqual([0]);
    expect(changedRegionIndexes([region], [{ from: 20, to: 20 }])).toEqual([]);
  });
});

describe('merge resolution editor', () => {
  afterEach(() => document.body.replaceChildren());

  it('opens the configured top in-file search panel from the standard Mod-f keymap', () => {
    const editor = createMergeResolutionEditor(document.body, session());

    expect(searchPanelOpen(editor.view.state)).toBe(false);
    expect(
      runScopeHandlers(
        editor.view,
        new KeyboardEvent('keydown', { key: 'f', ctrlKey: true }),
        'editor'
      )
    ).toBe(true);
    expect(searchPanelOpen(editor.view.state)).toBe(true);
    expect(editor.view.dom.querySelector('.cm-panels-top .cm-search')).not.toBeNull();
    editor.destroy();
  });

  it('applies the requested syntax theme and reconfigures it in place', () => {
    const editor = createMergeResolutionEditor(document.body, session(), {
      syntaxThemeId: 'glacier',
    });
    const glacierClasses = editor.view.themeClasses;

    editor.setTheme('abyssal');

    expect(editor.view.themeClasses).not.toBe(glacierClasses);
    editor.destroy();
  });

  it('replaces the active marker block, advances, and restores text plus decisions through history', () => {
    const editor = createMergeResolutionEditor(document.body, session());
    const current = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent === 'Take Current'
    );

    current?.click();

    expect(editor.getResult()).toContain('before\ncurrent line\nbetween');
    expect(editor.getResult().match(/<<<<<<< current/g)).toHaveLength(1);
    expect(editor.getState()).toEqual({
      activeIndex: 1,
      decisions: { 0: 'C' },
      order: 'current-first',
    });

    expect(editor.undo()).toBe(true);
    expect(editor.getResult()).toBe(content);
    expect(editor.getState().decisions).toEqual({});

    expect(redo(editor.view)).toBe(true);
    expect(editor.getState().decisions).toEqual({ 0: 'C' });
    editor.destroy();
  });

  it('returns focus to CodeMirror after successful external undo and redo', () => {
    const editor = createMergeResolutionEditor(document.body, session());
    Array.from(document.querySelectorAll('button'))
      .find((button) => button.textContent === 'Take Current')
      ?.click();
    const outside = document.createElement('button');
    document.body.appendChild(outside);

    outside.focus();
    expect(editor.undo()).toBe(true);
    expect(editor.view.dom.contains(document.activeElement)).toBe(true);

    outside.focus();
    expect(editor.redo()).toBe(true);
    expect(editor.view.dom.contains(document.activeElement)).toBe(true);
    editor.destroy();
  });

  it('marks an edited resolution manual and undo restores its previous decision', () => {
    const editor = createMergeResolutionEditor(document.body, session());
    Array.from(document.querySelectorAll('button'))
      .find((button) => button.textContent === 'Take Current')
      ?.click();
    const from = editor.getResult().indexOf('current line');

    editor.view.dispatch({ changes: { from, to: from + 'current'.length, insert: 'edited' } });

    expect(editor.getState().decisions).toEqual({ 0: 'M' });
    expect(editor.undo()).toBe(true);
    expect(editor.getState().decisions).toEqual({ 0: 'C' });
    expect(editor.getResult()).toContain('current line');
    editor.destroy();
  });

  it('keeps Edit manually at the current region with both sides selected', () => {
    const editor = createMergeResolutionEditor(document.body, session());
    const manual = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent === 'Edit manually'
    );

    expect(manual?.dataset.decision).toBe('M');
    manual?.click();

    const manualStart = editor.getResult().indexOf('current line');
    expect(editor.getResult()).toContain('current line\nincoming line');
    expect(editor.getState()).toEqual({
      activeIndex: 0,
      decisions: { 0: 'M' },
      order: 'current-first',
    });
    expect(editor.view.state.selection.main.head).toBe(manualStart);
    expect(editor.view.dom.contains(document.activeElement)).toBe(true);
    editor.destroy();
  });

  it.each([
    ['Take Current', 'current line'],
    ['Take Incoming', 'incoming line'],
    ['Take Both', 'current line\nincoming line'],
  ])('returns focus to CodeMirror after %s replaces its widget', (label, expectedResult) => {
    const editor = createMergeResolutionEditor(document.body, session());
    const action = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent === label
    ) as HTMLButtonElement;

    action.focus();
    expect(action).toHaveFocus();
    action.click();

    expect(editor.getResult()).toContain(expectedResult);
    expect(editor.view.dom.contains(document.activeElement)).toBe(true);
    editor.destroy();
  });

  it('returns focus to CodeMirror after the order toggle recreates its widget', () => {
    const editor = createMergeResolutionEditor(document.body, session());
    const order = document.querySelector('.cm-mergeResolution-order') as HTMLButtonElement;

    order.focus();
    expect(order).toHaveFocus();
    order.click();

    expect(editor.getState().order).toBe('incoming-first');
    expect(editor.view.dom.contains(document.activeElement)).toBe(true);
    editor.destroy();
  });

  it('keeps typing at the following line outside an unresolved conflict', () => {
    const editor = createMergeResolutionEditor(document.body, session());
    const first = markerBlockRange(content, 2, 6);
    const followingLineStart = first.to + 1;

    editor.view.dispatch({
      changes: { from: followingLineStart, to: followingLineStart, insert: 'typed ' },
    });

    expect(editor.getResult()).toContain('typed between');
    expect(editor.getState().decisions).toEqual({});
    expect(editor.getResult()).toContain('<<<<<<< current');
    editor.destroy();
  });

  it('restores pre-marker context before resolving after native undo', () => {
    const contextContent =
      'before\n<<<<<<< current\ncurrent\n=======\nincoming\n>>>>>>> incoming\nafter\n';
    const merge = session({
      content: contextContent,
      regions: [
        {
          ...session().regions[0],
          startLine: 2,
          endLine: 6,
          ours: ['current'],
          theirs: ['incoming'],
        },
      ],
    });
    const editor = createMergeResolutionEditor(document.body, merge);
    const marker = markerBlockRange(contextContent, 2, 6);

    editor.view.dispatch({ changes: { from: 0, to: marker.from, insert: '' } });
    expect(editor.getResult()).toBe(
      '<<<<<<< current\ncurrent\n=======\nincoming\n>>>>>>> incoming\nafter\n'
    );

    expect(editor.undo()).toBe(true);
    expect(editor.getResult()).toBe(contextContent);
    expect(editor.getState().decisions).toEqual({});
    const current = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent === 'Take Current'
    );
    expect(current).toBeDefined();
    current?.click();

    expect(editor.getResult()).toBe('before\ncurrent\nafter\n');
    editor.destroy();
  });

  it('rejects an untagged boundary edit into an unresolved hidden marker range', () => {
    const editor = createMergeResolutionEditor(document.body, session());
    const first = markerBlockRange(content, 2, 6);

    editor.view.dispatch({ changes: { from: first.from, to: first.from, insert: 'unsafe ' } });

    expect(editor.getResult()).toBe(content);
    expect(editor.getState().decisions).toEqual({});
    expect(editor.getResult()).toContain('<<<<<<< current');
    expect(editor.getResult()).toContain('>>>>>>> incoming');
    editor.destroy();
  });

  it('rejects a mixed edit that touches resolved text and an unresolved marker', () => {
    const editor = createMergeResolutionEditor(document.body, session());
    Array.from(document.querySelectorAll('button'))
      .find((button) => button.textContent === 'Take Current')
      ?.click();
    const resultBeforeEdit = editor.getResult();
    const resolved = resultBeforeEdit.indexOf('current line');
    const unresolved = resultBeforeEdit.indexOf('<<<<<<< current');

    editor.view.dispatch({
      changes: [
        { from: resolved, to: resolved + 'current'.length, insert: 'edited' },
        { from: unresolved, to: unresolved, insert: 'unsafe ' },
      ],
    });

    expect(editor.getResult()).toBe(resultBeforeEdit);
    expect(editor.getState().decisions).toEqual({ 0: 'C' });
    editor.destroy();
  });

  it('marks an edit at a collapsed empty resolution point manual', () => {
    const merge = session({
      content: 'before\n<<<<<<< current\n=======\nincoming\n>>>>>>> incoming\nafter\n',
      regions: [{ ...session().regions[0], startLine: 2, endLine: 5, ours: [] }],
    });
    const editor = createMergeResolutionEditor(document.body, merge);
    Array.from(document.querySelectorAll('button'))
      .find((button) => button.textContent === 'Take Current')
      ?.click();
    const point = editor.getResult().indexOf('after');

    editor.view.dispatch({ changes: { from: point, to: point, insert: 'typed ' } });

    expect(editor.getResult()).toBe('before\ntyped after\n');
    expect(editor.getState().decisions).toEqual({ 0: 'M' });
    editor.destroy();
  });

  it('marks an EOF append after a no-final-newline result manual', () => {
    const merge = session({
      content: '<<<<<<< current\ncurrent\n=======\nincoming\n>>>>>>> incoming',
      regions: [{ ...session().regions[0], startLine: 1, endLine: 5 }],
    });
    const editor = createMergeResolutionEditor(document.body, merge);
    Array.from(document.querySelectorAll('button'))
      .find((button) => button.textContent === 'Take Current')
      ?.click();
    const point = editor.getResult().length;

    editor.view.dispatch({ changes: { from: point, to: point, insert: ' appended' } });

    expect(editor.getResult()).toBe('current line appended');
    expect(editor.getState().decisions).toEqual({ 0: 'M' });
    editor.destroy();
  });

  it('activates a rail region and moves the result selection to its mapped range', () => {
    const editor = createMergeResolutionEditor(document.body, session());
    const second = markerBlockRange(content, 8, 12);
    const outside = document.createElement('button');
    document.body.appendChild(outside);
    outside.focus();

    expect(editor.activate(1)).toBe(true);
    expect(editor.getState().activeIndex).toBe(1);
    expect(editor.view.state.selection.main.head).toBe(second.from);
    expect(editor.view.dom.contains(document.activeElement)).toBe(true);
    editor.destroy();
  });

  it('uses MergeHeads labels with explicit sides in cards and inactive strips', () => {
    const emptyCurrent = session({
      labels: {
        operation: 'merge',
        ours: { label: 'release/current', hash: '111', subject: '' },
        theirs: { label: 'topic/incoming', hash: '222', subject: '' },
      } as TextMergeSession['labels'],
      regions: [
        { ...session().regions[0], ours: [], oursLabel: 'HEAD', theirLabel: 'MERGE_HEAD' },
        { ...session().regions[1], oursLabel: 'HEAD', theirLabel: 'MERGE_HEAD' },
      ],
    });

    const editor = createMergeResolutionEditor(document.body, emptyCurrent);

    expect(document.body.textContent).toContain('CURRENT — release/current');
    expect(document.body.textContent).toContain('INCOMING — topic/incoming');
    const strip = document.querySelector('.cm-mergeResolution-strip') as HTMLButtonElement;
    expect(strip.textContent).toContain('CURRENT — release/current / INCOMING — topic/incoming');
    expect(strip).toHaveAccessibleName(
      'Open conflict 2: CURRENT — release/current / INCOMING — topic/incoming'
    );
    expect(document.body.textContent).not.toContain('MERGE_HEAD');
    expect(document.body.textContent).toContain('(deletes this block)');
    editor.destroy();
  });

  it('maps CRLF marker lines in CodeMirror coordinates without replacing nearby text', () => {
    const editor = createMergeResolutionEditor(
      document.body,
      session({ content: content.replace(/\n/g, '\r\n'), lineEndings: 'crlf' })
    );
    Array.from(document.querySelectorAll('button'))
      .find((button) => button.textContent === 'Take Current')
      ?.click();

    expect(editor.getResult()).toContain('before\ncurrent line\nbetween');
    expect(editor.getResult()).toContain('after');
    expect(editor.getResult()).not.toContain('<<<<<<< current\r');
    editor.destroy();
  });

  it('removes empty resolutions without leaving an extra line in the middle or at EOF', () => {
    const middle = session({
      content: 'before\n<<<<<<< current\n=======\nincoming\n>>>>>>> incoming\nafter\n',
      regions: [{ ...session().regions[0], startLine: 2, endLine: 5, ours: [] }],
    });
    const middleEditor = createMergeResolutionEditor(document.body, middle);
    Array.from(document.querySelectorAll('button'))
      .find((button) => button.textContent === 'Take Current')
      ?.click();
    expect(middleEditor.getResult()).toBe('before\nafter\n');
    middleEditor.destroy();

    const eof = session({
      content: '<<<<<<< current\n=======\nincoming\n>>>>>>> incoming\n',
      regions: [{ ...session().regions[0], startLine: 1, endLine: 4, ours: [] }],
    });
    const eofEditor = createMergeResolutionEditor(document.body, eof);
    Array.from(document.querySelectorAll('button'))
      .find((button) => button.textContent === 'Take Current')
      ?.click();
    expect(eofEditor.getResult()).toBe('');
    eofEditor.destroy();
  });

  it('keeps the separator mapped through empty resolution undo before a non-empty choice', () => {
    const merge = session({
      content: 'before\n<<<<<<< current\n=======\ncurrent\n>>>>>>> incoming\nafter\n',
      regions: [
        { ...session().regions[0], startLine: 2, endLine: 5, ours: [], theirs: ['current'] },
      ],
    });
    const editor = createMergeResolutionEditor(document.body, merge);
    Array.from(document.querySelectorAll('button'))
      .find((button) => button.textContent === 'Take Current')
      ?.click();
    expect(editor.getResult()).toBe('before\nafter\n');

    expect(editor.undo()).toBe(true);
    Array.from(document.querySelectorAll('button'))
      .find((button) => button.textContent === 'Take Incoming')
      ?.click();

    expect(editor.getResult()).toBe('before\ncurrent\nafter\n');
    editor.destroy();
  });

  it('keeps adjacent empty and non-empty marker ranges independent through native undo and redo', () => {
    const adjacentContent = [
      '<<<<<<< current',
      '=======',
      'first incoming',
      '>>>>>>> incoming',
      '<<<<<<< current',
      'second current',
      '=======',
      'second incoming',
      '>>>>>>> incoming',
      'tail',
      '',
    ].join('\n');
    const merge = session({
      content: adjacentContent,
      regions: [
        {
          ...session().regions[0],
          startLine: 1,
          endLine: 4,
          ours: [],
          theirs: ['first incoming'],
        },
        {
          ...session().regions[1],
          startLine: 5,
          endLine: 9,
          ours: ['second current'],
          theirs: ['second incoming'],
        },
      ],
    });
    const editor = createMergeResolutionEditor(document.body, merge);
    const choose = (label: string) => {
      const button = Array.from(document.querySelectorAll('button')).find(
        (candidate) => candidate.textContent === label
      );
      expect(button).toBeDefined();
      button?.click();
    };

    choose('Take Current');
    const collapsed = adjacentContent.replace(
      '<<<<<<< current\n=======\nfirst incoming\n>>>>>>> incoming\n',
      ''
    );
    expect(editor.getResult()).toBe(collapsed);
    expect(editor.getState()).toEqual({
      activeIndex: 1,
      decisions: { 0: 'C' },
      order: 'current-first',
    });

    expect(editor.undo()).toBe(true);
    expect(editor.getResult()).toBe(adjacentContent);
    expect(editor.getState().decisions).toEqual({});

    expect(editor.redo()).toBe(true);
    expect(editor.getResult()).toBe(collapsed);
    expect(editor.getState().decisions).toEqual({ 0: 'C' });

    expect(editor.undo()).toBe(true);
    expect(editor.getResult()).toBe(adjacentContent);
    expect(editor.activate(1)).toBe(true);
    choose('Take Incoming');
    expect(editor.getResult()).toBe(
      '<<<<<<< current\n=======\nfirst incoming\n>>>>>>> incoming\nsecond incoming\ntail\n'
    );
    expect(editor.activate(0)).toBe(true);
    choose('Take Current');

    expect(editor.getResult()).toBe('second incoming\ntail\n');
    expect(editor.getState()).toEqual({
      activeIndex: null,
      decisions: { 0: 'C', 1: 'I' },
      order: 'current-first',
    });

    expect(editor.undo()).toBe(true);
    expect(editor.getResult()).toBe(
      '<<<<<<< current\n=======\nfirst incoming\n>>>>>>> incoming\nsecond incoming\ntail\n'
    );
    expect(editor.redo()).toBe(true);
    expect(editor.getResult()).toBe('second incoming\ntail\n');
    expect(editor.undo()).toBe(true);
    expect(editor.activate(0)).toBe(true);
    choose('Take Current');
    expect(editor.getResult()).toBe('second incoming\ntail\n');
    editor.destroy();
  });

  it('isolates adjacent empty decisions and rejects an ambiguous shared-coordinate edit', () => {
    const adjacentContent = [
      '<<<<<<< current',
      '=======',
      'first incoming',
      '>>>>>>> incoming',
      '<<<<<<< current',
      '=======',
      'second incoming',
      '>>>>>>> incoming',
      'tail',
      '',
    ].join('\n');
    const merge = session({
      content: adjacentContent,
      regions: [
        {
          ...session().regions[0],
          startLine: 1,
          endLine: 4,
          ours: [],
          theirs: ['first incoming'],
        },
        {
          ...session().regions[1],
          startLine: 5,
          endLine: 8,
          ours: [],
          theirs: ['second incoming'],
        },
      ],
    });
    const editor = createMergeResolutionEditor(document.body, merge);
    const chooseCurrent = () => {
      const button = Array.from(document.querySelectorAll('button')).find(
        (candidate) => candidate.textContent === 'Take Current'
      );
      expect(button).toBeDefined();
      button?.click();
    };

    chooseCurrent();
    chooseCurrent();
    expect(editor.getResult()).toBe('tail\n');
    expect(editor.getState().decisions).toEqual({ 0: 'C', 1: 'C' });

    expect(editor.undo()).toBe(true);
    expect(editor.getResult()).toBe(
      '<<<<<<< current\n=======\nsecond incoming\n>>>>>>> incoming\ntail\n'
    );
    expect(editor.getState().decisions).toEqual({ 0: 'C' });
    expect(editor.redo()).toBe(true);
    expect(editor.getResult()).toBe('tail\n');

    editor.view.dispatch({ changes: { from: 0, to: 0, insert: 'ambiguous ' } });
    expect(editor.getResult()).toBe('tail\n');
    expect(editor.getState().decisions).toEqual({ 0: 'C', 1: 'C' });

    expect(editor.undo()).toBe(true);
    expect(editor.undo()).toBe(true);
    expect(editor.getResult()).toBe(adjacentContent);
    expect(editor.redo()).toBe(true);
    expect(editor.redo()).toBe(true);
    expect(editor.getResult()).toBe('tail\n');
    editor.destroy();
  });

  it('allows a non-ambiguous edit spanning two resolved regions and marks both manual', () => {
    const adjacentContent = [
      '<<<<<<< current',
      'first current',
      '=======',
      'first incoming',
      '>>>>>>> incoming',
      '<<<<<<< current',
      'second current',
      '=======',
      'second incoming',
      '>>>>>>> incoming',
      'tail',
      '',
    ].join('\n');
    const merge = session({
      content: adjacentContent,
      regions: [
        { ...session().regions[0], startLine: 1, endLine: 5, ours: ['first current'] },
        { ...session().regions[1], startLine: 6, endLine: 10, ours: ['second current'] },
      ],
    });
    const editor = createMergeResolutionEditor(document.body, merge);
    const chooseCurrent = () => {
      const button = Array.from(document.querySelectorAll('button')).find(
        (candidate) => candidate.textContent === 'Take Current'
      );
      expect(button).toBeDefined();
      button?.click();
    };

    chooseCurrent();
    chooseCurrent();
    expect(editor.getResult()).toBe('first current\nsecond current\ntail\n');

    editor.view.dispatch({
      changes: { from: 0, to: editor.getResult().indexOf('tail'), insert: 'joined\n' },
    });

    expect(editor.getResult()).toBe('joined\ntail\n');
    expect(editor.getState().decisions).toEqual({ 0: 'M', 1: 'M' });

    expect(editor.undo()).toBe(true);
    expect(editor.getResult()).toBe('first current\nsecond current\ntail\n');
    expect(editor.getState().decisions).toEqual({ 0: 'C', 1: 'C' });
    expect(editor.redo()).toBe(true);
    expect(editor.getResult()).toBe('joined\ntail\n');
    expect(editor.getState().decisions).toEqual({ 0: 'M', 1: 'M' });
    editor.destroy();
  });

  it('allows insertion inside overlapping non-collapsed manual ranges through undo and redo', () => {
    const adjacentContent = [
      '<<<<<<< current',
      'first current',
      '=======',
      'first incoming',
      '>>>>>>> incoming',
      '<<<<<<< current',
      'second current',
      '=======',
      'second incoming',
      '>>>>>>> incoming',
      'tail',
      '',
    ].join('\n');
    const merge = session({
      content: adjacentContent,
      regions: [
        { ...session().regions[0], startLine: 1, endLine: 5, ours: ['first current'] },
        { ...session().regions[1], startLine: 6, endLine: 10, ours: ['second current'] },
      ],
    });
    const editor = createMergeResolutionEditor(document.body, merge);
    const chooseCurrent = () => {
      const button = Array.from(document.querySelectorAll('button')).find(
        (candidate) => candidate.textContent === 'Take Current'
      );
      expect(button).toBeDefined();
      button?.click();
    };

    chooseCurrent();
    chooseCurrent();
    editor.view.dispatch({
      changes: { from: 0, to: editor.getResult().indexOf('tail'), insert: 'joined\n' },
    });
    expect(editor.getResult()).toBe('joined\ntail\n');
    expect(editor.getState().decisions).toEqual({ 0: 'M', 1: 'M' });
    expect(editor.undo()).toBe(true);
    expect(editor.getResult()).toBe('first current\nsecond current\ntail\n');
    expect(editor.getState().decisions).toEqual({ 0: 'C', 1: 'C' });
    expect(editor.redo()).toBe(true);
    expect(editor.getResult()).toBe('joined\ntail\n');
    expect(editor.getState().decisions).toEqual({ 0: 'M', 1: 'M' });

    editor.view.dispatch({ changes: { from: 2, to: 2, insert: 'X' } });
    expect(editor.getResult()).toBe('joXined\ntail\n');
    expect(editor.getState().decisions).toEqual({ 0: 'M', 1: 'M' });
    expect(editor.undo()).toBe(true);
    expect(editor.getResult()).toBe('joined\ntail\n');
    expect(editor.getState().decisions).toEqual({ 0: 'M', 1: 'M' });
    expect(editor.redo()).toBe(true);
    expect(editor.getResult()).toBe('joXined\ntail\n');
    expect(editor.getState().decisions).toEqual({ 0: 'M', 1: 'M' });
    editor.destroy();
  });

  it('keeps an insertion at the second adjacent resolved range independent through undo and redo', () => {
    const adjacentContent = [
      '<<<<<<< current',
      'first current',
      '=======',
      'first incoming',
      '>>>>>>> incoming',
      '<<<<<<< current',
      'second current',
      '=======',
      'second incoming',
      '>>>>>>> incoming',
      'tail',
      '',
    ].join('\n');
    const merge = session({
      content: adjacentContent,
      regions: [
        { ...session().regions[0], startLine: 1, endLine: 5, ours: ['first current'] },
        { ...session().regions[1], startLine: 6, endLine: 10, ours: ['second current'] },
      ],
    });
    const editor = createMergeResolutionEditor(document.body, merge);
    const chooseCurrent = () => {
      const button = Array.from(document.querySelectorAll('button')).find(
        (candidate) => candidate.textContent === 'Take Current'
      );
      expect(button).toBeDefined();
      button?.click();
    };

    chooseCurrent();
    chooseCurrent();
    editor.view.dispatch({
      changes: {
        from: editor.getResult().indexOf('second current'),
        to: editor.getResult().indexOf('second current'),
        insert: 'typed ',
      },
    });

    expect(editor.getResult()).toBe('first current\ntyped second current\ntail\n');
    expect(editor.getState().decisions).toEqual({ 0: 'C', 1: 'M' });
    expect(editor.undo()).toBe(true);
    expect(editor.getResult()).toBe('first current\nsecond current\ntail\n');
    expect(editor.getState().decisions).toEqual({ 0: 'C', 1: 'C' });
    expect(editor.redo()).toBe(true);
    expect(editor.getResult()).toBe('first current\ntyped second current\ntail\n');
    expect(editor.getState().decisions).toEqual({ 0: 'C', 1: 'M' });
    editor.destroy();
  });

  it('rejects a shared insertion between a collapsed and non-empty resolved region', () => {
    const adjacentContent = [
      '<<<<<<< current',
      '=======',
      'first incoming',
      '>>>>>>> incoming',
      '<<<<<<< current',
      'second current',
      '=======',
      'second incoming',
      '>>>>>>> incoming',
      'tail',
      '',
    ].join('\n');
    const merge = session({
      content: adjacentContent,
      regions: [
        { ...session().regions[0], startLine: 1, endLine: 4, ours: [] },
        { ...session().regions[1], startLine: 5, endLine: 9, ours: ['second current'] },
      ],
    });
    const editor = createMergeResolutionEditor(document.body, merge);
    const chooseCurrent = () => {
      const button = Array.from(document.querySelectorAll('button')).find(
        (candidate) => candidate.textContent === 'Take Current'
      );
      expect(button).toBeDefined();
      button?.click();
    };

    chooseCurrent();
    chooseCurrent();
    expect(editor.getResult()).toBe('second current\ntail\n');

    editor.view.dispatch({ changes: { from: 0, to: 0, insert: 'unsafe ' } });

    expect(editor.getResult()).toBe('second current\ntail\n');
    expect(editor.getState().decisions).toEqual({ 0: 'C', 1: 'C' });
    editor.destroy();
  });

  it('rejects adjacent changes when their individual insertion shares a collapsed boundary', () => {
    const adjacentContent = [
      'before',
      '<<<<<<< current',
      '=======',
      'first incoming',
      '>>>>>>> incoming',
      '<<<<<<< current',
      'second current',
      '=======',
      'second incoming',
      '>>>>>>> incoming',
      'tail',
      '',
    ].join('\n');
    const merge = session({
      content: adjacentContent,
      regions: [
        { ...session().regions[0], startLine: 2, endLine: 5, ours: [] },
        { ...session().regions[1], startLine: 6, endLine: 10, ours: ['second current'] },
      ],
    });
    const editor = createMergeResolutionEditor(document.body, merge);
    const chooseCurrent = () => {
      const button = Array.from(document.querySelectorAll('button')).find(
        (candidate) => candidate.textContent === 'Take Current'
      );
      expect(button).toBeDefined();
      button?.click();
    };

    chooseCurrent();
    chooseCurrent();
    const result = 'before\nsecond current\ntail\n';
    const point = result.indexOf('second current');
    expect(editor.getResult()).toBe(result);

    editor.view.dispatch({
      changes: [
        { from: point - 1, to: point, insert: '' },
        { from: point, to: point, insert: 'unsafe ' },
      ],
    });

    expect(editor.getResult()).toBe(result);
    expect(editor.getState().decisions).toEqual({ 0: 'C', 1: 'C' });
    editor.destroy();
  });

  it('keeps one blank side line instead of treating it as deletion', () => {
    const merge = session({
      content: 'before\n<<<<<<< current\n\n=======\nincoming\n>>>>>>> incoming\nafter\n',
      regions: [{ ...session().regions[0], startLine: 2, endLine: 6, ours: [''] }],
    });
    const editor = createMergeResolutionEditor(document.body, merge);
    Array.from(document.querySelectorAll('button'))
      .find((button) => button.textContent === 'Take Current')
      ?.click();

    expect(editor.getResult()).toBe('before\n\nafter\n');
    editor.destroy();
  });

  it('handles native strip activation plus F7 and Mod shortcuts', () => {
    const editor = createMergeResolutionEditor(document.body, session());
    const strip = document.querySelector('.cm-mergeResolution-strip') as HTMLButtonElement;

    expect(strip.tagName).toBe('BUTTON');
    strip.focus();
    expect(strip).toHaveFocus();
    strip.click();
    expect(editor.getState().activeIndex).toBe(1);
    expect(editor.view.dom.contains(document.activeElement)).toBe(true);
    expect(
      runScopeHandlers(
        editor.view,
        new KeyboardEvent('keydown', { key: 'F7', shiftKey: true }),
        'editor'
      )
    ).toBe(true);
    expect(editor.getState().activeIndex).toBe(0);
    expect(
      runScopeHandlers(editor.view, new KeyboardEvent('keydown', { key: 'F7' }), 'editor')
    ).toBe(true);
    expect(editor.getState().activeIndex).toBe(1);
    expect(
      runScopeHandlers(
        editor.view,
        new KeyboardEvent('keydown', { key: 'F7', shiftKey: true }),
        'editor'
      )
    ).toBe(true);
    expect(editor.getState().activeIndex).toBe(0);
    expect(
      runScopeHandlers(
        editor.view,
        new KeyboardEvent('keydown', { key: '1', ctrlKey: true }),
        'editor'
      )
    ).toBe(true);
    expect(editor.getState().decisions).toEqual({ 0: 'C' });
    expect(editor.getState().activeIndex).toBe(1);
    editor.destroy();
  });

  it('clears the active region after the final decision and reports it to observers', () => {
    const observed: number[] = [];
    const single = session({
      content: content.slice(0, content.indexOf('between')),
      regions: [session().regions[0]],
    });
    const editor = createMergeResolutionEditor(document.body, single, {
      onStateChange: (state) => observed.push(state.activeIndex ?? -1),
    });
    Array.from(document.querySelectorAll('button'))
      .find((button) => button.textContent === 'Take Current')
      ?.click();

    expect(editor.getState().activeIndex).toBeNull();
    expect(observed.at(-1)).toBe(-1);
    editor.destroy();
  });

  it('makes a read-only session non-editable and refuses widget and shortcut decisions', () => {
    const editor = createMergeResolutionEditor(document.body, session({ readOnly: true }));
    Array.from(document.querySelectorAll('button'))
      .find((button) => button.textContent === 'Take Current')
      ?.click();
    runScopeHandlers(
      editor.view,
      new KeyboardEvent('keydown', { key: '1', ctrlKey: true }),
      'editor'
    );

    expect(editor.view.state.facet(EditorState.readOnly)).toBe(true);
    expect(editor.getResult()).toBe(content);
    expect(editor.getState().decisions).toEqual({});
    editor.destroy();
  });

  it('freezes widget, shortcut, history, and document mutations until released', () => {
    const editor = createMergeResolutionEditor(document.body, session());
    Array.from(document.querySelectorAll('button'))
      .find((button) => button.textContent === 'Take Current')
      ?.click();
    const resultBeforeFreeze = editor.getResult();
    const stateBeforeFreeze = editor.getState();

    editor.setFrozen(true);

    expect(editor.view.state.facet(EditorState.readOnly)).toBe(true);
    const current = Array.from(document.querySelectorAll('button')).find(
      (button) => button.textContent === 'Take Current'
    ) as HTMLButtonElement;
    const order = document.querySelector('.cm-mergeResolution-order') as HTMLButtonElement;
    expect(current.disabled).toBe(true);
    expect(order.disabled).toBe(true);
    current.click();
    order.click();
    editor.view.dispatch({ changes: { from: 0, to: 0, insert: 'blocked ' } });
    runScopeHandlers(
      editor.view,
      new KeyboardEvent('keydown', { key: '1', ctrlKey: true }),
      'editor'
    );
    runScopeHandlers(
      editor.view,
      new KeyboardEvent('keydown', { key: 'z', ctrlKey: true }),
      'editor'
    );

    expect(editor.undo()).toBe(false);
    expect(editor.getResult()).toBe(resultBeforeFreeze);
    expect(editor.getState()).toEqual(stateBeforeFreeze);

    editor.setFrozen(false);
    expect(editor.view.state.facet(EditorState.readOnly)).toBe(false);
    expect(editor.undo()).toBe(true);
    editor.destroy();
  });
});
