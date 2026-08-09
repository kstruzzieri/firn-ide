import { memo, useEffect, useMemo, useRef, type KeyboardEvent } from 'react';
import { useGolemStore } from '../../stores/golemStore';
import { GOLEM_UNAVAILABLE } from '../../types/golem';
import type { ConversationView, RunPhase, RunView, TranscriptEntry } from '../../types/golem';
import styles from './GolemPanel.module.css';

/**
 * The Golem conversation view (#226 Task B8).
 *
 * Deliberately one file. The composer, transcript, consent shelf, queue, and
 * background strip are five views of one conversation record, and splitting
 * them would mean five components all reaching into the same store slice.
 *
 * Nothing here holds state at all: the panel unmounts whenever the right panel
 * collapses or switches to Runs, so the draft, the queue, the pending consent
 * turn, and the composer focus signal all live in `golemStore`. Even the live
 * region is derived, not accumulated.
 */

const NO_WORKSPACE = 'Open a workspace to chat with Golem.';
const BINDING = 'Connecting to Golem…';
const STALE = 'This workspace is no longer open.';
const UNAVAILABLE = 'Golem is unavailable in this workspace.';
const CONSENT_REQUIRED = 'This workspace asks for approval before sending anything to a provider.';

/** Phases shown as live in the focused or background run surfaces. */
const isLivePhase = (phase: RunPhase): boolean =>
  phase === 'admitting' ||
  phase === 'needs-consent' ||
  phase === 'running' ||
  phase === 'canceling';

/** The backend has accepted these phases, so a cancellation can name a run it owns. */
const isCancelablePhase = (phase: RunPhase): boolean =>
  phase === 'needs-consent' || phase === 'running';

/**
 * The header status chip (the mockups' `.chip.run`).
 *
 * Keyed by exactly the live phases, so a present label is also the panel's
 * "something is happening" flag — the transcript's live rail node reads it
 * rather than testing `isLivePhase` a second time.
 */
const STATUS_LABEL: Partial<Record<RunPhase, string>> = {
  admitting: 'RUNNING',
  running: 'RUNNING',
  canceling: 'CANCELING',
  'needs-consent': 'APPROVAL',
};

const workspaceName = (conversation: ConversationView): string =>
  conversation.workspaceLabel || 'Workspace';

/** The assistant text a finished run produced, for the live region. */
function completedReply(conversation: ConversationView, runId: string): string {
  for (let index = conversation.transcript.length - 1; index >= 0; index -= 1) {
    const entry = conversation.transcript[index];
    if (entry.kind === 'assistant' && entry.runId === runId && entry.text.trim() !== '') {
      return entry.text;
    }
  }
  return '';
}

/** What the latest terminal run has to say, or '' while none has finished. */
function phaseAnnouncement(conversation: ConversationView, latest: RunView | null): string {
  if (!latest) return '';
  if (latest.phase === 'canceled') return 'Golem run canceled.';
  if (latest.phase === 'failed') return `Golem run failed. ${latest.error ?? ''}`.trim();
  return completedReply(conversation, latest.identity.runId) || 'Golem finished its reply.';
}

/**
 * One transcript row.
 *
 * A component, not a file split: the transcript is the only genuinely O(n)
 * render here, and every entry but the streaming last one keeps its reference
 * across a delta, so memoising the row is what stops a token stream from
 * rebuilding the whole conversation each frame.
 */
const TranscriptRow = memo(function TranscriptRow({ entry }: { entry: TranscriptEntry }) {
  return (
    // The row spans the column so its timeline node always lands on the rail;
    // the bubble inside is what shifts right for a prompt or shrinks to a chip
    // for a tool call.
    <div className={`${styles.entry} ${styles[entry.kind]}`}>
      <div className={styles.bubble}>
        {entry.kind === 'tool' && (
          <>
            {/* Two-tone like the mockups' `.k`: purple verb, neutral detail,
                separated by the chip's own gap rather than a middot. */}
            <span className={styles.toolName}>{entry.toolName || 'tool'}</span>
            {entry.activity && <span className={styles.toolActivity}>{entry.activity}</span>}
          </>
        )}
        {/* Rendered as text, never as markup: provider output is untrusted. */}
        <span className={styles.entryText}>{entry.text}</span>
      </div>
    </div>
  );
});

/** Slack, in px, for treating a scroll position as "at the newest row". */
const PIN_SLACK = 4;

