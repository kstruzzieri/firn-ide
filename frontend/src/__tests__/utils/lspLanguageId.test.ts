import { languageIdForFile, lspFamilyForFile } from '../../utils/lspLanguageId';

describe('lspLanguageId', () => {
  it.each([
    ['main.ts', 'typescript', 'typescript'],
    ['component.tsx', 'typescriptreact', 'typescript'],
    ['script.js', 'javascript', 'typescript'],
    ['view.jsx', 'javascriptreact', 'typescript'],
    ['main.go', 'go', 'go'],
    ['MAIN.GO', 'go', 'go'],
    ['main.rs', 'rust', 'rust'],
    ['app.py', 'python', 'python'],
    ['APP.PY', 'python', 'python'],
    ['app.pyw', 'python', 'python'],
    ['types.pyi', 'python', 'python'],
  ])('maps %s to language=%s family=%s', (filename, languageId, family) => {
    expect(languageIdForFile(filename)).toBe(languageId);
    expect(lspFamilyForFile(filename)).toBe(family);
  });

  it('returns empty strings for unsupported files', () => {
    expect(languageIdForFile('README.md')).toBe('');
    expect(lspFamilyForFile('README.md')).toBe('');
  });
});
