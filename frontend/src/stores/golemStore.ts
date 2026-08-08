import { create } from 'zustand';
import { CancelGolemRun, RunGolemTurn } from '../../wailsjs/go/main/App';
import {
  boundedGolemMessage as boundedMessage,
  GolemContractError,
  parseGolemEvent,
  parseRunStatus,
  parseTurnAdmission,
  toCancelRequest,
  toTurnRequest,
} from '../types/golem';
import type {
  ConversationIdentity,
  ConversationView,
  GolemEvent,
  GolemStatus,
  GolemStoreState,
  RunIdentity,
  RunPhase,
  RunView,
  TranscriptEntry,
  TurnAdmission,
  TurnDraft,
} from '../types/golem';

/**
 * Conversation-keyed Golem chat state (#226 Task B7).
 *
 * The panel unmounts whenever the right panel collapses or switches to Runs, so
 * everything a conversation needs to survive that — transcript, draft, queue,
 * pending consent, composer focus — lives here rather than in component state.
 *
 * Two invariants drive most of the code:
 *  1. Reduction is monotonic. A run's phase only advances; a terminal phase is a
 *     process-lifetime tombstone for that run ID, so a deferred `RunGolemTurn`
 *     or `GetGolemStatus` result that lands after the run already ended cannot
 *     resurrect it, reopen the active slot, or dispatch the queue a second time.
 *  2. Nothing from the boundary is trusted. Wails results go through the
 *     validators in `types/golem.ts`; a contract break is a bridge error, and a
 *     malformed streamed event is silently dropped.
 */

const GENERIC_ERROR = 'Golem is unavailable.';
const RUN_FAILED_ERROR = 'The Golem run failed.';
const NO_SECURE_UUID_ERROR =
  'This window cannot generate a secure run ID, so the turn was not sent.';
const STALE_BINDING_ERROR = 'The workspace changed before this turn started.';

/**
 * Highest repository epoch ever hydrated. Epochs are never reused within a
 * process, so this is a monotonic floor that rejects a status snapshot captured
 * before an unbind/rebind even while `hydratedIdentity` is momentarily null.
 */
let hydratedEpochFloor = 0;
let localIdSeq = 0;

const nextLocalId = (prefix: string): string => `${prefix}-${++localIdSeq}`;

/**
 * `crypto.randomUUID` exists only in secure contexts. There is deliberately no
 * `Math.random`/timestamp fallback: the backend accepts nothing but a canonical
 * v4 UUID, and a guessable run ID is an identity, not a formatting, problem.
 */
function secureRandomUUID(): string | null {
  const webCrypto = globalThis.crypto;
  if (!webCrypto || typeof webCrypto.randomUUID !== 'function') return null;
  try {
    return webCrypto.randomUUID();
  } catch {
    return null;
  }
}

const isTerminalPhase = (phase: RunPhase): boolean =>
  phase === 'done' || phase === 'failed' || phase === 'canceled';

const sameConversationIdentity = (
  a: ConversationIdentity | null,
  b: ConversationIdentity | null
): boolean =>
  a !== null &&
  b !== null &&
  a.repoEpoch === b.repoEpoch &&
  a.workspaceId === b.workspaceId &&
  a.conversationId === b.conversationId;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === 'string' && value !== '';

function newConversation(identity: ConversationIdentity, workspaceLabel = ''): ConversationView {
  return {
    identity,
    workspaceLabel,
    available: false,
    needsConsent: false,
    warnings: [],
    initError: null,
    destination: null,
    rawEvents: [],
    transcript: [],
    runs: {},
    activeRunId: null,
    draft: '',
    queuedTurns: [],
    pendingConsentTurn: null,
    lastFailedTurn: null,
  };
}

// ── mutation scratchpad ───────────────────────────────────────────────────────
// A shallow working copy of the slices a reducer may touch. Conversations are
// copied on write so an ignored event leaves every object identity untouched
// and React skips the re-render entirely.

interface Mutation {
  conversations: Record<string, ConversationView>;
  runToConversation: Record<string, string>;
  lastActiveConversationId: string | null;
  activityRevision: number;
  lastFailureConversationId: string | null;
  failureRevision: number;
}

