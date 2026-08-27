/**
 * Golem configuration workspace — the app-global `tab-golem-config` surface
 * (#263 Slice B, spec §3.1/§4).
 *
 * This component owns the whole write flow: the draft, the key vault, the two
 * bootstrap sources, the Apply/Confirm/Cancel calls, and every §4.6/§4.6a
 * transition they can land in. Two rules shape all of it:
 *
 * - The draft and any pending API-key VALUE live in refs on THIS component,
 *   never in a store and never in anything serializable (§3.2). Crossing the
 *   pane boundary for tab close and app quit therefore ships FUNCTIONS through
 *   `configCloseGuard`, not data.
 * - `settleDraft` is the single place a draft settles and the single place key
 *   refs are cleared (§5.6). Every outcome below — result, expiry, cancel,
 *   discard, teardown, transport rejection — reaches it through `settle`, so
 *   "were the values dropped?" has exactly one answer per outcome.
 *
 * There is one instance per app, so nothing here is workspace-scoped: Firn's
 * settings calls read one process-wide snapshot.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ApplyGolemSettings,
  CancelGolemSettingsApply,
  ConfirmGolemSettingsApply,
  CreateGolemSettings,
  LoadGolemProfile,
  ReloadGolemSettings,
} from '../../../wailsjs/go/main/App';
import type { ai } from '../../../wailsjs/go/models';
import {
  boundedGolemMessage,
  parseSettingsReloadResult,
  type ProviderProjection,
  type SettingsDiagnostic,
  type SettingsProjection,
} from '../../types/golem';
import {
  KeyVault,
  buildApplyRequest,
  changeStableID,
  cleanDraft,
  draftChangeCount,
  isDraftDirty,
  meetsUseCaseFloor,
  parseCancelSettingsApplyResult,
  parseGolemProfileLoadResult,
  parseSettingsApplyResult,
  projectDraft,
  recordApplyProvenance,
  replaceSource,
  retainsKeys,
  setTargetRevision,
  settleDraft,
  stageChange,
  unstageChange,
  type ApplyChallenge,
  type ApplyConflictKind,
  type ApplyMode,
  type Change,
  type ChangeDropSet,
  type DraftEvent,
  type ProfileDraftProjection,
  type SettingsApplyRequest,
  type SettingsApplyResult,
} from '../../types/golemConfig';
import { formatProfileDiagnostic, formatSettingsDiagnostic } from '../../utils/settingsDiagnostics';
import { ApplyBar, type EditorFocusRequest } from './ApplyBar';
import { registerConfigCloseHandler, type ConfigCloseIntent } from './configCloseGuard';
import styles from './GolemConfig.module.css';
import { ProvidersCard } from './ProvidersCard';
import { RoutingCard, routingOwnsDiagnostic } from './RoutingCard';
import { StatusText, type StatusTone } from './StatusText';

const STATE_LABEL: Record<SettingsProjection['state'], string> = {
  ready: 'Ready',
  limited: 'Limited',
  invalid: 'Invalid',
  missing: 'Missing',
};

const STATE_TONE: Record<SettingsProjection['state'], StatusTone> = {
  ready: 'ok',
  limited: 'warn',
  invalid: 'bad',
  missing: 'dim',
};

const ORIGIN_LABEL: Record<SettingsProjection['sourceOrigin'], string> = {
  none: 'No configuration found',
  env: 'Environment override',
  working_directory: 'Working directory models.json',
  user_config: 'User configuration directory',
  legacy: 'Legacy configuration directory',
};

/**
 * Why editing is off (spec §4.6). `limited` covers both write-blocked reasons —
 * a read-only document and an unsafe mutation identity — because the backend
 * collapses `readOnly || !editable` onto that state and emits the naming
 * diagnostic beside it. `missing` is not a block: it is the bootstrap path.
 */
const EDITING_UNAVAILABLE: Partial<Record<SettingsProjection['state'], string>> = {
  limited:
    'Editing is unavailable while this configuration is Limited. The notices below name the reason; repair it in the file, then Refresh.',
  invalid:
    'Editing is unavailable: this configuration could not be loaded, so there is nothing safe to change. Repair it in the file, then Refresh.',
};

/** The CAS token is 64 hex characters; the head identifies a revision at a
 * glance and the full value stays available on hover. */
const REVISION_HEAD = 12;

/** Slice B invokes the profile loader for this one fixed bootstrap CTA (§5.3). */
const CURATED_PROFILE = 'curated/local';

/** The one copy vocabulary, shared with the diagnostics the backend returns. */
const copy = (code: Parameters<typeof formatSettingsDiagnostic>[0]): string =>
  formatSettingsDiagnostic(code, '', '').text;

const APPLIED = 'Configuration applied.';
const APPLIED_UNCERTAIN =
  'Configuration applied. Golem could not confirm the write reached disk; check it after a restart.';
