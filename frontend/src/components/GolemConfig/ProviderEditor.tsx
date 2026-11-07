/**
 * Provider row editor (#263 spec §4.3b, mockup v10).
 *
 * The strip expands into a native `fieldset`: Name (immutable once created —
 * renaming is remove + add), Endpoint, API format, and a write-only API key.
 *
 * The key value lives in this component's state while it is typed and nowhere
 * else. **Done** validates it, hands it to the workspace-root KeyVault,
 * and clears the input; collapsing and reopening never brings it back, because
 * there is nothing to bring back. Clearing the vault is NOT this component's
 * job — that is the reducer's single terminal path (§3.2).
 *
 * Every check here is a pre-check: the backend independently re-validates the
 * name, the endpoint, and the key, and owns every verdict this cannot reach
 * (userinfo, queries, resolvability, collisions against a document that moved).
 */

import { useEffect, useState } from 'react';
import {
  API_FORMATS,
  MAX_ENDPOINT_BYTES,
  NON_ASCII_RUNE,
  isBoundedString,
  isIdentifier,
  type APIFormat,
  type ProviderProjection,
  type SettingsSourceOrigin,
} from '../../types/golem';
import { isKeyValue, type Change, type KeyVault } from '../../types/golemConfig';
import { formatSettingsDiagnostic } from '../../utils/settingsDiagnostics';
import styles from './GolemConfig.module.css';
import { CUSTOM_PRESET_ID, PROVIDER_PRESETS, keyLine, listingLine } from './providerPresets';

/** The one copy vocabulary, shared with the diagnostics the backend returns. */
const copy = (code: Parameters<typeof formatSettingsDiagnostic>[0]): string =>
  formatSettingsDiagnostic(code, '', '').text;

const NAME_INVALID = copy('provider_name_invalid');
const NAME_TAKEN = copy('provider_exists');
const ENDPOINT_INVALID = copy('provider_endpoint_invalid');
const KEY_INVALID = copy('key_value_invalid');
const PROVIDER_IN_USE = copy('provider_in_use');

/** go-llm's NormalizeEndpoint lowercases the scheme before comparing. */
const HTTP_SCHEME = /^https?:\/\//i;

const FORMAT_LABEL: Record<APIFormat, string> = {
  ollama: 'Ollama',
  'openai-compat': 'OpenAI-compatible',
};

export interface ProviderFields {
  name: string;
  endpoint: string;
  apiFormat: APIFormat;
  keyValue: string;
  clearKey: boolean;
}

export interface StagedProviderChanges {
  changes: Change[];
  /** Stable identities this editor owns and is NOT staging, so a change the
   * user has just reverted leaves the draft instead of lingering. */
  drop: string[];
}

/**
 * The changes these fields mean, against the APPLIED provider.
 *
 * An update carries only the members the user actually changed: the projection
 * shows the normalized endpoint, and re-sending it would overwrite a different
 * authored spelling — and every provider member the transport does not model
 * (§4.3b). Provider and key are separate identities, so an add and its key are
 * one ordered sequence rather than one change (§5.2 mutation order).
 */
export function providerChanges(
  applied: ProviderProjection | null,
  fields: ProviderFields,
  stagedKey?: Change
): StagedProviderChanges {
  const name = applied?.name ?? fields.name;
  const changes: Change[] = [];
  const drop: string[] = [];

  if (applied === null) {
    changes.push({
      kind: 'provider-add',
      name,
      endpoint: fields.endpoint,
      apiFormat: fields.apiFormat,
    });
  } else {
    const patch: { endpoint?: string; apiFormat?: APIFormat } = {};
    if (fields.endpoint !== applied.endpoint) patch.endpoint = fields.endpoint;
    if (fields.apiFormat !== applied.apiFormat) patch.apiFormat = fields.apiFormat;
    if (Object.keys(patch).length > 0) changes.push({ kind: 'provider-update', name, ...patch });
    else drop.push(`provider:${name}`);
  }

  if (fields.keyValue !== '') changes.push({ kind: 'provider-key-set', name });
  else if (fields.clearKey) changes.push({ kind: 'provider-key-clear', name });
  // An empty password field cannot mean "revert my key": it is empty after
  // every successful stage, so dropping the identity here would silently
  // delete both the staged key-set and its vault value on the next stage from
  // this editor. An unchecked Clear box, by contrast, IS the revert.
  else if (applied !== null && stagedKey?.kind !== 'provider-key-set')
    drop.push(`provider-key:${name}`);

  return { changes, drop };
}

