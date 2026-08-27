/**
 * The closed Golem settings WRITE transport (spec §5.6), the mirror of
 * internal/ai/settings_apply.go. Every enum is closed, every unknown key is a
 * contract break, and every bound is measured in UTF-8 BYTES — the shared
 * corpus in internal/ai/testdata/settings_apply_contract/ runs these validators
 * and the Go ones over byte-identical fixtures, so the two cannot drift.
 *
 * Requests are validated here as well as in the backend. The backend is the
 * authority (the frontend is not trusted); validating locally means a drafting
 * bug fails at the boundary that produced it instead of arriving as an opaque
 * diagnostics result.
 *
 * API key values live in `keys` and nowhere else: no result type below has a
 * member that could carry one back.
 */
import {
  CAPABILITY_NAMES,
  MAX_DIAGNOSTICS,
  MAX_ENDPOINT_BYTES,
  MAX_PROJECTION_ENTRIES,
  MODEL_TYPES,
  NON_ASCII_RUNE,
  REVISION,
  THINK_MODES,
  API_FORMATS,
  compareString,
  contractError,
  hasOnlyKeys,
  isBoundedString,
  isCanonicalCapabilities,
  isCleanIdentifier,
  isIdentifier,
  isOneOf,
  isOptionalModelNumber,
  isRecord,
  isStrictlyOrdered,
  parseSettingsProjection,
  readCappedArray,
  readSettingsDiagnostic,
  utf8Length,
  type APIFormat,
  type CapabilityFacts,
  type CapabilityName,
  type ModelType,
  type ProviderProjection,
  type RouteProjection,
  type ModelProjection,
  type SettingsDiagnostic,
  type SettingsProjection,
  type SettingsState,
  type ThinkMode,
} from './golem';

/** §5.6: key values are 1..4096 UTF-8 bytes, literal-only. */
const MAX_KEY_VALUE_BYTES = 4096;
/** §5.6: the consent challenge token is opaque, 1..256 UTF-8 bytes. */
const MAX_CHALLENGE_TOKEN_BYTES = 256;
const PROFILE_ID = /^(curated|user)\/[a-z0-9][a-z0-9-]{0,63}$/;

/** Apply targets an existing document; Create establishes a new one. */
export type ApplyMode = 'apply' | 'create';

export type ChangeKind =
  | 'route'
  | 'route-unassign'
  | 'provider-add'
  | 'provider-update'
  | 'provider-remove'
  | 'provider-key-set'
  | 'provider-key-clear'
  | 'role-remove';

const CHANGE_KINDS: readonly ChangeKind[] = [
  'route',
  'route-unassign',
  'provider-add',
  'provider-update',
  'provider-remove',
  'provider-key-set',
  'provider-key-clear',
  'role-remove',
];

/** Model-specific members a real retarget drops (§5.2b). */
export type DropField = 'slots' | 'think_tags';
const DROP_FIELDS: readonly DropField[] = ['slots', 'think_tags'];

export type ApplySource =
  | { kind: 'applied' }
  | { kind: 'profile'; profileId: string; sourceRevision: string }
  | { kind: 'blank' };

export interface ModelFacts {
  provider: string;
  model: string;
  type: ModelType;
  parameters?: string;
  contextWindow?: number;
  dimensions?: number;
}

export interface RouteChange {
  kind: 'route';
  useCase: string;
  modelFacts: ModelFacts;
  capabilityFacts: CapabilityFacts;
  exposedCaps: CapabilityName[];
  thinkMode: ThinkMode;
  confirmUnknown: boolean;
  confirmUnknownUseCases?: string[];
  confirmDrops?: DropField[];
}

export type Change =
  | RouteChange
  | { kind: 'route-unassign'; useCase: string }
  | { kind: 'provider-add'; name: string; endpoint: string; apiFormat?: APIFormat }
  | { kind: 'provider-update'; name: string; endpoint?: string; apiFormat?: APIFormat }
  | { kind: 'provider-remove'; name: string }
  | { kind: 'provider-key-set'; name: string }
  | { kind: 'provider-key-clear'; name: string }
  | { kind: 'role-remove'; role: string };

