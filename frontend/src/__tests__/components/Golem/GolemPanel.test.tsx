/**
 * Task B8 — the Golem conversation view.
 *
 * TDD: written before `components/Golem/GolemPanel.tsx` exists.
 *
 * Everything the panel shows is read from `golemStore`, so these tests drive
 * the store the way the bridge does — status hydration, streamed events, run
 * status — and assert only on what a user (or a screen reader) can perceive.
 */

import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { GolemPanel } from '../../../components/Golem';
import { __resetGolemStore, useGolemStore } from '../../../stores/golemStore';
import { useIDEStore } from '../../../stores/ideStore';
import { parseGolemStatus } from '../../../types/golem';

const mockRunGolemTurn = jest.fn();
const mockCancelGolemRun = jest.fn();

jest.mock('../../../../wailsjs/go/main/App', () => ({
  RunGolemTurn: (...args: unknown[]) => mockRunGolemTurn(...args),
  CancelGolemRun: (...args: unknown[]) => mockCancelGolemRun(...args),
}));

// ── fixtures ──────────────────────────────────────────────────────────────────

const EPOCH = 7;
const WS = 'frontend';
const CONV = 'conv-frontend';
const OTHER_WS = 'backend';
const OTHER_CONV = 'conv-backend';
const RUN_A = '11111111-1111-4111-8111-111111111111';
const RUN_B = '22222222-2222-4222-8222-222222222222';
const RUN_BG = '33333333-3333-4333-8333-333333333333';

const identity = { repoEpoch: EPOCH, workspaceId: WS, conversationId: CONV };
const runIdentity = (runId: string, over: Partial<typeof identity> = {}) => ({
  ...identity,
  ...over,
  runId,
});

const remoteDestination = {
  provider: 'anthropic',
  model: 'claude-opus',
  endpoint: 'https://api.example.test/v1',
  classification: 'remote' as const,
  digest: 'digest-remote',
};
const localDestination = {
  provider: 'ollama',
  model: 'qwen3',
  endpoint: 'http://127.0.0.1:11434',
  classification: 'local' as const,
  digest: 'digest-local',
};

const challengeFor = (runId: string) => ({
  id: 'challenge-1',
  identity: runIdentity(runId),
  destination: remoteDestination,
  destinationDigest: remoteDestination.digest,
  expiresAt: Date.now() + 5 * 60_000,
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

const acceptedAdmission = (runId: string) => ({
  state: 'accepted',
  identity: runIdentity(runId),
  destination: localDestination,
  context: { included: 0, bytes: 0, excluded: 0 },
});

const consentAdmission = (runId: string) => ({
  state: 'needs_consent',
  identity: runIdentity(runId),
  destination: remoteDestination,
  context: { included: 0, bytes: 0, excluded: 0 },
  consentChallenge: challengeFor(runId),
});

const eventPayload = (over: Record<string, unknown> = {}) => ({
  protocol: 1,
  threadId: CONV,
  runId: RUN_A,
  seq: 1,
  type: 'run.started',
  payload: {},
  raw: '{}',
  ...over,
});

// ── crypto ────────────────────────────────────────────────────────────────────

let uuidQueue: string[] = [];
const originalCrypto = Object.getOwnPropertyDescriptor(globalThis, 'crypto');

beforeAll(() => {
  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    writable: true,
    value: {
      randomUUID: () => {
        const next = uuidQueue.shift();
        if (!next) throw new Error('test exhausted the queued UUIDs');
        return next;
      },
    },
  });
});

afterAll(() => {
  if (originalCrypto) Object.defineProperty(globalThis, 'crypto', originalCrypto);
});

// ── harness ───────────────────────────────────────────────────────────────────

const store = () => useGolemStore.getState();

const hydrate = (over: Record<string, unknown> = {}) => {
  act(() => {
    store().hydrateStatus(parseGolemStatus(statusPayload(over)));
  });
};

const selectFocused = () => {
  act(() => {
    store().selectConversation(CONV);
  });
};

