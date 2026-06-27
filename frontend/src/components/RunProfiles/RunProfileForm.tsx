import { useMemo, useRef, useState } from 'react';
import { SaveRunProfile, DeleteRunProfile, OpenFolderDialog } from '../../../wailsjs/go/main/App';
import type { runprofile } from '../../../wailsjs/go/models';
import {
  useIDEStore,
  useWorkspace,
  useWorkspaces,
  useActiveWorkspaceId,
  useRunProfiles,
} from '../../stores/ideStore';
import type { ProfileTag, RunProfile } from '../../types/runProfile';
import {
  buildProfileFromForm,
  duplicateEnvKeys,
  mapToEnvRows,
  relativizeWorkingDir,
  seedName,
  type EnvRow,
  type RunProfileFormValues,
} from '../../utils/runProfileForm';
import styles from './RunProfileForm.module.css';

const ALL_TAGS: ProfileTag[] = ['build', 'test', 'dev', 'lint', 'deploy'];
const OTHER = '__other__';

interface RunProfileFormProps {
  state: { mode: 'create' } | { mode: 'edit'; profile: RunProfile };
}

function initialValues(
  state: RunProfileFormProps['state'],
  activeWorkspaceId: string
): RunProfileFormValues {
  if (state.mode === 'edit') {
    const p = state.profile;
    return {
      name: p.name,
      command: p.command ?? '',
      workingDir: p.workingDir ?? '',
      envRows: mapToEnvRows(p.env),
      envFile: p.envFile ?? '',
      tags: p.tags ? [...p.tags] : [],
      workspaceId: p.workspaceId ?? activeWorkspaceId,
    };
  }
  return {
    name: '',
    command: '',
    workingDir: '',
    envRows: [],
    envFile: '',
    tags: [],
    workspaceId: activeWorkspaceId,
  };
}