const beginMutation = (state: GolemStoreState): Mutation => ({
  conversations: { ...state.conversations },
  runToConversation: { ...state.runToConversation },
  lastActiveConversationId: state.lastActiveConversationId,
  activityRevision: state.activityRevision,
  lastFailureConversationId: state.lastFailureConversationId,
  failureRevision: state.failureRevision,
});

function draftConversation(mutation: Mutation, conversationId: string): ConversationView | null {
  const existing = mutation.conversations[conversationId];
  if (!existing) return null;
  const copy: ConversationView = {
    ...existing,
    warnings: [...existing.warnings],
    rawEvents: [...existing.rawEvents],
    transcript: [...existing.transcript],
    runs: { ...existing.runs },
    queuedTurns: [...existing.queuedTurns],
  };
  mutation.conversations[conversationId] = copy;
  return copy;
}

function markActive(mutation: Mutation, conversationId: string): void {
  mutation.lastActiveConversationId = conversationId;
  mutation.activityRevision += 1;
}

function markFailure(mutation: Mutation, conversationId: string): void {
  mutation.lastFailureConversationId = conversationId;
  mutation.failureRevision += 1;
}

function appendError(
  conversation: ConversationView,
  runId: string,
  text: string,
  raw?: GolemEvent
) {
  const entry: TranscriptEntry = { id: nextLocalId('error'), runId, kind: 'error', text };
  if (raw) entry.raw = raw;
  conversation.transcript.push(entry);
}

function upsertRun(
  conversation: ConversationView,
  runId: string,
  patch: Partial<RunView>
): RunView {
  const existing = conversation.runs[runId] ?? {
    identity: { ...conversation.identity, runId },
    phase: 'running' as RunPhase,
    lastSeq: -1,
  };
  const next = { ...existing, ...patch };
  conversation.runs[runId] = next;
  return next;
}

// ── event payload projections ─────────────────────────────────────────────────

type Projection =
  | { kind: 'none' }
  | { kind: 'delta'; messageId: string; text: string }
  | { kind: 'tool-start'; toolCallId: string; name: string; preview: string }
  | { kind: 'tool-finish'; toolCallId: string; name: string; preview: string; isError: boolean }
  | { kind: 'terminal'; phase: RunPhase; message?: string };

/**
 * Classifies one already-validated envelope. `null` means the payload does not
 * match its own event type, in which case the event is dropped whole rather
 * than half-applied. Terminals are deliberately lenient: dropping one would
 * wedge the conversation's active slot forever.
 */
function classifyEvent(event: GolemEvent): Projection | null {
  const payload = event.payload;
  switch (event.type) {
    case 'run.started':
      return isRecord(payload) ? { kind: 'none' } : null;
    case 'message.delta': {
      if (!isRecord(payload)) return null;
      if (!isNonEmptyString(payload.messageId) || typeof payload.text !== 'string') return null;
      return { kind: 'delta', messageId: payload.messageId, text: payload.text };
    }
    case 'tool.started': {
      if (!isRecord(payload) || !isNonEmptyString(payload.toolCallId)) return null;
      return {
        kind: 'tool-start',
        toolCallId: payload.toolCallId,
        name: typeof payload.name === 'string' ? payload.name : '',
        preview: typeof payload.preview === 'string' ? payload.preview : '',
      };
    }
    case 'tool.finished': {
      if (!isRecord(payload) || !isNonEmptyString(payload.toolCallId)) return null;
      return {
        kind: 'tool-finish',
        toolCallId: payload.toolCallId,
        name: typeof payload.name === 'string' ? payload.name : '',
        preview: typeof payload.preview === 'string' ? payload.preview : '',
        isError: payload.isError === true,
      };
    }
    case 'run.finished':
      return isRecord(payload) ? { kind: 'terminal', phase: 'done' } : null;
    case 'run.canceled':
      return isRecord(payload) ? { kind: 'terminal', phase: 'canceled' } : null;
    case 'run.failed': {
      if (!isRecord(payload)) return null;
      const message =
        typeof payload.message === 'string' && payload.message.trim() !== ''
          ? boundedMessage(payload.message)
          : RUN_FAILED_ERROR;
      return { kind: 'terminal', phase: 'failed', message };
    }
    default:
      return { kind: 'none' };
  }
}