export interface SettingsApplyRequest {
  targetRevision?: string;
  source: ApplySource;
  changes: Change[];
  keys: Record<string, string>;
}

export interface ConfirmSettingsApplyRequest {
  challengeToken: string;
  request: SettingsApplyRequest;
}

export interface ApplyDestination {
  provider: string;
  model: string;
  endpoint: string;
  classification: 'remote';
}

export interface ApplyChallenge {
  token: string;
  expiresAt: number;
  destination: ApplyDestination;
}

export interface ChangeDropSet {
  changeId: string;
  fields: DropField[];
}

export type ConsentOutcome = 'unchanged' | 'recorded' | 'uncertain';
export type ApplyConflictKind = 'target' | 'profile_source' | 'challenge';

export type SettingsApplyResult =
  | { status: 'applied'; projection: SettingsProjection; warning?: 'durability_uncertain' }
  | { status: 'consent_required'; challenge: ApplyChallenge }
  | { status: 'drop_confirmation_required'; drops: ChangeDropSet[] }
  | {
      status: 'conflict';
      conflict: ApplyConflictKind;
      projection?: SettingsProjection;
      consentOutcome: ConsentOutcome;
    }
  | { status: 'diagnostics'; diagnostics: SettingsDiagnostic[]; consentOutcome: ConsentOutcome }
  | { status: 'busy' }
  | { status: 'limited'; diagnostics: SettingsDiagnostic[] };

export interface CancelSettingsApplyResult {
  status: 'cancelled';
}

/** A profile preview: the projection minus sourceOrigin and revision. */
export interface ProfileDraftProjection {
  state: Extract<SettingsState, 'ready' | 'limited'>;
  readOnly: boolean;
  editable: boolean;
  routes: RouteProjection[];
  models: ModelProjection[];
  providers: ProviderProjection[];
  diagnostics: SettingsDiagnostic[];
}

export type ProfileDiagnosticCode =
  | 'invalid_id'
  | 'not_found'
  | 'curated_read_only'
  | 'store_unsafe'
  | 'io'
  | 'config_invalid'
  | 'active_config_invalid'
  | 'profile_limit';

const PROFILE_DIAGNOSTIC_CODES: readonly ProfileDiagnosticCode[] = [
  'invalid_id',
  'not_found',
  'curated_read_only',
  'store_unsafe',
  'io',
  'config_invalid',
  'active_config_invalid',
  'profile_limit',
];

export interface ProfileDiagnostic {
  code: ProfileDiagnosticCode;
  profileId?: string;
}

export type GolemProfileLoadResult =
  | {
      status: 'loaded';
      profileId: string;
      sourceRevision: string;
      projection: ProfileDraftProjection;
    }
  | { status: 'diagnostics'; diagnostics: ProfileDiagnostic[] };

// ---------------------------------------------------------------------------
// Shared predicates
// ---------------------------------------------------------------------------

const isRevision = (value: unknown): value is string =>
  typeof value === 'string' && REVISION.test(value);

const isProfileID = (value: unknown): value is string =>
  typeof value === 'string' && PROFILE_ID.test(value);

/**
 * An authored endpoint: non-empty, bounded, and printable ASCII only. A
 * non-ASCII host is a homoglyph risk and is never resolvable as authored —
 * internationalized hosts must be supplied as punycode.
 */
const isEndpoint = (value: unknown): value is string =>
  isBoundedString(value, MAX_ENDPOINT_BYTES) && value !== '' && !NON_ASCII_RUNE.test(value);

/** Literal-only: `${` is refused even though go-llm would expand it. */
const isKeyValue = (value: unknown): value is string =>
  typeof value === 'string' &&
  value !== '' &&
  utf8Length(value) <= MAX_KEY_VALUE_BYTES &&
  !value.includes('${');

const isChallengeToken = (value: unknown): value is string =>
  isCleanIdentifier(value, MAX_CHALLENGE_TOKEN_BYTES) && value !== '';

const isCapabilityList = (value: unknown): CapabilityName[] | null => {
  const caps = readCappedArray(value, CAPABILITY_NAMES.length, (cap) =>
    isOneOf(cap, CAPABILITY_NAMES) ? cap : null
  );
  return caps !== null && isCanonicalCapabilities(caps) ? caps : null;
};