interface Problems {
  name?: string;
  endpoint?: string;
  key?: string;
}

const endpointProblem = (value: string): string | undefined => {
  if (value === '') return `${ENDPOINT_INVALID} An endpoint is required.`;
  if (NON_ASCII_RUNE.test(value))
    return `${ENDPOINT_INVALID} Use ASCII only — an internationalized host must be given as punycode.`;
  if (!isBoundedString(value, MAX_ENDPOINT_BYTES))
    return `${ENDPOINT_INVALID} It must be at most ${MAX_ENDPOINT_BYTES} bytes.`;
  if (!HTTP_SCHEME.test(value)) return `${ENDPOINT_INVALID} Use an http:// or https:// URL.`;
  return undefined;
};

/**
 * Amendment 12: the vault stores whatever it is handed, so a value is checked
 * HERE, before it is handed over, and a refusal is shown at the input. `${` is
 * refused even though go-llm would expand it — a reference is an external
 * configuration concern, and staging one would write a credential the user
 * cannot see.
 */
const keyProblem = (value: string): string | undefined => {
  if (value === '') return undefined; // no key operation at all
  if (value.includes('${'))
    return `${KEY_INVALID} A \${…} reference stays an external configuration concern.`;
  return isKeyValue(value) ? undefined : KEY_INVALID;
};

/**
 * #322: go-llm stores a typed key verbatim as the provider's `api_key`
 * (`Document.SetProviderAPIKey`), and Apply writes that document to the source
 * file. Create only ever targets the user config directory, so the commit
 * warning belongs to a working-directory source alone.
 */
const KEY_HINT =
  'Saved as plain text in the configuration file and never shown again. Nothing is written until you apply.';
const KEY_COMMIT_WARNING =
  'The configuration file is a models.json in the working directory, so a commit can include this key.';

/** The fields a preset fills; each reads "from preset" until edited. */
type PresetField = 'name' | 'endpoint' | 'apiFormat';
const PRESET_FIELDS: readonly PresetField[] = ['name', 'endpoint', 'apiFormat'];

/** A space-separated id list, or undefined when nothing describes the field. */
const ids = (...parts: (string | false)[]): string | undefined =>
  parts.filter((part) => part !== false).join(' ') || undefined;

const sameFields = (a: ProviderFields, b: ProviderFields): boolean =>
  a.name === b.name &&
  a.endpoint === b.endpoint &&
  a.apiFormat === b.apiFormat &&
  a.keyValue === b.keyValue &&
  a.clearKey === b.clearKey;

export interface ProviderEditorProps {
  /** DOM id root; also the `aria-controls` target of the disclosure button. */
  id: string;
  /** The applied provider, or null while adding one. */
  provider: ProviderProjection | null;
  /** The change already staged on the provider identity, if any. */
  staged?: Change;
  /** The change already staged on the key identity, if any. */
  stagedKey?: Change;
  /** Names a new provider may not take: applied plus already staged. */
  takenNames: readonly string[];
  /** True while a model still references this provider. */
  inUse: boolean;
  vault: KeyVault;
  /** Where the loaded configuration came from; Apply writes the key there. */
  sourceOrigin: SettingsSourceOrigin;
  rowKey: string;
  onStage: (changes: Change[], drop: string[]) => void;
  onClose: () => void;
  onUnstagedChange: (rowKey: string, unstaged: boolean) => void;
}