function applyDelta(
  conversation: ConversationView,
  event: GolemEvent,
  messageId: string,
  text: string
) {
  const entryId = `assistant:${event.runId}:${messageId}`;
  const index = conversation.transcript.findIndex((entry) => entry.id === entryId);
  if (index < 0) {
    conversation.transcript.push({
      id: entryId,
      runId: event.runId,
      kind: 'assistant',
      text,
      raw: event,
    });
    return;
  }
  const previous = conversation.transcript[index];
  conversation.transcript[index] = { ...previous, text: previous.text + text, raw: event };
}

function applyToolEvent(
  conversation: ConversationView,
  event: GolemEvent,
  projection: Extract<Projection, { kind: 'tool-start' | 'tool-finish' }>
) {
  const entryId = `tool:${event.runId}:${projection.toolCallId}`;
  const index = conversation.transcript.findIndex((entry) => entry.id === entryId);
  const activity =
    projection.kind === 'tool-start' ? 'running' : projection.isError ? 'failed' : 'done';
  if (index < 0) {
    conversation.transcript.push({
      id: entryId,
      runId: event.runId,
      kind: 'tool',
      text: projection.preview,
      toolCallId: projection.toolCallId,
      toolName: projection.name,
      activity,
      raw: event,
    });
    return;
  }
  const previous = conversation.transcript[index];
  conversation.transcript[index] = {
    ...previous,
    text: projection.preview || previous.text,
    toolName: projection.name || previous.toolName,
    activity,
    raw: event,
  };
}

// ── terminal reduction and queue dispatch ─────────────────────────────────────

interface PendingDispatch {
  identity: RunIdentity;
  draft: TurnDraft;
}

interface DispatchContext {
  hydratedIdentity: ConversationIdentity | null;
  bridgePhase: GolemStoreState['bridgePhase'];
}

/**
 * Starts at most the first staged turn. The backend emits a run's terminal only
 * after it has released the conversation, so dispatching here — and only here —
 * cannot be rejected as busy.
 */
function dispatchQueued(
  mutation: Mutation,
  conversationId: string,
  context: DispatchContext
): PendingDispatch | null {
  const conversation = mutation.conversations[conversationId];
  if (!conversation) return null;
  if (conversation.activeRunId !== null || conversation.pendingConsentTurn !== null) return null;

  const index = conversation.queuedTurns.findIndex((turn) => turn.state === 'queued');
  if (index < 0) return null;

  const current = context.hydratedIdentity;
  const epochCurrent =
    context.bridgePhase === 'ready' &&
    current !== null &&
    current.repoEpoch === conversation.identity.repoEpoch &&
    conversation.available;
  if (!epochCurrent) {
    conversation.queuedTurns[index] = {
      ...conversation.queuedTurns[index],
      state: 'reopen-required',
    };
    return null;
  }

  const runId = secureRandomUUID();
  const queued = conversation.queuedTurns[index];
  if (!runId) {
    appendError(conversation, '', NO_SECURE_UUID_ERROR);
    return null;
  }

  conversation.queuedTurns.splice(index, 1);
  const draft: TurnDraft = { message: queued.message, contextRefs: [...queued.contextRefs] };
  const identity: RunIdentity = { ...conversation.identity, runId };

  let userEntryId = queued.userEntryId;
  if (userEntryId) {
    // A consented prompt was already projected: retag it rather than repeat it.
    const existing = conversation.transcript.findIndex((entry) => entry.id === userEntryId);
    if (existing >= 0) {
      conversation.transcript[existing] = {
        ...conversation.transcript[existing],
        runId,
        text: draft.message,
      };
    } else {
      userEntryId = undefined;
    }
  }
  if (!userEntryId) {
    userEntryId = nextLocalId('user');
    conversation.transcript.push({ id: userEntryId, runId, kind: 'user', text: draft.message });
  }

  conversation.runs[runId] = {
    identity,
    phase: 'admitting',
    lastSeq: -1,
    request: draft,
    userEntryId,
  };
  conversation.activeRunId = runId;
  mutation.runToConversation[runId] = conversationId;
  return { identity, draft };
}

/**
 * Applies one terminal exactly once. A run already in a terminal phase is a
 * tombstone: it never re-enters the active slot and never re-dispatches.
 */
