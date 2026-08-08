/**
 * Task B7 — conversation-keyed Golem store.
 *
 * TDD: written before `src/types/golem.ts` and `src/stores/golemStore.ts` exist.
 *
 * Two concerns live here because they are one contract:
 *  - boundary validators that turn `unknown` Wails payloads into declared types
 *    without a single unchecked cast;
 *  - the conversation/run reducer that keeps streamed transcripts, queues, and
 *    consent state monotonic across deferred promises and epoch changes.
 */

import { ai } from '../../../wailsjs/go/models';
import {
  GolemContractError,
  parseGolemEvent,
  parseGolemStatus,
  parseRunStatus,
  parseTurnAdmission,
  toCancelRequest,
  toStatusRequest,
  toTurnRequest,
} from '../../types/golem';
import type { ConversationView, GolemStatus, TurnAdmission } from '../../types/golem';
import { __resetGolemStore, useGolemStore } from '../../stores/golemStore';

// ── Wails mocks ───────────────────────────────────────────────────────────────

const mockGetWorkspaceInfo = jest.fn();
const mockGetGolemStatus = jest.fn();
const mockRunGolemTurn = jest.fn();
const mockCancelGolemRun = jest.fn();

jest.mock('../../../wailsjs/go/main/App', () => ({
  GetWorkspaceInfo: (...args: unknown[]) => mockGetWorkspaceInfo(...args),
  GetGolemStatus: (...args: unknown[]) => mockGetGolemStatus(...args),
  RunGolemTurn: (...args: unknown[]) => mockRunGolemTurn(...args),
  CancelGolemRun: (...args: unknown[]) => mockCancelGolemRun(...args),
}));

// ── crypto.randomUUID control ─────────────────────────────────────────────────

let uuidQueue: string[] = [];
const mockRandomUUID = jest.fn(() => {
  const next = uuidQueue.shift();
  if (!next) throw new Error('test exhausted the queued UUIDs');
  return next;
});

const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
const installCrypto = (value: unknown) => {
  Object.defineProperty(globalThis, 'crypto', { configurable: true, writable: true, value });
};

afterAll(() => {
  if (originalCrypto) Object.defineProperty(globalThis, 'crypto', originalCrypto);
});

// ── fixtures ──────────────────────────────────────────────────────────────────

const EPOCH = 7;
const WS = 'frontend';
const CONV = 'conv-frontend';
const OTHER_WS = 'backend';
const OTHER_CONV = 'conv-backend';
const RUN_A = '11111111-1111-4111-8111-111111111111';
const RUN_B = '22222222-2222-4222-8222-222222222222';
const RUN_C = '33333333-3333-4333-8333-333333333333';

const identity = { repoEpoch: EPOCH, workspaceId: WS, conversationId: CONV };
const runIdentity = (runId: string, over: Partial<typeof identity> = {}) => ({
  ...identity,
  ...over,
  runId,
});

const remoteDestination = {
  provider: 'anthropic',
  model: 'claude',
  endpoint: 'https://api.example.test',
  classification: 'remote' as const,
  digest: 'digest-remote',
};
const localDestination = {
  ...remoteDestination,
  classification: 'local' as const,
  digest: 'local',
};

const challengeFor = (runId: string, over: Record<string, unknown> = {}) => ({
  id: 'challenge-1',
  identity: runIdentity(runId),
  destination: remoteDestination,
  destinationDigest: remoteDestination.digest,
  expiresAt: 1_800_000_000_000,
  ...over,
});

const statusPayload = (over: Record<string, unknown> = {}) => ({
  available: true,
  workspaceLabel: 'Frontend',
  identity,
  destination: localDestination,
  needsConsent: false,
  activeRuns: [],
  ...over,
});

const admissionPayload = (runId: string, over: Record<string, unknown> = {}) => ({
  state: 'accepted',
  identity: runIdentity(runId),
  destination: localDestination,
  context: { included: 0, bytes: 0, excluded: 0 },
  ...over,
});

