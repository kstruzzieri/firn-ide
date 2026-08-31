// Single stable import surface for the generated Wails bindings.
// This file and runtime.ts are the ONLY places allowed to reference
// wailsjs paths (enforced by no-direct-wailsjs.test.ts). The v3
// migration swaps the re-export targets here without touching consumers.
export * from '../../wailsjs/go/main/App';
export {
  ai,
  filesystem,
  git,
  lsp,
  main,
  runhistory,
  runprofile,
  search,
  workspace,
} from '../../wailsjs/go/models';