function finishRun(
  mutation: Mutation,
  conversationId: string,
  runId: string,
  phase: RunPhase,
  context: DispatchContext,
  message?: string,
  raw?: GolemEvent
): PendingDispatch | null {
  const conversation = mutation.conversations[conversationId];
  if (!conversation) return null;
  const existing = conversation.runs[runId];
  if (existing && isTerminalPhase(existing.phase)) return null;

  const run = upsertRun(conversation, runId, message ? { phase, error: message } : { phase });

  conversation.transcript = conversation.transcript.map((entry) =>
    entry.kind === 'tool' && entry.runId === runId && entry.activity === 'running'
      ? { ...entry, activity: 'interrupted' }
      : entry
  );
  if (message) appendError(conversation, runId, message, raw);

  if (conversation.activeRunId === runId) conversation.activeRunId = null;

  const pending = conversation.pendingConsentTurn;
  if (pending && pending.identity.runId === runId) {
    conversation.lastFailedTurn = { draft: pending.draft, userEntryId: pending.userEntryId };
    conversation.pendingConsentTurn = null;
  } else if (phase === 'failed' && run.request && run.userEntryId) {
    conversation.lastFailedTurn = { draft: run.request, userEntryId: run.userEntryId };
  }

  if (phase === 'failed') markFailure(mutation, conversationId);

  return dispatchQueued(mutation, conversationId, context);
}

// ── store ─────────────────────────────────────────────────────────────────────

const initialState = () => ({
  conversations: {} as Record<string, ConversationView>,
  runToConversation: {} as Record<string, string>,
  selectedConversationId: null as string | null,
  hydratedIdentity: null as ConversationIdentity | null,
  bridgePhase: 'unbound' as GolemStoreState['bridgePhase'],
  bridgeError: null as string | null,
  lastActiveConversationId: null as string | null,
  activityRevision: 0,
  lastFailureConversationId: null as string | null,
  failureRevision: 0,
  // Preserve today's panel: Golem is opt-in, and once chosen it stays chosen
  // for the rest of the process.
  panelMode: 'runs' as GolemStoreState['panelMode'],
  composerFocusRevision: 0,
});

