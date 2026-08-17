/**
 * Golem chat contract for the frontend (#226 Task B7).
 *
 * Everything crossing the Wails boundary arrives as `unknown`: the generated
 * `ai.*` classes are constructed from `any` and never validate, so they are
 * INPUTS to the validators below rather than trusted UI state. Nothing here
 * casts an untrusted value into a declared type.
 *
 * `ai.RelayedEvent` and `ai.RunStatusEvent` are deliberately absent from the
 * generated models — no bound method returns them, so Wails never emits their
 * TypeScript shapes. `GolemEvent` and `GolemRunStatusEvent` are hand-written
 * mirrors of `internal/ai.RelayedEvent` / `internal/ai.RunStatusEvent`.
 */

import { ai } from '../../wailsjs/go/models';

export interface ConversationIdentity {
  repoEpoch: number;
  workspaceId: string;
  conversationId: string;
}

export interface RunIdentity extends ConversationIdentity {
  runId: string;
}

export interface ProviderDestination {
  provider: string;
  model: string;
  endpoint: string;
  classification: 'local' | 'remote';
  digest: string;
}

export interface GolemEvent {
  protocol: 1;
  threadId: string;
  runId: string;
  seq: number;
  type: string;
  payload: unknown;
  raw: string;
}

export interface GolemRunStatusEvent {
  identity: RunIdentity;
  state: 'failed' | 'canceled';
  message?: string;
}

export interface ConsentChallenge {
  id: string;
  identity: RunIdentity;
  destination: ProviderDestination;
  destinationDigest: string;
  expiresAt: number;
}

export interface ContextReceipt {
  included: number;
  bytes: number;
  excluded: number;
}

export interface TurnAdmissionBase {
  identity: RunIdentity;
  destination: ProviderDestination;
  context: ContextReceipt;
}

export type TurnAdmission =
  | (TurnAdmissionBase & { state: 'accepted'; consentChallenge?: never })
  | (TurnAdmissionBase & {
      state: 'needs_consent';
      consentChallenge: ConsentChallenge;
    });

export interface ActiveRunStatus {
  identity: RunIdentity;
  workspaceLabel: string;
  state: 'running' | 'canceling';
}

export interface GolemStatus {
  available: boolean;
  workspaceLabel: string;
  identity: ConversationIdentity;
  destination?: ProviderDestination;
  needsConsent: boolean;
  consentChallenge?: ConsentChallenge;
  activeRuns: ActiveRunStatus[];
  warnings?: string[];
  initError?: string;
}

export type RunPhase =
  | 'admitting'
  | 'needs-consent'
  | 'running'
  | 'canceling'
  | 'done'
  | 'failed'
  | 'canceled';

export interface TranscriptEntry {
  id: string;
  runId: string;
  kind: 'user' | 'assistant' | 'tool' | 'error';
  text: string;
  toolCallId?: string;
  toolName?: string;
  activity?: 'running' | 'done' | 'failed' | 'interrupted';
  raw?: GolemEvent;
}

export interface TurnDraft {
  message: string;
  contextRefs: string[];
}

export interface RunView {
  identity: RunIdentity;
  phase: RunPhase;
  lastSeq: number;
  request?: TurnDraft; // absent when reconstructed only from backend Status
  userEntryId?: string;
  error?: string;
}

export interface QueuedTurn extends TurnDraft {
  queueId: string;
  state: 'queued' | 'reopen-required';
  userEntryId?: string; // retained only when a consented prompt was already projected
}

export interface PendingConsentTurn {
  draft: TurnDraft;
  identity: RunIdentity;
  challenge: ConsentChallenge;
  userEntryId: string;
}

export interface RetryTurn {
  draft: TurnDraft;
  userEntryId: string;
}

export interface ConversationView {
  identity: ConversationIdentity;
  workspaceLabel: string;
  available: boolean;
  needsConsent: boolean;
  warnings: string[];
  initError: string | null;
  destination: ProviderDestination | null;
  rawEvents: GolemEvent[];
  transcript: TranscriptEntry[];
  runs: Record<string, RunView>;
  activeRunId: string | null;
  draft: string;
  queuedTurns: QueuedTurn[];
  pendingConsentTurn: PendingConsentTurn | null;
  lastFailedTurn: RetryTurn | null;
}

