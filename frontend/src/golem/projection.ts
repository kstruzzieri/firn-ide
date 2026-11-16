import type { GolemStoreState, ProviderDestination, RunPhase } from '../types/golem';
import type { GolemView, ProjectedConversation, ProjectedRun } from '../types/golemWindow';

/**
 * The presentation projection main publishes to the satellite (#271 spec §5.2).
 *
 * Every field is enumerated rather than spread: a spread of `ConversationView`
 * would ship the transcript's `raw` provider events and each run's owner-only
 * submitted `request` across a window boundary. Adding a field to
 * `ConversationView` must therefore be a deliberate decision to project it, not
 * an accident of structure. (Composer text is not among the risks any more —
 * it lives in the visible host's `draftStore` (#271 §5.1), so the executing
 * owner has nothing to leak — but the enumeration is what keeps that true for
 * the *next* field somebody adds.)
 *
 * `lastFailedTurn` narrows to a boolean on purpose: the satellite needs to know
 * only whether Retry is available, never the prompt that failed.
 */
/**
 * Exactly the slices the projection reads. Narrower than `GolemStoreState` on
 * purpose: it lets a host memoize on those six subscriptions instead of on a
 * whole-store `getState()` read the dependency checker cannot see through.
 */
export type GolemProjectionSource = Pick<
  GolemStoreState,
  | 'conversations'
  | 'bridgePhase'
  | 'bridgeError'
  | 'hydratedIdentity'
  | 'selectedConversationId'
  | 'composerFocusRevision'
>;

export function buildGolemView(state: GolemProjectionSource): GolemView {
  const conversations: Record<string, ProjectedConversation> = Object.create(null) as Record<
    string,
    ProjectedConversation
  >;
  for (const [id, c] of Object.entries(state.conversations)) {
    conversations[id] = {
      identity: c.identity,
      workspaceLabel: c.workspaceLabel,
      available: c.available,
      needsConsent: c.needsConsent,
      // Copied, not aliased: a projection can be in flight while the store
      // mutates, and a payload must never change under the serializer.
      warnings: [...c.warnings],
      initError: c.initError,
      destination: c.destination,
      activeRunId: c.activeRunId,
      queuedTurns: c.queuedTurns.map((turn) => ({ ...turn, contextRefs: [...turn.contextRefs] })),
      transcript: c.transcript.map((entry) => ({
        id: entry.id,
        runId: entry.runId,
        kind: entry.kind,
        text: entry.text,
        ...(entry.toolCallId === undefined ? {} : { toolCallId: entry.toolCallId }),
        ...(entry.toolName === undefined ? {} : { toolName: entry.toolName }),
        ...(entry.activity === undefined ? {} : { activity: entry.activity }),
      })),
      runs: Object.fromEntries(
        Object.entries(c.runs).map(([runId, run]): [string, ProjectedRun] => [
          runId,
          {
            identity: run.identity,
            phase: run.phase,
            lastSeq: run.lastSeq,
            ...(run.error === undefined ? {} : { error: run.error }),
            ...(run.destination === undefined ? {} : { destination: run.destination }),
          },
        ])
      ),
      pendingConsentTurn:
        c.pendingConsentTurn === null
          ? null
          : {
              identity: c.pendingConsentTurn.identity,
              challenge: c.pendingConsentTurn.challenge,
            },
      lastFailedTurn: c.lastFailedTurn !== null,
    };
  }
  return {
    bridgePhase: state.bridgePhase,
    bridgeError: state.bridgeError,
    hydratedIdentity: state.hydratedIdentity,
    selectedConversationId: state.selectedConversationId,
    composerFocusRevision: state.composerFocusRevision,
    processedThrough: 0, // stamped by the instance's main relay at flush time
    conversations,
  };
}

