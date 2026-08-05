import type { WorkspaceAccent } from '../stores/ideStore';

// Accent values with a defined --accent-* token in styles/tokens.css. Typed
// through WorkspaceAccent so the set stays aligned with the union.
const VALID_ACCENTS: ReadonlySet<string> = new Set<WorkspaceAccent>([
  'project',
  'frontend',
  'go',
  'python',
  'docker',
  'node',
  'terraform',
  'rust',
  'general',
]);

// accentVar maps an accent value to its CSS custom property, falling back to
// the neutral "project" accent for any value without a defined token. Accepts
// undefined because Run Profiles resolve an accent from an optional workspace.
export function accentVar(accent: string | undefined): string {
  return `var(--accent-${accent && VALID_ACCENTS.has(accent) ? accent : 'project'})`;
}