export interface GolemStoreState {
  conversations: Record<string, ConversationView>;
  runToConversation: Record<string, string>;
  selectedConversationId: string | null;
  hydratedIdentity: ConversationIdentity | null;
  bridgePhase: 'unbound' | 'binding' | 'ready' | 'error';
  bridgeError: string | null;
  lastActiveConversationId: string | null;
  activityRevision: number;
  lastFailureConversationId: string | null;
  failureRevision: number;
  panelMode: 'golem' | 'runs'; // initialize to 'runs'
  golemView: 'chat' | 'configuration'; // panel-level view; initialize to 'chat'
  setGolemView(view: GolemStoreState['golemView']): void;
  composerFocusRevision: number;
  hydrateStatus(status: GolemStatus): void;
  invalidateBinding(): void;
  ingestEvent(value: unknown): void;
  ingestRunStatus(value: unknown): void;
  selectConversation(conversationId: string): void;
  clearConversation(conversationId: string): void;
  setPanelMode(mode: GolemStoreState['panelMode']): void;
  setDraft(conversationId: string, value: string): void;
  submitTurn(conversationId: string): Promise<void>;
  allowAndSend(conversationId: string): Promise<void>;
  retryLastFailed(conversationId: string): Promise<void>;
  updateQueuedTurn(conversationId: string, queueId: string, message: string): void;
  removeQueuedTurn(conversationId: string, queueId: string): void;
  cancelRun(runId: string): Promise<void>;
}

// ── Wails inputs ──────────────────────────────────────────────────────────────
// Only the generated constructors build request payloads, so a field the Go
// structs do not declare cannot be smuggled across the boundary.

export const toStatusRequest = (identity: ConversationIdentity) =>
  new ai.StatusRequest({
    repoEpoch: identity.repoEpoch,
    workspaceId: identity.workspaceId,
  });

export const toTurnRequest = (identity: RunIdentity, draft: TurnDraft, consentChallengeId = '') =>
  new ai.TurnRequest({ identity, ...draft, consentChallengeId });

export const toCancelRequest = (identity: RunIdentity) => new ai.RunIdentity(identity);

// ── Boundary validators ───────────────────────────────────────────────────────

/**
 * The single error the request/response boundary raises. The message is fixed
 * so a malformed payload — which may embed provider or filesystem text — can
 * never reach the UI through the error path.
 */
export class GolemContractError extends Error {
  constructor() {
    super('Golem returned an unexpected response.');
    this.name = 'GolemContractError';
  }
}

const contractError = (): never => {
  throw new GolemContractError();
};

const MAX_ERROR_CHARS = 200;

/** Shown whenever a failure carries no usable message of its own. */
export const GOLEM_UNAVAILABLE = 'Golem is unavailable.';

/**
 * Clamps any rejection value to a short, displayable string. The backend
 * already sanitizes its own errors; this only bounds length and shape so a
 * hostile or oversized rejection cannot become the UI.
 */
