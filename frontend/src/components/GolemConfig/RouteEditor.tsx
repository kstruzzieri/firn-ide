/**
 * Route row editor (#263 spec §4.3/§4.4/§4.5, mockup v9/v10).
 *
 * The strip expands into a native `fieldset`: on the left the provider select
 * and the filtered model picker, on the right the capabilities this use case
 * exposes and — only while `thinking` is among them — the think mode.
 *
 * Three disclosures separate this from a naive "pick a model" form, and all
 * three exist because a route edit is LOSSY in ways the row cannot show:
 *
 * - a role several use cases share is FORKED by the backend, so the siblings
 *   keep the model they have (§5.2b);
 * - a capability/think override is persisted per provider+model SELECTOR, so it
 *   governs every use case resolving to that selector (§4.5) — and if any of
 *   them is outside Firn's floor table, the change needs an explicit
 *   "requirements unknown" acknowledgement the backend re-derives and verifies;
 * - a real retarget drops the authored, model-specific ThinkTags/Slots, which
 *   the projection reports only as existence facts (§5.2b, plan amendment 13).
 *
 * The affected set is NEVER re-derived here: the candidate change is projected
 * through `projectDraft`, the same reducer whose normalization Apply sends, so
 * the disclosure and the request cannot disagree. The backend re-derives both
 * sets independently and refuses an omission or an extra.
 */

import { useEffect, useMemo, useState } from 'react';
import {
  CAPABILITY_NAMES,
  isIdentifier,
  THINK_MODES,
  type CapabilityFacts,
  type CapabilityName,
  type ModelProjection,
  type ProviderProjection,
  type ThinkMode,
} from '../../types/golem';
import {
  KeyVault,
  USE_CASE_FLOORS,
  meetsUseCaseFloor,
  projectDraft,
  sameModelFacts,
  stageChange,
  type Change,
  type Draft,
  type DraftBaseProjection,
  type DropField,
  type ModelFacts,
  type RouteChange,
} from '../../types/golemConfig';
import { formatSettingsDiagnostic } from '../../utils/settingsDiagnostics';
import styles from './GolemConfig.module.css';
import { ModelPicker, canonicalCaps, type ManualModel } from './ModelPicker';

/** The one copy vocabulary, shared with the diagnostics the backend returns. */
const copy = (code: Parameters<typeof formatSettingsDiagnostic>[0]): string =>
  formatSettingsDiagnostic(code, '', '').text;

const MODEL_INVALID = copy('model_invalid');
const INELIGIBLE = copy('eligibility_ineligible');

/** Transport order, the order the backend's drop set is compared in. */
const DROP_ORDER: readonly DropField[] = ['slots', 'think_tags'];

const THINK_LABEL: Record<ThinkMode, string> = {
  '': 'Default',
  none: 'None',
  always: 'Always',
  toggle: 'Toggle',
  auto: 'Auto',
};

/**
 * Amendment 13 copy, one clause per hidden fact the current model carries.
 * Reading order is the amendment's; the drop SET stays in transport order
 * (`slots` before `think_tags`), which is what the backend compares against.
 */
const dropNotice = (thinkTags: boolean, slots: boolean): string => {
  const names = [
    ...(thinkTags ? ['custom think tags'] : []),
    ...(slots ? ['slot configuration'] : []),
  ];
  return `Changing this model removes ${names.join(' / ')}.`;
};

export interface RouteEditorProps {
  /** DOM id root; also the `aria-controls` target of the disclosure button. */
  id: string;
  useCase: string;
  /** The applied route's role, or null while this use case is unbound. */
  role: string | null;
  /** The model that role resolves to, or null. */
  current: ModelProjection | null;
  providers: readonly ProviderProjection[];
  models: readonly ModelProjection[];
  /** Routes + models the draft is layered on, for the candidate projection. */
  base: DraftBaseProjection;
  draft: Draft;
  /** The change already staged on this route identity, if any. */
  staged?: Change;
  rowKey: string;
  onStage: (changes: Change[], drop: string[]) => void;
  onClose: () => void;
  onUnstagedChange: (rowKey: string, unstaged: boolean) => void;
}

