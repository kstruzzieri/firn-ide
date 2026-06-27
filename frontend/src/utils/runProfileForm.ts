import type { ProfileTag, RunProfile } from '../types/runProfile';

export interface EnvRow {
  key: string;
  value: string;
}

export interface RunProfileFormValues {
  name: string;
  command: string;
  workingDir: string;
  envRows: EnvRow[];
  envFile: string;
  tags: ProfileTag[];
  workspaceId: string;
}

export type FormState = null | { mode: 'create' } | { mode: 'edit'; profile: RunProfile };

/** Seed a descriptive name: "<Workspace> — <command>", or the bare name for
 *  repo-root / workspace-less profiles. */
export function seedName(profile: RunProfile): string {
  const ws = profile.workspaceName?.trim();
  if (!ws || !profile.workspaceRelDir) {
    return profile.name;
  }
  return `${ws} — ${profile.name}`;
}

/** Build the env map: trim keys, skip fully-empty and empty-key rows. */
export function envRowsToMap(rows: EnvRow[]): Record<string, string> | undefined {
  const out: Record<string, string> = {};
  for (const row of rows) {
    const key = row.key.trim();
    if (key === '') continue; // empty key (incl. fully-empty rows) is unusable
    out[key] = row.value;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function mapToEnvRows(env: Record<string, string> | undefined): EnvRow[] {
  if (!env) return [];
  return Object.entries(env).map(([key, value]) => ({ key, value }));
}

/** Non-empty keys (after trim) that appear more than once. */
export function duplicateEnvKeys(rows: EnvRow[]): string[] {
  const seen = new Set<string>();
  const dups = new Set<string>();
  for (const row of rows) {
    const key = row.key.trim();
    if (key === '') continue;
    if (seen.has(key)) dups.add(key);
    else seen.add(key);
  }
  return [...dups];
}

function normPath(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '');
}

/** Relativize an absolute picked dir against the repo root.
 *  ponytail: POSIX/Windows separator-normalized prefix match; no symlink resolution. */
export function relativizeWorkingDir(
  absPicked: string,
  repoRoot: string
): { ok: true; relDir: string } | { ok: false } {
  const root = normPath(repoRoot);
  const picked = normPath(absPicked);
  if (picked === root) return { ok: true, relDir: '' };
  const prefix = root + '/';
  if (picked.startsWith(prefix)) return { ok: true, relDir: picked.slice(prefix.length) };
  return { ok: false };
}

function defaultGenId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  // Fallback for environments without crypto.randomUUID.
  return 'user-' + Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/** Build a RunProfile from form values. Create mints a fresh id; edit reuses
 *  profile.id and carries through variants/order/workspace metadata. */
export function buildProfileFromForm(
  values: RunProfileFormValues,
  base: { mode: 'create' } | { mode: 'edit'; profile: RunProfile },
  genId: () => string = defaultGenId
): RunProfile {
  const carried = base.mode === 'edit' ? base.profile : undefined;
  const workingDir = values.workingDir.trim();
  const envFile = values.envFile.trim();
  return {
    id: base.mode === 'create' ? genId() : base.profile.id,
    name: values.name.trim(),
    command: values.command.trim(),
    type: 'single',
    source: 'user',
    workingDir: workingDir || undefined,
    env: envRowsToMap(values.envRows),
    envFile: envFile || undefined,
    tags: values.tags.length > 0 ? [...values.tags] : undefined,
    workspaceId: values.workspaceId,
    envVariants: carried?.envVariants,
    activeVariant: carried?.activeVariant,
    order: carried?.order,
    workspaceName: carried?.workspaceName,
    workspaceRelDir: carried?.workspaceRelDir,
  };
}