const composer = () => screen.getByRole('textbox', { name: /message golem/i });
const sendButton = () => screen.getByRole('button', { name: 'Send' });
const liveRegion = (): HTMLElement => {
  const region = document.querySelector('[aria-live="polite"]');
  if (!(region instanceof HTMLElement)) throw new Error('no polite live region');
  return region;
};

const type = (value: string) => {
  fireEvent.change(composer(), { target: { value } });
};

const pressEnter = (over: Record<string, unknown> = {}) => {
  fireEvent.keyDown(composer(), { key: 'Enter', ...over });
};

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
  });
};

beforeEach(() => {
  __resetGolemStore();
  useIDEStore.setState(useIDEStore.getInitialState());
  jest.clearAllMocks();
  uuidQueue = [RUN_A, RUN_B];
  mockRunGolemTurn.mockResolvedValue(acceptedAdmission(RUN_A));
  mockCancelGolemRun.mockResolvedValue(undefined);
});

// ── identity and destination ──────────────────────────────────────────────────

describe('GolemPanel destination', () => {
  it('shows the backend workspace label, classification, provider, model, and endpoint', () => {
    hydrate();
    selectFocused();
    render(<GolemPanel />);

    expect(screen.getByText('Frontend')).toBeInTheDocument();
    expect(screen.getByText('Local')).toBeInTheDocument();
    expect(screen.getByText('ollama')).toBeInTheDocument();
    expect(screen.getByText('qwen3')).toBeInTheDocument();
    expect(screen.getByText('http://127.0.0.1:11434')).toBeInTheDocument();
  });

  it('classifies a remote destination as Remote', () => {
    hydrate({ destination: remoteDestination });
    selectFocused();
    render(<GolemPanel />);

    expect(screen.getByText('Remote')).toBeInTheDocument();
    expect(screen.queryByText('Local')).not.toBeInTheDocument();
  });

  it('states the fixed Phase 1 context scope', () => {
    hydrate();
    selectFocused();
    render(<GolemPanel />);

    expect(screen.getByText('Context: prompt only')).toBeInTheDocument();
  });
});

// ── blocked states ────────────────────────────────────────────────────────────

describe('GolemPanel blocked states', () => {
  it('sends when nothing blocks the conversation', () => {
    hydrate();
    selectFocused();
    render(<GolemPanel />);
    type('hello');

    expect(sendButton()).toBeEnabled();
  });

  it('reports no workspace and disables send', () => {
    render(<GolemPanel />);

    expect(screen.getByText('Open a workspace to chat with Golem.')).toBeInTheDocument();
    expect(sendButton()).toBeDisabled();
  });

  it('reports a binding still in flight and disables send', () => {
    hydrate();
    selectFocused();
    render(<GolemPanel />);
    type('hello');
    act(() => {
      useGolemStore.setState({ bridgePhase: 'binding' });
    });

    expect(screen.getByText('Connecting to Golem…')).toBeInTheDocument();
    expect(sendButton()).toBeDisabled();
  });

  it('reports a stale hydration and disables send', () => {
    hydrate();
    hydrate({
      identity: { repoEpoch: EPOCH, workspaceId: OTHER_WS, conversationId: OTHER_CONV },
      workspaceLabel: 'Backend',
    });
    selectFocused();
    render(<GolemPanel />);
    type('hello');

    expect(screen.getByText('This workspace is no longer open.')).toBeInTheDocument();
    expect(sendButton()).toBeDisabled();
  });

  it('reports an unavailable backend and disables send', () => {
    hydrate({ available: false });
    selectFocused();
    render(<GolemPanel />);
    type('hello');

    expect(screen.getByText('Golem is unavailable in this workspace.')).toBeInTheDocument();
    expect(sendButton()).toBeDisabled();
  });

  it('renders config, policy, and consent warnings inline rather than only as a toast', () => {
    hydrate({
      available: false,
      needsConsent: true,
      warnings: ['Policy blocks remote providers.', 'No API key is configured.'],
      initError: 'golem.yaml could not be read.',
    });
    selectFocused();
    const { container } = render(<GolemPanel />);

    expect(within(container).getByText('Policy blocks remote providers.')).toBeInTheDocument();
    expect(within(container).getByText('No API key is configured.')).toBeInTheDocument();
    expect(within(container).getByText('golem.yaml could not be read.')).toBeInTheDocument();
  });

  it('prefers the backend init error over the generic unavailable copy', () => {
    hydrate({ available: false, initError: 'golem.yaml could not be read.' });
    selectFocused();
    render(<GolemPanel />);

    expect(screen.queryByText('Golem is unavailable in this workspace.')).not.toBeInTheDocument();
    expect(screen.getByText('golem.yaml could not be read.')).toBeInTheDocument();
  });

  it('blocks Enter while a state notice is showing', () => {
    hydrate({ available: false });
    selectFocused();
    render(<GolemPanel />);

    type('hello');
    pressEnter();

    expect(mockRunGolemTurn).not.toHaveBeenCalled();
  });
});