const isSubsetOf = (values: readonly string[], known: readonly string[]): boolean =>
  values.every((value) => known.includes(value));

/** Non-empty, unique, ascending, drawn from the closed drop vocabulary. */
const readDropFields = (value: unknown): DropField[] | null => {
  const fields = readCappedArray(value, DROP_FIELDS.length, (field) =>
    isOneOf(field, DROP_FIELDS) ? field : null
  );
  if (fields === null || fields.length === 0) return null;
  return isStrictlyOrdered(fields, compareString) ? fields : null;
};

const readSortedIdentifiers = (value: unknown): string[] | null => {
  const values = readCappedArray(value, MAX_PROJECTION_ENTRIES, (entry) =>
    isIdentifier(entry) ? entry : null
  );
  if (values === null || values.length === 0) return null;
  return isStrictlyOrdered(values, compareString) ? values : null;
};

/**
 * The stable change identity a drop set names: `<kind>:<identifier>`. A bare
 * identifier or an unknown kind prefix is a contract break.
 */
const isChangeID = (value: unknown): value is string => {
  if (typeof value !== 'string') return false;
  const separator = value.indexOf(':');
  if (separator < 0) return false;
  return (
    isOneOf(value.slice(0, separator), CHANGE_KINDS) && isIdentifier(value.slice(separator + 1))
  );
};

/** Present-but-absent is not a thing: an explicit null is a rejection. */
const readOptional = <T>(
  value: Record<string, unknown>,
  key: string,
  read: (entry: unknown) => T | null
): { present: false } | { present: true; value: T } | null => {
  if (!Object.hasOwn(value, key)) return { present: false };
  const parsed = read(value[key]);
  return parsed === null ? null : { present: true, value: parsed };
};

// ---------------------------------------------------------------------------
// Request validation
// ---------------------------------------------------------------------------

function readApplySource(value: unknown): ApplySource | null {
  if (!isRecord(value)) return null;
  switch (value.kind) {
    case 'applied':
    case 'blank':
      return hasOnlyKeys(value, ['kind']) ? ({ kind: value.kind } as ApplySource) : null;
    case 'profile':
      if (!hasOnlyKeys(value, ['kind', 'profileId', 'sourceRevision'])) return null;
      if (!isProfileID(value.profileId) || !isRevision(value.sourceRevision)) return null;
      return {
        kind: 'profile',
        profileId: value.profileId,
        sourceRevision: value.sourceRevision,
      };
    default:
      return null;
  }
}

function readModelFacts(value: unknown): ModelFacts | null {
  if (!isRecord(value)) return null;
  if (
    !hasOnlyKeys(value, ['provider', 'model', 'type', 'parameters', 'contextWindow', 'dimensions'])
  )
    return null;
  const { provider, model, type } = value;
  if (!isIdentifier(provider) || !isIdentifier(model) || !isOneOf(type, MODEL_TYPES)) return null;

  const parameters = readOptional(value, 'parameters', (entry) =>
    isIdentifier(entry) ? entry : null
  );
  const contextWindow = readOptional(value, 'contextWindow', (entry) =>
    isOptionalModelNumber(entry) ? entry : null
  );
  const dimensions = readOptional(value, 'dimensions', (entry) =>
    isOptionalModelNumber(entry) ? entry : null
  );
  if (parameters === null || contextWindow === null || dimensions === null) return null;
  return {
    provider,
    model,
    type,
    ...(parameters.present ? { parameters: parameters.value } : {}),
    ...(contextWindow.present ? { contextWindow: contextWindow.value } : {}),
    ...(dimensions.present ? { dimensions: dimensions.value } : {}),
  };
}

function readRequestCapabilityFacts(value: unknown): CapabilityFacts | null {
  if (!isRecord(value) || !hasOnlyKeys(value, ['caps', 'knownCaps'])) return null;
  const caps = isCapabilityList(value.caps);
  const knownCaps = isCapabilityList(value.knownCaps);
  if (caps === null || knownCaps === null || !isSubsetOf(caps, knownCaps)) return null;
  return { caps, knownCaps };
}

