import { readFileSync } from 'fs';
import { relative, resolve } from 'path';
import ts from 'typescript';

const sourceRoot = resolve(__dirname, '..');

it('requires exactly one explicit type on every production button', () => {
  const invalid: string[] = [];
  const files = ts.sys.readDirectory(
    sourceRoot,
    ['.tsx'],
    ['**/__tests__/**', '**/*.test.tsx', '**/*.spec.tsx'],
    ['**/*.tsx']
  );

  for (const file of files) {
    const source = ts.createSourceFile(
      file,
      readFileSync(file, 'utf8'),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX
    );

    const visit = (node: ts.Node) => {
      if (
        (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) &&
        node.tagName.getText(source) === 'button'
      ) {
        const typeCount = node.attributes.properties.filter(
          (property) => ts.isJsxAttribute(property) && property.name.getText(source) === 'type'
        ).length;
        const { line } = source.getLineAndCharacterOfPosition(node.getStart(source));
        if (typeCount !== 1) {
          invalid.push(`${relative(sourceRoot, file)}:${line + 1} (${typeCount} types)`);
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(source);
  }

  expect(invalid).toEqual([]);
});