// ── composer ──────────────────────────────────────────────────────────────────

describe('GolemPanel composer', () => {
  beforeEach(() => {
    hydrate();
    selectFocused();
  });

  it('sends on Enter and stages the prompt visibly while clearing the draft', async () => {
    render(<GolemPanel />);

    type('hello there');
    pressEnter();
    await flush();

    expect(mockRunGolemTurn).toHaveBeenCalledTimes(1);
    expect(mockRunGolemTurn.mock.calls[0][0]).toMatchObject({
      identity: runIdentity(RUN_A),
      message: 'hello there',
      consentChallengeId: '',
    });
    expect(composer()).toHaveValue('');
    expect(screen.getByText('hello there')).toBeInTheDocument();
  });

  it('leaves Shift+Enter to the textarea so it inserts a newline', () => {
    render(<GolemPanel />);

    type('first line');
    const event = fireEvent.keyDown(composer(), {
      key: 'Enter',
      shiftKey: true,
      cancelable: true,
    });

    expect(mockRunGolemTurn).not.toHaveBeenCalled();
    // Not prevented: the textarea's own newline insertion must still happen.
    expect(event).toBe(true);
    expect(composer()).toHaveValue('first line');
  });

  it('disables send for a blank or whitespace-only draft', () => {
    render(<GolemPanel />);

    expect(sendButton()).toBeDisabled();
    type('   ');
    expect(sendButton()).toBeDisabled();
    pressEnter();
    expect(mockRunGolemTurn).not.toHaveBeenCalled();

    type('real');
    expect(sendButton()).toBeEnabled();
  });

  it('does not send an Enter that is committing an IME composition, but does send the next one', async () => {
    render(<GolemPanel />);

    type('こんにちは');
    // `isComposing` is on the native event; the key is identical either way.
    fireEvent.keyDown(composer(), { key: 'Enter', isComposing: true });
    await flush();

    expect(mockRunGolemTurn).not.toHaveBeenCalled();

    pressEnter();
    await flush();

    expect(mockRunGolemTurn).toHaveBeenCalledTimes(1);
  });

  it('sends from the Send button too', async () => {
    render(<GolemPanel />);

    type('via button');
    fireEvent.click(sendButton());
    await flush();

    expect(mockRunGolemTurn).toHaveBeenCalledTimes(1);
  });
});

// ── draft durability ──────────────────────────────────────────────────────────

describe('GolemPanel draft', () => {
  it('survives an unmount, which is what collapsing the panel or showing Runs does', () => {
    hydrate();
    selectFocused();
    const { unmount } = render(<GolemPanel />);

    type('half-written thought');
    unmount();
    render(<GolemPanel />);

    expect(composer()).toHaveValue('half-written thought');
  });

  it('survives a workspace change and stays attached to its own conversation', () => {
    hydrate();
    hydrate({
      identity: { repoEpoch: EPOCH, workspaceId: OTHER_WS, conversationId: OTHER_CONV },
      workspaceLabel: 'Backend',
    });
    selectFocused();
    render(<GolemPanel />);
    type('frontend draft');

    act(() => {
      store().selectConversation(OTHER_CONV);
    });
    expect(composer()).toHaveValue('');

    act(() => {
      store().selectConversation(CONV);
    });
    expect(composer()).toHaveValue('frontend draft');
  });
});