function readRouteChange(value: Record<string, unknown>): Change | null {
  if (
    !hasOnlyKeys(value, [
      'kind',
      'useCase',
      'modelFacts',
      'capabilityFacts',
      'exposedCaps',
      'thinkMode',
      'confirmUnknown',
      'confirmUnknownUseCases',
      'confirmDrops',
    ])
  )
    return null;
  const { useCase, thinkMode, confirmUnknown } = value;
  if (
    !isIdentifier(useCase) ||
    !isOneOf(thinkMode, THINK_MODES) ||
    typeof confirmUnknown !== 'boolean'
  )
    return null;
  const modelFacts = readModelFacts(value.modelFacts);
  const capabilityFacts = readRequestCapabilityFacts(value.capabilityFacts);
  const exposedCaps = isCapabilityList(value.exposedCaps);
  if (modelFacts === null || capabilityFacts === null || exposedCaps === null) return null;
  if (!isSubsetOf(exposedCaps, capabilityFacts.knownCaps)) return null;

  // Confirmation arrays are omitted when empty; an explicit [] is a break.
  const confirmUnknownUseCases = readOptional(
    value,
    'confirmUnknownUseCases',
    readSortedIdentifiers
  );
  const confirmDrops = readOptional(value, 'confirmDrops', readDropFields);
  if (confirmUnknownUseCases === null || confirmDrops === null) return null;
  return {
    kind: 'route',
    useCase,
    modelFacts,
    capabilityFacts,
    exposedCaps,
    thinkMode,
    confirmUnknown,
    ...(confirmUnknownUseCases.present
      ? { confirmUnknownUseCases: confirmUnknownUseCases.value }
      : {}),
    ...(confirmDrops.present ? { confirmDrops: confirmDrops.value } : {}),
  };
}

function readChange(value: unknown): Change | null {
  if (!isRecord(value)) return null;
  switch (value.kind) {
    case 'route':
      return readRouteChange(value);
    case 'route-unassign':
      if (!hasOnlyKeys(value, ['kind', 'useCase']) || !isIdentifier(value.useCase)) return null;
      return { kind: 'route-unassign', useCase: value.useCase };
    case 'provider-add': {
      if (!hasOnlyKeys(value, ['kind', 'name', 'endpoint', 'apiFormat'])) return null;
      if (!isIdentifier(value.name) || !isEndpoint(value.endpoint)) return null;
      const apiFormat = readOptional(value, 'apiFormat', (entry) =>
        isOneOf(entry, API_FORMATS) ? entry : null
      );
      if (apiFormat === null) return null;
      return {
        kind: 'provider-add',
        name: value.name,
        endpoint: value.endpoint,
        ...(apiFormat.present ? { apiFormat: apiFormat.value } : {}),
      };
    }
    case 'provider-update': {
      if (!hasOnlyKeys(value, ['kind', 'name', 'endpoint', 'apiFormat'])) return null;
      if (!isIdentifier(value.name)) return null;
      const endpoint = readOptional(value, 'endpoint', (entry) =>
        isEndpoint(entry) ? entry : null
      );
      const apiFormat = readOptional(value, 'apiFormat', (entry) =>
        isOneOf(entry, API_FORMATS) ? entry : null
      );
      if (endpoint === null || apiFormat === null) return null;
      // An update that touches nothing is not a change.
      if (!endpoint.present && !apiFormat.present) return null;
      return {
        kind: 'provider-update',
        name: value.name,
        ...(endpoint.present ? { endpoint: endpoint.value } : {}),
        ...(apiFormat.present ? { apiFormat: apiFormat.value } : {}),
      };
    }
    case 'provider-remove':
    case 'provider-key-set':
    case 'provider-key-clear':
      if (!hasOnlyKeys(value, ['kind', 'name']) || !isIdentifier(value.name)) return null;
      return { kind: value.kind, name: value.name };
    case 'role-remove':
      if (!hasOnlyKeys(value, ['kind', 'role']) || !isIdentifier(value.role)) return null;
      return { kind: 'role-remove', role: value.role };
    default:
      return null;
  }
}

/**
 * The stable (namespace, identity) pair a change mutates. Provider definition
 * and provider key changes are separate namespaces on purpose: adding a
 * provider and setting its key in one Apply is the normal flow, while two
 * definition changes for one provider are not.
 */
