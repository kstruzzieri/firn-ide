/**
 * Maps file extensions to LSP languageId strings.
 * Must stay in sync with internal/lsp/registry.go extensionMap.
 */
const extensionToLanguageId: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescriptreact',
  js: 'javascript',
  jsx: 'javascriptreact',
  mts: 'typescript',
  cts: 'typescript',
  mjs: 'javascript',
  cjs: 'javascript',
};

/**
 * Returns the LSP languageId for the given filename, or empty string if unsupported.
 */
export function languageIdForFile(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return extensionToLanguageId[ext] ?? '';
}