export function RunProfileForm({ state }: RunProfileFormProps) {
  // Controlled child: RunProfiles mounts this only while the store form-state is
  // set, and the form clears it via close() on cancel / successful save / delete.
  const close = useIDEStore((s) => s.closeRunProfileForm);
  const workspace = useWorkspace();
  const workspaces = useWorkspaces();
  const activeWorkspaceId = useActiveWorkspaceId();
  const allProfiles = useRunProfiles();

  const [values, setValues] = useState<RunProfileFormValues>(() =>
    initialValues(state, activeWorkspaceId)
  );
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [dirError, setDirError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  // For the "clear seeded tags when customizing and command changes" rule.
  const customizing = state.mode === 'edit' && state.profile.source === 'detected';
  const seededCommand = useRef(values.command);
  const seededTags = useRef(values.tags.length > 0);

  const isEdit = state.mode === 'edit';
  const isUserProfile = state.mode === 'edit' && state.profile.source === 'user';
  const title = !isEdit ? 'New Profile' : customizing ? 'Customize Profile' : 'Edit Profile';

  const detectedOptions = useMemo(() => {
    const selected = workspaces.find((w) => w.id === values.workspaceId);
    return allProfiles.filter(
      (p) =>
        p.source === 'detected' &&
        p.type === 'single' &&
        (p.workspaceId === values.workspaceId ||
          (selected != null && p.workspaceRelDir === selected.relDir))
    );
  }, [allProfiles, workspaces, values.workspaceId]);

  const dupKeys = duplicateEnvKeys(values.envRows);
  const canSave =
    values.name.trim() !== '' && values.command.trim() !== '' && dupKeys.length === 0 && !saving;

  const patch = (p: Partial<RunProfileFormValues>) => setValues((v) => ({ ...v, ...p }));

  const onPickStartFrom = (id: string) => {
    if (id === OTHER || id === '') {
      patch({ name: '', command: '', workingDir: '', tags: [] });
      seededCommand.current = '';
      seededTags.current = false;
      return;
    }
    const src = detectedOptions.find((p) => p.id === id);
    if (!src) return;
    const name = seedName(src);
    const command = src.command ?? '';
    patch({
      name,
      command,
      workingDir: src.workingDir ?? '',
      tags: src.tags ? [...src.tags] : [],
    });
    seededCommand.current = command;
    seededTags.current = (src.tags?.length ?? 0) > 0;
  };

  const onCommandChange = (command: string) => {
    // Customizing a detected profile: clear copied tags once the command diverges
    // from the seed, so stale build/test badges don't ride along.
    if (customizing && seededTags.current && command !== seededCommand.current) {
      seededTags.current = false;
      patch({ command, tags: [] });
      return;
    }
    patch({ command });
  };

  const onBrowse = async () => {
    setDirError(null);
    const root = workspace?.path;
    const picked = await OpenFolderDialog();
    if (!picked) return;
    if (!root) {
      patch({ workingDir: picked });
      return;
    }
    const rel = relativizeWorkingDir(picked, root);
    if (!rel.ok) {
      setDirError('Folder must be inside the workspace.');
      return;
    }
    patch({ workingDir: rel.relDir });
  };

  const addEnvRow = () => patch({ envRows: [...values.envRows, { key: '', value: '' }] });
  const updateEnvRow = (i: number, row: EnvRow) =>
    patch({ envRows: values.envRows.map((r, idx) => (idx === i ? row : r)) });
  const removeEnvRow = (i: number) =>
    patch({ envRows: values.envRows.filter((_, idx) => idx !== i) });

  const onSave = async () => {
    if (!canSave) return;
    setSaving(true);
    setFormError(null);
    setFieldErrors({});
    try {
      const profile = buildProfileFromForm(values, state);
      // The Wails-generated runprofile.RunProfile carries a convertValues helper
      // the plain app type lacks; the binding only serializes the data, so cast.
      const result = await SaveRunProfile(profile as unknown as runprofile.RunProfile);
      if (result.valid) {
        close(); // backend emits runprofiles:changed → list refreshes
        return;
      }
      const errs: Record<string, string> = {};
      for (const e of result.errors ?? []) errs[e.field] = e.message;
      setFieldErrors(errs);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const onDelete = async () => {
    if (state.mode !== 'edit') return;
    setSaving(true);
    setFormError(null);
    try {
      await DeleteRunProfile(state.profile.id);
      close();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
      setSaving(false);
      setConfirmingDelete(false);
    }
  };

  const multiWorkspace = workspaces.length > 1;
  const variantCount = state.mode === 'edit' ? (state.profile.envVariants?.length ?? 0) : 0;

  return (
    <div className={styles.form}>
      <div className={styles.header}>
        <button className={styles.back} onClick={close} aria-label="Back to profiles">
          ←
        </button>
        <span className={styles.title}>{title}</span>
        <button className={styles.cancel} onClick={close}>
          Cancel
        </button>
        <button className={styles.save} onClick={onSave} disabled={!canSave} aria-label="Save">
          {saving ? 'Saving…' : 'Save'}
        </button>
      </div>

      <div className={styles.body}>
        {formError && <div className={styles.formError}>{formError}</div>}

        {!isEdit && (
          <label className={styles.group}>
            <span className={styles.label}>Start from</span>
            <select
              className={styles.input}
              defaultValue=""
              onChange={(e) => onPickStartFrom(e.target.value)}
              aria-label="Start from detected command"
            >
              <option value="">Choose a detected command…</option>
              {detectedOptions.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} — {p.command}
                </option>
              ))}
              <option value={OTHER}>Other — enter manually…</option>
            </select>
          </label>
        )}

        {!isEdit && multiWorkspace && (
          <label className={styles.group}>
            <span className={styles.label}>Workspace</span>
            <select
              className={styles.input}
              value={values.workspaceId}
              onChange={(e) => patch({ workspaceId: e.target.value })}
              aria-label="Workspace"
            >
              {workspaces.map((w) => (
                <option key={w.id} value={w.id}>
                  {w.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className={styles.group}>
          <span className={`${styles.label} ${styles.required}`}>Name</span>
          <input
            className={styles.input}
            value={values.name}
            onChange={(e) => patch({ name: e.target.value })}
            aria-label="Name"
          />
          {fieldErrors.name && <span className={styles.fieldError}>{fieldErrors.name}</span>}
        </label>

        <label className={styles.group}>
          <span className={`${styles.label} ${styles.required}`}>Command</span>
          <input
            className={`${styles.input} ${styles.mono}`}
            value={values.command}
            onChange={(e) => onCommandChange(e.target.value)}
            aria-label="Command"
          />
          {fieldErrors.command && <span className={styles.fieldError}>{fieldErrors.command}</span>}
        </label>

        <div className={styles.group}>
          <span className={styles.label}>Working directory</span>
          <div className={styles.dirRow}>
            <input
              className={`${styles.input} ${styles.mono}`}
              value={values.workingDir}
              placeholder="workspace folder"
              onChange={(e) => patch({ workingDir: e.target.value })}
              aria-label="Working directory"
            />
            <button className={styles.browse} onClick={onBrowse} aria-label="Browse">
              Browse…
            </button>
          </div>
          {dirError && <span className={styles.fieldError}>{dirError}</span>}
        </div>

        <div className={styles.group}>
          <span className={styles.label}>Environment variables</span>
          {values.envRows.map((row, i) => (
            <div className={styles.envRow} key={i}>
              <input
                className={`${styles.input} ${styles.mono}`}
                value={row.key}
                placeholder="KEY"
                aria-label={`Env key ${i + 1}`}
                onChange={(e) => updateEnvRow(i, { ...row, key: e.target.value })}
              />
              <span className={styles.eq}>=</span>
              <input
                className={`${styles.input} ${styles.mono}`}
                value={row.value}
                placeholder="value"
                aria-label={`Env value ${i + 1}`}
                onChange={(e) => updateEnvRow(i, { ...row, value: e.target.value })}
              />
              <button
                className={styles.removeRow}
                onClick={() => removeEnvRow(i)}
                aria-label={`Remove env row ${i + 1}`}
              >
                ×
              </button>
            </div>
          ))}
          {dupKeys.length > 0 && (
            <span className={styles.fieldError}>Duplicate env key: {dupKeys.join(', ')}</span>
          )}
          <button className={styles.addRow} onClick={addEnvRow}>
            + Add variable
          </button>
        </div>

        <label className={styles.group}>
          <span className={styles.label}>Env file</span>
          <input
            className={`${styles.input} ${styles.mono}`}
            value={values.envFile}
            placeholder=".env.local"
            onChange={(e) => patch({ envFile: e.target.value })}
            aria-label="Env file"
          />
        </label>

        {values.tags.length > 0 && (
          <div className={styles.group}>
            <span className={styles.label}>Tags</span>
            <div className={styles.tags}>
              {ALL_TAGS.filter((t) => values.tags.includes(t)).map((t) => (
                <span key={t} className={styles.tag}>
                  {t}
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {(isUserProfile || variantCount > 0) && (
        <div className={styles.deleteRow}>
          {isUserProfile &&
            (confirmingDelete ? (
              <>
                <button
                  className={styles.deleteConfirm}
                  onClick={onDelete}
                  aria-label="Confirm delete"
                >
                  Confirm delete
                </button>
                <button className={styles.cancel} onClick={() => setConfirmingDelete(false)}>
                  Cancel
                </button>
              </>
            ) : (
              <button
                className={styles.delete}
                onClick={() => setConfirmingDelete(true)}
                aria-label="Delete profile"
              >
                Delete profile
              </button>
            ))}
          {variantCount > 0 && (
            <span className={styles.variantNote}>{variantCount} variants preserved</span>
          )}
        </div>
      )}
    </div>
  );
}