function changeIdentity(change: Change): string {
  switch (change.kind) {
    case 'route':
    case 'route-unassign':
      return `use_case ${change.useCase}`;
    case 'provider-add':
    case 'provider-update':
    case 'provider-remove':
      return `provider ${change.name}`;
    case 'provider-key-set':
    case 'provider-key-clear':
      return `provider_key ${change.name}`;
    case 'role-remove':
      return `role ${change.role}`;
  }
}

function changesAreConsistent(changes: readonly Change[], keys: Record<string, string>): boolean {
  const identities = new Set<string>();
  const keySets = new Set<string>();
  const removedProviders = new Set<string>();
  const keyedProviders = new Set<string>();
  for (const change of changes) {
    const identity = changeIdentity(change);
    if (identities.has(identity)) return false;
    identities.add(identity);
    if (change.kind === 'provider-remove') removedProviders.add(change.name);
    if (change.kind === 'provider-key-set') {
      keySets.add(change.name);
      keyedProviders.add(change.name);
    }
    if (change.kind === 'provider-key-clear') keyedProviders.add(change.name);
  }
  // Removing a provider and touching its key in the same Apply contradict.
  for (const name of removedProviders) if (keyedProviders.has(name)) return false;
  // Exact 1:1: every provider-key-set carries one key value, and no other
  // change (and no stray entry) may carry one.
  const keyNames = Object.keys(keys);
  if (keyNames.length !== keySets.size) return false;
  return keyNames.every((name) => keySets.has(name));
}

export function parseSettingsApplyRequest(value: unknown, mode: ApplyMode): SettingsApplyRequest {
  if (!isRecord(value)) return contractError();
  if (!hasOnlyKeys(value, ['targetRevision', 'source', 'changes', 'keys'])) return contractError();

  const hasTargetRevision = Object.hasOwn(value, 'targetRevision');
  if (mode === 'apply' && !(hasTargetRevision && isRevision(value.targetRevision)))
    return contractError();
  if (mode === 'create' && hasTargetRevision) return contractError();

  const source = readApplySource(value.source);
  if (source === null) return contractError();
  // Create establishes a document that does not exist yet, so there is no
  // applied source to copy from.
  if (mode === 'create' && source.kind === 'applied') return contractError();

  const changes = readCappedArray(value.changes, MAX_PROJECTION_ENTRIES, readChange);
  // A write with no change is not a write.
  if (changes === null || changes.length === 0) return contractError();

  const rawKeys = value.keys;
  if (!isRecord(rawKeys) || Object.keys(rawKeys).length > MAX_PROJECTION_ENTRIES)
    return contractError();
  for (const [name, keyValue] of Object.entries(rawKeys)) {
    if (!isIdentifier(name) || !isKeyValue(keyValue)) return contractError();
  }
  // Spread, never per-key assignment: `keys['__proto__'] = v` would invoke the
  // prototype setter and silently drop the entry, so a stray "__proto__" key
  // would pass the 1:1 check here while Go's map still carries it. Spread
  // creates own data properties, so both sides see the same key set.
  const keys = { ...rawKeys } as Record<string, string>;
  if (!changesAreConsistent(changes, keys)) return contractError();

  return {
    ...(hasTargetRevision ? { targetRevision: value.targetRevision as string } : {}),
    source,
    changes,
    keys,
  };
}

export function parseConfirmSettingsApplyRequest(
  value: unknown,
  mode: ApplyMode
): ConfirmSettingsApplyRequest {
  if (!isRecord(value)) return contractError();
  if (!hasOnlyKeys(value, ['challengeToken', 'request'])) return contractError();
  if (!isChallengeToken(value.challengeToken)) return contractError();
  return {
    challengeToken: value.challengeToken,
    request: parseSettingsApplyRequest(value.request, mode),
  };
}

// ---------------------------------------------------------------------------
// Result validation
// ---------------------------------------------------------------------------

/** Which optional members each status owns; every other member must be absent. */
const RESULT_MEMBERS: Record<string, readonly string[]> = {
  applied: ['projection', 'warning'],
  consent_required: ['challenge'],
  drop_confirmation_required: ['drops'],
  conflict: ['conflict', 'projection', 'consentOutcome'],
  diagnostics: ['diagnostics', 'consentOutcome'],
  busy: [],
  limited: ['diagnostics'],
};