interface Seed {
  provider: string;
  defined: ModelProjection | null;
  manual: ManualModel | null;
  exposed: CapabilityName[];
  think: ThinkMode;
  ackUnknown: boolean;
  ackDrops: boolean;
}

/**
 * Reopening shows what is waiting for Apply, not the applied document
 * underneath it. A staged change whose facts match a defined model reads back
 * as that model; anything else was declared by hand and reads back as a manual
 * declaration, because there is no other lossless way to restore it.
 */
function seedFrom(
  staged: Change | undefined,
  current: ModelProjection | null,
  models: readonly ModelProjection[],
  floor: readonly CapabilityName[]
): Seed {
  if (staged?.kind === 'route') {
    const facts = staged.modelFacts;
    const defined = models.find((model) => sameModelFacts(model, facts)) ?? null;
    return {
      provider: facts.provider,
      defined,
      manual:
        defined === null
          ? {
              model: facts.model,
              type: facts.type,
              caps: canonicalCaps(staged.capabilityFacts.caps),
            }
          : null,
      // The floor is always in: its checkboxes render locked-on, and a state
      // that disagreed with them would make the surface lie about what it is
      // about to send.
      exposed: canonicalCaps([...staged.exposedCaps, ...floor]),
      think: staged.thinkMode,
      ackUnknown: staged.confirmUnknown,
      ackDrops: staged.confirmDrops !== undefined,
    };
  }
  if (current !== null) {
    return {
      provider: current.provider,
      defined: current,
      manual: null,
      exposed: canonicalCaps([...current.exposedCapabilities, ...floor]),
      think: current.thinkMode,
      ackUnknown: false,
      ackDrops: false,
    };
  }
  return {
    provider: '',
    defined: null,
    manual: null,
    exposed: canonicalCaps(floor),
    think: '',
    ackUnknown: false,
    ackDrops: false,
  };
}

