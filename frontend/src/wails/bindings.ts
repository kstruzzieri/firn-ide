// Single stable import surface for the generated Wails bindings.
// This file and runtime.ts are the ONLY places allowed to reference
// wailsjs paths (enforced by no-direct-wailsjs.test.ts). The v3
// migration swaps the re-export targets here without touching consumers.
export * from '../../wailsjs/go/main/App';
// Re-exports every model namespace (ai, filesystem, git, lsp, main,
// runhistory, runprofile, search, workspace) so this stays in sync with
// models.ts without an explicit name list to maintain.
export * from '../../wailsjs/go/models';