const CONSENT_OUTCOMES: readonly ConsentOutcome[] = ['unchanged', 'recorded', 'uncertain'];
const CONFLICT_KINDS: readonly ApplyConflictKind[] = ['target', 'profile_source', 'challenge'];

function readApplyDestination(value: unknown): ApplyDestination | null {
  if (!isRecord(value)) return null;
  if (!hasOnlyKeys(value, ['provider', 'model', 'endpoint', 'classification'])) return null;
  const { provider, model, endpoint, classification } = value;
  if (!isIdentifier(provider) || !isIdentifier(model) || !isEndpoint(endpoint)) return null;
  if (classification !== 'remote') return null;
  return { provider, model, endpoint, classification };
}

function readApplyChallenge(value: unknown): ApplyChallenge | null {
  if (!isRecord(value)) return null;
  if (!hasOnlyKeys(value, ['token', 'expiresAt', 'destination'])) return null;
  if (!isChallengeToken(value.token)) return null;
  // A Unix-millisecond instant: positive and exactly representable.
  if (!Number.isSafeInteger(value.expiresAt) || (value.expiresAt as number) < 1) return null;
  const destination = readApplyDestination(value.destination);
  if (destination === null) return null;
  return { token: value.token, expiresAt: value.expiresAt as number, destination };
}

function readDropSets(value: unknown): ChangeDropSet[] | null {
  const drops = readCappedArray(value, MAX_PROJECTION_ENTRIES, (entry) => {
    if (!isRecord(entry) || !hasOnlyKeys(entry, ['changeId', 'fields'])) return null;
    if (!isChangeID(entry.changeId)) return null;
    const fields = readDropFields(entry.fields);
    return fields === null ? null : { changeId: entry.changeId, fields };
  });
  if (drops === null || drops.length === 0) return null;
  return new Set(drops.map((drop) => drop.changeId)).size === drops.length ? drops : null;
}

function readResultDiagnostics(value: unknown, blockingOnly: boolean): SettingsDiagnostic[] | null {
  const diagnostics = readCappedArray(value, MAX_DIAGNOSTICS, readSettingsDiagnostic);
  if (diagnostics === null || diagnostics.length === 0) return null;
  if (blockingOnly && diagnostics.some((diagnostic) => !diagnostic.blocking)) return null;
  const order = (a: SettingsDiagnostic, b: SettingsDiagnostic): number =>
    (a.blocking === b.blocking ? 0 : a.blocking ? -1 : 1) ||
    compareString(a.code, b.code) ||
    compareString(a.subjectKind, b.subjectKind) ||
    compareString(a.subjectName, b.subjectName);
  return isStrictlyOrdered(diagnostics, order) ? diagnostics : null;
}

export function parseSettingsApplyResult(value: unknown): SettingsApplyResult {
  if (!isRecord(value) || typeof value.status !== 'string') return contractError();
  const members = RESULT_MEMBERS[value.status];
  if (members === undefined) return contractError();
  if (!hasOnlyKeys(value, ['status', ...members])) return contractError();

  switch (value.status) {
    case 'applied': {
      if (!Object.hasOwn(value, 'projection')) return contractError();
      const projection = parseSettingsProjection(value.projection);
      if (!Object.hasOwn(value, 'warning')) return { status: 'applied', projection };
      if (value.warning !== 'durability_uncertain') return contractError();
      return { status: 'applied', projection, warning: 'durability_uncertain' };
    }
    case 'consent_required': {
      const challenge = readApplyChallenge(value.challenge);
      if (challenge === null) return contractError();
      return { status: 'consent_required', challenge };
    }
    case 'drop_confirmation_required': {
      const drops = readDropSets(value.drops);
      if (drops === null) return contractError();
      return { status: 'drop_confirmation_required', drops };
    }
    case 'conflict': {
      if (!isOneOf(value.conflict, CONFLICT_KINDS)) return contractError();
      if (!isOneOf(value.consentOutcome, CONSENT_OUTCOMES)) return contractError();
      const conflict = value.conflict;
      const consentOutcome = value.consentOutcome;
      if (!Object.hasOwn(value, 'projection'))
        return { status: 'conflict', conflict, consentOutcome };
      return {
        status: 'conflict',
        conflict,
        projection: parseSettingsProjection(value.projection),
        consentOutcome,
      };
    }
    case 'diagnostics': {
      if (!isOneOf(value.consentOutcome, CONSENT_OUTCOMES)) return contractError();
      const diagnostics = readResultDiagnostics(value.diagnostics, true);
      if (diagnostics === null) return contractError();
      return { status: 'diagnostics', diagnostics, consentOutcome: value.consentOutcome };
    }
    case 'busy':
      return { status: 'busy' };
    case 'limited': {
      // Limited keeps the projection's blocking semantics: a non-blocking
      // "this document is not editable" notice is exactly what it carries.
      const diagnostics = readResultDiagnostics(value.diagnostics, false);
      if (diagnostics === null) return contractError();
      return { status: 'limited', diagnostics };
    }
    default:
      return contractError();
  }
}

