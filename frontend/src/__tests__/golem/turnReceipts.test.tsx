/**
 * #492 — each chat turn says which model it went to.
 *
 * Driven end to end: the real store reduces admissions and streamed events,
 * `buildGolemView` projects it, and the passive surface renders it, both as
 * the docked host passes it and as the undocked window receives it (through
 * JSON and `parseGolemView`).
 */

import { render, screen, within } from '@testing-library/react';
import { GolemSurface, type GolemSurfaceActions } from '../../components/Golem/GolemSurface';
import { buildGolemView } from '../../golem/projection';
import { __resetGolemStore, useGolemStore } from '../../stores/golemStore';
import { parseGolemStatus } from '../../types/golem';
import type { ProviderDestination } from '../../types/golem';
import { parseGolemView } from '../../types/golemWindow';
import type { GolemView } from '../../types/golemWindow';
import type { ai } from '../../wails/bindings';

const mockRunGolemTurn = jest.fn();

jest.mock('../../wails/bindings', () => {
  const actual = jest.requireActual('../../wails/bindings');
  return {
    ...actual,
    RunGolemTurn: (...args: unknown[]) => mockRunGolemTurn(...args),
    CancelGolemRun: jest.fn(() => Promise.resolve(true)),
    ResetGolemConversation: jest.fn(() => Promise.resolve()),
  };
});

const EPOCH = 7;
const CONV = 'conv-frontend';
const identity = { repoEpoch: EPOCH, workspaceId: 'frontend', conversationId: CONV };
const RUNS = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444',
];

const qwen: ProviderDestination = {
  provider: 'ollama',
  model: 'qwen3-coder',
  endpoint: 'http://127.0.0.1:11434',
  classification: 'local',
  digest: 'digest-ollama-local',
};
const llama: ProviderDestination = { ...qwen, model: 'llama3.3' };
const qwenElsewhere: ProviderDestination = {
  ...qwen,
  endpoint: 'http://127.0.0.1:11500',
  digest: 'digest-ollama-other',
};

let uuidQueue: string[] = [];
const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');
afterAll(() => {
  if (originalCrypto) Object.defineProperty(globalThis, 'crypto', originalCrypto);
});

const store = () => useGolemStore.getState();
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const hydrate = (destination: ProviderDestination, repoEpoch = EPOCH) => {
  store().hydrateStatus(
    parseGolemStatus({
      available: true,
      workspaceLabel: 'Frontend',
      identity: { ...identity, repoEpoch },
      destination,
      needsConsent: false,
      activeRuns: [],
    })
  );
  store().selectConversation(CONV);
};

const admit = (destination: ProviderDestination) => (request: ai.TurnRequest) =>
  Promise.resolve({
    state: 'accepted',
    identity: { ...request.identity },
    destination,
    context: { included: 0, bytes: 0, excluded: 0 },
  });

const event = (runId: string, seq: number, type: string, payload: unknown) =>
  store().ingestEvent({
    protocol: 1,
    threadId: CONV,
    runId,
    seq,
    type,
    payload,
    raw: JSON.stringify({ type }),
  });

/** Streams one answered run: started, one reply, finished naming `model`. */
const stream = (runId: string, answer: string, model: string) => {
  event(runId, 1, 'run.started', {});
  event(runId, 2, 'message.delta', { messageId: 'm', text: answer });
  event(runId, 3, 'run.finished', { stopReason: 'completed', model });
};

const wireModel = (d: ProviderDestination) => `${d.provider}/${d.model}`;

/** One whole turn admitted for `destination`, as a stub backend answers it. */
async function turn(runId: string, text: string, destination: ProviderDestination) {
  uuidQueue.push(runId);
  mockRunGolemTurn.mockImplementationOnce(admit(destination));
  expect(store().submitTurn(CONV, text)).toEqual({ ok: true });
  await flush();
  stream(runId, `answer to ${text}`, wireModel(destination));
}

const actions = (): GolemSurfaceActions => ({
  send: jest.fn(),
  allowAndSend: jest.fn(),
  cancelRun: jest.fn(),
  retry: jest.fn(),
  updateQueued: jest.fn(),
  removeQueued: jest.fn(),
  select: jest.fn(),
  clear: jest.fn(),
  openConfig: jest.fn(),
});

const docked = (): GolemView => buildGolemView(store());
const undocked = (): GolemView => parseGolemView(JSON.parse(JSON.stringify(docked())));

function show(view: GolemView) {
  return render(
    <GolemSurface
      view={view}
      draft=""
      onDraftChange={() => {}}
      actions={actions()}
      frozen={false}
      composerPending={false}
      focusRevision={0}
      visible
    />
  );
}

/** The transcript read top to bottom: each row's text, receipts marked. */
function transcriptLines(): string[] {
  const transcript = screen.getByRole('region', { name: 'Golem transcript' });
  return Array.from(transcript.children).map((row) =>
    // identity-obj-proxy maps the CSS module class to its own name.
    row.classList.contains('receipt') ? `receipt: ${row.textContent}` : (row.textContent ?? '')
  );
}