// ── queue ─────────────────────────────────────────────────────────────────────

describe('GolemPanel queue', () => {
  const startBusyRun = async () => {
    hydrate();
    selectFocused();
    mockRunGolemTurn.mockReturnValue(new Promise(() => {}));
    render(<GolemPanel />);
    type('first');
    pressEnter();
    await flush();
  };

  it('queues a send made while a run is busy and keeps it editable and removable', async () => {
    await startBusyRun();

    type('second');
    pressEnter();
    await flush();

    const queued = screen.getByRole('textbox', { name: /queued message/i });
    expect(queued).toHaveValue('second');
    expect(composer()).toHaveValue('');
    // Only the first turn reached the backend.
    expect(mockRunGolemTurn).toHaveBeenCalledTimes(1);

    fireEvent.change(queued, { target: { value: 'second, edited' } });
    expect(store().conversations[CONV].queuedTurns[0].message).toBe('second, edited');

    fireEvent.click(screen.getByRole('button', { name: /remove queued message/i }));
    expect(store().conversations[CONV].queuedTurns).toHaveLength(0);
    expect(screen.queryByRole('textbox', { name: /queued message/i })).not.toBeInTheDocument();
  });
});

// ── consent ───────────────────────────────────────────────────────────────────

describe('GolemPanel consent', () => {
  const askConsent = async () => {
    hydrate({ destination: remoteDestination });
    selectFocused();
    mockRunGolemTurn.mockResolvedValueOnce(consentAdmission(RUN_A));
    render(<GolemPanel />);
    type('send this remotely');
    pressEnter();
    await flush();
  };

  it('shows the real destination and both choices', async () => {
    await askConsent();

    const shelf = screen.getByRole('group', { name: /approval/i });
    expect(within(shelf).getByText('anthropic')).toBeInTheDocument();
    expect(within(shelf).getByText('claude-opus')).toBeInTheDocument();
    expect(within(shelf).getByText('https://api.example.test/v1')).toBeInTheDocument();
    expect(within(shelf).getByRole('button', { name: 'Allow & send' })).toBeInTheDocument();
    expect(within(shelf).getByRole('button', { name: 'Not now' })).toBeInTheDocument();
  });

  it('allowing retries the same turn once with the opaque challenge id', async () => {
    await askConsent();
    mockRunGolemTurn.mockResolvedValue(acceptedAdmission(RUN_A));

    fireEvent.click(screen.getByRole('button', { name: 'Allow & send' }));
    await flush();

    expect(mockRunGolemTurn).toHaveBeenCalledTimes(2);
    expect(mockRunGolemTurn.mock.calls[1][0]).toMatchObject({
      identity: runIdentity(RUN_A),
      message: 'send this remotely',
      consentChallengeId: 'challenge-1',
    });
    expect(store().conversations[CONV].pendingConsentTurn).toBeNull();
  });

  it('declining cancels the pending run identity', async () => {
    await askConsent();

    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    await flush();

    expect(mockCancelGolemRun).toHaveBeenCalledTimes(1);
    expect(mockCancelGolemRun.mock.calls[0][0]).toMatchObject(runIdentity(RUN_A));
    // No second turn: declining must not smuggle the prompt out.
    expect(mockRunGolemTurn).toHaveBeenCalledTimes(1);
  });

  it('announces the shelf once rather than on every render', async () => {
    await askConsent();

    const announced = liveRegion().textContent;
    expect(announced).toMatch(/approval/i);
    expect(announced).toContain('anthropic');

    // A re-render that changes nothing about the challenge must not re-announce,
    // which for a polite region means the text must not change.
    type('unrelated keystrokes');
    expect(liveRegion().textContent).toBe(announced);
    expect(document.querySelectorAll('[aria-live]')).toHaveLength(1);
  });
});

