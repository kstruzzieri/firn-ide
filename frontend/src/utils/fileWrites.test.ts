jest.mock('../../wailsjs/go/main/App', () => ({
  WriteFile: jest.fn(),
}));

import { WriteFile } from '../../wailsjs/go/main/App';
import { isWritableFormat, saveOpenFileToDisk } from './fileWrites';
import { useIDEStore, type EditorFile } from '../stores/ideStore';

const mockWriteFile = WriteFile as jest.MockedFunction<typeof WriteFile>;

const file = (over: Partial<EditorFile> = {}): EditorFile => ({
  id: 'f1',
  name: 'conflicted.ts',
  path: '/repo/src/conflicted.ts',
  language: 'typescript',
  encoding: 'utf-8',
  lineEndings: 'lf',
  content: 'buffer content',
  isModified: true,
  ...over,
});

beforeEach(() => {
  jest.clearAllMocks();
  mockWriteFile.mockResolvedValue(undefined);
  useIDEStore.setState({ openFiles: [] });
});

describe('isWritableFormat', () => {
  it('accepts the encodings and line endings WriteFile can round-trip', () => {
    expect(isWritableFormat('utf-8', 'lf')).toBe(true);
    expect(isWritableFormat('utf-8-bom', 'crlf')).toBe(true);
    expect(isWritableFormat('utf-16le', 'none')).toBe(true);
  });

  it('rejects formats WriteFile would re-encode lossily', () => {
    expect(isWritableFormat('latin-1', 'lf')).toBe(false);
    expect(isWritableFormat('utf-8', 'mixed')).toBe(false);
    expect(isWritableFormat(undefined, 'lf')).toBe(false);
    expect(isWritableFormat('utf-8', undefined)).toBe(false);
  });
});

describe('saveOpenFileToDisk', () => {
  it('resolves without writing when the file is not open', async () => {
    await saveOpenFileToDisk('/repo/src/conflicted.ts');
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('resolves without writing when the open buffer is clean', async () => {
    useIDEStore.setState({ openFiles: [file({ isModified: false })] });
    await saveOpenFileToDisk('/repo/src/conflicted.ts');
    expect(mockWriteFile).not.toHaveBeenCalled();
  });

  it('writes a dirty buffer to disk with its encoding and clears isModified', async () => {
    useIDEStore.setState({ openFiles: [file({ encoding: 'utf-8-bom', lineEndings: 'crlf' })] });

    await saveOpenFileToDisk('/repo/src/conflicted.ts');

    expect(mockWriteFile).toHaveBeenCalledWith(
      '/repo/src/conflicted.ts',
      'buffer content',
      'utf-8-bom',
      'crlf',
      false
    );
    expect(useIDEStore.getState().openFiles[0].isModified).toBe(false);
  });

  it('loops until the buffer is stable when an edit lands mid-write', async () => {
    useIDEStore.setState({ openFiles: [file()] });
    // First write races with a keystroke: mutate the buffer while the write is
    // in flight, so the flush must write again with the newer content.
    mockWriteFile.mockImplementationOnce(async () => {
      useIDEStore.setState({
        openFiles: [file({ content: 'newer content', isModified: true })],
      });
    });

    await saveOpenFileToDisk('/repo/src/conflicted.ts');

    expect(mockWriteFile).toHaveBeenCalledTimes(2);
    expect(mockWriteFile).toHaveBeenLastCalledWith(
      '/repo/src/conflicted.ts',
      'newer content',
      'utf-8',
      'lf',
      false
    );
    expect(useIDEStore.getState().openFiles[0].isModified).toBe(false);
  });

  it('does not clear isModified when the write itself fails', async () => {
    useIDEStore.setState({ openFiles: [file()] });
    mockWriteFile.mockRejectedValueOnce(new Error('disk full'));

    await expect(saveOpenFileToDisk('/repo/src/conflicted.ts')).rejects.toThrow('disk full');
    expect(useIDEStore.getState().openFiles[0].isModified).toBe(true);
  });
});