const eventPayload = (over: Record<string, unknown> = {}) => ({
  protocol: 1,
  threadId: CONV,
  runId: RUN_A,
  seq: 1,
  type: 'run.started',
  payload: {},
  raw: '{"type":"run.started"}',
  ...over,
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const store = () => useGolemStore.getState();
const conv = (id = CONV): ConversationView => {
  const found = store().conversations[id];
  if (!found) throw new Error(`no conversation ${id}`);
  return found;
};

/** Hydrate a ready, available conversation and select it. */
const hydrateReady = (over: Record<string, unknown> = {}) => {
  store().hydrateStatus(parseGolemStatus(statusPayload(over)));
  store().selectConversation(CONV);
};

beforeEach(() => {
  __resetGolemStore();
  jest.clearAllMocks();
  uuidQueue = [];
  installCrypto({ randomUUID: mockRandomUUID });
  // The backend echoes the submitted identity; the default mock must too.
  mockRunGolemTurn.mockImplementation((request: ai.TurnRequest) =>
    Promise.resolve({
      state: 'accepted',
      identity: { ...request.identity },
      destination: localDestination,
      context: { included: 0, bytes: 0, excluded: 0 },
    })
  );
  mockCancelGolemRun.mockResolvedValue(true);
  mockGetGolemStatus.mockResolvedValue(statusPayload());
  mockGetWorkspaceInfo.mockResolvedValue({ name: '', path: '', repoKey: '', repoEpoch: EPOCH });
});

// ─────────────────────────────────────────────────────────────────────────────
// B7.1 — boundary validators
// ─────────────────────────────────────────────────────────────────────────────

describe('boundary validators', () => {
  it('accepts a plain status object and normalizes the optional fields', () => {
    const parsed = parseGolemStatus(
      statusPayload({ warnings: ['policy drift'], initError: 'Golem is unavailable.' })
    );
    expect(parsed.available).toBe(true);
    expect(parsed.identity).toEqual(identity);
    expect(parsed.destination).toEqual(localDestination);
    expect(parsed.warnings).toEqual(['policy drift']);
    expect(parsed.initError).toBe('Golem is unavailable.');
    expect(parsed.activeRuns).toEqual([]);
  });

  it('accepts a generated ai.Status instance', () => {
    const generated = ai.Status.createFrom(
      statusPayload({
        activeRuns: [
          { identity: runIdentity(RUN_A), workspaceLabel: 'Frontend', state: 'running' },
        ],
      })
    );
    const parsed = parseGolemStatus(generated);
    expect(parsed.activeRuns).toEqual([
      { identity: runIdentity(RUN_A), workspaceLabel: 'Frontend', state: 'running' },
    ]);
    expect(parsed.destination?.classification).toBe('local');
  });

  it('drops absent optional status fields rather than inventing them', () => {
    const parsed = parseGolemStatus(statusPayload({ destination: undefined }));
    expect(parsed.destination).toBeUndefined();
    expect(parsed.warnings).toBeUndefined();
    expect(parsed.initError).toBeUndefined();
  });

  it.each<[string, unknown]>([
    ['a non-object', 'nope'],
    ['null', null],
    ['an array', []],
    ['a missing identity', statusPayload({ identity: undefined })],
    ['a partial identity', statusPayload({ identity: { repoEpoch: 1, workspaceId: 'x' } })],
    ['a non-boolean available', statusPayload({ available: 'yes' })],
    ['a non-array activeRuns', statusPayload({ activeRuns: null })],
    [
      'an unknown active-run state',
      statusPayload({
        activeRuns: [{ identity: runIdentity(RUN_A), workspaceLabel: 'x', state: 'paused' }],
      }),
    ],
    [
      'an unknown destination classification',
      statusPayload({ destination: { ...localDestination, classification: 'hybrid' } }),
    ],
    ['a non-string warning', statusPayload({ warnings: [1] })],
  ])('rejects %s', (_label, value) => {
    expect(() => parseGolemStatus(value)).toThrow(GolemContractError);
  });

  it('reports a bounded contract message that never echoes the payload', () => {
    let thrown: unknown;
    try {
      parseGolemStatus({ available: true, secret: 'API_KEY_MARKER' });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(GolemContractError);
    const message = (thrown as Error).message;
    expect(message).not.toContain('API_KEY_MARKER');
    expect(message.length).toBeLessThanOrEqual(120);
  });

  it('accepts accepted admissions as plain objects and generated instances', () => {
    const plain = parseTurnAdmission(admissionPayload(RUN_A));
    expect(plain.state).toBe('accepted');
    expect(plain.identity).toEqual(runIdentity(RUN_A));

    const generated = parseTurnAdmission(ai.TurnAdmission.createFrom(admissionPayload(RUN_A)));
    expect(generated.state).toBe('accepted');
    expect(generated.context).toEqual({ included: 0, bytes: 0, excluded: 0 });
  });

  it('accepts a needs_consent admission whose challenge matches identity, destination and digest', () => {
    const parsed = parseTurnAdmission(
      admissionPayload(RUN_A, {
        state: 'needs_consent',
        destination: remoteDestination,
        consentChallenge: challengeFor(RUN_A),
      })
    );
    expect(parsed.state).toBe('needs_consent');
    if (parsed.state !== 'needs_consent') throw new Error('unreachable');
    expect(parsed.consentChallenge.id).toBe('challenge-1');
  });

  it.each<[string, unknown]>([
    ['an unknown state', admissionPayload(RUN_A, { state: 'queued' })],
    [
      'an accepted admission carrying a challenge',
      admissionPayload(RUN_A, { consentChallenge: challengeFor(RUN_A) }),
    ],
    [
      'needs_consent without a challenge',
      admissionPayload(RUN_A, { state: 'needs_consent', destination: remoteDestination }),
    ],
    [
      'needs_consent with a null challenge',
      admissionPayload(RUN_A, {
        state: 'needs_consent',
        destination: remoteDestination,
        consentChallenge: null,
      }),
    ],
    [
      'a challenge naming another run',
      admissionPayload(RUN_A, {
        state: 'needs_consent',
        destination: remoteDestination,
        consentChallenge: challengeFor(RUN_B),
      }),
    ],
    [
      'a challenge naming another epoch',
      admissionPayload(RUN_A, {
        state: 'needs_consent',
        destination: remoteDestination,
        consentChallenge: challengeFor(RUN_A, {
          identity: { ...runIdentity(RUN_A), repoEpoch: EPOCH + 1 },
        }),
      }),
    ],
    [
      'a challenge naming another workspace',
      admissionPayload(RUN_A, {
        state: 'needs_consent',
        destination: remoteDestination,
        consentChallenge: challengeFor(RUN_A, {
          identity: { ...runIdentity(RUN_A), workspaceId: OTHER_WS },
        }),
      }),
    ],
    [
      'a challenge naming another conversation',
      admissionPayload(RUN_A, {
        state: 'needs_consent',
        destination: remoteDestination,
        consentChallenge: challengeFor(RUN_A, {
          identity: { ...runIdentity(RUN_A), conversationId: OTHER_CONV },
        }),
      }),
    ],
    [
      'a challenge naming another destination',
      admissionPayload(RUN_A, {
        state: 'needs_consent',
        destination: remoteDestination,
        consentChallenge: challengeFor(RUN_A, {
          destination: { ...remoteDestination, endpoint: 'https://elsewhere.test' },
        }),
      }),
    ],
    [
      'a challenge whose destinationDigest drifted',
      admissionPayload(RUN_A, {
        state: 'needs_consent',
        destination: remoteDestination,
        consentChallenge: challengeFor(RUN_A, { destinationDigest: 'other' }),
      }),
    ],
    ['a missing context receipt', admissionPayload(RUN_A, { context: undefined })],
  ])('rejects %s', (_label, value) => {
    expect(() => parseTurnAdmission(value)).toThrow(GolemContractError);
  });

  it.each([
    ['run.started', {}],
    ['message.delta', { messageId: 'm1', text: 'hi' }],
    ['tool.started', { toolCallId: 't1', name: 'read', preview: 'read(a)' }],
    ['tool.finished', { toolCallId: 't1', name: 'read', preview: 'ok', isError: false }],
    ['run.finished', { stopReason: 'end_turn', model: 'claude' }],
    ['run.failed', { code: 'run_failed', message: 'The Golem run failed.' }],
    ['run.canceled', {}],
  ])('accepts the %s envelope', (type, payload) => {
    const parsed = parseGolemEvent(eventPayload({ type, payload }));
    expect(parsed).not.toBeNull();
    expect(parsed!.type).toBe(type);
    expect(parsed!.payload).toEqual(payload);
    expect(parsed!.protocol).toBe(1);
  });

  it.each<[string, unknown]>([
    ['a non-object', 42],
    ['an unsupported protocol', eventPayload({ protocol: 2 })],
    ['a missing threadId', eventPayload({ threadId: '' })],
    ['a missing runId', eventPayload({ runId: undefined })],
    ['a non-numeric seq', eventPayload({ seq: '1' })],
    ['a missing type', eventPayload({ type: '' })],
    ['a non-string raw', eventPayload({ raw: {} })],
  ])('returns null for %s streamed event', (_label, value) => {
    expect(parseGolemEvent(value)).toBeNull();
  });

  it('parses failed and canceled run-status fallbacks', () => {
    expect(parseRunStatus({ identity: runIdentity(RUN_A), state: 'failed', message: 'x' })).toEqual(
      {
        identity: runIdentity(RUN_A),
        state: 'failed',
        message: 'x',
      }
    );
    expect(parseRunStatus({ identity: runIdentity(RUN_A), state: 'canceled' })).toEqual({
      identity: runIdentity(RUN_A),
      state: 'canceled',
    });
  });

  it.each<[string, unknown]>([
    ['an unknown state', { identity: runIdentity(RUN_A), state: 'done' }],
    ['a partial identity', { identity: { repoEpoch: 1 }, state: 'failed' }],
    ['a non-string message', { identity: runIdentity(RUN_A), state: 'failed', message: 3 }],
    ['a non-object', null],
  ])('returns null for %s run status', (_label, value) => {
    expect(parseRunStatus(value)).toBeNull();
  });

  it('builds Wails inputs through the generated constructors only', () => {
    const statusRequest = toStatusRequest(identity);
    expect(statusRequest).toBeInstanceOf(ai.StatusRequest);
    expect(Object.keys(statusRequest).sort()).toEqual(['repoEpoch', 'workspaceId']);

    const turnRequest = toTurnRequest(runIdentity(RUN_A), { message: 'hi', contextRefs: [] });
    expect(turnRequest).toBeInstanceOf(ai.TurnRequest);
    expect(turnRequest.identity).toBeInstanceOf(ai.RunIdentity);
    expect(Object.keys(turnRequest).sort()).toEqual([
      'consentChallengeId',
      'contextRefs',
      'identity',
      'message',
    ]);

    expect(toCancelRequest(runIdentity(RUN_A))).toBeInstanceOf(ai.RunIdentity);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B7.1 — event reduction
// ─────────────────────────────────────────────────────────────────────────────

describe('event reduction', () => {
  beforeEach(() => {
    hydrateReady();
    useGolemStore.setState((state) => ({
      runToConversation: { ...state.runToConversation, [RUN_A]: CONV },
    }));
  });

  const send = (over: Record<string, unknown>) => store().ingestEvent(eventPayload(over));

  it('merges message deltas by message ID and keeps a single assistant row', () => {
    send({ seq: 1, type: 'message.delta', payload: { messageId: 'm1', text: 'Hel' } });
    send({ seq: 2, type: 'message.delta', payload: { messageId: 'm1', text: 'lo' } });
    send({ seq: 3, type: 'message.delta', payload: { messageId: 'm2', text: '!' } });

    const rows = conv().transcript.filter((entry) => entry.kind === 'assistant');
    expect(rows.map((row) => row.text)).toEqual(['Hello', '!']);
    expect(rows[0].runId).toBe(RUN_A);
    expect(rows[0].raw?.seq).toBe(2);
    expect(conv().runs[RUN_A].lastSeq).toBe(3);
  });

  it('updates one activity across tool.started and tool.finished', () => {
    send({
      seq: 1,
      type: 'tool.started',
      payload: { toolCallId: 't1', name: 'read', preview: 'read(a)' },
    });
    expect(conv().transcript.filter((e) => e.kind === 'tool')).toHaveLength(1);
    expect(conv().transcript[0].activity).toBe('running');

    send({
      seq: 2,
      type: 'tool.finished',
      payload: { toolCallId: 't1', name: 'read', preview: 'ok', isError: false },
    });
    const tools = conv().transcript.filter((e) => e.kind === 'tool');
    expect(tools).toHaveLength(1);
    expect(tools[0].activity).toBe('done');
    expect(tools[0].text).toBe('ok');
    expect(tools[0].toolName).toBe('read');
    expect(tools[0].raw?.seq).toBe(2);
  });

  it('marks a failing tool.finished as failed', () => {
    send({
      seq: 1,
      type: 'tool.started',
      payload: { toolCallId: 't1', name: 'read', preview: '' },
    });
    send({
      seq: 2,
      type: 'tool.finished',
      payload: { toolCallId: 't1', name: 'read', preview: 'boom', isError: true },
    });
    expect(conv().transcript[0].activity).toBe('failed');
  });

  it('ignores an event whose seq does not advance the run', () => {
    send({ seq: 5, type: 'message.delta', payload: { messageId: 'm1', text: 'a' } });
    send({ seq: 5, type: 'message.delta', payload: { messageId: 'm1', text: 'b' } });
    send({ seq: 4, type: 'message.delta', payload: { messageId: 'm1', text: 'c' } });
    expect(conv().transcript[0].text).toBe('a');
    expect(conv().rawEvents).toHaveLength(1);
    expect(conv().runs[RUN_A].lastSeq).toBe(5);
  });

  it.each(['run.finished', 'run.failed', 'run.canceled'])(
    'marks unmatched tool activities interrupted on %s',
    (terminal) => {
      send({
        seq: 1,
        type: 'tool.started',
        payload: { toolCallId: 't1', name: 'read', preview: '' },
      });
      send({
        seq: 2,
        type: 'tool.started',
        payload: { toolCallId: 't2', name: 'glob', preview: '' },
      });
      send({
        seq: 3,
        type: 'tool.finished',
        payload: { toolCallId: 't1', name: 'read', preview: 'ok', isError: false },
      });
      send({
        seq: 4,
        type: terminal,
        payload: terminal === 'run.failed' ? { code: 'run_failed', message: 'nope' } : {},
      });

      const tools = conv().transcript.filter((e) => e.kind === 'tool');
      expect(tools.map((t) => t.activity)).toEqual(['done', 'interrupted']);
    }
  );

  it('keeps unknown but valid events in rawEvents without projecting a row', () => {
    send({ seq: 1, type: 'plan.updated', payload: { steps: 2 } });
    expect(conv().rawEvents.map((e) => e.type)).toEqual(['plan.updated']);
    expect(conv().transcript).toHaveLength(0);
    expect(conv().runs[RUN_A].lastSeq).toBe(1);
  });

  it('does not mutate state for an invalid envelope', () => {
    send({ seq: 1, type: 'message.delta', payload: { messageId: 'm1', text: 'a' } });
    const before = conv();
    store().ingestEvent(eventPayload({ protocol: 9, seq: 2 }));
    store().ingestEvent({ nonsense: true });
    store().ingestEvent(
      eventPayload({ seq: 2, type: 'message.delta', payload: { text: 'no id' } })
    );
    expect(conv().rawEvents).toBe(before.rawEvents);
    expect(conv().transcript[0].text).toBe('a');
  });

  it('projects a bounded error row from run.failed', () => {
    send({
      seq: 1,
      type: 'run.failed',
      payload: { code: 'run_failed', message: 'The Golem run failed.' },
    });
    const errors = conv().transcript.filter((e) => e.kind === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].text).toBe('The Golem run failed.');
    expect(errors[0].raw?.type).toBe('run.failed');
    expect(conv().runs[RUN_A].phase).toBe('failed');
  });

  it('finishes a run from the run-status fallback without synthesizing a raw event', () => {
    send({
      seq: 1,
      type: 'tool.started',
      payload: { toolCallId: 't1', name: 'read', preview: '' },
    });
    const rawBefore = conv().rawEvents.length;
    store().ingestRunStatus({
      identity: runIdentity(RUN_A),
      state: 'failed',
      message: 'The Golem run failed.',
    });
    expect(conv().rawEvents).toHaveLength(rawBefore);
    expect(conv().runs[RUN_A].phase).toBe('failed');
    expect(conv().transcript.find((e) => e.kind === 'tool')!.activity).toBe('interrupted');
    expect(conv().transcript.find((e) => e.kind === 'error')!.text).toBe('The Golem run failed.');
  });

  it('ignores a malformed streamed status', () => {
    const before = store().conversations;
    store().ingestRunStatus({ identity: runIdentity(RUN_A), state: 'weird' });
    expect(store().conversations).toBe(before);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// B7.2 — lifecycle
// ─────────────────────────────────────────────────────────────────────────────

describe('bridge lifecycle and hydration', () => {
  it('starts unbound with the Runs panel preserved', () => {
    expect(store().panelMode).toBe('runs');
    expect(store().bridgePhase).toBe('unbound');
    expect(store().hydratedIdentity).toBeNull();
    expect(store().conversations).toEqual({});
  });

  it('moves to ready and stores availability, consent, warnings and initError', () => {
    useGolemStore.setState({ bridgePhase: 'binding' });
    store().hydrateStatus(
      parseGolemStatus(
        statusPayload({
          available: false,
          needsConsent: true,
          destination: remoteDestination,
          warnings: ['manifest reloaded'],
          initError: 'Remote consent storage is unavailable.',
        })
      )
    );
    expect(store().bridgePhase).toBe('ready');
    expect(store().hydratedIdentity).toEqual(identity);
    expect(conv().available).toBe(false);
    expect(conv().needsConsent).toBe(true);
    expect(conv().warnings).toEqual(['manifest reloaded']);
    expect(conv().initError).toBe('Remote consent storage is unavailable.');
    expect(conv().destination).toEqual(remoteDestination);
    expect(conv().workspaceLabel).toBe('Frontend');
  });

  it('normalizes absent optional status fields to null and empty arrays', () => {
    hydrateReady({ destination: undefined });
    expect(conv().destination).toBeNull();
    expect(conv().initError).toBeNull();
    expect(conv().warnings).toEqual([]);
  });

  it('treats an unresolvable status as a bridge error without inventing a conversation', () => {
    hydrateReady();
    store().hydrateStatus(
      parseGolemStatus({
        available: false,
        workspaceLabel: '',
        identity: { repoEpoch: 0, workspaceId: '', conversationId: '' },
        needsConsent: false,
        activeRuns: [],
        initError: 'The Golem workspace is unavailable.',
      })
    );
    expect(store().bridgePhase).toBe('error');
    expect(store().bridgeError).toBe('The Golem workspace is unavailable.');
    expect(store().hydratedIdentity).toBeNull();
    expect(Object.keys(store().conversations)).toEqual([CONV]);
  });

  it('rejects a stale-epoch status while retaining conversation history', async () => {
    hydrateReady();
    uuidQueue = [RUN_A];
    store().setDraft(CONV, 'hello');
    await store().submitTurn(CONV);

    store().hydrateStatus(
      parseGolemStatus(
        statusPayload({
          identity: { ...identity, repoEpoch: EPOCH + 1 },
          workspaceLabel: 'Frontend v2',
        })
      )
    );
    expect(store().hydratedIdentity!.repoEpoch).toBe(EPOCH + 1);

    store().hydrateStatus(
      parseGolemStatus(statusPayload({ workspaceLabel: 'stale', available: false }))
    );
    expect(store().hydratedIdentity!.repoEpoch).toBe(EPOCH + 1);
    expect(conv().workspaceLabel).toBe('Frontend v2');
    expect(conv().transcript.filter((e) => e.kind === 'user')).toHaveLength(1);
  });

  it('upserts hydrated active runs with routing but no invented prompt metadata', () => {
    store().hydrateStatus(
      parseGolemStatus(
        statusPayload({
          activeRuns: [
            { identity: runIdentity(RUN_A), workspaceLabel: 'Frontend', state: 'running' },
            {
              identity: {
                ...runIdentity(RUN_B),
                workspaceId: OTHER_WS,
                conversationId: OTHER_CONV,
              },
              workspaceLabel: 'Backend',
              state: 'canceling',
            },
          ],
        })
      )
    );
    expect(store().runToConversation).toEqual({ [RUN_A]: CONV, [RUN_B]: OTHER_CONV });
    expect(conv().runs[RUN_A].phase).toBe('running');
    expect(conv().runs[RUN_A].request).toBeUndefined();
    expect(conv().runs[RUN_A].userEntryId).toBeUndefined();
    expect(conv().activeRunId).toBe(RUN_A);
    expect(conv(OTHER_CONV).runs[RUN_B].phase).toBe('canceling');
    expect(conv(OTHER_CONV).workspaceLabel).toBe('Backend');
  });

  it('merges rather than deletes runs from other workspaces', () => {
    store().hydrateStatus(
      parseGolemStatus(
        statusPayload({
          activeRuns: [
            {
              identity: {
                ...runIdentity(RUN_B),
                workspaceId: OTHER_WS,
                conversationId: OTHER_CONV,
              },
              workspaceLabel: 'Backend',
              state: 'running',
            },
          ],
        })
      )
    );
    store().hydrateStatus(parseGolemStatus(statusPayload({ activeRuns: [] })));
    expect(conv(OTHER_CONV).runs[RUN_B].phase).toBe('running');
    expect(store().runToConversation[RUN_B]).toBe(OTHER_CONV);
  });
});

describe('send gating', () => {
  it.each<[string, () => void]>([
    ['no workspace is bound', () => __resetGolemStore()],
    [
      'binding is still in flight',
      () => {
        hydrateReady();
        useGolemStore.setState({ bridgePhase: 'binding' });
      },
    ],
    [
      'the bridge is in error',
      () => {
        hydrateReady();
        useGolemStore.setState({ bridgePhase: 'error', bridgeError: 'Golem is unavailable.' });
      },
    ],
    [
      'status reports the workspace unavailable',
      () => hydrateReady({ available: false, initError: 'Golem is unavailable.' }),
    ],
    [
      'the hydrated identity names another workspace',
      () => {
        hydrateReady();
        useGolemStore.setState({
          hydratedIdentity: { ...identity, workspaceId: OTHER_WS, conversationId: OTHER_CONV },
        });
      },
    ],
  ])('makes no backend call when %s', async (_label, arrange) => {
    arrange();
    if (!store().conversations[CONV]) {
      store().hydrateStatus(parseGolemStatus(statusPayload()));
      useGolemStore.setState({ bridgePhase: 'unbound', hydratedIdentity: null });
    }
    store().setDraft(CONV, 'hello');
    await store().submitTurn(CONV);
    expect(mockRunGolemTurn).not.toHaveBeenCalled();
  });

  it('makes no backend call for a blank draft', async () => {
    hydrateReady();
    store().setDraft(CONV, '   ');
    await store().submitTurn(CONV);
    expect(mockRunGolemTurn).not.toHaveBeenCalled();
  });

  it('shows a bounded inline error and calls nothing when secure randomUUID is unavailable', async () => {
    hydrateReady();
    installCrypto({});
    store().setDraft(CONV, 'hello');
    await store().submitTurn(CONV);

    expect(mockRunGolemTurn).not.toHaveBeenCalled();
    const errors = conv().transcript.filter((e) => e.kind === 'error');
    expect(errors).toHaveLength(1);
    expect(errors[0].text.length).toBeLessThanOrEqual(200);
    expect(conv().draft).toBe('hello');
    expect(conv().activeRunId).toBeNull();
  });
});

describe('submitTurn', () => {
  it('creates the provisional run, routing and user row before the Wails call', async () => {
    hydrateReady();
    uuidQueue = [RUN_A];
    store().setDraft(CONV, 'explain this');

    let observed: ReturnType<typeof store> | null = null;
    const gate = deferred<unknown>();
    mockRunGolemTurn.mockImplementation(() => {
      observed = store();
      return gate.promise;
    });

    const pending = store().submitTurn(CONV);
    expect(observed).not.toBeNull();
    const snapshot = observed!;
    const before = snapshot.conversations[CONV];
    expect(before.runs[RUN_A].phase).toBe('admitting');
    expect(before.runs[RUN_A].request).toEqual({ message: 'explain this', contextRefs: [] });
    expect(before.runs[RUN_A].userEntryId).toBeTruthy();
    expect(before.activeRunId).toBe(RUN_A);
    expect(before.draft).toBe('');
    expect(snapshot.runToConversation[RUN_A]).toBe(CONV);
    const userRow = before.transcript.find((e) => e.kind === 'user')!;
    expect(userRow.text).toBe('explain this');
    expect(userRow.id).toBe(before.runs[RUN_A].userEntryId);

    gate.resolve(admissionPayload(RUN_A));
    await pending;
    expect(conv().runs[RUN_A].phase).toBe('running');
  });

  it('submits no endpoint or path', async () => {
    hydrateReady();
    uuidQueue = [RUN_A];
    store().setDraft(CONV, 'hello');
    await store().submitTurn(CONV);

    const request = mockRunGolemTurn.mock.calls[0][0] as ai.TurnRequest;
    expect(Object.keys(request).sort()).toEqual([
      'consentChallengeId',
      'contextRefs',
      'identity',
      'message',
    ]);
    expect(Object.keys(request.identity).sort()).toEqual([
      'conversationId',
      'repoEpoch',
      'runId',
      'workspaceId',
    ]);
    expect(JSON.stringify(request)).not.toContain('endpoint');
    expect(request.consentChallengeId).toBe('');
  });

  it('lets admission resolve after the run has already advanced by events', async () => {
    hydrateReady();
    uuidQueue = [RUN_A];
    const gate = deferred<unknown>();
    mockRunGolemTurn.mockReturnValue(gate.promise);
    store().setDraft(CONV, 'hello');
    const pending = store().submitTurn(CONV);

    store().ingestEvent(eventPayload({ seq: 1, type: 'run.started' }));
    store().ingestEvent(
      eventPayload({ seq: 2, type: 'message.delta', payload: { messageId: 'm1', text: 'hi' } })
    );
    expect(conv().runs[RUN_A].phase).toBe('running');

    gate.resolve(admissionPayload(RUN_A));
    await pending;
    expect(conv().runs[RUN_A].phase).toBe('running');
    expect(conv().transcript.filter((e) => e.kind === 'assistant')[0].text).toBe('hi');
  });

  it('routes background events by threadId while another workspace is focused', async () => {
    hydrateReady();
    uuidQueue = [RUN_A];
    store().setDraft(CONV, 'hello');
    await store().submitTurn(CONV);

    // Focus moves to a sibling workspace in the same repository.
    store().hydrateStatus(
      parseGolemStatus(
        statusPayload({
          identity: { ...identity, workspaceId: OTHER_WS, conversationId: OTHER_CONV },
          workspaceLabel: 'Backend',
        })
      )
    );
    store().selectConversation(OTHER_CONV);

    store().ingestEvent(
      eventPayload({
        threadId: CONV,
        seq: 1,
        type: 'message.delta',
        payload: { messageId: 'm1', text: 'background' },
      })
    );
    expect(conv().transcript.filter((e) => e.kind === 'assistant')[0].text).toBe('background');
    expect(conv(OTHER_CONV).transcript).toHaveLength(0);
  });

  it('ignores events for an unknown conversation', () => {
    hydrateReady();
    const before = store().conversations;
    store().ingestEvent(eventPayload({ threadId: 'conv-unknown', runId: RUN_C }));
    expect(store().conversations).toBe(before);
  });

  it('restores the same transcript and draft after switching away and back', async () => {
    hydrateReady();
    uuidQueue = [RUN_A];
    store().setDraft(CONV, 'hello');
    await store().submitTurn(CONV);
    store().setDraft(CONV, 'draft in progress');

    store().hydrateStatus(
      parseGolemStatus(
        statusPayload({
          identity: { ...identity, workspaceId: OTHER_WS, conversationId: OTHER_CONV },
        })
      )
    );
    store().selectConversation(OTHER_CONV);
    expect(conv(OTHER_CONV).draft).toBe('');

    store().selectConversation(CONV);
    expect(store().selectedConversationId).toBe(CONV);
    expect(conv().draft).toBe('draft in progress');
    expect(conv().transcript.filter((e) => e.kind === 'user')).toHaveLength(1);
  });

  it('preserves the draft across Runs mode and a collapsed panel', () => {
    hydrateReady();
    store().setDraft(CONV, 'still here');
    useGolemStore.setState({ panelMode: 'runs' });
    expect(conv().draft).toBe('still here');
    const revision = store().composerFocusRevision;
    store().selectConversation(CONV);
    expect(store().composerFocusRevision).toBeGreaterThan(revision);
    expect(conv().draft).toBe('still here');
  });
});

describe('queueing', () => {
  const startBusyRun = async () => {
    hydrateReady();
    uuidQueue = [RUN_A];
    store().setDraft(CONV, 'first');
    await store().submitTurn(CONV);
  };

  it('stages a queued turn without a backend call while a run is active', async () => {
    await startBusyRun();
    mockRunGolemTurn.mockClear();
    store().setDraft(CONV, 'second');
    await store().submitTurn(CONV);

    expect(mockRunGolemTurn).not.toHaveBeenCalled();
    expect(conv().queuedTurns).toHaveLength(1);
    expect(conv().queuedTurns[0]).toMatchObject({ message: 'second', state: 'queued' });
    expect(conv().draft).toBe('');
  });

  it('stages a queued turn while consent is pending', async () => {
    hydrateReady({ destination: remoteDestination, needsConsent: true });
    uuidQueue = [RUN_A];
    mockRunGolemTurn.mockResolvedValue(
      admissionPayload(RUN_A, {
        state: 'needs_consent',
        destination: remoteDestination,
        consentChallenge: challengeFor(RUN_A),
      })
    );
    store().setDraft(CONV, 'first');
    await store().submitTurn(CONV);
    expect(conv().pendingConsentTurn).not.toBeNull();

    mockRunGolemTurn.mockClear();
    store().setDraft(CONV, 'second');
    await store().submitTurn(CONV);
    expect(mockRunGolemTurn).not.toHaveBeenCalled();
    expect(conv().queuedTurns).toHaveLength(1);
  });

  it('starts exactly one queued turn on the terminal relay with a fresh run ID', async () => {
    await startBusyRun();
    store().setDraft(CONV, 'second');
    await store().submitTurn(CONV);
    store().setDraft(CONV, 'third');
    await store().submitTurn(CONV);
    expect(conv().queuedTurns).toHaveLength(2);

    uuidQueue = [RUN_B];
    mockRunGolemTurn.mockClear();
    store().ingestEvent(
      eventPayload({
        seq: 1,
        type: 'run.finished',
        payload: { stopReason: 'end_turn', model: 'm' },
      })
    );
    await flush();

    expect(mockRunGolemTurn).toHaveBeenCalledTimes(1);
    expect((mockRunGolemTurn.mock.calls[0][0] as ai.TurnRequest).identity.runId).toBe(RUN_B);
    expect((mockRunGolemTurn.mock.calls[0][0] as ai.TurnRequest).message).toBe('second');
    expect(conv().queuedTurns).toHaveLength(1);
    expect(conv().queuedTurns[0].message).toBe('third');
    expect(conv().activeRunId).toBe(RUN_B);
  });

  it('edits and removes staged turns', async () => {
    await startBusyRun();
    store().setDraft(CONV, 'second');
    await store().submitTurn(CONV);
    const queueId = conv().queuedTurns[0].queueId;

    store().updateQueuedTurn(CONV, queueId, 'second, revised');
    expect(conv().queuedTurns[0].message).toBe('second, revised');
    store().removeQueuedTurn(CONV, queueId);
    expect(conv().queuedTurns).toHaveLength(0);
  });

  it('keeps queued turns staged as reopen-required after unbind and reissues them on rebind', async () => {
    await startBusyRun();
    store().setDraft(CONV, 'second');
    await store().submitTurn(CONV);

    store().invalidateBinding();
    expect(store().bridgePhase).toBe('unbound');
    expect(store().hydratedIdentity).toBeNull();
    expect(conv().queuedTurns[0].state).toBe('reopen-required');

    mockRunGolemTurn.mockClear();
    uuidQueue = [RUN_B];
    // The old-epoch run finished in the background; the slot must be free first.
    store().ingestEvent(
      eventPayload({
        seq: 1,
        type: 'run.finished',
        payload: { stopReason: 'end_turn', model: 'm' },
      })
    );
    await flush();
    expect(mockRunGolemTurn).not.toHaveBeenCalled();
    expect(conv().queuedTurns[0].state).toBe('reopen-required');

    store().hydrateStatus(
      parseGolemStatus(statusPayload({ identity: { ...identity, repoEpoch: EPOCH + 1 } }))
    );
    await flush();

    expect(mockRunGolemTurn).toHaveBeenCalledTimes(1);
    const reissued = mockRunGolemTurn.mock.calls[0][0] as ai.TurnRequest;
    expect(reissued.identity.repoEpoch).toBe(EPOCH + 1);
    expect(reissued.identity.runId).toBe(RUN_B);
    expect(reissued.message).toBe('second');
    expect(conv().queuedTurns).toHaveLength(0);
  });
});

describe('consent', () => {
  const needsConsentAdmission = (runId: string) =>
    admissionPayload(runId, {
      state: 'needs_consent',
      destination: remoteDestination,
      consentChallenge: challengeFor(runId),
    });

  const firstRemoteSubmission = async () => {
    hydrateReady({ destination: remoteDestination, needsConsent: true });
    uuidQueue = [RUN_A];
    mockRunGolemTurn.mockResolvedValue(needsConsentAdmission(RUN_A));
    store().setDraft(CONV, 'ask remote');
    await store().submitTurn(CONV);
  };

  it('stores the exact request when admission needs consent', async () => {
    await firstRemoteSubmission();
    const pending = conv().pendingConsentTurn!;
    expect(pending.draft).toEqual({ message: 'ask remote', contextRefs: [] });
    expect(pending.identity).toEqual(runIdentity(RUN_A));
    expect(pending.challenge.id).toBe('challenge-1');
    expect(pending.userEntryId).toBe(conv().runs[RUN_A].userEntryId);
    expect(conv().runs[RUN_A].phase).toBe('needs-consent');
  });

  it('retries with the same identity and message plus only the challenge ID', async () => {
    await firstRemoteSubmission();
    mockRunGolemTurn.mockClear();
    mockRunGolemTurn.mockResolvedValue(admissionPayload(RUN_A, { destination: remoteDestination }));

    await store().allowAndSend(CONV);

    expect(mockRunGolemTurn).toHaveBeenCalledTimes(1);
    const retry = mockRunGolemTurn.mock.calls[0][0] as ai.TurnRequest;
    expect(retry.identity).toEqual(expect.objectContaining(runIdentity(RUN_A)));
    expect(retry.message).toBe('ask remote');
    expect(retry.contextRefs).toEqual([]);
    expect(retry.consentChallengeId).toBe('challenge-1');
    expect(conv().transcript.filter((e) => e.kind === 'user')).toHaveLength(1);
    expect(conv().pendingConsentTurn).toBeNull();
    expect(conv().runs[RUN_A].phase).toBe('running');
  });

  it('retains the pending turn, challenge and user row after a transient grant rejection', async () => {
    await firstRemoteSubmission();
    const pendingBefore = conv().pendingConsentTurn!;
    mockRunGolemTurn.mockClear();
    mockRunGolemTurn.mockRejectedValueOnce('Remote consent storage is unavailable.');

    await store().allowAndSend(CONV);

    expect(conv().pendingConsentTurn).toEqual(pendingBefore);
    expect(conv().runs[RUN_A].phase).toBe('needs-consent');
    expect(conv().transcript.filter((e) => e.kind === 'user')).toHaveLength(1);
    expect(
      conv()
        .transcript.filter((e) => e.kind === 'error')
        .pop()!.text
    ).toBe('Remote consent storage is unavailable.');
    expect(conv().lastFailedTurn).toBeNull();
    expect(store().lastFailureConversationId).toBe(CONV);
  });

  it('keeps one prompt row and one first request across a deferred fail-then-recover grant', async () => {
    await firstRemoteSubmission();
    const firstCallCount = mockRunGolemTurn.mock.calls.length;

    const failing = deferred<unknown>();
    mockRunGolemTurn.mockReturnValueOnce(failing.promise);
    const firstGrant = store().allowAndSend(CONV);
    failing.reject('Remote consent storage is unavailable.');
    await firstGrant;

    const recovering = deferred<unknown>();
    mockRunGolemTurn.mockReturnValueOnce(recovering.promise);
    const secondGrant = store().allowAndSend(CONV);
    recovering.resolve(admissionPayload(RUN_A, { destination: remoteDestination }));
    await secondGrant;

    expect(conv().transcript.filter((e) => e.kind === 'user')).toHaveLength(1);
    expect(mockRunGolemTurn.mock.calls).toHaveLength(firstCallCount + 2);
    expect(mockRunGolemTurn.mock.calls[firstCallCount][0].consentChallengeId).toBe('challenge-1');
    expect(mockRunGolemTurn.mock.calls[firstCallCount + 1][0].consentChallengeId).toBe(
      'challenge-1'
    );
    expect(conv().pendingConsentTurn).toBeNull();
    expect(conv().runs[RUN_A].phase).toBe('running');
  });

  it('declines with Cancel on the pending identity and keeps the turn retryable', async () => {
    await firstRemoteSubmission();
    await store().cancelRun(RUN_A);

    expect(mockCancelGolemRun).toHaveBeenCalledTimes(1);
    const cancelArg = mockCancelGolemRun.mock.calls[0][0] as ai.RunIdentity;
    expect(cancelArg).toBeInstanceOf(ai.RunIdentity);
    expect({ ...cancelArg }).toEqual(runIdentity(RUN_A));
    expect(conv().runs[RUN_A].phase).toBe('canceling');

    store().ingestRunStatus({ identity: runIdentity(RUN_A), state: 'canceled' });
    expect(conv().pendingConsentTurn).toBeNull();
    expect(conv().activeRunId).toBeNull();
    expect(conv().lastFailedTurn).toEqual({
      draft: { message: 'ask remote', contextRefs: [] },
      userEntryId: conv().runs[RUN_A].userEntryId,
    });
  });

  it('refuses to offer a consent challenge issued under a retired epoch', async () => {
    hydrateReady({ destination: remoteDestination, needsConsent: true });
    uuidQueue = [RUN_A];
    const gate = deferred<unknown>();
    mockRunGolemTurn.mockReturnValueOnce(gate.promise);
    store().setDraft(CONV, 'ask remote');
    const pending = store().submitTurn(CONV);

    // The repository is rebound before the challenge comes back; the backend
    // has already dropped every unconsumed challenge for the old incarnation.
    store().hydrateStatus(
      parseGolemStatus(
        statusPayload({
          identity: { ...identity, repoEpoch: EPOCH + 1 },
          destination: remoteDestination,
          needsConsent: true,
        })
      )
    );

    gate.resolve(needsConsentAdmission(RUN_A));
    await pending;

    expect(conv().pendingConsentTurn).toBeNull();
    expect(conv().runs[RUN_A].phase).toBe('failed');
    expect(conv().activeRunId).toBeNull();
    expect(
      conv()
        .transcript.filter((e) => e.kind === 'error')
        .pop()!.text
    ).toBe('The workspace changed before this turn started.');
    expect(conv().lastFailedTurn).toEqual({
      draft: { message: 'ask remote', contextRefs: [] },
      userEntryId: conv().runs[RUN_A].userEntryId,
    });
  });

  it('does not resurrect a terminal run when needs_consent resolves late', async () => {
    hydrateReady({ destination: remoteDestination, needsConsent: true });
    uuidQueue = [RUN_A];
    const gate = deferred<unknown>();
    mockRunGolemTurn.mockReturnValueOnce(gate.promise);
    store().setDraft(CONV, 'ask remote');
    const pending = store().submitTurn(CONV);
    store().setDraft(CONV, 'queued after');
    await store().submitTurn(CONV);

    store().ingestEvent(eventPayload({ seq: 1, type: 'run.started' }));
    uuidQueue = [RUN_B];
    store().ingestEvent(eventPayload({ seq: 2, type: 'run.canceled', payload: {} }));
    await flush();
    const dispatchedCalls = mockRunGolemTurn.mock.calls.length;

    gate.resolve(needsConsentAdmission(RUN_A));
    await pending;

    expect(conv().runs[RUN_A].phase).toBe('canceled');
    expect(conv().pendingConsentTurn).toBeNull();
    expect(conv().activeRunId).toBe(RUN_B);
    expect(mockRunGolemTurn.mock.calls).toHaveLength(dispatchedCalls);
  });
});

describe('failure and retry', () => {
  it('records lastFailedTurn on admission rejection and does not drain queued work', async () => {
    hydrateReady();
    uuidQueue = [RUN_A];
    const gate = deferred<unknown>();
    mockRunGolemTurn.mockReturnValueOnce(gate.promise);
    store().setDraft(CONV, 'first');
    const pending = store().submitTurn(CONV);
    store().setDraft(CONV, 'second');
    await store().submitTurn(CONV);

    gate.reject('The Golem request is invalid or stale.');
    await pending;

    expect(conv().runs[RUN_A].phase).toBe('failed');
    expect(conv().activeRunId).toBeNull();
    expect(conv().lastFailedTurn).toEqual({
      draft: { message: 'first', contextRefs: [] },
      userEntryId: conv().runs[RUN_A].userEntryId,
    });
    expect(conv().queuedTurns).toHaveLength(1);
    expect(mockRunGolemTurn).toHaveBeenCalledTimes(1);
    expect(store().lastFailureConversationId).toBe(CONV);
  });

  it('sets bridgePhase error when an admission violates the contract', async () => {
    hydrateReady();
    uuidQueue = [RUN_A];
    mockRunGolemTurn.mockResolvedValueOnce({ state: 'maybe' });
    store().setDraft(CONV, 'first');
    await store().submitTurn(CONV);

    expect(store().bridgePhase).toBe('error');
    expect(store().bridgeError).toBeTruthy();
    expect(conv().runs[RUN_A].phase).toBe('failed');
  });

  it('rejects an admission that names another run', async () => {
    hydrateReady();
    uuidQueue = [RUN_A];
    mockRunGolemTurn.mockResolvedValueOnce(admissionPayload(RUN_B));
    store().setDraft(CONV, 'first');
    await store().submitTurn(CONV);

    expect(store().bridgePhase).toBe('error');
    expect(conv().runs[RUN_A].phase).toBe('failed');
    expect(conv().runs[RUN_B]).toBeUndefined();
  });

  it('records lastFailedTurn from a terminal run.failed with a known request', async () => {
    hydrateReady();
    uuidQueue = [RUN_A];
    store().setDraft(CONV, 'first');
    await store().submitTurn(CONV);
    store().ingestEvent(
      eventPayload({ seq: 1, type: 'run.failed', payload: { code: 'run_failed', message: 'boom' } })
    );
    expect(conv().lastFailedTurn).toEqual({
      draft: { message: 'first', contextRefs: [] },
      userEntryId: conv().runs[RUN_A].userEntryId,
    });
  });

  it('leaves a status-hydrated run without prompt metadata or an enabled retry', async () => {
    store().hydrateStatus(
      parseGolemStatus(
        statusPayload({
          activeRuns: [
            { identity: runIdentity(RUN_A), workspaceLabel: 'Frontend', state: 'running' },
          ],
        })
      )
    );
    store().ingestEvent(
      eventPayload({ seq: 1, type: 'run.failed', payload: { code: 'run_failed', message: 'boom' } })
    );
    expect(conv().lastFailedTurn).toBeNull();

    mockRunGolemTurn.mockClear();
    await store().retryLastFailed(CONV);
    expect(mockRunGolemTurn).not.toHaveBeenCalled();
  });

  it('retries with a fresh run ID and reuses the original user row', async () => {
    hydrateReady();
    uuidQueue = [RUN_A];
    store().setDraft(CONV, 'first');
    await store().submitTurn(CONV);
    store().ingestEvent(
      eventPayload({ seq: 1, type: 'run.failed', payload: { code: 'run_failed', message: 'boom' } })
    );
    const userEntryId = conv().runs[RUN_A].userEntryId!;

    uuidQueue = [RUN_B];
    mockRunGolemTurn.mockClear();
    await store().retryLastFailed(CONV);

    expect(mockRunGolemTurn).toHaveBeenCalledTimes(1);
    expect((mockRunGolemTurn.mock.calls[0][0] as ai.TurnRequest).identity.runId).toBe(RUN_B);
    const userRows = conv().transcript.filter((e) => e.kind === 'user');
    expect(userRows).toHaveLength(1);
    expect(userRows[0].id).toBe(userEntryId);
    expect(userRows[0].runId).toBe(RUN_B);
    expect(conv().runs[RUN_B].userEntryId).toBe(userEntryId);
    expect(conv().lastFailedTurn).toBeNull();
    expect(store().runToConversation[RUN_B]).toBe(CONV);
  });
});

describe('cancel', () => {
  it('cancels a background run with its own identity and stays canceling until terminal', () => {
    const backgroundIdentity = {
      repoEpoch: EPOCH - 1,
      workspaceId: OTHER_WS,
      conversationId: OTHER_CONV,
      runId: RUN_C,
    };
    store().hydrateStatus(
      parseGolemStatus(
        statusPayload({
          activeRuns: [
            {
              identity: backgroundIdentity,
              workspaceLabel: 'Backend (previous)',
              state: 'running',
            },
          ],
        })
      )
    );

    void store().cancelRun(RUN_C);
    const sent = mockCancelGolemRun.mock.calls[0][0] as ai.RunIdentity;
    expect({ ...sent }).toEqual(backgroundIdentity);
    expect(conv(OTHER_CONV).runs[RUN_C].phase).toBe('canceling');

    store().ingestEvent(
      eventPayload({
        threadId: OTHER_CONV,
        runId: RUN_C,
        seq: 1,
        type: 'run.canceled',
        payload: {},
      })
    );
    expect(conv(OTHER_CONV).runs[RUN_C].phase).toBe('canceled');
    expect(conv(OTHER_CONV).activeRunId).toBeNull();
  });

  it('ignores cancel for an unknown or already terminal run', async () => {
    hydrateReady();
    await store().cancelRun(RUN_C);
    expect(mockCancelGolemRun).not.toHaveBeenCalled();

    uuidQueue = [RUN_A];
    store().setDraft(CONV, 'first');
    await store().submitTurn(CONV);
    store().ingestEvent(
      eventPayload({
        seq: 1,
        type: 'run.finished',
        payload: { stopReason: 'end_turn', model: 'm' },
      })
    );
    await store().cancelRun(RUN_A);
    expect(mockCancelGolemRun).not.toHaveBeenCalled();
  });

  it('restores the run and reports a bounded error when Cancel is rejected', async () => {
    hydrateReady();
    uuidQueue = [RUN_A];
    store().setDraft(CONV, 'first');
    await store().submitTurn(CONV);
    mockCancelGolemRun.mockRejectedValueOnce('The Golem request is invalid or stale.');

    await store().cancelRun(RUN_A);

    expect(conv().runs[RUN_A].phase).toBe('running');
    expect(
      conv()
        .transcript.filter((e) => e.kind === 'error')
        .pop()!.text
    ).toBe('The Golem request is invalid or stale.');
  });
});

describe('activity and failure revisions', () => {
  it('advances activity on running and canceling and failure on run failure', async () => {
    hydrateReady();
    uuidQueue = [RUN_A];
    store().setDraft(CONV, 'first');
    await store().submitTurn(CONV);
    expect(store().lastActiveConversationId).toBe(CONV);
    const afterRunning = store().activityRevision;
    expect(afterRunning).toBeGreaterThan(0);

    void store().cancelRun(RUN_A);
    expect(store().activityRevision).toBeGreaterThan(afterRunning);

    const beforeFailure = store().failureRevision;
    store().ingestEvent(
      eventPayload({ seq: 1, type: 'run.failed', payload: { code: 'run_failed', message: 'boom' } })
    );
    expect(store().failureRevision).toBeGreaterThan(beforeFailure);
    expect(store().lastFailureConversationId).toBe(CONV);
  });

  it('keeps an older failure visible when newer activity happens elsewhere', async () => {
    hydrateReady();
    uuidQueue = [RUN_A];
    store().setDraft(CONV, 'first');
    await store().submitTurn(CONV);
    store().ingestEvent(
      eventPayload({ seq: 1, type: 'run.failed', payload: { code: 'run_failed', message: 'boom' } })
    );
    const failureRevision = store().failureRevision;

    store().hydrateStatus(
      parseGolemStatus(
        statusPayload({
          identity: { ...identity, workspaceId: OTHER_WS, conversationId: OTHER_CONV },
        })
      )
    );
    store().selectConversation(OTHER_CONV);
    uuidQueue = [RUN_B];
    store().setDraft(OTHER_CONV, 'other');
    await store().submitTurn(OTHER_CONV);

    expect(store().lastActiveConversationId).toBe(OTHER_CONV);
    expect(store().lastFailureConversationId).toBe(CONV);
    expect(store().failureRevision).toBe(failureRevision);
  });

  it('advances the failure revision when a newly hydrated status is degraded', () => {
    hydrateReady();
    const before = store().failureRevision;
    hydrateReady({ available: false, initError: 'Remote consent storage is unavailable.' });
    expect(store().failureRevision).toBeGreaterThan(before);
    expect(store().lastFailureConversationId).toBe(CONV);

    const settled = store().failureRevision;
    hydrateReady({ available: false, initError: 'Remote consent storage is unavailable.' });
    expect(store().failureRevision).toBe(settled);
  });
});

describe('monotonicity under deferred promises', () => {
  it('does not let a late accepted admission resurrect a terminal run or redispatch the queue', async () => {
    hydrateReady();
    uuidQueue = [RUN_A];
    const gate = deferred<unknown>();
    mockRunGolemTurn.mockReturnValueOnce(gate.promise);
    store().setDraft(CONV, 'first');
    const pending = store().submitTurn(CONV);
    store().setDraft(CONV, 'second');
    await store().submitTurn(CONV);

    uuidQueue = [RUN_B];
    store().ingestEvent(eventPayload({ seq: 1, type: 'run.started' }));
    store().ingestEvent(
      eventPayload({
        seq: 2,
        type: 'run.finished',
        payload: { stopReason: 'end_turn', model: 'm' },
      })
    );
    await flush();
    const callsAfterDispatch = mockRunGolemTurn.mock.calls.length;
    expect(conv().activeRunId).toBe(RUN_B);

    gate.resolve(admissionPayload(RUN_A));
    await pending;

    expect(conv().runs[RUN_A].phase).toBe('done');
    expect(conv().activeRunId).toBe(RUN_B);
    expect(mockRunGolemTurn.mock.calls).toHaveLength(callsAfterDispatch);
    expect(conv().queuedTurns).toHaveLength(0);
  });

  it('preserves the terminal tombstone when an active status snapshot resolves late', async () => {
    hydrateReady();
    uuidQueue = [RUN_A];
    store().setDraft(CONV, 'first');
    await store().submitTurn(CONV);
    store().setDraft(CONV, 'second');
    await store().submitTurn(CONV);

    uuidQueue = [RUN_B];
    store().ingestEvent(
      eventPayload({
        seq: 1,
        type: 'run.finished',
        payload: { stopReason: 'end_turn', model: 'm' },
      })
    );
    await flush();
    const callsAfterDispatch = mockRunGolemTurn.mock.calls.length;

    // A GetGolemStatus snapshot captured before the terminal now resolves.
    store().hydrateStatus(
      parseGolemStatus(
        statusPayload({
          activeRuns: [
            { identity: runIdentity(RUN_A), workspaceLabel: 'Frontend', state: 'running' },
          ],
        })
      )
    );
    await flush();

    expect(conv().runs[RUN_A].phase).toBe('done');
    expect(conv().activeRunId).toBe(RUN_B);
    expect(mockRunGolemTurn.mock.calls).toHaveLength(callsAfterDispatch);
  });
});

// Type-level guard: the declared union stays discriminated, so consumers cannot
// read a challenge off an accepted admission.
it('keeps TurnAdmission discriminated by state', () => {
  const admission: TurnAdmission = parseTurnAdmission(admissionPayload(RUN_A));
  if (admission.state === 'accepted') {
    expect(admission.consentChallenge).toBeUndefined();
  }
  const status: GolemStatus = parseGolemStatus(statusPayload());
  expect(status.identity.conversationId).toBe(CONV);
});