export function parseCancelSettingsApplyResult(value: unknown): CancelSettingsApplyResult {
  if (!isRecord(value) || !hasOnlyKeys(value, ['status']) || value.status !== 'cancelled')
    return contractError();
  return { status: 'cancelled' };
}

/**
 * A draft is exactly a projection minus sourceOrigin and revision, so their
 * PRESENCE is a contract break and the remaining rules are checked once, by
 * the projection validator, with the two omitted members supplied here.
 */
export function parseProfileDraftProjection(value: unknown): ProfileDraftProjection {
  if (!isRecord(value)) return contractError();
  if (
    !hasOnlyKeys(value, [
      'state',
      'readOnly',
      'editable',
      'routes',
      'models',
      'providers',
      'diagnostics',
    ])
  )
    return contractError();
  if (value.state !== 'ready' && value.state !== 'limited') return contractError();
  const state = value.state;
  const projection = parseSettingsProjection({
    ...value,
    sourceOrigin: 'none',
    revision: '0'.repeat(64),
  });
  // Every loaded draft is credential-free: the loader clears every provider
  // key before the preview is built.
  if (projection.providers.some((provider) => provider.credentialState !== 'none'))
    return contractError();
  return {
    state,
    readOnly: projection.readOnly,
    editable: projection.editable,
    routes: projection.routes,
    models: projection.models,
    providers: projection.providers,
    diagnostics: projection.diagnostics,
  };
}

function readProfileDiagnostics(value: unknown): ProfileDiagnostic[] | null {
  const diagnostics = readCappedArray(value, MAX_PROJECTION_ENTRIES, (entry) => {
    if (!isRecord(entry) || !hasOnlyKeys(entry, ['code', 'profileId'])) return null;
    if (!isOneOf(entry.code, PROFILE_DIAGNOSTIC_CODES)) return null;
    const profileId = readOptional(entry, 'profileId', (raw) => (isProfileID(raw) ? raw : null));
    if (profileId === null) return null;
    return {
      code: entry.code,
      ...(profileId.present ? { profileId: profileId.value } : {}),
    };
  });
  if (diagnostics === null || diagnostics.length === 0) return null;
  return diagnostics;
}

export function parseGolemProfileLoadResult(value: unknown): GolemProfileLoadResult {
  if (!isRecord(value)) return contractError();
  switch (value.status) {
    case 'loaded': {
      if (!hasOnlyKeys(value, ['status', 'profileId', 'sourceRevision', 'projection']))
        return contractError();
      if (!isProfileID(value.profileId) || !isRevision(value.sourceRevision))
        return contractError();
      if (!Object.hasOwn(value, 'projection')) return contractError();
      return {
        status: 'loaded',
        profileId: value.profileId,
        sourceRevision: value.sourceRevision,
        projection: parseProfileDraftProjection(value.projection),
      };
    }
    case 'diagnostics': {
      if (!hasOnlyKeys(value, ['status', 'diagnostics'])) return contractError();
      const diagnostics = readProfileDiagnostics(value.diagnostics);
      if (diagnostics === null) return contractError();
      return { status: 'diagnostics', diagnostics };
    }
    default:
      return contractError();
  }
}