// ── transcript and announcements ──────────────────────────────────────────────

describe('GolemPanel transcript', () => {
  const startRun = async () => {
    hydrate();
    selectFocused();
    render(<GolemPanel />);
    type('what is up');
    pressEnter();
    await flush();
  };

  const delta = (text: string, seq: number) =>
    act(() => {
      store().ingestEvent(
        eventPayload({ seq, type: 'message.delta', payload: { messageId: 'm1', text } })
      );
    });

  it('renders assistant markup as literal text', async () => {
    await startRun();

    delta('<b>x</b>', 2);

    // getByText is the guard: an innerHTML render would show a bold "x" whose
    // text content is "x", and this query would find nothing.
    expect(screen.getByText('<b>x</b>')).toBeInTheDocument();
    expect(screen.getByText('<b>x</b>').querySelector('b')).toBeNull();
  });

  it('keeps exactly one polite live region that stays silent through deltas', async () => {
    await startRun();

    expect(document.querySelectorAll('[aria-live]')).toHaveLength(1);
    expect(liveRegion().textContent).toBe('');

    delta('par', 2);
    delta('tial', 3);

    expect(liveRegion().textContent).toBe('');
    expect(screen.getByText('partial')).toBeInTheDocument();
  });

  it('announces a completed message when the run finishes', async () => {
    await startRun();
    delta('all done now', 2);

    act(() => {
      store().ingestEvent(eventPayload({ seq: 3, type: 'run.finished', payload: {} }));
    });

    expect(liveRegion()).toHaveTextContent('all done now');
  });

  it('announces a failure transition', async () => {
    await startRun();

    act(() => {
      store().ingestEvent(
        eventPayload({ seq: 2, type: 'run.failed', payload: { message: 'the provider refused' } })
      );
    });

    expect(liveRegion()).toHaveTextContent(/the provider refused/);
  });

  it('announces a cancellation transition', async () => {
    await startRun();

    act(() => {
      store().ingestRunStatus({ identity: runIdentity(RUN_A), state: 'canceled' });
    });

    expect(liveRegion()).toHaveTextContent(/cancel/i);
  });
});

// ── focus ─────────────────────────────────────────────────────────────────────

describe('GolemPanel focus', () => {
  it('focuses the composer when the focus revision changes, but not on streamed events', async () => {
    hydrate();
    selectFocused();
    render(<GolemPanel />);

    type('draft');
    pressEnter();
    await flush();

    act(() => composer().blur());
    expect(document.activeElement).not.toBe(composer());

    act(() => {
      store().selectConversation(CONV);
    });
    expect(document.activeElement).toBe(composer());

    act(() => composer().blur());
    act(() => {
      store().ingestEvent(
        eventPayload({ seq: 2, type: 'message.delta', payload: { messageId: 'm1', text: 'hi' } })
      );
    });

    expect(document.activeElement).not.toBe(composer());
  });
});

// ── conversations and background runs ─────────────────────────────────────────