beforeEach(() => {
  __resetGolemStore();
  mockRunGolemTurn.mockReset();
  uuidQueue = [];
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    writable: true,
    value: { randomUUID: () => uuidQueue.shift() ?? 'exhausted' },
  });
});

it('labels the first turn and each change of model, keeping earlier labels', async () => {
  hydrate(qwen);
  await turn(RUNS[0], 'one', qwen);
  await turn(RUNS[1], 'two', qwen);
  await turn(RUNS[2], 'three', qwen);
  // A settings reload points chat at another model; a rebind follows.
  hydrate(llama);
  store().invalidateBinding();
  hydrate(llama, EPOCH + 1);
  await turn(RUNS[3], 'four', llama);

  const expected = [
    'one',
    'answer to one',
    'receipt: qwen3-coder via ollama',
    'two',
    'answer to two',
    'three',
    'answer to three',
    'four',
    'answer to four',
    'receipt: llama3.3 via ollama',
  ];
  const { unmount } = show(docked());
  expect(transcriptLines()).toEqual(expected);
  unmount();
  // The undocked window reads every line the same.
  show(undocked());
  expect(transcriptLines()).toEqual(expected);
});

it('labels the same provider and model again at a different endpoint', async () => {
  hydrate(qwen);
  await turn(RUNS[0], 'one', qwen);
  await turn(RUNS[1], 'two', qwenElsewhere);
  await turn(RUNS[2], 'three', qwenElsewhere);

  show(undocked());
  expect(transcriptLines()).toEqual([
    'one',
    'answer to one',
    'receipt: qwen3-coder via ollama',
    'two',
    'answer to two',
    'receipt: qwen3-coder via ollama',
    'three',
    'answer to three',
  ]);
});

it('keeps the model run.finished names beside the target the run was admitted for', async () => {
  hydrate(qwen);
  await turn(RUNS[0], 'one', qwen);

  const run = store().conversations[CONV].runs[RUNS[0]];
  expect(run.destination).toEqual(qwen);
  expect(run.model).toBe(wireModel(run.destination!));
});

it('labels a run whose events land before its admission result', async () => {
  hydrate(qwen);
  let resolve!: (value: unknown) => void;
  mockRunGolemTurn.mockImplementationOnce(
    (request: ai.TurnRequest) =>
      new Promise((res) => {
        resolve = () => res(admit(qwen)(request));
      })
  );
  uuidQueue.push(RUNS[0]);
  expect(store().submitTurn(CONV, 'one')).toEqual({ ok: true });
  stream(RUNS[0], 'answer to one', wireModel(qwen));
  expect(store().conversations[CONV].runs[RUNS[0]].phase).toBe('done');

  resolve(undefined);
  await flush();

  show(docked());
  expect(transcriptLines()).toEqual(['one', 'answer to one', 'receipt: qwen3-coder via ollama']);
});

it('gives failed and canceled turns no line, and does not count them', async () => {
  /** A turn admitted for llama that ends with `terminal` instead of an answer. */
  const unfinished = async (runId: string, text: string, terminal: string, payload: unknown) => {
    uuidQueue.push(runId);
    mockRunGolemTurn.mockImplementationOnce(admit(llama));
    expect(store().submitTurn(CONV, text)).toEqual({ ok: true });
    await flush();
    event(runId, 1, terminal, payload);
  };
  hydrate(qwen);
  await turn(RUNS[0], 'one', qwen);
  await unfinished(RUNS[1], 'two', 'run.failed', { code: 'provider', message: 'boom' });
  await unfinished(RUNS[2], 'three', 'run.canceled', {});
  // Had either llama turn counted as the previous one, this would be labelled.
  await turn(RUNS[3], 'four', qwen);

  show(docked());
  const receipts = transcriptLines().filter((line) => line.startsWith('receipt: '));
  expect(receipts).toEqual(['receipt: qwen3-coder via ollama']);
  expect(transcriptLines().indexOf(receipts[0])).toBe(2);
});

it('never puts a line in a live region or in the status announcement', async () => {
  hydrate(qwen);
  await turn(RUNS[0], 'one', qwen);

  show(undocked());
  const line = screen.getByText('qwen3-coder via ollama');
  expect(line.closest('[aria-live], [role="status"], [role="log"], [role="alert"]')).toBeNull();
  const status = screen.getByRole('status');
  expect(status).toHaveTextContent('answer to one');
  expect(within(status).queryByText(/via/)).toBeNull();
  // No endpoint or path reaches the line.
  expect(line.textContent).toBe('qwen3-coder via ollama');
  expect(screen.getByRole('region', { name: 'Golem transcript' })).not.toHaveTextContent(
    '127.0.0.1'
  );
});