/** §5.6: shown before the base copy for `consentOutcome: 'recorded'`. */
const CONSENT_RECORDED = 'Destination approval saved; configuration not applied.';
const CONSENT_UNCERTAIN = copy('consent_store_failed');
const CHALLENGE_EXPIRED =
  'The approval request expired. Nothing was written. Re-enter any API key and apply again.';
const CHALLENGE_CANCELLED =
  'The approval request was cancelled. Nothing was written. Re-enter any API key and apply again.';
const CANCEL_FAILED =
  'The approval request could not be cancelled. Try again before closing this tab.';
const BUSY_NOTICE =
  'Golem is busy — a run or pending consent prompt owns the idle barrier. Nothing was written; retry when idle.';
const LIMITED_NOTICE = 'This configuration cannot be written. Nothing was applied.';
/** §5.2 fixed copy for the outcome-unknown recovery state. */
const OUTCOME_UNKNOWN = 'The Apply result is unknown. Refresh before making more changes.';
const BUILD_REFUSED = `${copy('invalid_argument')} Review the changes waiting for Apply, then try again.`;

const UNSTAGED_GATE =
  'Apply is unavailable while an editor has unstaged changes. Stage or cancel them first.';
const REVIEW_GATE =
  'Apply is unavailable until every change marked Needs review is re-staged or discarded.';
const EMPTY_GATE = 'Stage at least one change — a new source on its own is not a write.';
const BOOTSTRAP_GATE =
  'A blank configuration needs one provider and an agent route that meets chat, stream, and tool_call.';

const DISCARD_BODY =
  'The staged changes and any API key you entered are dropped. Nothing has been written, and the file on disk does not change.';
const DISCARD_BODY_CHALLENGED = `${DISCARD_BODY} The pending destination approval is cancelled first.`;

type Phase =
  | { kind: 'loading' }
  | { kind: 'ready'; projection: SettingsProjection; busyNotice: boolean }
  | { kind: 'error'; message: string };

/**
 * Everything the cards render. The active projection satisfies it, and so does
 * a profile preview or the blank builder — which is exactly the point: a draft
 * layered on a replacement source paints THAT document, not the applied one
 * underneath it (§3.3).
 */
type Body = Pick<
  SettingsProjection,
  'state' | 'readOnly' | 'editable' | 'routes' | 'models' | 'providers' | 'diagnostics'
>;

/** A blank source is frontend builder state: no document exists yet (§3.3). */
const BLANK_PREVIEW: ProfileDraftProjection = {
  state: 'ready',
  readOnly: false,
  editable: true,
  routes: [],
  models: [],
  providers: [],
  diagnostics: [],
};

/** What the last write left behind. Exactly one shape, cleared as one value. */
interface WriteOutcome {
  challenge: ApplyChallenge | null;
  drops: ChangeDropSet[] | null;
  conflict: ApplyConflictKind | null;
  /** A busy result: the same request stays retryable. */
  busy: boolean;
  /** Outcome-unknown recovery: every write is disabled (§4.6a). */
  unknown: boolean;
  notice: string;
  diagnostics: SettingsDiagnostic[];
}

const NO_OUTCOME: WriteOutcome = {
  challenge: null,
  drops: null,
  conflict: null,
  busy: false,
  unknown: false,
  notice: '',
  diagnostics: [],
};

interface Prompt {
  title: string;
  body: string;
  confirmLabel: string;
}

/**
 * §5.2: a blank Apply stays disabled until one provider plus a floor-valid
 * agent route can form a complete `BootstrapSpec`. The frontend checks it so
 * the refusal lands on the control rather than as an opaque diagnostics result;
 * the backend checks it again before `NewDocument`.
 */
function bootstrapComplete(changes: readonly Change[]): boolean {
  if (!changes.some((change) => change.kind === 'provider-add')) return false;
  const agent = changes.find((change) => change.kind === 'route' && change.useCase === 'agent');
  return agent?.kind === 'route' && meetsUseCaseFloor('agent', agent.exposedCaps);
}

/** §5.6: `recorded` and `uncertain` both prepend their own sentence. */
const consentCopy = (outcome: 'unchanged' | 'recorded' | 'uncertain'): string =>
  outcome === 'recorded' ? CONSENT_RECORDED : outcome === 'uncertain' ? CONSENT_UNCERTAIN : '';