export const useGolemStore = create<GolemStoreState>()((set, get) => {
  /** Send is allowed only into the conversation the backend just hydrated. */
  const canSend = (conversationId: string): boolean => {
    const state = get();
    const conversation = state.conversations[conversationId];
    if (!conversation || !conversation.available) return false;
    if (state.bridgePhase !== 'ready') return false;
    return sameConversationIdentity(state.hydratedIdentity, conversation.identity);
  };

  /** Advances only the token-matched run that is still awaiting admission. */
  const admittingRun = (
    state: GolemStoreState,
    identity: RunIdentity
  ): { conversationId: string; run: RunView } | null => {
    const conversationId = state.runToConversation[identity.runId];
    if (!conversationId) return null;
    const run = state.conversations[conversationId]?.runs[identity.runId];
    if (!run || run.phase !== 'admitting') return null;
    return { conversationId, run };
  };

  const applyAdmission = (identity: RunIdentity, admission: TurnAdmission) => {
    set((state) => {
      const matched = admittingRun(state, identity);
      if (!matched) return state;
      const mutation = beginMutation(state);
      const conversation = draftConversation(mutation, matched.conversationId)!;
      const run = conversation.runs[identity.runId];

      if (admission.state === 'accepted') {
        conversation.runs[identity.runId] = { ...run, phase: 'running' };
        if (conversation.activeRunId === null) conversation.activeRunId = identity.runId;
        if (conversation.pendingConsentTurn?.identity.runId === identity.runId) {
          conversation.pendingConsentTurn = null;
        }
        markActive(mutation, matched.conversationId);
        return { ...mutation };
      }

      // A challenge belongs to the binding that issued it; the backend drops it
      // on unbind, so a stale-epoch grant must never be offered to the user.
      const stale = identity.repoEpoch < hydratedEpochFloor;
      if (stale || !run.request || !run.userEntryId) {
        conversation.runs[identity.runId] = {
          ...run,
          phase: 'failed',
          error: STALE_BINDING_ERROR,
        };
        appendError(conversation, identity.runId, STALE_BINDING_ERROR);
        if (conversation.activeRunId === identity.runId) conversation.activeRunId = null;
        if (run.request && run.userEntryId) {
          conversation.lastFailedTurn = { draft: run.request, userEntryId: run.userEntryId };
        }
        markFailure(mutation, matched.conversationId);
        return { ...mutation };
      }

      conversation.runs[identity.runId] = { ...run, phase: 'needs-consent' };
      conversation.activeRunId = identity.runId;
      conversation.pendingConsentTurn = {
        draft: run.request,
        identity: run.identity,
        challenge: admission.consentChallenge,
        userEntryId: run.userEntryId,
      };
      return { ...mutation };
    });
  };

  const applyTurnFailure = (identity: RunIdentity, message: string, consentRetry: boolean) => {
    set((state) => {
      const matched = admittingRun(state, identity);
      if (!matched) return state;
      const mutation = beginMutation(state);
      const conversation = draftConversation(mutation, matched.conversationId)!;
      const run = conversation.runs[identity.runId];

      if (consentRetry) {
        // Keep the exact challenge and prompt row so the grant can be retried.
        conversation.runs[identity.runId] = { ...run, phase: 'needs-consent', error: message };
        appendError(conversation, identity.runId, message);
        markFailure(mutation, matched.conversationId);
        return { ...mutation };
      }

      conversation.runs[identity.runId] = { ...run, phase: 'failed', error: message };
      appendError(conversation, identity.runId, message);
      if (conversation.activeRunId === identity.runId) conversation.activeRunId = null;
      if (run.request && run.userEntryId) {
        conversation.lastFailedTurn = { draft: run.request, userEntryId: run.userEntryId };
      }
      markFailure(mutation, matched.conversationId);
      // Deliberately no queue dispatch: a rejected admission usually means the
      // next turn would be rejected too, and draining would burn the whole queue.
      return { ...mutation };
    });
  };

  const runTurn = async (
    identity: RunIdentity,
    draft: TurnDraft,
    challengeId: string | null
  ): Promise<void> => {
    const consentRetry = challengeId !== null;
    let admission: TurnAdmission;
    try {
      const result = await RunGolemTurn(toTurnRequest(identity, draft, challengeId ?? ''));
      admission = parseTurnAdmission(result);
      if (
        admission.identity.runId !== identity.runId ||
        admission.identity.repoEpoch !== identity.repoEpoch ||
        admission.identity.workspaceId !== identity.workspaceId ||
        admission.identity.conversationId !== identity.conversationId
      ) {
        throw new GolemContractError();
      }
    } catch (err) {
      if (err instanceof GolemContractError) {
        set({ bridgePhase: 'error', bridgeError: err.message });
      }
      applyTurnFailure(identity, boundedMessage(err), consentRetry);
      return;
    }
    applyAdmission(identity, admission);
  };

  const runDispatch = (dispatch: PendingDispatch | null) => {
    if (dispatch) void runTurn(dispatch.identity, dispatch.draft, null);
  };

  return {
    ...initialState(),

    hydrateStatus(status: GolemStatus) {
      // A status that never resolved a workspace carries the zero identity: it
      // is a binding failure, not a conversation.
      if (status.identity.conversationId === '') {
        set({
          bridgePhase: 'error',
          bridgeError: boundedMessage(status.initError ?? GENERIC_ERROR),
          hydratedIdentity: null,
        });
        return;
      }
      if (status.identity.repoEpoch < hydratedEpochFloor) return;
      hydratedEpochFloor = Math.max(hydratedEpochFloor, status.identity.repoEpoch);

      let reissued = false;
      set((state) => {
        const mutation = beginMutation(state);
        const conversationId = status.identity.conversationId;
        const known = mutation.conversations[conversationId];
        // A conversation that has never been hydrated is not "previously
        // healthy", so a cold-start degraded status still counts as new.
        const wasDegraded = known ? !known.available || known.initError !== null : false;
        if (!known) {
          mutation.conversations[conversationId] = newConversation(
            status.identity,
            status.workspaceLabel
          );
        }
        const conversation = draftConversation(mutation, conversationId)!;

        conversation.identity = status.identity;
        conversation.workspaceLabel = status.workspaceLabel;
        conversation.available = status.available;
        conversation.needsConsent = status.needsConsent;
        conversation.warnings = [...(status.warnings ?? [])];
        conversation.initError = status.initError ?? null;
        conversation.destination = status.destination ?? null;

        const degraded = !status.available || conversation.initError !== null;
        if (degraded && !wasDegraded) markFailure(mutation, conversationId);

        // Reopening the same repository re-arms turns staged while it was closed.
        conversation.queuedTurns = conversation.queuedTurns.map((turn) => {
          if (turn.state !== 'reopen-required') return turn;
          reissued = true;
          return { ...turn, state: 'queued' as const };
        });

        for (const active of status.activeRuns) {
          const runConversationId = active.identity.conversationId;
          if (!mutation.conversations[runConversationId]) {
            mutation.conversations[runConversationId] = newConversation(
              {
                repoEpoch: active.identity.repoEpoch,
                workspaceId: active.identity.workspaceId,
                conversationId: runConversationId,
              },
              active.workspaceLabel
            );
          }
          const target =
            runConversationId === conversationId
              ? conversation
              : draftConversation(mutation, runConversationId)!;
          if (!target.workspaceLabel) target.workspaceLabel = active.workspaceLabel;

          const known = target.runs[active.identity.runId];
          if (known && isTerminalPhase(known.phase)) continue; // tombstone
          target.runs[active.identity.runId] = {
            ...(known ?? { lastSeq: -1 }),
            identity: active.identity,
            phase: active.state,
          } as RunView;
          mutation.runToConversation[active.identity.runId] = runConversationId;
          if (target.activeRunId === null) target.activeRunId = active.identity.runId;
        }

        return {
          ...mutation,
          hydratedIdentity: status.identity,
          bridgePhase: 'ready' as const,
          bridgeError: null,
          selectedConversationId: state.selectedConversationId ?? conversationId,
        };
      });

      if (!reissued) return;
      let dispatch: PendingDispatch | null = null;
      set((state) => {
        const mutation = beginMutation(state);
        draftConversation(mutation, status.identity.conversationId);
        dispatch = dispatchQueued(mutation, status.identity.conversationId, {
          hydratedIdentity: state.hydratedIdentity,
          bridgePhase: state.bridgePhase,
        });
        return { ...mutation };
      });
      runDispatch(dispatch);
    },

    invalidateBinding() {
      set((state) => {
        const mutation = beginMutation(state);
        for (const conversationId of Object.keys(mutation.conversations)) {
          const conversation = draftConversation(mutation, conversationId)!;
          const pending = conversation.pendingConsentTurn;
          if (pending) {
            // The backend drops unconsumed challenges for a retired binding, so
            // the prompt goes back on the shelf with its existing user row.
            conversation.queuedTurns.push({
              ...pending.draft,
              queueId: nextLocalId('queue'),
              state: 'reopen-required',
              userEntryId: pending.userEntryId,
            });
            conversation.pendingConsentTurn = null;
            const run = conversation.runs[pending.identity.runId];
            if (run && !isTerminalPhase(run.phase)) {
              conversation.runs[pending.identity.runId] = { ...run, phase: 'canceled' };
            }
            if (conversation.activeRunId === pending.identity.runId) {
              conversation.activeRunId = null;
            }
          }
          conversation.queuedTurns = conversation.queuedTurns.map((turn) =>
            turn.state === 'queued' ? { ...turn, state: 'reopen-required' as const } : turn
          );
        }
        return {
          ...mutation,
          hydratedIdentity: null,
          bridgePhase: 'unbound' as const,
          bridgeError: null,
        };
      });
    },

    ingestEvent(value: unknown) {
      const event = parseGolemEvent(value);
      if (!event) return;

      const state = get();
      const conversationId = state.runToConversation[event.runId] ?? event.threadId;
      const conversation = state.conversations[conversationId];
      if (!conversation) return;

      const knownRun = conversation.runs[event.runId];
      if (knownRun && event.seq <= knownRun.lastSeq) return;
      const projection = classifyEvent(event);
      if (!projection) return;

      let dispatch: PendingDispatch | null = null;
      set((current) => {
        const mutation = beginMutation(current);
        const draft = draftConversation(mutation, conversationId);
        if (!draft) return current;
        mutation.runToConversation[event.runId] = conversationId;

        draft.rawEvents.push(event);
        upsertRun(draft, event.runId, { lastSeq: event.seq });

        switch (projection.kind) {
          case 'delta':
            applyDelta(draft, event, projection.messageId, projection.text);
            break;
          case 'tool-start':
          case 'tool-finish':
            applyToolEvent(draft, event, projection);
            break;
          case 'terminal':
            dispatch = finishRun(
              mutation,
              conversationId,
              event.runId,
              projection.phase,
              { hydratedIdentity: current.hydratedIdentity, bridgePhase: current.bridgePhase },
              projection.message,
              event
            );
            break;
          case 'none':
            if (event.type === 'run.started') {
              const run = draft.runs[event.runId];
              if (!isTerminalPhase(run.phase) && run.phase !== 'canceling') {
                draft.runs[event.runId] = { ...run, phase: 'running' };
              }
            }
            break;
        }
        return { ...mutation };
      });
      runDispatch(dispatch);
    },

    ingestRunStatus(value: unknown) {
      const status = parseRunStatus(value);
      if (!status) return;

      const state = get();
      const conversationId =
        state.runToConversation[status.identity.runId] ?? status.identity.conversationId;
      if (!state.conversations[conversationId]) return;

      let dispatch: PendingDispatch | null = null;
      set((current) => {
        const mutation = beginMutation(current);
        if (!draftConversation(mutation, conversationId)) return current;
        mutation.runToConversation[status.identity.runId] = conversationId;
        dispatch = finishRun(
          mutation,
          conversationId,
          status.identity.runId,
          status.state,
          { hydratedIdentity: current.hydratedIdentity, bridgePhase: current.bridgePhase },
          status.message ? boundedMessage(status.message) : undefined
        );
        return { ...mutation };
      });
      runDispatch(dispatch);
    },

    selectConversation(conversationId: string) {
      set((state) => ({
        selectedConversationId: conversationId,
        composerFocusRevision: state.composerFocusRevision + 1,
      }));
    },

    setDraft(conversationId: string, value: string) {
      set((state) => {
        const conversation = state.conversations[conversationId];
        if (!conversation || conversation.draft === value) return state;
        return {
          conversations: {
            ...state.conversations,
            [conversationId]: { ...conversation, draft: value },
          },
        };
      });
    },

    async submitTurn(conversationId: string) {
      if (!canSend(conversationId)) return;
      const conversation = get().conversations[conversationId];
      const message = conversation.draft.trim();
      if (!message) return;

      const busy = conversation.activeRunId !== null || conversation.pendingConsentTurn !== null;
      if (busy) {
        set((state) => {
          const mutation = beginMutation(state);
          const draft = draftConversation(mutation, conversationId)!;
          draft.queuedTurns.push({
            message,
            contextRefs: [],
            queueId: nextLocalId('queue'),
            state: 'queued',
          });
          draft.draft = '';
          return { ...mutation };
        });
        return;
      }

      const runId = secureRandomUUID();
      if (!runId) {
        set((state) => {
          const mutation = beginMutation(state);
          const draft = draftConversation(mutation, conversationId)!;
          appendError(draft, '', NO_SECURE_UUID_ERROR);
          return { ...mutation };
        });
        return;
      }

      const identity: RunIdentity = { ...conversation.identity, runId };
      const turnDraft: TurnDraft = { message, contextRefs: [] };
      set((state) => {
        const mutation = beginMutation(state);
        const draft = draftConversation(mutation, conversationId)!;
        const userEntryId = nextLocalId('user');
        draft.transcript.push({ id: userEntryId, runId, kind: 'user', text: message });
        draft.runs[runId] = {
          identity,
          phase: 'admitting',
          lastSeq: -1,
          request: turnDraft,
          userEntryId,
        };
        draft.activeRunId = runId;
        draft.draft = '';
        mutation.runToConversation[runId] = conversationId;
        return { ...mutation };
      });

      await runTurn(identity, turnDraft, null);
    },

    async allowAndSend(conversationId: string) {
      if (!canSend(conversationId)) return;
      const conversation = get().conversations[conversationId];
      const pending = conversation.pendingConsentTurn;
      if (!pending) return;
      const run = conversation.runs[pending.identity.runId];
      if (!run || isTerminalPhase(run.phase)) return;

      set((state) => {
        const mutation = beginMutation(state);
        const draft = draftConversation(mutation, conversationId)!;
        const current = draft.runs[pending.identity.runId];
        draft.runs[pending.identity.runId] = { ...current, phase: 'admitting' };
        return { ...mutation };
      });

      await runTurn(pending.identity, pending.draft, pending.challenge.id);
    },

    async retryLastFailed(conversationId: string) {
      const conversation = get().conversations[conversationId];
      const failed = conversation?.lastFailedTurn;
      if (!failed) return;
      if (!canSend(conversationId)) return;
      if (conversation.activeRunId !== null || conversation.pendingConsentTurn !== null) return;

      const runId = secureRandomUUID();
      if (!runId) {
        set((state) => {
          const mutation = beginMutation(state);
          const draft = draftConversation(mutation, conversationId)!;
          appendError(draft, '', NO_SECURE_UUID_ERROR);
          return { ...mutation };
        });
        return;
      }

      const identity: RunIdentity = { ...conversation.identity, runId };
      set((state) => {
        const mutation = beginMutation(state);
        const draft = draftConversation(mutation, conversationId)!;
        const index = draft.transcript.findIndex((entry) => entry.id === failed.userEntryId);
        if (index >= 0) draft.transcript[index] = { ...draft.transcript[index], runId };
        draft.runs[runId] = {
          identity,
          phase: 'admitting',
          lastSeq: -1,
          request: failed.draft,
          userEntryId: failed.userEntryId,
        };
        draft.activeRunId = runId;
        draft.lastFailedTurn = null;
        mutation.runToConversation[runId] = conversationId;
        return { ...mutation };
      });

      await runTurn(identity, failed.draft, null);
    },

    updateQueuedTurn(conversationId: string, queueId: string, message: string) {
      set((state) => {
        const conversation = state.conversations[conversationId];
        if (!conversation) return state;
        const queuedTurns = conversation.queuedTurns.map((turn) =>
          turn.queueId === queueId ? { ...turn, message } : turn
        );
        return {
          conversations: {
            ...state.conversations,
            [conversationId]: { ...conversation, queuedTurns },
          },
        };
      });
    },

    removeQueuedTurn(conversationId: string, queueId: string) {
      set((state) => {
        const conversation = state.conversations[conversationId];
        if (!conversation) return state;
        return {
          conversations: {
            ...state.conversations,
            [conversationId]: {
              ...conversation,
              queuedTurns: conversation.queuedTurns.filter((turn) => turn.queueId !== queueId),
            },
          },
        };
      });
    },

    async cancelRun(runId: string) {
      const state = get();
      const conversationId = state.runToConversation[runId];
      if (!conversationId) return;
      const run = state.conversations[conversationId]?.runs[runId];
      if (!run || isTerminalPhase(run.phase) || run.phase === 'canceling') return;
      const previousPhase = run.phase;

      set((current) => {
        const mutation = beginMutation(current);
        const draft = draftConversation(mutation, conversationId)!;
        draft.runs[runId] = { ...draft.runs[runId], phase: 'canceling' };
        markActive(mutation, conversationId);
        return { ...mutation };
      });

      try {
        // The run's own identity, never the current workspace's: a background
        // run from a retired epoch is cancelable only by its exact identity.
        await CancelGolemRun(toCancelRequest(run.identity));
      } catch (err) {
        set((current) => {
          const mutation = beginMutation(current);
          const draft = draftConversation(mutation, conversationId);
          if (!draft) return current;
          const latest = draft.runs[runId];
          if (!latest || latest.phase !== 'canceling') return current;
          draft.runs[runId] = { ...latest, phase: previousPhase };
          appendError(draft, runId, boundedMessage(err));
          markFailure(mutation, conversationId);
          return { ...mutation };
        });
      }
    },
  };
});

/** Test-only reset of both the store and its process-lifetime counters. */
export function __resetGolemStore(): void {
  hydratedEpochFloor = 0;
  localIdSeq = 0;
  useGolemStore.setState(initialState(), false);
}