describe('GolemPanel conversations', () => {
  const withBackground = () => {
    hydrate({
      available: false,
      identity: { repoEpoch: EPOCH, workspaceId: OTHER_WS, conversationId: OTHER_CONV },
      workspaceLabel: 'Backend',
      initError: 'Backend Golem is misconfigured.',
    });
    hydrate({
      activeRuns: [
        {
          identity: { ...runIdentity(RUN_BG), workspaceId: 'infra', conversationId: 'conv-infra' },
          workspaceLabel: 'Infra',
          state: 'running',
        },
      ],
    });
    selectFocused();
  };

  it('lists the focused, background, and failed conversations', () => {
    withBackground();
    render(<GolemPanel />);

    const list = screen.getByRole('group', { name: /conversations/i });
    expect(within(list).getByRole('button', { name: /Frontend/ })).toBeInTheDocument();
    expect(within(list).getByRole('button', { name: /Backend/ })).toBeInTheDocument();
    expect(within(list).getByRole('button', { name: /Infra/ })).toBeInTheDocument();
  });

  it('selecting another conversation never changes the IDE workspace', () => {
    withBackground();
    useIDEStore.setState({ activeWorkspaceId: WS });
    render(<GolemPanel />);

    const list = screen.getByRole('group', { name: /conversations/i });
    fireEvent.click(within(list).getByRole('button', { name: /Backend/ }));

    expect(store().selectedConversationId).toBe(OTHER_CONV);
    expect(useIDEStore.getState().activeWorkspaceId).toBe(WS);
  });

  it('cancels a background run through that run own identity', async () => {
    withBackground();
    render(<GolemPanel />);

    fireEvent.click(screen.getByRole('button', { name: /cancel the golem run in infra/i }));
    await flush();

    expect(mockCancelGolemRun).toHaveBeenCalledTimes(1);
    expect(mockCancelGolemRun.mock.calls[0][0]).toMatchObject({
      repoEpoch: EPOCH,
      workspaceId: 'infra',
      conversationId: 'conv-infra',
      runId: RUN_BG,
    });
  });

  it('selects a background run by its own conversation, not the focused one', () => {
    withBackground();
    render(<GolemPanel />);

    fireEvent.click(screen.getByRole('button', { name: /show the golem run in infra/i }));

    expect(store().selectedConversationId).toBe('conv-infra');
    expect(useIDEStore.getState().activeWorkspaceId).toBe(
      useIDEStore.getInitialState().activeWorkspaceId
    );
  });
});

// ── cancel and retry ──────────────────────────────────────────────────────────

describe('GolemPanel cancel and retry', () => {
  it('offers Cancel as a real button while a run is live', async () => {
    hydrate();
    selectFocused();
    mockRunGolemTurn.mockReturnValue(new Promise(() => {}));
    render(<GolemPanel />);
    type('long one');
    pressEnter();
    await flush();

    const cancel = screen.getByRole('button', { name: /cancel the current golem run/i });
    expect(cancel.tagName).toBe('BUTTON');

    fireEvent.click(cancel);
    await flush();

    expect(mockCancelGolemRun).toHaveBeenCalledTimes(1);
    expect(mockCancelGolemRun.mock.calls[0][0]).toMatchObject(runIdentity(RUN_A));
  });

  it('offers Retry as a real button for a failed turn it still holds the request for', async () => {
    hydrate();
    selectFocused();
    render(<GolemPanel />);
    type('retry me');
    pressEnter();
    await flush();

    act(() => {
      store().ingestEvent(
        eventPayload({ seq: 2, type: 'run.failed', payload: { message: 'boom' } })
      );
    });

    const retry = screen.getByRole('button', { name: 'Retry' });
    expect(retry.tagName).toBe('BUTTON');

    mockRunGolemTurn.mockResolvedValue(acceptedAdmission(RUN_B));
    fireEvent.click(retry);
    await flush();

    expect(mockRunGolemTurn).toHaveBeenCalledTimes(2);
    expect(mockRunGolemTurn.mock.calls[1][0]).toMatchObject({
      identity: runIdentity(RUN_B),
      message: 'retry me',
    });
  });

  it('never offers Retry for a status-hydrated run it has no request for', () => {
    hydrate({
      activeRuns: [{ identity: runIdentity(RUN_BG), workspaceLabel: 'Frontend', state: 'running' }],
    });
    selectFocused();
    render(<GolemPanel />);

    act(() => {
      store().ingestRunStatus({
        identity: runIdentity(RUN_BG),
        state: 'failed',
        message: 'died in the background',
      });
    });

    // Surfaced (transcript row plus the announcement) but not retryable: the
    // store never captured a request for a run it only learned about by status.
    expect(screen.getAllByText(/died in the background/).length).toBeGreaterThan(0);
    expect(store().conversations[CONV].lastFailedTurn).toBeNull();
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
  });
});