export function GolemConfigWorkspace({ onClose }: { onClose: () => void }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [inFlight, setInFlight] = useState(false);
  const generation = useRef(0);
  const headingRef = useRef<HTMLHeadingElement>(null);

  // The draft and the pending key VALUES live here and nowhere else (§3.2):
  // the values in a plain ref, reachable only through the KeyVault facade, so
  // they never enter React state, a store, or anything serializable.
  const keyRefs = useRef(new Map<string, string>());
  const vault = useMemo(() => new KeyVault(keyRefs.current), []);
  const [draft, setDraft] = useState(cleanDraft);
  /** Editors holding fields the user has not staged (§4.2: Apply is blocked). */
  const [unstagedEditors, setUnstagedEditors] = useState<ReadonlySet<string>>(new Set());
  /** Bumped by every draft reset, to remount the cards and their editors. */
  const [draftEpoch, setDraftEpoch] = useState(0);
  /** The profile preview or blank builder a replacement source paints (§3.3). */
  const [preview, setPreview] = useState<ProfileDraftProjection | null>(null);
  const [sourceError, setSourceError] = useState('');
  const [sourceOpen, setSourceOpen] = useState(false);
  const [outcome, setOutcome] = useState<WriteOutcome>(NO_OUTCOME);
  /** True while an Apply/Confirm/Cancel owns the surface (§3.3). */
  const [sending, setSending] = useState(false);
  const [prompt, setPrompt] = useState<Prompt | null>(null);
  const [focusRequest, setFocusRequest] = useState<EditorFocusRequest | null>(null);

  /** The exact request Confirm and Retry resend: Call 1 retained none of it. */
  const pendingRequestRef = useRef<SettingsApplyRequest | null>(null);
  /** The settings RPC an app-close handshake must wait out (§4.6a). */
  const writeRef = useRef<Promise<void>>(Promise.resolve());
  const answerRef = useRef<((ok: boolean) => void) | null>(null);

  const load = useCallback(async (explicit: boolean): Promise<boolean> => {
    const gen = ++generation.current;
    setInFlight(true);
    try {
      const result = parseSettingsReloadResult(await ReloadGolemSettings());
      if (gen !== generation.current) return false; // superseded or unmounted
      setPhase({
        kind: 'ready',
        projection: result.projection,
        // A busy reload on open silently shows the effective snapshot; only the
        // explicit Refresh action surfaces the notice.
        busyNotice: explicit && result.busy,
      });
      // The draft targets whichever revision the document is on now — including
      // after a conflict, where adopting it is the whole point of the reload.
      setDraft((current) => setTargetRevision(current, result.projection.revision));
      return !result.busy;
    } catch (err) {
      if (gen !== generation.current) return false;
      setPhase({ kind: 'error', message: boundedGolemMessage(err) });
      return false;
    } finally {
      if (gen === generation.current) setInFlight(false);
    }
  }, []);

  useEffect(() => {
    void load(false);
    return () => {
      generation.current += 1; // invalidate any pending response on unmount
    };
  }, [load]);

  // The tab mounts when it is opened and focused, so this lands the caret on the
  // surface the user just asked for rather than leaving it on the palette.
  useEffect(() => {
    headingRef.current?.focus();
  }, []);

  // Teardown is terminal for keys (§3.2). It goes through the same reducer
  // table as every other outcome, so "were the values dropped?" has one answer.
  const draftRef = useRef(draft);
  draftRef.current = draft;
  useEffect(
    () => () => {
      settleDraft(draftRef.current, { kind: 'teardown' }, vault);
    },
    [vault]
  );

  // -------------------------------------------------------------------------
  // The one settle path
  // -------------------------------------------------------------------------

  /**
   * Records provenance, settles the draft, and replaces the visible outcome.
   * The three nonterminal results keep their key refs and their pending
   * request; every other event drops both and remounts the editors, because a
   * reset draft must not leave an editor holding fields staged against it.
   */
  const settle = (event: DraftEvent, next: Partial<WriteOutcome> = {}): void => {
    recordApplyProvenance(draftRef.current.source, event);
    setDraft((current) => settleDraft(current, event, vault));
    if (!retainsKeys(event)) {
      pendingRequestRef.current = null;
      setDraftEpoch((current) => current + 1);
      setSourceOpen(false);
    }
    setOutcome({ ...NO_OUTCOME, ...next });
  };
  const settleRef = useRef(settle);
  settleRef.current = settle;

  const outcomeRef = useRef(outcome);
  outcomeRef.current = outcome;

  // The consent challenge outlives nothing: its own expiry is a terminal event.
  useEffect(() => {
    const challenge = outcome.challenge;
    if (challenge === null) return;
    const expire = () => settleRef.current({ kind: 'expired' }, { notice: CHALLENGE_EXPIRED });
    const delay = challenge.expiresAt - Date.now();
    if (delay <= 0) {
      expire();
      return;
    }
    const timer = setTimeout(expire, delay);
    return () => clearTimeout(timer);
  }, [outcome.challenge]);

  // -------------------------------------------------------------------------
  // Editors
  // -------------------------------------------------------------------------

  const stage = useCallback(
    (changes: Change[], drop: string[]) => {
      setDraft((current) => {
        const cleared = drop.reduce((next, id) => unstageChange(next, id, vault), current);
        return changes.reduce((next, change) => stageChange(next, change, vault), cleared);
      });
    },
    [vault]
  );

  const noteUnstaged = useCallback((rowKey: string, unstaged: boolean) => {
    setUnstagedEditors((current) => {
      if (current.has(rowKey) === unstaged) return current; // no render, no churn
      const next = new Set(current);
      if (unstaged) next.add(rowKey);
      else next.delete(rowKey);
      return next;
    });
  }, []);

  // -------------------------------------------------------------------------
  // Destructive transitions (§4.6a)
  // -------------------------------------------------------------------------

  const ask = useCallback(
    (next: Prompt) =>
      new Promise<boolean>((resolve) => {
        answerRef.current?.(false); // a superseded question answers itself
        answerRef.current = resolve;
        setPrompt(next);
      }),
    []
  );

  const answer = useCallback((ok: boolean) => {
    setPrompt(null);
    const resolve = answerRef.current;
    answerRef.current = null;
    resolve?.(ok);
  }, []);

  /** §4.6a: staged changes, an open row with unstaged edits, or a challenge. */
  const unsaved = isDraftDirty(draft) || unstagedEditors.size > 0 || outcome.challenge !== null;
  const unsavedRef = useRef(unsaved);
  unsavedRef.current = unsaved;

  /**
   * A challenge-state transition first calls and awaits the cancel; a
   * cancellation failure keeps the surface open rather than dropping a token
   * the backend still honours (§4.6a).
   */
  const cancelChallenge = async (): Promise<boolean> => {
    const token = outcomeRef.current.challenge?.token;
    if (token === undefined) return true;
    try {
      parseCancelSettingsApplyResult(await CancelGolemSettingsApply(token));
      return true;
    } catch {
      setOutcome((current) => ({ ...current, notice: CANCEL_FAILED }));
      return false;
    }
  };

  /** Confirm, then cancel any challenge. Callers only reach it while dirty. */
  const clearForTransition = async (title: string, confirmLabel: string): Promise<boolean> => {
    const body = outcomeRef.current.challenge === null ? DISCARD_BODY : DISCARD_BODY_CHALLENGED;
    if (!(await ask({ title, body, confirmLabel }))) return false;
    return cancelChallenge();
  };
  const clearForTransitionRef = useRef(clearForTransition);
  clearForTransitionRef.current = clearForTransition;

  // Registered once: the object reads refs, so the panes that can close this
  // surface never hold a stale closure — and never hold draft or key data.
  const closeHandler = useRef({
    hasUnsavedWork: () => unsavedRef.current,
    confirm: async (intent: ConfigCloseIntent): Promise<boolean> => {
      // The backend has torn down nothing yet, so waiting out an in-flight
      // settings RPC is safe and is what §4.6a requires before any decision.
      await writeRef.current.catch(() => undefined);
      if (!unsavedRef.current) return true; // clean: acknowledge, no dialog
      const confirmLabel = intent === 'quit' ? 'Discard & quit' : 'Discard & close';
      const ok = await clearForTransitionRef.current(
        'Discard your staged configuration changes?',
        confirmLabel
      );
      if (!ok) return false;
      settleRef.current({ kind: 'teardown' });
      return true;
    },
  });

  useEffect(() => {
    registerConfigCloseHandler(closeHandler.current);
    return () => registerConfigCloseHandler(null);
  }, []);

  const discard = () => {
    settle({ kind: 'discard' });
    setPreview(null);
    setSourceError('');
  };

  const refresh = async () => {
    if (!unsavedRef.current) {
      await load(true);
      return;
    }
    if (!(await clearForTransition('Discard your staged changes and reload?', 'Discard & reload')))
      return;
    settle({ kind: 'discard' });
    setPreview(null);
    await load(true);
  };

  // -------------------------------------------------------------------------
  // Sources (§4.6 bootstrap, §5.3)
  // -------------------------------------------------------------------------

  const adoptProfile = async (profileId: string, keepDraft: boolean): Promise<void> => {
    setSourceError('');
    try {
      const result = parseGolemProfileLoadResult(await LoadGolemProfile(profileId));
      if (result.status === 'diagnostics') {
        setSourceError(formatProfileDiagnostic(result.diagnostics[0]));
        return;
      }
      const source = {
        kind: 'profile' as const,
        profileId: result.profileId,
        sourceRevision: result.sourceRevision,
      };
      setPreview(result.projection);
      // A conflict reload keeps the draft under review; a fresh choice clears
      // it through the one terminal path (§4.6a).
      setDraft((current) =>
        keepDraft ? { ...current, source } : replaceSource(current, source, vault)
      );
      // Either way the document the editors derive from has just been replaced,
      // so they re-derive: a row reopened against the old preview would read
      // back a stale model as if the user had chosen it.
      setDraftEpoch((current) => current + 1);
      if (!keepDraft) setOutcome(NO_OUTCOME);
    } catch (err) {
      setSourceError(boundedGolemMessage(err));
    }
  };

  const startFromProfile = async () => {
    if (
      unsavedRef.current &&
      !(await clearForTransition(
        'Discard your staged changes and switch source?',
        'Discard & switch'
      ))
    )
      return;
    await adoptProfile(CURATED_PROFILE, false);
  };

  const startBlank = async () => {
    if (
      unsavedRef.current &&
      !(await clearForTransition(
        'Discard your staged changes and switch source?',
        'Discard & switch'
      ))
    )
      return;
    setSourceError('');
    setPreview(BLANK_PREVIEW);
    setDraft((current) => replaceSource(current, { kind: 'blank' }, vault));
    setDraftEpoch((current) => current + 1);
    setOutcome(NO_OUTCOME);
  };

  // -------------------------------------------------------------------------
  // The write itself (§5.2)
  // -------------------------------------------------------------------------

  const projection = phase.kind === 'ready' ? phase.projection : null;
  const body: Body | null = preview ?? projection;
  const mode: ApplyMode = projection?.state === 'missing' ? 'create' : 'apply';

  const projected = useMemo(
    () => projectDraft(body ?? { routes: [], models: [] }, draft),
    [body, draft]
  );

  const receive = (result: SettingsApplyResult): void => {
    switch (result.status) {
      case 'applied':
        settle(
          { kind: 'result', result },
          { notice: result.warning === undefined ? APPLIED : APPLIED_UNCERTAIN }
        );
        setPreview(null);
        setPhase({ kind: 'ready', projection: result.projection, busyNotice: false });
        return;
      case 'consent_required':
        settle({ kind: 'result', result }, { challenge: result.challenge });
        return;
      case 'drop_confirmation_required':
        settle({ kind: 'result', result }, { drops: result.drops });
        return;
      case 'conflict':
        settle(
          { kind: 'result', result },
          { conflict: result.conflict, notice: consentCopy(result.consentOutcome) }
        );
        return;
      case 'diagnostics':
        settle(
          { kind: 'result', result },
          { diagnostics: result.diagnostics, notice: consentCopy(result.consentOutcome) }
        );
        return;
      case 'busy':
        settle({ kind: 'result', result }, { busy: true, notice: BUSY_NOTICE });
        return;
      case 'limited':
        settle(
          { kind: 'result', result },
          { diagnostics: result.diagnostics, notice: LIMITED_NOTICE }
        );
        return;
    }
  };

  /**
   * §5.2: an Apply/Confirm rejection is NOT a retryable domain result — the
   * response may have been lost after the save. A malformed response is the
   * same situation for the same reason: the outcome is unknown either way.
   */
  const send = (call: () => Promise<unknown>, token: string | null): void => {
    setSending(true);
    const run = (async () => {
      try {
        receive(parseSettingsApplyResult(await call()));
      } catch {
        // One best-effort cancel for a known token; failure is ignored locally
        // and the backend record expires normally.
        if (token !== null) void CancelGolemSettingsApply(token).catch(() => undefined);
        // The recovery panel below carries the copy; a second notice saying the
        // same sentence would only make the surface louder, not clearer.
        settleRef.current({ kind: 'rejected' }, { unknown: true });
        setPreview(null);
      } finally {
        setSending(false);
      }
    })();
    writeRef.current = run;
  };

  const dispatchRequest = (request: SettingsApplyRequest): void => {
    const payload = request as unknown as ai.SettingsApplyRequest;
    send(
      () => (mode === 'create' ? CreateGolemSettings(payload) : ApplyGolemSettings(payload)),
      null
    );
  };

  const apply = () => {
    if (body === null) return;
    let request: SettingsApplyRequest;
    try {
      request = buildApplyRequest({ routes: body.routes, models: body.models }, draft, vault, mode);
    } catch {
      // A drafting bug the transport refuses: a local refusal, never a call.
      setOutcome({ ...NO_OUTCOME, notice: BUILD_REFUSED });
      return;
    }
    pendingRequestRef.current = request;
    dispatchRequest(request);
  };

  const confirmDestination = () => {
    const challenge = outcome.challenge;
    const request = pendingRequestRef.current;
    if (challenge === null || request === null) return;
    send(
      () =>
        ConfirmGolemSettingsApply({
          challengeToken: challenge.token,
          request,
        } as unknown as ai.ConfirmSettingsApplyRequest),
      challenge.token
    );
  };

  const retry = () => {
    if (outcome.challenge !== null) {
      confirmDestination();
      return;
    }
    const request = pendingRequestRef.current;
    if (request === null) apply();
    else dispatchRequest(request);
  };

  const cancelDestination = async () => {
    setSending(true);
    try {
      if (await cancelChallenge()) settle({ kind: 'cancelled' }, { notice: CHALLENGE_CANCELLED });
    } finally {
      setSending(false);
    }
  };

  /**
   * §5.2: the frontend discloses the dropped fields and re-stages that change
   * with the backend's exact set. The user still presses Apply — nothing is
   * resent on their behalf.
   */
  const restageDrops = () => {
    const sets = outcome.drops ?? [];
    setDraft((current) =>
      sets.reduce((next, set) => {
        const change = next.changes.find((staged) => changeStableID(staged) === set.changeId);
        return change?.kind === 'route'
          ? stageChange(next, { ...change, confirmDrops: set.fields }, vault)
          : next;
      }, current)
    );
    setOutcome(NO_OUTCOME);
  };

  const reviewConflict = async () => {
    const kind = outcome.conflict;
    setOutcome(NO_OUTCOME);
    if (kind === 'profile_source') {
      const source = draftRef.current.source;
      if (source.kind === 'profile') await adoptProfile(source.profileId, true);
      return;
    }
    // A `challenge` conflict has nothing left to reload: the token is spent and
    // the draft is already waiting for review.
    if (kind === 'target') await load(true);
  };

  const discardConflict = async () => {
    discard();
    await load(true);
  };

  const recover = async () => {
    // Busy or another transport failure keeps the recovery state, and the old
    // request is never resent (§5.2).
    if (await load(true)) setOutcome(NO_OUTCOME);
  };

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  const recovery = outcome.unknown;
  const locked = sending || recovery;
  const changeCount = draftChangeCount(draft);
  // Editing needs a document that is both loaded and writable. A profile or
  // blank source supplies its own: the draft is layered on THAT preview.
  const canEdit =
    body !== null && body.state === 'ready' && body.editable && !body.readOnly && !locked;

  // A provider a defined model still references cannot be removed.
  const usedProviders = body?.models.map((entry) => entry.provider) ?? [];
  // A staged provider-add has no strip, but a route must still be able to name
  // it — the blank builder is exactly one provider-add plus one route (§5.2).
  const stagedProviders: ProviderProjection[] = draft.changes
    .filter((change) => change.kind === 'provider-add')
    .map((change) => ({
      name: change.name,
      endpoint: change.endpoint,
      classification: 'unknown',
      apiFormat: change.apiFormat ?? 'openai-compat',
      credentialState: 'none',
    }));
  const routableProviders = [...(body?.providers ?? []), ...stagedProviders];

  // A diagnostic about a provider or a use case that has a row belongs inside
  // that row (§4.3b, §4.3); one naming an entity this projection does not show
  // stays here, where it is still readable. Apply-result diagnostics route by
  // the same (subjectKind, subjectName) tuple as loaded ones.
  const diagnostics = [...(body?.diagnostics ?? []), ...outcome.diagnostics];
  const providerRows = new Set(body?.providers.map((entry) => entry.name) ?? []);
  const ownedByRow = (diagnostic: SettingsDiagnostic): boolean =>
    (diagnostic.subjectKind === 'provider' && providerRows.has(diagnostic.subjectName)) ||
    routingOwnsDiagnostic(body?.routes ?? [], diagnostic);
  const pageDiagnostics = diagnostics.filter((entry) => !ownedByRow(entry));

  const blocked =
    unstagedEditors.size > 0
      ? UNSTAGED_GATE
      : draft.needsReview.length > 0
        ? REVIEW_GATE
        : draft.source.kind === 'blank' && !bootstrapComplete(projected.changes)
          ? BOOTSTRAP_GATE
          : // The transport refuses an empty change set whatever the source is,
            // so a bare source replacement is not yet a write (§5.6).
            projected.changes.length === 0
            ? EMPTY_GATE
            : null;

  return (
    <div className={styles.root}>
      <div className={styles.page}>
        <header className={styles.masthead} data-testid="golem-config-masthead">
          <h2 ref={headingRef} tabIndex={-1} className={styles.title}>
            Golem Configuration
          </h2>
          {projection && (
            <>
              <StatusText tone={STATE_TONE[projection.state]}>
                {STATE_LABEL[projection.state]}
              </StatusText>
              <span className={styles.source}>{ORIGIN_LABEL[projection.sourceOrigin]}</span>
              {projection.revision !== undefined && (
                <span className={styles.revision} title={projection.revision}>
                  rev {projection.revision.slice(0, REVISION_HEAD)}
                </span>
              )}
            </>
          )}
          <span className={styles.grow} />
          {/* §4.1: profile management is absent, not disabled, in Slice B. The
              fixed bootstrap CTAs are the sole exception (§4.6). */}
          {projection?.state === 'missing' && !recovery && (
            <>
              <button
                type="button"
                className={styles.button}
                disabled={locked}
                onClick={() => void startFromProfile()}
              >
                Start from curated/local
              </button>
              <button
                type="button"
                className={styles.button}
                disabled={locked}
                onClick={() => void startBlank()}
              >
                Start blank
              </button>
            </>
          )}
          {recovery ? (
            <button
              type="button"
              className={styles.button}
              disabled={inFlight}
              onClick={() => void recover()}
            >
              Recover state
            </button>
          ) : (
            <button
              type="button"
              className={styles.button}
              disabled={inFlight || sending}
              onClick={() => void refresh()}
            >
              Refresh
            </button>
          )}
          <button
            type="button"
            className={`${styles.button} ${styles.quiet}`}
            disabled={sending}
            onClick={onClose}
          >
            Close
          </button>
        </header>

        <div className={styles.srOnly} role="status" aria-live="polite" aria-atomic="true">
          {projection
            ? `Configuration ${STATE_LABEL[projection.state]}. Source ${ORIGIN_LABEL[projection.sourceOrigin]}.`
            : ''}
        </div>

        {phase.kind === 'loading' && <p className={styles.loading}>Loading configuration…</p>}

        {phase.kind === 'error' && (
          <div className={styles.error} role="alert">
            <p className={styles.errorText}>{phase.message}</p>
            <button
              type="button"
              className={styles.button}
              disabled={inFlight}
              onClick={() => void load(true)}
            >
              Retry
            </button>
          </div>
        )}

        {projection && body && (
          <div className={styles.body}>
            {phase.kind === 'ready' && phase.busyNotice && (
              <p className={styles.notice} role="status">
                Golem is busy — a run or pending consent prompt is active. Showing the configuration
                currently in effect; refresh when idle.
              </p>
            )}

            {projection.state === 'missing' && preview === null && (
              <p className={styles.notice}>
                Start from the curated configuration or build a blank one — nothing is written until
                you Apply.
              </p>
            )}

            {EDITING_UNAVAILABLE[projection.state] !== undefined && (
              <p className={styles.notice}>{EDITING_UNAVAILABLE[projection.state]}</p>
            )}

            {sourceError !== '' && (
              <p className={styles.notice} role="alert">
                {sourceError}
              </p>
            )}

            {recovery && (
              <div className={styles.panel} role="alert" data-blocking="true">
                <p className={styles.panelText}>{OUTCOME_UNKNOWN}</p>
                <p className={styles.panelText}>
                  Every retained change is waiting for review. Recover state reloads the active
                  configuration; re-stage what you still want before applying anything.
                </p>
              </div>
            )}

            {outcome.challenge !== null && (
              <div className={styles.panel} role="alert" data-blocking="true">
                <p className={styles.panelText}>
                  Approve this destination before the configuration is written. This is a settings
                  approval, separate from run approval.
                </p>
                <p className={styles.destination}>
                  <span className={styles.identifier}>
                    {outcome.challenge.destination.provider}
                  </span>
                  <span aria-hidden="true">·</span>
                  <span className={styles.identifier}>{outcome.challenge.destination.model}</span>
                  <span aria-hidden="true">·</span>
                  <span className={styles.value}>{outcome.challenge.destination.endpoint}</span>
                  <span aria-hidden="true">·</span>
                  <span className={styles.meta}>
                    {outcome.challenge.destination.classification}
                  </span>
                </p>
                <div className={styles.panelActions}>
                  <button
                    type="button"
                    className={`${styles.button} ${styles.primary}`}
                    disabled={sending}
                    onClick={confirmDestination}
                  >
                    Confirm destination
                  </button>
                  <button
                    type="button"
                    className={`${styles.button} ${styles.quiet}`}
                    disabled={sending}
                    onClick={() => void cancelDestination()}
                  >
                    Cancel approval
                  </button>
                </div>
              </div>
            )}

            {outcome.drops !== null && (
              <div className={styles.panel} data-blocking="true">
                <p className={styles.panelText}>
                  These changes remove model-specific settings the file authors. Confirm the exact
                  set and the changes are re-staged with it; nothing is written until you Apply.
                </p>
                <ul className={styles.dropList}>
                  {outcome.drops.map((drop) => (
                    <li key={drop.changeId} className={styles.panelText}>
                      {`${drop.changeId} → ${drop.fields.join(', ')}`}
                    </li>
                  ))}
                </ul>
                <div className={styles.panelActions}>
                  <button
                    type="button"
                    className={`${styles.button} ${styles.primary}`}
                    disabled={sending}
                    onClick={restageDrops}
                  >
                    Confirm and restage
                  </button>
                </div>
              </div>
            )}

            {outcome.conflict !== null && (
              <div className={styles.panel} role="alert" data-blocking="true">
                <p className={styles.panelText}>
                  The configuration moved while this draft was open, so nothing was written. Reload
                  and re-stage each retained change against the fresh document, or discard the
                  draft.
                </p>
                <div className={styles.panelActions}>
                  <button
                    type="button"
                    className={styles.button}
                    disabled={sending || inFlight}
                    onClick={() => void reviewConflict()}
                  >
                    Reload &amp; review draft
                  </button>
                  <button
                    type="button"
                    className={`${styles.button} ${styles.quiet}`}
                    disabled={sending || inFlight}
                    onClick={() => void discardConflict()}
                  >
                    Discard draft
                  </button>
                </div>
              </div>
            )}

            {outcome.notice !== '' && (
              <p className={styles.notice} role="status">
                {outcome.notice}
              </p>
            )}

            {outcome.busy && (
              <div className={styles.panelActions}>
                <button type="button" className={styles.button} disabled={sending} onClick={retry}>
                  Retry
                </button>
              </div>
            )}

            {pageDiagnostics.length > 0 && (
              <ul className={styles.diagnostics} aria-label="Configuration diagnostics">
                {pageDiagnostics.map((diagnostic, index) => {
                  const { text, subject } = formatSettingsDiagnostic(
                    diagnostic.code,
                    diagnostic.subjectKind,
                    diagnostic.subjectName
                  );
                  return (
                    <li
                      key={`${diagnostic.code}-${diagnostic.subjectKind}-${diagnostic.subjectName}-${index}`}
                      className={styles.diagnostic}
                      data-blocking={diagnostic.blocking || undefined}
                    >
                      <span className={styles.severity}>
                        {diagnostic.blocking ? 'Blocking' : 'Notice'}
                      </span>
                      <span className={styles.diagnosticText}>
                        {text}
                        {subject !== '' && (
                          <>
                            {' — '}
                            <span className={styles.subject}>{subject}</span>
                          </>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}

            {sourceOpen && draft.source.kind !== 'applied' && (
              <div className={styles.panel}>
                <p className={styles.panelText}>
                  {draft.source.kind === 'blank'
                    ? 'This draft builds a new configuration from nothing. Applying it creates the file; the rows below are all pending.'
                    : `This draft comes from profile ${draft.source.profileId} at revision ${draft.source.sourceRevision.slice(0, REVISION_HEAD)}. Applying it replaces the active configuration, and every provider key it carries is cleared unless you stage a replacement.`}
                </p>
              </div>
            )}

            <ProvidersCard
              // Remount on every draft reset AND on every document the open
              // editors could be diffing against: an editor derives its fields
              // once, at mount, but stages against the live projection, so a
              // Refresh that moved the revision would otherwise let a stale
              // endpoint be re-staged as if the user had authored it.
              key={`providers-${draftEpoch}:${projection.revision ?? ''}`}
              providers={body.providers}
              usedProviders={usedProviders}
              changes={draft.changes}
              rows={projected.providerRows}
              diagnostics={diagnostics}
              vault={vault}
              editable={canEdit}
              focusRequest={focusRequest}
              onStage={stage}
              onUnstagedChange={noteUnstaged}
            />
            <RoutingCard
              // Same remount rule as the providers card: an open route editor
              // derives its fields at mount but stages against the live
              // projection, so a Refresh that moved the revision must not let a
              // stale model read back as the user's choice.
              key={`routing-${draftEpoch}:${projection.revision ?? ''}`}
              routes={body.routes}
              models={body.models}
              providers={routableProviders}
              draft={draft}
              // The COALESCED changes, never `draft.changes`: a row and a
              // reopened editor must show the selector-wide truth Apply sends
              // (§3.3), which is rebuilt from each group's last authority.
              changes={projected.changes}
              rows={projected.routeRows}
              roleRows={projected.roleRows}
              diagnostics={diagnostics}
              editable={canEdit}
              focusRequest={focusRequest}
              onStage={stage}
              onUnstagedChange={noteUnstaged}
            />

            {isDraftDirty(draft) && !recovery && (
              <ApplyBar
                source={draft.source}
                changes={projected.changes}
                count={changeCount}
                blocked={blocked}
                locked={locked}
                onApply={apply}
                onDiscard={discard}
                onOpenChange={(changeId) =>
                  setFocusRequest((current) => ({ changeId, nonce: (current?.nonce ?? 0) + 1 }))
                }
                onOpenSource={() => setSourceOpen((current) => !current)}
              />
            )}
          </div>
        )}
      </div>

      {prompt !== null && <ConfirmDialog prompt={prompt} onAnswer={answer} />}
    </div>
  );
}

/**
 * The §4.6a confirmation: a native modal dialog, initially focused on the
 * non-destructive choice, cancelled by Escape, restoring focus to whatever
 * opened it. The same pattern the merge surface uses, for the same reason.
 */
function ConfirmDialog({ prompt, onAnswer }: { prompt: Prompt; onAnswer: (ok: boolean) => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const keepRef = useRef<HTMLButtonElement>(null);
  const invokerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    const active = document.activeElement;
    invokerRef.current = active instanceof HTMLElement ? active : null;
    if (!dialog.open) dialog.showModal();
    keepRef.current?.focus();
  }, []);

  // §4.7: focus returns to the control that opened this, on both answers. A
  // control the answer itself removes (the tab's close button) is simply gone
  // by then, and the pane that removed it owns focus from there.
  const settleWith = (ok: boolean) => {
    const invoker = invokerRef.current;
    onAnswer(ok);
    if (invoker?.isConnected) invoker.focus();
  };

  return (
    <dialog
      ref={dialogRef}
      className={styles.dialog}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="golem-config-confirm-title"
      aria-describedby="golem-config-confirm-body"
      onCancel={(event) => {
        event.preventDefault(); // Escape cancels the transition, not the draft
        settleWith(false);
      }}
    >
      <h2 id="golem-config-confirm-title" className={styles.dialogTitle}>
        {prompt.title}
      </h2>
      <p id="golem-config-confirm-body" className={styles.dialogBody}>
        {prompt.body}
      </p>
      <div className={styles.dialogActions}>
        <button
          ref={keepRef}
          type="button"
          className={`${styles.button} ${styles.quiet}`}
          onClick={() => settleWith(false)}
        >
          Keep editing
        </button>
        <button
          type="button"
          className={`${styles.button} ${styles.primary}`}
          onClick={() => settleWith(true)}
        >
          {prompt.confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
