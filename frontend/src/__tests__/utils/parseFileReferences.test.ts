import { parseFileReferences, resolveFileReferencePath } from '../../utils/parseFileReferences';

describe('parseFileReferences', () => {
  it('parses Go file:line:column output', () => {
    const references = parseFileReferences('main.go:42:5: undefined: value');

    expect(references).toEqual([
      {
        path: 'main.go',
        line: 42,
        column: 5,
        startIndex: 0,
        endIndex: 'main.go:42:5'.length,
        text: 'main.go:42:5',
      },
    ]);
  });

  it('parses Node and TypeScript stack frames inside parentheses', () => {
    const line = '    at Object.<anonymous> (src/index.ts:15:3)';
    const references = parseFileReferences(line);

    expect(references).toHaveLength(1);
    expect(references[0]).toMatchObject({
      path: 'src/index.ts',
      line: 15,
      column: 3,
      text: 'src/index.ts:15:3',
    });
    expect(references[0].startIndex).toBe(line.indexOf('src/index.ts'));
  });

  it('parses parenthesized stack paths that contain spaces', () => {
    const line = '    at main (/repo/My Project/src/index.ts:15:3)';
    const references = parseFileReferences(line);

    expect(references).toHaveLength(1);
    expect(references[0]).toMatchObject({
      path: '/repo/My Project/src/index.ts',
      line: 15,
      column: 3,
      text: '/repo/My Project/src/index.ts:15:3',
    });
  });

  it('parses bare TSX diagnostics', () => {
    const references = parseFileReferences(
      'src/components/Button.tsx:42:5 - error TS2741: Property missing'
    );

    expect(references).toHaveLength(1);
    expect(references[0]).toMatchObject({
      path: 'src/components/Button.tsx',
      line: 42,
      column: 5,
      text: 'src/components/Button.tsx:42:5',
    });
  });

  it('parses Python traceback frames with a default column', () => {
    const line = '  File "app.py", line 42, in <module>';
    const references = parseFileReferences(line);

    expect(references).toEqual([
      {
        path: 'app.py',
        line: 42,
        column: 1,
        startIndex: 2,
        endIndex: 24,
        text: 'File "app.py", line 42',
      },
    ]);
  });

  it('parses multiple references in one line', () => {
    const references = parseFileReferences('src/a.ts:1:2 -> src/b.ts:3:4');

    expect(references.map((reference) => reference.path)).toEqual(['src/a.ts', 'src/b.ts']);
    expect(references.map((reference) => [reference.line, reference.column])).toEqual([
      [1, 2],
      [3, 4],
    ]);
  });
});

describe('resolveFileReferencePath', () => {
  it('resolves relative references against a relative profile working directory', () => {
    expect(resolveFileReferencePath('src/App.tsx', 'frontend', '/repo')).toBe(
      '/repo/frontend/src/App.tsx'
    );
  });

  it('falls back to the workspace path when the profile has no working directory', () => {
    expect(resolveFileReferencePath('main.go', undefined, '/repo')).toBe('/repo/main.go');
  });

  it('keeps absolute references absolute', () => {
    expect(resolveFileReferencePath('/tmp/project/main.go', 'frontend', '/repo')).toBe(
      '/tmp/project/main.go'
    );
  });

  it('normalizes dot segments while resolving', () => {
    expect(resolveFileReferencePath('../pkg/main.go', 'cmd/server', '/repo/app')).toBe(
      '/repo/app/cmd/pkg/main.go'
    );
  });
});
