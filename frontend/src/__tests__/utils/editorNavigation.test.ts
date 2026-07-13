import { ensureEditorFileOpen, navigateToEditorLocation } from '../../utils/editorNavigation';
import { useIDEStore } from '../../stores/ideStore';
import { toNativeLocalPath } from '../../utils/lspUri';
import { ReadFile, WriteFile } from '../../../wailsjs/go/main/App';
import { queueWorkingTreeEdit } from '../../utils/fileWrites';

jest.mock('../../../wailsjs/go/main/App', () => ({
  ReadFile: jest.fn(),
  WriteFile: jest.fn(),
}));

const mockReadFile = ReadFile as jest.MockedFunction<typeof ReadFile>;
const mockWriteFile = WriteFile as jest.MockedFunction<typeof WriteFile>;

function createReadFileResult(content: string) {
  return {
    content,
    encoding: 'utf-8',
    lineEndings: 'LF',
    size: content.length,
    isBinary: false,
  };
}

beforeEach(() => {
  useIDEStore.setState(useIDEStore.getInitialState());
  jest.clearAllMocks();
  mockWriteFile.mockResolvedValue(undefined);
});

describe('ensureEditorFileOpen', () => {
  it('returns existing file and activates it when already open', async () => {
    useIDEStore.getState().openFile({
      id: '/test/file.ts',
      name: 'file.ts',
      path: '/test/file.ts',
      language: 'typescript',
      encoding: 'utf-8',
      lineEndings: 'LF',
      content: 'const x = 1;',
      isModified: false,
    });

    const file = await ensureEditorFileOpen('/test/file.ts');
    expect(file).not.toBeNull();
    expect(file!.id).toBe('/test/file.ts');
    expect(useIDEStore.getState().activeFileId).toBe('/test/file.ts');
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it('reads and opens a new file', async () => {
    mockReadFile.mockResolvedValue(createReadFileResult('hello world') as never);

    const file = await ensureEditorFileOpen('/test/new.ts');
    expect(file).not.toBeNull();
    expect(file!.name).toBe('new.ts');
    expect(file!.language).toBe('TypeScript');
    expect(useIDEStore.getState().openFiles).toHaveLength(1);
  });

  it('flushes a pending diff edit before reading the file into an editor buffer', async () => {
    queueWorkingTreeEdit({
      absPath: '/test/pending.ts',
      displayPath: 'pending.ts',
      content: 'latest diff text',
      encoding: 'utf-8',
      lineEndings: 'lf',
    });
    mockReadFile.mockResolvedValue(createReadFileResult('latest diff text') as never);

    await ensureEditorFileOpen('/test/pending.ts');

    expect(mockWriteFile).toHaveBeenCalledWith(
      '/test/pending.ts',
      'latest diff text',
      'utf-8',
      'lf',
      false
    );
    expect(mockWriteFile.mock.invocationCallOrder[0]).toBeLessThan(
      mockReadFile.mock.invocationCallOrder[0]
    );
  });

  it('reuses an already-open file when the requested path is slash-normalized', async () => {
    // Open a file under its backslash form
    const storedId = 'C:\\Users\\dev\\project\\file.ts';
    useIDEStore.getState().openFile({
      id: storedId,
      name: 'file.ts',
      path: storedId,
      language: 'TypeScript',
      encoding: 'utf-8',
      lineEndings: 'LF',
      content: 'const x = 1;',
      isModified: true,
    });

    // Request with forward-slash lowercase form — should find the existing file
    const file = await ensureEditorFileOpen('c:/Users/dev/project/file.ts');

    expect(file).not.toBeNull();
    expect(file!.id).toBe(storedId);
    expect(useIDEStore.getState().activeFileId).toBe(storedId);
    expect(mockReadFile).not.toHaveBeenCalled();
  });

  it('stores new files using the native path form', async () => {
    mockReadFile.mockResolvedValue(createReadFileResult('const x = 1;') as never);

    const inputPath = 'c:/Users/dev/project/file.ts';
    const file = await ensureEditorFileOpen(inputPath);

    // toNativeLocalPath determines the expected form for this platform
    const expectedPath = toNativeLocalPath(inputPath);
    expect(mockReadFile).toHaveBeenCalledWith(expectedPath);
    expect(file).not.toBeNull();
    expect(file!.id).toBe(expectedPath);
    expect(file!.name).toBe('file.ts');
    expect(file!.language).toBe('TypeScript');
  });

  it('shows toast and returns null for binary files', async () => {
    mockReadFile.mockResolvedValue({
      content: '',
      encoding: '',
      lineEndings: '',
      isBinary: true,
    } as never);

    const file = await ensureEditorFileOpen('/test/image.png');
    expect(file).toBeNull();
    expect(useIDEStore.getState().toast?.type).toBe('error');
  });

  it('shows toast and returns null when read fails', async () => {
    mockReadFile.mockRejectedValue(new Error('File not found'));

    const file = await ensureEditorFileOpen('/test/missing.ts');
    expect(file).toBeNull();
    expect(useIDEStore.getState().toast?.message).toContain('File not found');
  });
});

describe('navigateToEditorLocation', () => {
  it('opens file and requests navigation', async () => {
    mockReadFile.mockResolvedValue(createReadFileResult('line1\nline2\nline3') as never);

    await navigateToEditorLocation('/test/file.ts', 2, 5);

    expect(useIDEStore.getState().openFiles).toHaveLength(1);
    const nav = useIDEStore.getState().pendingEditorNavigation;
    expect(nav).not.toBeNull();
    expect(nav!.fileId).toBe('/test/file.ts');
    expect(nav!.line).toBe(2);
    expect(nav!.column).toBe(5);
  });

  it('does not request navigation when file open fails', async () => {
    mockReadFile.mockRejectedValue(new Error('Not found'));

    await navigateToEditorLocation('/test/missing.ts', 1, 1);

    expect(useIDEStore.getState().pendingEditorNavigation).toBeNull();
  });

  it('does not open or navigate when shouldApply turns false while reading', async () => {
    useIDEStore.setState({ workspace: { name: 'Workspace A', path: '/workspace-a' } });
    let resolveRead!: (value: ReturnType<typeof createReadFileResult>) => void;
    mockReadFile.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRead = resolve;
        })
    );

    const navigation = navigateToEditorLocation('/workspace-a/file.ts', 2, 5, {
      shouldApply: () => useIDEStore.getState().workspace?.path === '/workspace-a',
    });
    await Promise.resolve(); // allow the shared pre-open flush to settle

    useIDEStore.setState({ workspace: { name: 'Workspace B', path: '/workspace-b' } });
    resolveRead(createReadFileResult('line1\nline2'));
    await navigation;

    expect(useIDEStore.getState().openFiles).toHaveLength(0);
    expect(useIDEStore.getState().pendingEditorNavigation).toBeNull();
  });

  it('increments revision for repeated navigation to same location', async () => {
    useIDEStore.getState().openFile({
      id: '/test/file.ts',
      name: 'file.ts',
      path: '/test/file.ts',
      language: 'typescript',
      encoding: 'utf-8',
      lineEndings: 'LF',
      content: 'const x = 1;',
      isModified: false,
    });

    await navigateToEditorLocation('/test/file.ts', 1, 1);
    const rev1 = useIDEStore.getState().pendingEditorNavigation!.revision;

    await navigateToEditorLocation('/test/file.ts', 1, 1);
    const rev2 = useIDEStore.getState().pendingEditorNavigation!.revision;

    expect(rev2).toBeGreaterThan(rev1);
  });
});