export function ProviderEditor({
  id,
  provider,
  staged,
  stagedKey,
  takenNames,
  inUse,
  vault,
  sourceOrigin,
  rowKey,
  onStage,
  onClose,
  onUnstagedChange,
}: ProviderEditorProps) {
  const adding = provider === null;
  const stagedRemoval = staged?.kind === 'provider-remove';
  /**
   * A provider-add already in the draft, editing from its own strip. The name
   * is that change's stable identity (§3.3), so it is fixed here for exactly
   * the reason an applied provider's is: editing it in place would mean
   * creating a SECOND provider while the first one stayed staged, and the key
   * value could not follow — the vault deliberately has no read, so a rename
   * cannot carry the secret across. Renaming is unstage plus re-add.
   */
  const stagedAdd = staged?.kind === 'provider-add' ? staged : null;
  const nameFixed = provider !== null || stagedAdd !== null;

  // Reopening shows what is waiting for Apply, not the applied document
  // underneath it — except the key, which is deliberately unrecoverable.
  const initial = (): ProviderFields => ({
    name: staged?.kind === 'provider-add' ? staged.name : (provider?.name ?? ''),
    endpoint:
      (staged?.kind === 'provider-add' || staged?.kind === 'provider-update'
        ? staged.endpoint
        : undefined) ??
      provider?.endpoint ??
      '',
    apiFormat:
      (staged?.kind === 'provider-add' || staged?.kind === 'provider-update'
        ? staged.apiFormat
        : undefined) ??
      provider?.apiFormat ??
      'openai-compat',
    keyValue: '',
    clearKey: stagedKey?.kind === 'provider-key-clear',
  });

  const [fields, setFields] = useState<ProviderFields>(initial);
  /** What is already in the draft: the baseline the Apply gate compares to. */
  const [committed, setCommitted] = useState<ProviderFields>(initial);
  const [problems, setProblems] = useState<Problems>({});
  const [refusal, setRefusal] = useState('');
  /** #322: only a brand-new provider starts from a preset. */
  const [presetId, setPresetId] = useState(CUSTOM_PRESET_ID);
  const [fromPreset, setFromPreset] = useState<ReadonlySet<PresetField>>(new Set());
  const preset = PROVIDER_PRESETS.find((candidate) => candidate.id === presetId);

  const unstaged = !sameFields(fields, committed);

  useEffect(() => {
    onUnstagedChange(rowKey, unstaged);
  }, [onUnstagedChange, rowKey, unstaged]);

  // Collapsing or unmounting releases the Apply gate this editor was holding.
  useEffect(() => () => onUnstagedChange(rowKey, false), [onUnstagedChange, rowKey]);

  // Editing invalidates the last verdict rather than leaving a stale red field:
  // Stage re-checks everything anyway.
  const patch = (next: Partial<ProviderFields>) => {
    setFields((current) => ({ ...current, ...next }));
    setProblems({});
    setRefusal('');
  };

  /** A user edit makes the field theirs: its "from preset" mark goes. */
  const edit = (field: PresetField, next: Partial<ProviderFields>) => {
    patch(next);
    setFromPreset((marks) => new Set([...marks].filter((mark) => mark !== field)));
  };

  /**
   * Fills the name, format and endpoint, and nothing else: no request, and the
   * key is left as typed. Custom fills blanks and marks nothing; it has no
   * format to give, so the format stays as it is.
   */
  const pickPreset = (nextId: string) => {
    const next = PROVIDER_PRESETS.find((candidate) => candidate.id === nextId);
    if (next === undefined || next.disabledReason !== undefined) return;
    setPresetId(next.id);
    patch({
      name: next.name,
      endpoint: next.endpoint,
      ...(next.apiFormat === null ? {} : { apiFormat: next.apiFormat }),
    });
    setFromPreset(new Set(next.id === CUSTOM_PRESET_ID ? [] : PRESET_FIELDS));
  };

  const presetMark = (field: PresetField) =>
    fromPreset.has(field) && (
      <span className={styles.presetMark} id={`${id}-${field}-preset`}>
        from preset
      </span>
    );
  const presetMarkId = (field: PresetField) => fromPreset.has(field) && `${id}-${field}-preset`;

  const name = provider?.name ?? fields.name;
  const keyLocked = stagedRemoval;

  const submit = () => {
    // A name this editor already staged is not a collision with itself.
    const taken = takenNames.filter((other) => other !== committed.name);
    const found: Problems = {
      ...(adding
        ? {
            name: !isIdentifier(fields.name)
              ? NAME_INVALID
              : taken.includes(fields.name)
                ? NAME_TAKEN
                : undefined,
          }
        : {}),
      // An untouched endpoint is never re-sent, so it is never re-checked: the
      // applied document is the backend's to judge.
      ...(adding || fields.endpoint !== provider.endpoint
        ? { endpoint: endpointProblem(fields.endpoint) }
        : {}),
      key: keyProblem(fields.keyValue),
    };
    setProblems(found);
    if (found.name !== undefined || found.endpoint !== undefined || found.key !== undefined) return;

    const { changes, drop } = providerChanges(provider, fields, stagedKey);
    if (fields.keyValue !== '') vault.set(name, fields.keyValue);
    onStage(changes, drop);

    const next = { ...fields, keyValue: '' };
    setFields(next);
    setCommitted(next);
  };

  const remove = () => {
    if (inUse) {
      setRefusal(PROVIDER_IN_USE);
      return;
    }
    onStage([{ kind: 'provider-remove', name }], [`provider-key:${name}`]);
    onClose();
  };

  /** An error joins a field's description while it stands. */
  const errorId = (field: keyof Problems) =>
    problems[field] !== undefined && `${id}-${field}-error`;
  const keyInWorkingDirectory = sourceOrigin === 'working_directory';

  // tabIndex is how an Apply-bar chip focuses the editor it names (§3.3).
  return (
    <fieldset className={styles.editor} id={id} tabIndex={-1}>
      {/* The row strip above IS the editor header (v9). A visible legend
          would cut the border line and leave a gap across the top, so the
          accessible name is sr-only. */}
      <legend className={styles.srOnly}>
        {provider !== null
          ? `Edit provider ${provider.name}`
          : stagedAdd !== null
            ? `Staged provider ${stagedAdd.name}`
            : 'Add a provider'}
      </legend>

      <div className={styles.editorGrid}>
        {!nameFixed && (
          <div className={`${styles.field} ${styles.presetField}`}>
            <label className={styles.fieldLabel} htmlFor={`${id}-preset`}>
              Preset
            </label>
            <select
              className={styles.input}
              id={`${id}-preset`}
              aria-describedby={`${id}-preset-facts`}
              value={presetId}
              onChange={(event) => pickPreset(event.target.value)}
            >
              {PROVIDER_PRESETS.map((option) => (
                <option
                  key={option.id}
                  value={option.id}
                  disabled={option.disabledReason !== undefined}
                >
                  {option.disabledReason === undefined
                    ? option.label
                    : `${option.label} (${option.disabledReason})`}
                </option>
              ))}
            </select>
            {/* Mounted while empty, so the facts of the next pick are announced
                without moving focus off the dropdown. */}
            <div className={styles.presetFacts} id={`${id}-preset-facts`} aria-live="polite">
              {preset !== undefined && preset.id !== CUSTOM_PRESET_ID && (
                <>
                  <p className={styles.fieldHint}>{listingLine(preset)}</p>
                  <p className={styles.fieldHint}>{keyLine(preset)}</p>
                  {preset.notes?.map((note) => (
                    <p key={note} className={styles.fieldHint}>
                      {note}
                    </p>
                  ))}
                </>
              )}
            </div>
          </div>
        )}

        <div className={styles.field}>
          {!nameFixed ? (
            <>
              <span className={styles.labelRow}>
                <label className={styles.fieldLabel} htmlFor={`${id}-name`}>
                  Provider name
                </label>
                {presetMark('name')}
              </span>
              <input
                className={styles.input}
                id={`${id}-name`}
                aria-invalid={problems.name === undefined ? undefined : true}
                aria-describedby={ids(presetMarkId('name'), errorId('name'))}
                value={fields.name}
                onChange={(event) => edit('name', { name: event.target.value })}
              />
            </>
          ) : (
            <>
              <span className={styles.fieldLabel}>Provider name</span>
              <span className={styles.identifier}>{fields.name}</span>
              <span className={styles.fieldHint}>
                {provider !== null
                  ? 'The name cannot be changed. To rename, remove this provider and add it again.'
                  : 'The name cannot be changed. To rename, unstage this provider and add it again.'}
              </span>
            </>
          )}
          {problems.name !== undefined && (
            <span className={styles.fieldError} id={`${id}-name-error`}>
              {problems.name}
            </span>
          )}
        </div>

        <div className={styles.field}>
          <span className={styles.labelRow}>
            <label className={styles.fieldLabel} htmlFor={`${id}-endpoint`}>
              Endpoint
            </label>
            {presetMark('endpoint')}
          </span>
          <input
            className={styles.input}
            id={`${id}-endpoint`}
            aria-invalid={problems.endpoint === undefined ? undefined : true}
            aria-describedby={ids(
              presetMarkId('endpoint'),
              `${id}-endpoint-hint`,
              errorId('endpoint')
            )}
            value={fields.endpoint}
            onChange={(event) => edit('endpoint', { endpoint: event.target.value })}
          />
          <span className={styles.fieldHint} id={`${id}-endpoint-hint`}>
            An http:// or https:// URL. Firn checks the shape; Golem validates the rest when you
            apply.
          </span>
          {problems.endpoint !== undefined && (
            <span className={styles.fieldError} id={`${id}-endpoint-error`}>
              {problems.endpoint}
            </span>
          )}
        </div>

        <div className={styles.field}>
          <span className={styles.labelRow}>
            <label className={styles.fieldLabel} htmlFor={`${id}-format`}>
              API format
            </label>
            {presetMark('apiFormat')}
          </span>
          <select
            className={styles.input}
            id={`${id}-format`}
            aria-describedby={ids(presetMarkId('apiFormat'))}
            value={fields.apiFormat}
            onChange={(event) => edit('apiFormat', { apiFormat: event.target.value as APIFormat })}
          >
            {API_FORMATS.map((format) => (
              <option key={format} value={format}>
                {FORMAT_LABEL[format]}
              </option>
            ))}
          </select>
        </div>

        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor={`${id}-key`}>
            New API key
          </label>
          <input
            className={styles.input}
            id={`${id}-key`}
            type="password"
            autoComplete="off"
            disabled={keyLocked || fields.clearKey}
            aria-invalid={problems.key === undefined ? undefined : true}
            aria-describedby={ids(
              `${id}-key-hint`,
              keyInWorkingDirectory && `${id}-key-warning`,
              errorId('key')
            )}
            value={fields.keyValue}
            onChange={(event) => patch({ keyValue: event.target.value })}
          />
          <span className={styles.fieldHint} id={`${id}-key-hint`}>
            {KEY_HINT}
          </span>
          {keyInWorkingDirectory && (
            <span className={styles.fieldCaution} id={`${id}-key-warning`}>
              {KEY_COMMIT_WARNING}
            </span>
          )}
          {problems.key !== undefined && (
            <span className={styles.fieldError} id={`${id}-key-error`}>
              {problems.key}
            </span>
          )}
          {!adding && (
            <label className={styles.checkbox}>
              <input
                className={styles.checkboxInput}
                type="checkbox"
                disabled={keyLocked}
                checked={fields.clearKey}
                onChange={(event) => patch({ clearKey: event.target.checked, keyValue: '' })}
              />
              <span className={styles.checkboxBox} aria-hidden="true" />
              Clear the stored API key
            </label>
          )}
          {keyLocked && (
            <span className={styles.fieldHint}>
              This provider is staged for removal, so its API key cannot also change.
            </span>
          )}
        </div>
      </div>

      {refusal !== '' && (
        <p className={styles.fieldError} role="alert">
          {refusal}
        </p>
      )}

      <div className={styles.editorFooter}>
        <button
          type="button"
          className={`${styles.button} ${styles.primary}`}
          disabled={!unstaged}
          onClick={submit}
        >
          Done
        </button>
        <button type="button" className={`${styles.button} ${styles.quiet}`} onClick={onClose}>
          Cancel
        </button>
        {/* v9 right-aligns the destructive action away from Done/Cancel. */}
        <span className={styles.grow} />
        {!adding && (
          <button type="button" className={`${styles.button} ${styles.danger}`} onClick={remove}>
            Remove provider
          </button>
        )}
      </div>
    </fieldset>
  );
}