// ── reading a projection ──────────────────────────────────────────────────────
// Pure derivations over a `GolemView`, shared by the passive `GolemSurface` and
// by whichever chrome hosts it, docked or undocked. They live beside the builder rather
// than in the component so both hosts read a projection the same way, and so a
// component file keeps exporting only components.

const sameDestination = (a: ProviderDestination, b: ProviderDestination): boolean =>
  a.provider === b.provider && a.model === b.model && a.endpoint === b.endpoint;

/**
 * Each finished turn's receipt, "<model> via <provider>", keyed by run ID (#492).
 *
 * A turn gets one when it is the conversation's first finished turn, or when
 * its provider, model or endpoint differs from the previous finished turn's.
 * It names the target the turn was admitted for -- what Firn sent the request
 * to, not proof of the model behind the endpoint -- and never the endpoint
 * itself. Failed and canceled turns, and runs adopted from status with no
 * admission, neither get one nor count as the previous turn.
 *
 * Runs are walked in insertion order, which is dispatch order: a turn's run is
 * created when it is sent, and one conversation runs one turn at a time.
 */
export function turnReceipts(conversation: ProjectedConversation): Map<string, string> {
  const receipts = new Map<string, string>();
  let previous: ProviderDestination | null = null;
  for (const run of Object.values(conversation.runs)) {
    if (run.phase !== 'done' || !run.destination) continue;
    if (!previous || !sameDestination(previous, run.destination)) {
      receipts.set(run.identity.runId, `${run.destination.model} via ${run.destination.provider}`);
    }
    previous = run.destination;
  }
  return receipts;
}

/** Phases shown as live in the focused or background run surfaces. */
export const isLivePhase = (phase: RunPhase): boolean =>
  phase === 'admitting' ||
  phase === 'needs-consent' ||
  phase === 'running' ||
  phase === 'canceling';

/**
 * The host chrome's live status, also carried as sr-only text beside the
 * breathing mark. Keyed by exactly the live phases, so a present label doubles
 * as the "something is happening" flag — the transcript's live rail node reads
 * it rather than testing `isLivePhase` a second time.
 */
export const STATUS_LABEL: Partial<Record<RunPhase, string>> = {
  admitting: 'RUNNING',
  running: 'RUNNING',
  canceling: 'CANCELING',
  'needs-consent': 'APPROVAL',
};

/**
 * Shown whenever a failure carries no usable message of its own.
 *
 * It lives in this module rather than in `types/golem` because both the store
 * and the surface need it, and only this module is reachable from the
 * satellite: `types/golem` pulls in the generated Wails bindings for its
 * request constructors, so importing one string from there would drag the
 * whole backend surface into the undocked window. `types/golem` re-exports it,
 * and this module's own imports from there are type-only, so the two
 * directions never meet at runtime.
 */
export const GOLEM_UNAVAILABLE = 'Golem is unavailable.';

export const workspaceName = (conversation: ProjectedConversation): string =>
  conversation.workspaceLabel || 'Workspace';

/** The conversation a projection has focused, or null when it has none. */
export const selectedConversation = (view: GolemView): ProjectedConversation | null =>
  view.selectedConversationId ? (view.conversations[view.selectedConversationId] ?? null) : null;

/** The run occupying a conversation's active slot, or null. */
export const activeRunOf = (conversation: ProjectedConversation | null): ProjectedRun | null =>
  conversation?.activeRunId != null ? (conversation.runs[conversation.activeRunId] ?? null) : null;

/**
 * Whether a projected conversation is still bound to the identity the backend
 * most recently hydrated. An unbound conversation cannot accept a turn, and its
 * identity is the only thing the backend would reject it by.
 */
export const isBound = (view: GolemView, conversation: ProjectedConversation): boolean => {
  const current = view.hydratedIdentity;
  return (
    current !== null &&
    current.repoEpoch === conversation.identity.repoEpoch &&
    current.workspaceId === conversation.identity.workspaceId &&
    current.conversationId === conversation.identity.conversationId
  );
};
