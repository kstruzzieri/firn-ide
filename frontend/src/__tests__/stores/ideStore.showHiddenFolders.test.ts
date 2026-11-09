import { renderHook } from '@testing-library/react';
import {
  loadInitialShowHiddenFolders,
  useIDEStore,
  useShowHiddenFolders,
} from '../../stores/ideStore';

// #450: the file explorer's Show hidden folders toggle applies to every
// project and survives a restart, like the editor syntax theme.
const KEY = 'firn.showHiddenFolders';

describe('showHiddenFolders store slice', () => {
  beforeEach(() => {
    localStorage.clear();
    useIDEStore.getState().setShowHiddenFolders(true);
  });

  afterEach(() => {
    jest.restoreAllMocks();
    localStorage.clear();
  });

  it('persists a change and exposes it through the selector hook', () => {
    useIDEStore.getState().setShowHiddenFolders(false);
    expect(localStorage.getItem(KEY)).toBe('false');
    const { result } = renderHook(() => useShowHiddenFolders());
    expect(result.current).toBe(false);

    useIDEStore.getState().setShowHiddenFolders(true);
    expect(localStorage.getItem(KEY)).toBe('true');
  });

  it('still updates when storage refuses the write', () => {
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    useIDEStore.getState().setShowHiddenFolders(false);
    expect(useIDEStore.getState().showHiddenFolders).toBe(false);
  });
});

describe('loadInitialShowHiddenFolders', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    localStorage.clear();
  });

  it('defaults to shown when nothing is stored', () => {
    expect(loadInitialShowHiddenFolders()).toBe(true);
  });

  it('reads a stored choice', () => {
    localStorage.setItem(KEY, 'false');
    expect(loadInitialShowHiddenFolders()).toBe(false);
    localStorage.setItem(KEY, 'true');
    expect(loadInitialShowHiddenFolders()).toBe(true);
  });

  it('falls back to shown when storage throws', () => {
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('unavailable');
    });
    expect(loadInitialShowHiddenFolders()).toBe(true);
  });
});