export function RouteEditor({
  id,
  useCase,
  role,
  current,
  providers,
  models,
  base,
  draft,
  staged,
  rowKey,
  onStage,
  onClose,
  onUnstagedChange,
}: RouteEditorProps) {
  const floor = USE_CASE_FLOORS.get(useCase) ?? [];
  const seed = useMemo(
    () => seedFrom(staged, current, models, floor),
    // Derived once, at mount: the row remounts when the document moves.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const [provider, setProvider] = useState(seed.provider);
  const [defined, setDefined] = useState<ModelProjection | null>(seed.defined);
  const [manual, setManual] = useState<ManualModel | null>(seed.manual);
  const [exposed, setExposed] = useState<CapabilityName[]>(seed.exposed);
  const [think, setThink] = useState<ThinkMode>(seed.think);
  const [ackUnknown, setAckUnknown] = useState(seed.ackUnknown);
  const [ackDrops, setAckDrops] = useState(seed.ackDrops);
  const [refusal, setRefusal] = useState('');
  const [announcement, setAnnouncement] = useState('');

  // The facts the picker currently yields. `null` means "not choosable yet";
  // submit() names which half is missing.
  const facts: ModelFacts | null =
    provider === ''
      ? null
      : manual !== null
        ? manual.model === '' || manual.type === ''
          ? null
          : { provider, model: manual.model, type: manual.type }
        : defined === null
          ? null
          : {
              provider: defined.provider,
              model: defined.modelName,
              type: defined.type,
              ...(defined.parameters === undefined ? {} : { parameters: defined.parameters }),
              ...(defined.contextWindow === undefined
                ? {}
                : { contextWindow: defined.contextWindow }),
              ...(defined.dimensions === undefined ? {} : { dimensions: defined.dimensions }),
            };

  /**
   * A manual declaration is authoritative: `caps` is the checked set and
   * `knownCaps` the full vocabulary shown (§4.4). A defined model carries the
   * facts the projection already computed.
   */
  const capabilityFacts: CapabilityFacts | null =
    manual !== null
      ? { caps: canonicalCaps([...manual.caps, ...floor]), knownCaps: [...CAPABILITY_NAMES] }
      : (defined?.capabilityFacts ?? null);

  /**
   * What arrives checked for a selection. §4.5's "declared caps arrive checked"
   * governs a selector Firn has never persisted an exposure for — a manual
   * declaration. A DEFINED model's `exposedCapabilities` already IS that
   * answer: the projection reports the selector override when one exists and
   * the declared set when it does not. Reading it here keeps all three seeding
   * paths (staged, applied, freshly chosen) on one notion of "offered", so
   * retargeting onto a model whose selector another use case narrowed cannot
   * silently re-widen that sibling's persisted contract through
   * `SetRoleOverrides`.
   */
  const offeredCaps = canonicalCaps([
    ...(defined?.exposedCapabilities ?? capabilityFacts?.caps ?? []),
    ...floor,
  ]);

  // Choosing a different model re-seeds the checklist from ITS exposure. Keyed
  // on the declaration, not the half-typed name, so a keystroke never discards
  // an exposure the user has already adjusted. (Render-phase state adjustment:
  // the React "derive state from props" pattern.)
  const factsKey =
    manual !== null
      ? `manual\u0000${manual.caps.join(',')}`
      : `defined\u0000${provider}\u0000${defined?.modelName ?? ''}`;
  const [seenKey, setSeenKey] = useState(factsKey);
  if (factsKey !== seenKey) {
    setSeenKey(factsKey);
    setExposed(offeredCaps);
    setThink(manual === null ? (defined?.thinkMode ?? '') : '');
    setAckDrops(false);
    setAckUnknown(false);
  }

  const candidate: RouteChange | null =
    facts === null || capabilityFacts === null
      ? null
      : {
          kind: 'route',
          useCase,
          modelFacts: facts,
          capabilityFacts,
          exposedCaps: exposed,
          // A think mode is meaningless without the capability that justifies it.
          thinkMode: exposed.includes('thinking') ? think : '',
          confirmUnknown: false,
        };

  // Route changes never touch a key ref, so the preview projection runs against
  // a throwaway vault rather than the workspace's.
  // ponytail: a scratch vault, not a KeyVault variant — stageChange only
  // evicts keys for provider changes, and this is always a route change.
  const scratch = useMemo(() => new KeyVault(new Map()), []);
  const affected = useMemo(() => {
    if (candidate === null) return [useCase];
    const preview = projectDraft(base, stageChange(draft, candidate, scratch));
    return preview.selectorUseCases.get(useCase) ?? [useCase];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, draft, scratch, useCase, JSON.stringify(candidate)]);

  const alsoGoverns = affected.filter((other) => other !== useCase);
  const unknownUseCases = affected.filter((other) => !USE_CASE_FLOORS.has(other));

  /** Siblings the backend forks away from, rather than changing under them. */
  const sharedRole = (current?.routedUseCases ?? []).filter((other) => other !== useCase);

  /**
   * What a real retarget would drop. An override — the same provider+model the
   * role already names — drops nothing, and a confirmation the backend cannot
   * match is refused outright, so this stays exactly the backend's rule.
   */
  const drops: DropField[] =
    current === null || facts === null || sameModelFacts(current, facts)
      ? []
      : DROP_ORDER.filter((field) => (field === 'slots' ? current.hasSlots : current.hasThinkTags));

  const snapshot = JSON.stringify({
    provider,
    defined: defined?.role ?? null,
    manual,
    exposed,
    think,
    ackUnknown,
    ackDrops,
  });
  const [committed, setCommitted] = useState(snapshot);
  const unstaged = snapshot !== committed;

  useEffect(() => {
    onUnstagedChange(rowKey, unstaged);
  }, [onUnstagedChange, rowKey, unstaged]);

  // Collapsing or unmounting releases the Apply gate this editor was holding.
  useEffect(() => () => onUnstagedChange(rowKey, false), [onUnstagedChange, rowKey]);

  const clearRefusal = () => setRefusal('');

  const submit = () => {
    if (provider === '') {
      setRefusal('Choose a provider first — a model needs the endpoint it runs on.');
      return;
    }
    if (manual === null && defined === null) {
      setRefusal('Choose a model, or enter one manually.');
      return;
    }
    if (manual !== null) {
      if (!isIdentifier(manual.model) || manual.model === '') {
        setRefusal(`${MODEL_INVALID} Enter the model id the provider serves.`);
        return;
      }
      if (manual.type === '') {
        setRefusal('A model type is required before this route can be staged.');
        return;
      }
    }
    if (candidate === null) {
      setRefusal('Choose a model, or enter one manually.');
      return;
    }
    if (!meetsUseCaseFloor(useCase, exposed)) {
      setRefusal(`${INELIGIBLE} Expose ${floor.join(', ')} for ${useCase}.`);
      return;
    }
    if (unknownUseCases.length > 0 && !ackUnknown) {
      setRefusal(
        `The requirements are unknown for ${unknownUseCases.join(', ')}. Confirm the change before staging it.`
      );
      return;
    }
    if (drops.length > 0 && !ackDrops) {
      setRefusal('Confirm what this change removes from the current model before staging it.');
      return;
    }

    onStage(
      [
        {
          ...candidate,
          // The reducer derives the exact `confirmUnknownUseCases` set from the
          // selector group; this is the acknowledgement that set requires.
          confirmUnknown: unknownUseCases.length > 0,
          ...(drops.length > 0 ? { confirmDrops: drops } : {}),
        },
      ],
      []
    );
    setCommitted(snapshot);
    setRefusal('');
    setAnnouncement(`${useCase} model staged: ${candidate.modelFacts.model}`);
  };

  const unassign = () => {
    onStage([{ kind: 'route-unassign', useCase }], []);
    onClose();
  };

  const providerModels = models.filter((model) => model.provider === provider);
  const capsLegend =
    facts === null
      ? `Capabilities exposed to ${useCase}`
      : `Capabilities exposed to ${useCase} — from ${facts.model}`;

  return (
    <fieldset className={styles.editor} id={id}>
      <legend className={styles.editorLegend}>{`Route ${useCase}`}</legend>

      {refusal !== '' && (
        <p className={styles.fieldError} role="alert">
          {refusal}
        </p>
      )}

      <div className={styles.editorGrid}>
        <div className={styles.column}>
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor={`${id}-provider`}>
              Provider
            </label>
            <select
              className={styles.input}
              id={`${id}-provider`}
              value={provider}
              onChange={(event) => {
                setProvider(event.target.value);
                setDefined(null);
                setManual(null);
                clearRefusal();
              }}
            >
              <option value="">Choose a provider</option>
              {providers.map((entry) => (
                <option key={entry.name} value={entry.name}>
                  {entry.name}
                </option>
              ))}
            </select>
          </div>

          {provider === '' ? (
            <p className={styles.fieldHint}>
              Choose a provider to see the models it can serve for {useCase}.
            </p>
          ) : (
            <ModelPicker
              id={id}
              floor={floor}
              models={providerModels}
              selected={defined?.modelName ?? ''}
              manual={manual}
              onSelect={(model) => {
                setDefined(model);
                setManual(null);
                clearRefusal();
              }}
              onManual={(next) => {
                setManual(next);
                if (next !== null) setDefined(null);
                clearRefusal();
              }}
            />
          )}
        </div>

        <div className={styles.column}>
          <fieldset className={styles.capabilities}>
            <legend className={styles.fieldLabel}>{capsLegend}</legend>
            {(capabilityFacts?.knownCaps ?? CAPABILITY_NAMES).map((cap) => {
              const locked = floor.includes(cap);
              return (
                <label key={cap} className={styles.checkbox}>
                  <input
                    type="checkbox"
                    disabled={locked}
                    checked={locked || exposed.includes(cap)}
                    onChange={(event) => {
                      setExposed((currentCaps) =>
                        canonicalCaps(
                          event.target.checked
                            ? [...currentCaps, cap]
                            : currentCaps.filter((other) => other !== cap)
                        )
                      );
                      clearRefusal();
                    }}
                  />
                  {cap}
                </label>
              );
            })}
            <span className={styles.fieldHint}>
              What this route may use. The capabilities {useCase} requires are checked and locked.
            </span>
          </fieldset>

          {exposed.includes('thinking') && (
            <div className={styles.field}>
              <label className={styles.fieldLabel} htmlFor={`${id}-think`}>
                Think mode
              </label>
              <select
                className={styles.input}
                id={`${id}-think`}
                value={think}
                onChange={(event) => {
                  setThink(event.target.value as ThinkMode);
                  clearRefusal();
                }}
              >
                {THINK_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {THINK_LABEL[mode]}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>

      {sharedRole.length > 0 && (
        <div className={styles.disclosure}>
          <p className={styles.disclosureText}>
            {`Also routed through this role: ${sharedRole.join(', ')}.`}
          </p>
          <p className={styles.disclosureText}>
            Staging a different model here creates a separate route and leaves them on the current
            model.
          </p>
        </div>
      )}

      {alsoGoverns.length > 0 && (
        <div className={styles.disclosure}>
          <p className={styles.disclosureText}>{`Also governs: ${alsoGoverns.join(', ')}.`}</p>
          <p className={styles.disclosureText}>
            Capabilities and think mode are stored per provider and model, so this edit is theirs
            too.
          </p>
        </div>
      )}

      {unknownUseCases.length > 0 && (
        <div className={styles.disclosure}>
          <p className={styles.disclosureText}>
            {`These affected use cases are outside Firn's known requirements: ${unknownUseCases.join(', ')}.`}
          </p>
          <p className={styles.disclosureText}>Firn cannot check what they need.</p>
          <label className={styles.checkbox}>
            <input
              type="checkbox"
              checked={ackUnknown}
              onChange={(event) => {
                setAckUnknown(event.target.checked);
                clearRefusal();
              }}
            />
            Requirements unknown — apply anyway
          </label>
        </div>
      )}

      {drops.length > 0 && (
        <div className={styles.disclosure} data-blocking="true">
          <p className={styles.disclosureText}>
            {dropNotice(current?.hasThinkTags === true, current?.hasSlots === true)}
          </p>
          <p className={styles.disclosureText}>
            Those fields are authored in the file and are not shown here; Golem confirms the exact
            set when you apply.
          </p>
          <label className={styles.checkbox}>
            <input
              type="checkbox"
              checked={ackDrops}
              onChange={(event) => {
                setAckDrops(event.target.checked);
                clearRefusal();
              }}
            />
            Remove them and stage this change
          </label>
        </div>
      )}

      <span className={styles.srOnly} role="status" aria-live="polite">
        {announcement}
      </span>

      <div className={styles.editorFooter}>
        {/* Always enabled: this button IS the validator's entry point, and the
            refusals above are how the editor answers. The global Apply gate is
            held by `onUnstagedChange`, not by a disabled control. */}
        <button
          type="button"
          className={`${styles.button} ${styles.primary}`}
          onClick={submit}
          data-unstaged={unstaged || undefined}
        >
          Stage change
        </button>
        <button type="button" className={`${styles.button} ${styles.quiet}`} onClick={onClose}>
          Cancel
        </button>
        {/* §4.3: optional use cases only. The agent route is Firn's own run
            path, and the backend refuses to unbind it independently (§5.2). */}
        {role !== null && useCase !== 'agent' && (
          <button type="button" className={`${styles.button} ${styles.quiet}`} onClick={unassign}>
            Unassign
          </button>
        )}
      </div>
    </fieldset>
  );
}