export function GolemPanel() {
  const conversations = useGolemStore((state) => state.conversations);
  const selectedConversationId = useGolemStore((state) => state.selectedConversationId);
  const hydratedIdentity = useGolemStore((state) => state.hydratedIdentity);
  const bridgePhase = useGolemStore((state) => state.bridgePhase);
  const bridgeError = useGolemStore((state) => state.bridgeError);
  const composerFocusRevision = useGolemStore((state) => state.composerFocusRevision);

  const composerRef = useRef<HTMLTextAreaElement>(null);
  const transcriptRef = useRef<HTMLDivElement>(null);
  // Follow the stream only while the user is already at the newest row, the
  // same rule the run output follows: scrolling back through a conversation
  // must not be yanked away by the next delta.
  const pinnedRef = useRef(true);

  const conversation = selectedConversationId
    ? (conversations[selectedConversationId] ?? null)
    : null;
  const conversationId = conversation?.identity.conversationId ?? null;

  const notice = useMemo(() => {
    if (bridgePhase === 'binding') return BINDING;
    if (bridgePhase === 'error') return bridgeError ?? GOLEM_UNAVAILABLE;
    if (!conversation) return NO_WORKSPACE;
    // A conversation the backend is no longer bound to cannot accept a turn,
    // and its identity is the only thing the backend would reject it by.
    const current = hydratedIdentity;
    const bound =
      current !== null &&
      current.repoEpoch === conversation.identity.repoEpoch &&
      current.workspaceId === conversation.identity.workspaceId &&
      current.conversationId === conversation.identity.conversationId;
    if (!bound) return STALE;
    if (!conversation.available) return conversation.initError ?? UNAVAILABLE;
    return null;
  }, [bridgePhase, bridgeError, conversation, hydratedIdentity]);

  // Everything the backend flagged, shown in the panel rather than as a toast
  // that scrolls away before the user reads it.
  const inlineWarnings = useMemo(() => {
    if (!conversation) return [] as string[];
    const rows = [...conversation.warnings];
    if (conversation.initError && conversation.initError !== notice) {
      rows.push(conversation.initError);
    }
    if (conversation.needsConsent && !conversation.pendingConsentTurn) rows.push(CONSENT_REQUIRED);
    return rows;
  }, [conversation, notice]);

  const backgroundRuns = useMemo(() => {
    const rows: { run: RunView; label: string }[] = [];
    for (const [id, view] of Object.entries(conversations)) {
      if (id === selectedConversationId) continue;
      for (const run of Object.values(view.runs)) {
        if (isLivePhase(run.phase)) rows.push({ run, label: workspaceName(view) });
      }
    }
    return rows;
  }, [conversations, selectedConversationId]);

  const conversationList = Object.entries(conversations);

  const activeRun =
    conversation?.activeRunId != null
      ? (conversation.runs[conversation.activeRunId] ?? null)
      : null;
  const pending = conversation?.pendingConsentTurn ?? null;
  const draft = conversation?.draft ?? '';
  const destination = conversation?.destination ?? null;
  const canSend = notice === null && conversationId !== null && draft.trim() !== '';
  const statusLabel = activeRun ? STATUS_LABEL[activeRun.phase] : undefined;

  /**
   * The single polite announcement, derived rather than accumulated.
   *
   * A live region announces when its content changes, so "announce once" is
   * exactly "compute a value that only changes on the events worth hearing".
   * Deltas move the transcript but not a run's phase and not the pending
   * challenge, so a token stream leaves this string untouched and silent.
   */
  const announcement = useMemo(() => {
    if (!conversation) return '';
    const challenge = conversation.pendingConsentTurn?.challenge;
    if (challenge) {
      return `Golem needs your approval to send this message to ${challenge.destination.provider}.`;
    }
    let latest: RunView | null = null;
    for (const run of Object.values(conversation.runs)) {
      if (run.phase === 'done' || run.phase === 'failed' || run.phase === 'canceled') latest = run;
    }
    // An error can arrive without moving any phase — a refused cancel restores
    // the run's previous phase and only appends a row — so the newest error row
    // is part of the derived string, not just the phases. Deltas never append
    // one, so a stream still leaves this silent.
    let lastError = '';
    for (const entry of conversation.transcript) {
      if (entry.kind === 'error') lastError = entry.text;
    }
    const phase = phaseAnnouncement(conversation, latest);
    // A terminal that already speaks that text does not say it twice.
    if (lastError && !phase.includes(lastError)) return `${phase} Golem error. ${lastError}`.trim();
    return phase;
  }, [conversation]);

  // Deliberately every mount, not only a changed revision: the panel unmounts
  // whenever the right panel collapses or shows Runs, so this effect is the
  // whole of the ⌘⇧I focus path. The cost is that clicking the Golem tab also
  // moves focus out of the tablist, because `setPanelMode` is the one signal
  // both paths raise; the shortcut is the one that has to keep working.
  useEffect(() => {
    composerRef.current?.focus();
  }, [composerFocusRevision]);

  const transcript = conversation?.transcript;
  useEffect(() => {
    const element = transcriptRef.current;
    if (element && pinnedRef.current) element.scrollTop = element.scrollHeight;
  }, [transcript]);

  const send = () => {
    // Only the identity guard: every other blocked state — no workspace, a
    // binding in flight, a stale identity, an unavailable backend, a blank
    // draft — is already refused by `golemStore.submitTurn`.
    if (conversationId === null) return;
    void useGolemStore.getState().submitTurn(conversationId);
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey) return;
    // An Enter that commits an IME composition belongs to the composition, not
    // to the conversation.
    if (event.nativeEvent.isComposing) return;
    event.preventDefault();
    send();
  };

  return (
    // data-accent pins the whole panel to the glacier accent the way
    // Terminal.tsx does, so Send, focus rings, and the Golem chrome share one
    // accent regardless of the workspace.
    <div className={styles.panel} data-accent="project">
      <header className={styles.header}>
        {/* Two deliberate rows at dock width (layout.html option A shows a
            collapsed header): identity + live status, then the destination. */}
        <div className={styles.identityRow}>
          <span className={styles.wordmark}>
            <span aria-hidden="true">◆</span> GOLEM
          </span>
          {statusLabel && (
            <span className={styles.statusChip} data-status={statusLabel}>
              <span className={styles.statusDot} aria-hidden="true" />
              {statusLabel}
            </span>
          )}
        </div>
        <div className={styles.identityRow}>
          <span className={styles.workspace}>
            {conversation ? workspaceName(conversation) : 'No workspace'}
          </span>
          {destination && (
            <span className={styles.badge} data-classification={destination.classification}>
              {destination.classification === 'local' ? 'Local' : 'Remote'}
            </span>
          )}
          {destination && (
            <span className={styles.modelChip}>
              <span className={styles.provider}>{destination.provider}</span>
              <span aria-hidden="true">·</span>
              <span className={styles.model}>{destination.model}</span>
            </span>
          )}
        </div>
        {/* The mockup header drops the endpoint; it stays because it is the only
            place the exact machine a prompt would reach is spelled out. */}
        <div className={styles.metaRow}>
          {destination && <span className={styles.endpoint}>{destination.endpoint}</span>}
          <span>Context: prompt only</span>
        </div>
      </header>

      {/* A switcher for one conversation is just a label repeated. */}
      {conversationList.length > 1 && (
        <div className={styles.conversations} role="group" aria-label="Golem conversations">
          {conversationList.map(([id, view]) => (
            <button
              key={id}
              type="button"
              className={styles.conversationButton}
              aria-pressed={id === selectedConversationId}
              onClick={() => useGolemStore.getState().selectConversation(id)}
            >
              {workspaceName(view)}
            </button>
          ))}
        </div>
      )}

      {notice && <p className={styles.notice}>{notice}</p>}
      {/* Provider-supplied strings: two identical warnings are still two rows. */}
      {inlineWarnings.map((warning, index) => (
        <p key={`${index}-${warning}`} className={styles.warning}>
          {warning}
        </p>
      ))}

      {/* Focusable because it scrolls: WKWebView gives a bare scroll container
          no keyboard access of its own. `region`, not `log`: the implicit
          aria-live of a log would fight the one deliberate live region. */}
      <div
        ref={transcriptRef}
        className={styles.transcript}
        // Lights the newest timeline node while a run is live. An attribute
        // rather than a class on the row: the rail has to stay pure CSS so a
        // token delta still re-renders one memoized row and nothing else.
        data-live={statusLabel ? 'true' : undefined}
        tabIndex={0}
        role="region"
        aria-label="Golem transcript"
        onScroll={(event) => {
          const element = event.currentTarget;
          pinnedRef.current =
            element.scrollHeight - element.scrollTop - element.clientHeight <= PIN_SLACK;
        }}
      >
        {transcript?.map((entry) => (
          <TranscriptRow key={entry.id} entry={entry} />
        ))}
      </div>

      {backgroundRuns.length > 0 && (
        <div className={styles.background}>
          {backgroundRuns.map(({ run, label }) => (
            <div key={run.identity.runId} className={styles.backgroundRow}>
              <button
                type="button"
                className={styles.backgroundLabel}
                // The phase is in the name because this strip is the only
                // surface that reports a background run's phase at all.
                aria-label={`Show the Golem run in ${label}: ${run.phase}`}
                // That run's own conversation, never the focused one: a
                // background run may belong to a workspace the IDE is not on.
                onClick={() =>
                  useGolemStore.getState().selectConversation(run.identity.conversationId)
                }
              >
                {label} · {run.phase}
              </button>
              {isCancelablePhase(run.phase) && (
                <button
                  type="button"
                  className={styles.secondaryButton}
                  aria-label={`Cancel the Golem run in ${label}`}
                  onClick={() => void useGolemStore.getState().cancelRun(run.identity.runId)}
                >
                  Cancel
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {pending && (
        <div className={styles.consent} role="group" aria-label="Approval required">
          <p className={styles.consentCopy}>
            Golem needs your approval before this message leaves the machine.
          </p>
          <dl className={styles.destinationList}>
            <div className={styles.destinationPair}>
              <dt>Provider</dt>
              <dd>{pending.challenge.destination.provider}</dd>
            </div>
            <div className={styles.destinationPair}>
              <dt>Model</dt>
              <dd>{pending.challenge.destination.model}</dd>
            </div>
            <div className={styles.destinationPair}>
              <dt>Endpoint</dt>
              <dd>{pending.challenge.destination.endpoint}</dd>
            </div>
          </dl>
          <div className={styles.consentActions}>
            <button
              type="button"
              className={styles.primaryButton}
              disabled={conversation?.runs[pending.identity.runId]?.phase !== 'needs-consent'}
              onClick={() => {
                if (conversationId) void useGolemStore.getState().allowAndSend(conversationId);
              }}
            >
              Allow &amp; send
            </button>
            <button
              type="button"
              className={styles.secondaryButton}
              disabled={conversation?.runs[pending.identity.runId]?.phase !== 'needs-consent'}
              onClick={() => void useGolemStore.getState().cancelRun(pending.identity.runId)}
            >
              Not now
            </button>
          </div>
        </div>
      )}

      {/* Numbered: n queued turns are otherwise n identically named controls. */}
      {conversation?.queuedTurns.map((turn, index) => (
        <div key={turn.queueId} className={styles.queued}>
          <input
            className={styles.queuedInput}
            aria-label={`Queued message ${index + 1}`}
            value={turn.message}
            onChange={(event) => {
              if (conversationId) {
                useGolemStore
                  .getState()
                  .updateQueuedTurn(conversationId, turn.queueId, event.target.value);
              }
            }}
          />
          {turn.state === 'reopen-required' && (
            <span className={styles.queuedState}>Waiting for the workspace</span>
          )}
          <button
            type="button"
            className={styles.secondaryButton}
            aria-label={`Remove queued message ${index + 1}`}
            onClick={() => {
              if (conversationId) {
                useGolemStore.getState().removeQueuedTurn(conversationId, turn.queueId);
              }
            }}
          >
            Remove
          </button>
        </div>
      ))}

      <div className={styles.composerRow}>
        <textarea
          ref={composerRef}
          className={styles.composer}
          aria-label="Message Golem"
          placeholder="Ask Golem…"
          rows={3}
          value={draft}
          disabled={conversationId === null}
          onChange={(event) => {
            if (conversationId) {
              useGolemStore.getState().setDraft(conversationId, event.target.value);
            }
          }}
          onKeyDown={handleComposerKeyDown}
        />
        <div className={styles.composerActions}>
          <button type="button" className={styles.primaryButton} disabled={!canSend} onClick={send}>
            Send
          </button>
          {activeRun && isCancelablePhase(activeRun.phase) && (
            <button
              type="button"
              className={`${styles.secondaryButton} ${styles.cancelButton}`}
              aria-label="Cancel the current Golem run"
              onClick={() => void useGolemStore.getState().cancelRun(activeRun.identity.runId)}
            >
              Cancel
            </button>
          )}
          {conversation?.lastFailedTurn && (
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={() => {
                if (conversationId) void useGolemStore.getState().retryLastFailed(conversationId);
              }}
            >
              Retry
            </button>
          )}
        </div>
      </div>

      <div className={styles.srOnly} role="status" aria-live="polite">
        {announcement}
      </div>
    </div>
  );
}