export function boundedGolemMessage(value: unknown): string {
  const raw = typeof value === 'string' ? value : value instanceof Error ? value.message : '';
  const text = raw.trim() || GOLEM_UNAVAILABLE;
  return text.length > MAX_ERROR_CHARS ? `${text.slice(0, MAX_ERROR_CHARS - 1)}…` : text;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isString = (value: unknown): value is string => typeof value === 'string';

const isNumber = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** Absent means absent: `undefined` and `null` are the same missing optional. */
const isAbsent = (value: unknown): boolean => value === undefined || value === null;

function readConversationIdentity(value: unknown): ConversationIdentity | null {
  if (!isRecord(value)) return null;
  if (!isNumber(value.repoEpoch) || !isString(value.workspaceId) || !isString(value.conversationId))
    return null;
  return {
    repoEpoch: value.repoEpoch,
    workspaceId: value.workspaceId,
    conversationId: value.conversationId,
  };
}

function readRunIdentity(value: unknown): RunIdentity | null {
  const base = readConversationIdentity(value);
  if (!base || !isRecord(value)) return null;
  if (!isString(value.runId) || value.runId === '') return null;
  return { ...base, runId: value.runId };
}

function readDestination(value: unknown): ProviderDestination | null {
  if (!isRecord(value)) return null;
  const { provider, model, endpoint, classification, digest } = value;
  if (!isString(provider) || !isString(model) || !isString(endpoint) || !isString(digest))
    return null;
  if (classification !== 'local' && classification !== 'remote') return null;
  return { provider, model, endpoint, classification, digest };
}

function readContextReceipt(value: unknown): ContextReceipt | null {
  if (!isRecord(value)) return null;
  if (!isNumber(value.included) || !isNumber(value.bytes) || !isNumber(value.excluded)) return null;
  return { included: value.included, bytes: value.bytes, excluded: value.excluded };
}

function readConsentChallenge(value: unknown): ConsentChallenge | null {
  if (!isRecord(value)) return null;
  if (!isString(value.id) || value.id === '') return null;
  if (!isString(value.destinationDigest) || !isNumber(value.expiresAt)) return null;
  const challengeIdentity = readRunIdentity(value.identity);
  const destination = readDestination(value.destination);
  if (!challengeIdentity || !destination) return null;
  return {
    id: value.id,
    identity: challengeIdentity,
    destination,
    destinationDigest: value.destinationDigest,
    expiresAt: value.expiresAt,
  };
}

function readActiveRun(value: unknown): ActiveRunStatus | null {
  if (!isRecord(value)) return null;
  const activeIdentity = readRunIdentity(value.identity);
  if (!activeIdentity || !isString(value.workspaceLabel)) return null;
  if (value.state !== 'running' && value.state !== 'canceling') return null;
  return { identity: activeIdentity, workspaceLabel: value.workspaceLabel, state: value.state };
}

const sameRunIdentity = (a: RunIdentity, b: RunIdentity): boolean =>
  a.repoEpoch === b.repoEpoch &&
  a.workspaceId === b.workspaceId &&
  a.conversationId === b.conversationId &&
  a.runId === b.runId;

const sameDestination = (a: ProviderDestination, b: ProviderDestination): boolean =>
  a.provider === b.provider &&
  a.model === b.model &&
  a.endpoint === b.endpoint &&
  a.classification === b.classification &&
  a.digest === b.digest;

export function parseGolemStatus(value: unknown): GolemStatus {
  if (!isRecord(value)) return contractError();
  if (typeof value.available !== 'boolean' || typeof value.needsConsent !== 'boolean')
    return contractError();
  if (!isString(value.workspaceLabel)) return contractError();

  const statusIdentity = readConversationIdentity(value.identity);
  if (!statusIdentity) return contractError();

  if (!Array.isArray(value.activeRuns)) return contractError();
  const activeRuns: ActiveRunStatus[] = [];
  for (const entry of value.activeRuns) {
    const run = readActiveRun(entry);
    if (!run) return contractError();
    activeRuns.push(run);
  }

  const status: GolemStatus = {
    available: value.available,
    workspaceLabel: value.workspaceLabel,
    identity: statusIdentity,
    needsConsent: value.needsConsent,
    activeRuns,
  };

  if (!isAbsent(value.destination)) {
    const destination = readDestination(value.destination);
    if (!destination) return contractError();
    status.destination = destination;
  }
  if (!isAbsent(value.consentChallenge)) {
    const challenge = readConsentChallenge(value.consentChallenge);
    if (!challenge) return contractError();
    status.consentChallenge = challenge;
  }
  if (!isAbsent(value.warnings)) {
    if (!Array.isArray(value.warnings) || !value.warnings.every(isString)) return contractError();
    status.warnings = [...value.warnings];
  }
  if (!isAbsent(value.initError)) {
    if (!isString(value.initError)) return contractError();
    status.initError = value.initError;
  }
  return status;
}

export function parseTurnAdmission(value: unknown): TurnAdmission {
  if (!isRecord(value)) return contractError();
  const admissionIdentity = readRunIdentity(value.identity);
  const destination = readDestination(value.destination);
  const context = readContextReceipt(value.context);
  if (!admissionIdentity || !destination || !context) return contractError();

  if (value.state === 'accepted') {
    // An accepted admission that still carries a challenge is a contract break,
    // not a challenge to honour.
    if (!isAbsent(value.consentChallenge)) return contractError();
    return { state: 'accepted', identity: admissionIdentity, destination, context };
  }

  if (value.state !== 'needs_consent') return contractError();
  const challenge = readConsentChallenge(value.consentChallenge);
  if (!challenge) return contractError();
  if (!sameRunIdentity(challenge.identity, admissionIdentity)) return contractError();
  if (!sameDestination(challenge.destination, destination)) return contractError();
  if (challenge.destinationDigest !== destination.digest) return contractError();

  return {
    state: 'needs_consent',
    identity: admissionIdentity,
    destination,
    context,
    consentChallenge: challenge,
  };
}

/** Streamed events are advisory: a malformed one is dropped, never surfaced. */
export function parseGolemEvent(value: unknown): GolemEvent | null {
  if (!isRecord(value)) return null;
  if (value.protocol !== 1) return null;
  if (!isString(value.threadId) || value.threadId === '') return null;
  if (!isString(value.runId) || value.runId === '') return null;
  if (!isNumber(value.seq) || value.seq < 0) return null;
  if (!isString(value.type) || value.type === '') return null;
  if (!isString(value.raw)) return null;
  return {
    protocol: 1,
    threadId: value.threadId,
    runId: value.runId,
    seq: value.seq,
    type: value.type,
    payload: value.payload,
    raw: value.raw,
  };
}

export function parseRunStatus(value: unknown): GolemRunStatusEvent | null {
  if (!isRecord(value)) return null;
  const statusIdentity = readRunIdentity(value.identity);
  if (!statusIdentity) return null;
  if (value.state !== 'failed' && value.state !== 'canceled') return null;
  if (!isAbsent(value.message) && !isString(value.message)) return null;
  const event: GolemRunStatusEvent = { identity: statusIdentity, state: value.state };
  if (isString(value.message)) event.message = value.message;
  return event;
}

// ── Settings projection (#263 Phase 1) ───────────────────────────────────────
// Read-only. EVERY enum below is a CLOSED set — including capability names and
// diagnostic codes. Phase 2 grows the sets on both sides of the boundary in
// the same change; an unknown value here is a contract break, not data.
// Limits mirror internal/ai/settings.go and are exercised by the shared corpus
// in internal/ai/testdata/settings_contract/.

export type SettingsState = 'missing' | 'invalid' | 'limited' | 'ready';
export type SettingsSourceOrigin = 'none' | 'env' | 'working_directory' | 'user_config' | 'legacy';
export type ProviderClassification = 'local' | 'remote' | 'unknown';
export type CredentialState = 'none' | 'available' | 'reference_unavailable';
export type DiagnosticSubjectKind = '' | 'role' | 'model' | 'provider';
export type SettingsDiagnosticCode =
  | 'config_missing'
  | 'json_invalid'
  | 'config_invalid'
  | 'agent_role_missing'
  | 'agent_capabilities_insufficient'
  | 'provider_endpoint_unsupported'
  | 'projection_limited';
export type CapabilityName =
  | 'chat'
  | 'generate'
  | 'stream'
  | 'embed'
  | 'tool_call'
  | 'thinking'
  | 'insert';

export interface RouteProjection {
  useCase: string;
  role: string;
}

export interface ModelProjection {
  role: string;
  modelName: string;
  provider: string;
  type: string;
  effectiveCapabilities: CapabilityName[];
  thinkMode: string;
}

export interface ProviderProjection {
  name: string;
  endpoint: string;
  classification: ProviderClassification;
  apiFormat: string;
  credentialState: CredentialState;
}

export interface SettingsDiagnostic {
  code: SettingsDiagnosticCode;
  subjectKind: DiagnosticSubjectKind;
  subjectName: string;
  blocking: boolean;
}

export interface SettingsProjection {
  state: SettingsState;
  sourceOrigin: SettingsSourceOrigin;
  routes: RouteProjection[];
  models: ModelProjection[];
  providers: ProviderProjection[];
  diagnostics: SettingsDiagnostic[];
}

export interface SettingsReloadResult {
  busy: boolean;
  projection: SettingsProjection;
}

const MAX_PROJECTION_ENTRIES = 256;
// All string limits are UTF-8 BYTE counts, matching internal/ai/settings.go
// (Go len()). Measured here with TextEncoder — never String.length, whose
// UTF-16 code units disagree with Go on non-ASCII input.
const MAX_IDENTIFIER_BYTES = 256;
const MAX_ENDPOINT_BYTES = 1024;
// Worst case the backend can emit: one endpoint diagnostic per provider plus
// one agent diagnostic (see internal/ai/settings.go maxProjectionDiagnostics).
const MAX_DIAGNOSTICS = MAX_PROJECTION_ENTRIES + 1;

const utf8Encoder = new TextEncoder();
const utf8Length = (value: string): number => utf8Encoder.encode(value).length;

const SETTINGS_STATES: readonly SettingsState[] = ['missing', 'invalid', 'limited', 'ready'];
const SOURCE_ORIGINS: readonly SettingsSourceOrigin[] = [
  'none',
  'env',
  'working_directory',
  'user_config',
  'legacy',
];
const CLASSIFICATIONS: readonly ProviderClassification[] = ['local', 'remote', 'unknown'];
const CREDENTIAL_STATES: readonly CredentialState[] = [
  'none',
  'available',
  'reference_unavailable',
];
const SUBJECT_KINDS: readonly DiagnosticSubjectKind[] = ['', 'role', 'model', 'provider'];
const DIAGNOSTIC_CODES: readonly SettingsDiagnosticCode[] = [
  'config_missing',
  'json_invalid',
  'config_invalid',
  'agent_role_missing',
  'agent_capabilities_insufficient',
  'provider_endpoint_unsupported',
  'projection_limited',
];
const CAPABILITY_NAMES: readonly CapabilityName[] = [
  'chat',
  'generate',
  'stream',
  'embed',
  'tool_call',
  'thinking',
  'insert',
];

const isBoundedString = (value: unknown, maxBytes: number): value is string =>
  isString(value) && utf8Length(value) <= maxBytes;

const isOneOf = <T extends string>(value: unknown, allowed: readonly T[]): value is T =>
  isString(value) && (allowed as readonly string[]).includes(value);

function readCappedArray<T>(
  value: unknown,
  max: number,
  read: (entry: unknown) => T | null
): T[] | null {
  if (!Array.isArray(value) || value.length > max) return null;
  const out: T[] = [];
  for (const entry of value) {
    const item = read(entry);
    if (item === null) return null;
    out.push(item);
  }
  return out;
}

function readRoute(value: unknown): RouteProjection | null {
  if (!isRecord(value)) return null;
  // Explicit empty useCase/role stay legal: go-llm permits empty map keys and
  // the Go oracle mirrors that; only providers reject empty names.
  if (!isBoundedString(value.useCase, MAX_IDENTIFIER_BYTES)) return null;
  if (!isBoundedString(value.role, MAX_IDENTIFIER_BYTES)) return null;
  return { useCase: value.useCase, role: value.role };
}

function readModel(value: unknown): ModelProjection | null {
  if (!isRecord(value)) return null;
  const { role, modelName, provider, type, effectiveCapabilities, thinkMode } = value;
  if (!isBoundedString(role, MAX_IDENTIFIER_BYTES)) return null;
  if (!isBoundedString(modelName, MAX_IDENTIFIER_BYTES)) return null;
  if (!isBoundedString(provider, MAX_IDENTIFIER_BYTES)) return null;
  if (!isBoundedString(type, MAX_IDENTIFIER_BYTES)) return null;
  if (!isBoundedString(thinkMode, MAX_IDENTIFIER_BYTES)) return null;
  const caps = readCappedArray(effectiveCapabilities, CAPABILITY_NAMES.length, (c) =>
    isOneOf(c, CAPABILITY_NAMES) ? c : null
  );
  if (caps === null) return null;
  return { role, modelName, provider, type, effectiveCapabilities: caps, thinkMode };
}

function readProvider(value: unknown): ProviderProjection | null {
  if (!isRecord(value)) return null;
  const { name, endpoint, classification, apiFormat, credentialState } = value;
  if (!isBoundedString(name, MAX_IDENTIFIER_BYTES) || name === '') return null;
  if (!isBoundedString(endpoint, MAX_ENDPOINT_BYTES)) return null;
  if (!isOneOf(classification, CLASSIFICATIONS)) return null;
  if (!isBoundedString(apiFormat, MAX_IDENTIFIER_BYTES)) return null;
  if (!isOneOf(credentialState, CREDENTIAL_STATES)) return null;
  return { name, endpoint, classification, apiFormat, credentialState };
}

function readSettingsDiagnostic(value: unknown): SettingsDiagnostic | null {
  if (!isRecord(value)) return null;
  const { code, subjectKind, subjectName, blocking } = value;
  if (!isOneOf(code, DIAGNOSTIC_CODES)) return null;
  if (!isOneOf(subjectKind, SUBJECT_KINDS)) return null;
  if (!isBoundedString(subjectName, MAX_IDENTIFIER_BYTES)) return null;
  if (typeof blocking !== 'boolean') return null;
  return { code, subjectKind, subjectName, blocking };
}

export function parseSettingsProjection(value: unknown): SettingsProjection {
  if (!isRecord(value)) return contractError();
  if (!isOneOf(value.state, SETTINGS_STATES)) return contractError();
  if (!isOneOf(value.sourceOrigin, SOURCE_ORIGINS)) return contractError();
  const routes = readCappedArray(value.routes, MAX_PROJECTION_ENTRIES, readRoute);
  const models = readCappedArray(value.models, MAX_PROJECTION_ENTRIES, readModel);
  const providers = readCappedArray(value.providers, MAX_PROJECTION_ENTRIES, readProvider);
  const diagnostics = readCappedArray(value.diagnostics, MAX_DIAGNOSTICS, readSettingsDiagnostic);
  if (routes === null || models === null || providers === null || diagnostics === null)
    return contractError();
  return {
    state: value.state,
    sourceOrigin: value.sourceOrigin,
    routes,
    models,
    providers,
    diagnostics,
  };
}

export function parseSettingsReloadResult(value: unknown): SettingsReloadResult {
  if (!isRecord(value)) return contractError();
  if (typeof value.busy !== 'boolean') return contractError();
  return { busy: value.busy, projection: parseSettingsProjection(value.projection) };
}
