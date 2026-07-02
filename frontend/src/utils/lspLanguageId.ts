interface LSPFileInfo {
  languageId: string;
  family: string;
}

/**
 * Maps file extensions to LSP language and server-family metadata.
 * Must stay in sync with internal/lsp/registry.go extensionMap.
 */
const extensionToLSPInfo: Record<string, LSPFileInfo> = {
  ts: { languageId: 'typescript', family: 'typescript' },
  tsx: { languageId: 'typescriptreact', family: 'typescript' },
  js: { languageId: 'javascript', family: 'typescript' },
  jsx: { languageId: 'javascriptreact', family: 'typescript' },
  mts: { languageId: 'typescript', family: 'typescript' },
  cts: { languageId: 'typescript', family: 'typescript' },
  mjs: { languageId: 'javascript', family: 'typescript' },
  cjs: { languageId: 'javascript', family: 'typescript' },
  go: { languageId: 'go', family: 'go' },
  py: { languageId: 'python', family: 'python' },
  pyw: { languageId: 'python', family: 'python' },
  pyi: { languageId: 'python', family: 'python' },
};

function lspInfoForFile(filename: string): LSPFileInfo | undefined {
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return extensionToLSPInfo[ext];
}

/**
 * Returns the LSP languageId for the given filename, or empty string if unsupported.
 */
export function languageIdForFile(filename: string): string {
  return lspInfoForFile(filename)?.languageId ?? '';
}

/**
 * Returns the LSP server family for the given filename, or empty string if unsupported.
 */
export function lspFamilyForFile(filename: string): string {
  return lspInfoForFile(filename)?.family ?? '';
}
