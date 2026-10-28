import fs from 'fs';
import path from 'path';
import {
  CAPABILITY_NAMES,
  GolemContractError,
  type CapabilityName,
  type ModelProjection,
  type ModelType,
} from '../../types/golem';
import {
  ACTIVE_PROFILE_KEY,
  affectedUseCases,
  buildApplyRequest,
  canApplyDraft,
  changeStableID,
  cleanDraft,
  draftChangeCount,
  effectiveRoutes,
  floorShortfalls,
  governedUseCasesOf,
  TYPE_DERIVED_CAPABILITIES,
  isDraftDirty,
  KeyVault,
  meetsUseCaseFloor,
  parseCancelSettingsApplyResult,
  parseConfirmSettingsApplyRequest,
  parseDestinationGrantsResult,
  parseGolemProfileListResult,
  parseGolemProfileLoadResult,
  parseGolemProfileSaveResult,
  parseSaveGolemProfileAsRequest,
  parseSettingsApplyRequest,
  parseSettingsApplyResult,
  probeRouteChange,
  projectDraft,
  providerUsage,
  readActiveProfile,
  recordApplyProvenance,
  replaceSource,
  replaceStagedChanges,
  retainsKeys,
  retargetOf,
  setTargetRevision,
  settleDraft,
  stageChange,
  stagedRoutes,
  unionFloor,
  unstageChange,
  USE_CASE_FLOORS,
  type ApplyMode,
  type Change,
  type ProjectedDraft,
  type DestinationGrantsStatus,
  type Draft,
  type DraftBaseProjection,
  type DraftEvent,
  type RouteChange,
  editReachFor,
  reachOf,
  withReach,
} from '../../types/golemConfig';

const corpusDir = path.resolve(
  __dirname,
  '../../../../internal/ai/testdata/settings_apply_contract'
);

type ApplyFixture = {
  verdict: 'accept' | 'reject';
  document: string;
  mode?: string;
  value: unknown;
};

const readFixture = (file: string): ApplyFixture =>
  JSON.parse(fs.readFileSync(path.join(corpusDir, file), 'utf8')) as ApplyFixture;

const fixtureMode = (fixture: ApplyFixture): ApplyMode => {
  if (fixture.mode !== 'apply' && fixture.mode !== 'create') {
    throw new GolemContractError();
  }
  return fixture.mode;
};

const checkFixture = (fixture: ApplyFixture): void => {
  switch (fixture.document) {
    case 'apply_request':
      parseSettingsApplyRequest(fixture.value, fixtureMode(fixture));
      return;
    case 'confirm_request':
      parseConfirmSettingsApplyRequest(fixture.value, fixtureMode(fixture));
      return;
    case 'apply_result':
      parseSettingsApplyResult(fixture.value);
      return;
    case 'cancel_result':
      parseCancelSettingsApplyResult(fixture.value);
      return;
    case 'profile_load_result':
      parseGolemProfileLoadResult(fixture.value);
      return;
    case 'profile_list_result':
      parseGolemProfileListResult(fixture.value);
      return;
    case 'profile_save_request':
      parseSaveGolemProfileAsRequest(fixture.value);
      return;
    case 'profile_save_result':
      parseGolemProfileSaveResult(fixture.value);
      return;
    default:
      throw new Error(`unknown document ${fixture.document}`);
  }
};

describe('apply contract corpus', () => {
  const files = fs.readdirSync(corpusDir).filter((file) => file.endsWith('.json'));

  it('corpus exists', () => {
    expect(files.length).toBeGreaterThanOrEqual(100);
  });

  it.each(files)('%s parses to its recorded verdict', (file) => {
    const fixture = readFixture(file);
    if (fixture.verdict !== 'accept' && fixture.verdict !== 'reject') {
      throw new Error(`${file}: unknown verdict ${JSON.stringify(fixture.verdict)}`);
    }
    if (fixture.verdict === 'accept') {
      expect(() => checkFixture(fixture)).not.toThrow();
    } else {
      expect(() => checkFixture(fixture)).toThrow(GolemContractError);
    }
  });
});

const minimalRequest = () =>
  readFixture('accept-apply-request-minimal.json').value as Record<string, unknown>;

describe('parseSettingsApplyRequest', () => {
  it('returns the decoded request', () => {
    const request = parseSettingsApplyRequest(minimalRequest(), 'apply');
    expect(request.source.kind).toBe('applied');
    expect(request.changes).toHaveLength(1);
    expect(request.changes[0].kind).toBe('route');
  });

  it('accepts an identifier at exactly 256 UTF-8 bytes and rejects 257', () => {
    const at = minimalRequest();
    at.changes = [{ kind: 'route-unassign', useCase: 'é'.repeat(128) }];
    expect(() => parseSettingsApplyRequest(at, 'apply')).not.toThrow();
    const over = minimalRequest();
    over.changes = [{ kind: 'route-unassign', useCase: `${'é'.repeat(128)}a` }];
    expect(() => parseSettingsApplyRequest(over, 'apply')).toThrow(GolemContractError);
  });

  it('requires targetRevision on apply and forbids it on create', () => {
    const request = minimalRequest();
    expect(() => parseSettingsApplyRequest(request, 'create')).toThrow(GolemContractError);
    delete request.targetRevision;
    expect(() => parseSettingsApplyRequest(request, 'apply')).toThrow(GolemContractError);
  });

  // An empty change set is source-conditional: only a profile source carries a
  // document of its own, so only it is a write with no staged mutation. The Go
  // validator applies the identical rule to byte-identical fixtures.
  it.each([
    ['applied', 'apply', { kind: 'applied' }, false],
    ['blank', 'create', { kind: 'blank' }, false],
    [
      'profile',
      'apply',
      { kind: 'profile', profileId: 'curated/local', sourceRevision: 'a'.repeat(64) },
      true,
    ],
    [
      'profile',
      'create',
      { kind: 'profile', profileId: 'curated/local', sourceRevision: 'a'.repeat(64) },
      true,
    ],
  ] as const)('%s source with no changes on %s', (_kind, mode, source, accepted) => {
    const request = minimalRequest();
    request.source = source;
    request.changes = [];
    request.keys = {};
    if (mode === 'create') delete request.targetRevision;
    const parse = () => parseSettingsApplyRequest(request, mode);
    if (accepted) expect(parse).not.toThrow();
    else expect(parse).toThrow(GolemContractError);
  });

  it('rejects the applied source on create', () => {
    const request = minimalRequest();
    delete request.targetRevision;
    expect(() => parseSettingsApplyRequest(request, 'create')).toThrow(GolemContractError);
    request.source = { kind: 'blank' };
    expect(() => parseSettingsApplyRequest(request, 'create')).not.toThrow();
  });

  it.each([
    ['an empty value', ''],
    ['an interpolation', '${OPENAI_API_KEY}'],
    ['an embedded interpolation', 'prefix-${X}'],
    ['a value over 4096 bytes', 'k'.repeat(4097)],
  ])('rejects a key with %s', (_name, value) => {
    const request = minimalRequest();
    request.changes = [{ kind: 'provider-key-set', name: 'hosted' }];
    request.keys = { hosted: value };
    expect(() => parseSettingsApplyRequest(request, 'apply')).toThrow(GolemContractError);
  });

  it('requires an exact 1:1 map between provider-key-set changes and keys', () => {
    const missingKey = minimalRequest();
    missingKey.changes = [{ kind: 'provider-key-set', name: 'hosted' }];
    expect(() => parseSettingsApplyRequest(missingKey, 'apply')).toThrow(GolemContractError);

    const strayKey = minimalRequest();
    strayKey.keys = { hosted: 'sk-literal-value' };
    expect(() => parseSettingsApplyRequest(strayKey, 'apply')).toThrow(GolemContractError);

    const paired = minimalRequest();
    paired.changes = [{ kind: 'provider-key-set', name: 'hosted' }];
    paired.keys = { hosted: 'sk-literal-value' };
    expect(() => parseSettingsApplyRequest(paired, 'apply')).not.toThrow();
  });

  it('rejects 257 changes and accepts 256', () => {
    const build = (count: number) => {
      const request = minimalRequest();
      request.changes = Array.from({ length: count }, (_, index) => ({
        kind: 'route-unassign',
        useCase: `u${index.toString().padStart(3, '0')}`,
      }));
      return request;
    };
    expect(() => parseSettingsApplyRequest(build(256), 'apply')).not.toThrow();
    expect(() => parseSettingsApplyRequest(build(257), 'apply')).toThrow(GolemContractError);
  });
});

describe('parseSettingsApplyResult', () => {
  it('rejects an unknown status', () => {
    expect(() => parseSettingsApplyResult({ status: 'queued' })).toThrow(GolemContractError);
  });

  it('rejects a member the status does not own', () => {
    expect(() => parseSettingsApplyResult({ status: 'busy', conflict: 'target' })).toThrow(
      GolemContractError
    );
  });

  it('returns the narrowed variant', () => {
    const result = parseSettingsApplyResult(
      readFixture('accept-result-consent-required.json').value
    );
    if (result.status !== 'consent_required') throw new Error('expected consent_required');
    expect(result.challenge.destinations[0].classification).toBe('remote');
  });
});

// ---------------------------------------------------------------------------
// The batch consent challenge (spec D8): every NEW remote destination one
// write would open, each with the routing hops that reach it. The rules mirror
// validateApplyChallenge in internal/ai/settings_apply_test.go one for one --
// the corpus replays them on the live seam, and these state them directly so a
// rule that loses its fixture still has an owner.
// ---------------------------------------------------------------------------

/** One rendered provenance hop: two bounded identifiers plus a fixed literal. */
const MAX_HOP_BYTES = 544;

const destination = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  provider: 'hosted',
  model: 'wire-model',
  endpoint: 'https://api.example.com/v1',
  classification: 'remote',
  provenance: ['agent'],
  ...over,
});

const challengeOf = (...destinations: unknown[]): Record<string, unknown> => ({
  token: 'opaque-challenge-token',
  expiresAt: 1767225600000,
  destinations,
});

const consentRequired = (challenge: unknown): unknown => ({
  status: 'consent_required',
  challenge,
});

/** Every way the batch can be malformed, stated once and asserted twice. */
const badChallenges: Array<[string, unknown]> = [
  ['no destinations at all', challengeOf()],
  [
    'a destination with no provenance key',
    challengeOf({
      provider: 'hosted',
      model: 'wire-model',
      endpoint: 'https://api.example.com/v1',
      classification: 'remote',
    }),
  ],
  ['an empty provenance', challengeOf(destination({ provenance: [] }))],
  ['an empty provenance hop', challengeOf(destination({ provenance: [''] }))],
  [
    'a provenance hop over the byte limit',
    challengeOf(destination({ provenance: ['a'.repeat(MAX_HOP_BYTES + 1)] })),
  ],
  ['a provenance hop carrying a format rune', challengeOf(destination({ provenance: ['agent‮'] }))],
  ['a local destination', challengeOf(destination({ classification: 'local' }))],
  ['an empty endpoint', challengeOf(destination({ endpoint: '' }))],
  ['an empty provider', challengeOf(destination({ provider: '' }))],
  ['an unknown destination member', challengeOf(destination({ apiKey: 'sk-leak' }))],
  ['257 destinations', challengeOf(...Array.from({ length: 257 }, () => destination()))],
];

describe('batch consent challenge', () => {
  it('parses every destination and keeps its provenance in order', () => {
    const result = parseSettingsApplyResult(
      consentRequired(
        challengeOf(
          destination(),
          destination({ model: '', provenance: ['agent', 'agent (recommendation)'] })
        )
      )
    );
    if (result.status !== 'consent_required') throw new Error('expected consent_required');
    expect(result.challenge.destinations).toHaveLength(2);
    expect(result.challenge.destinations[0]).toEqual({
      provider: 'hosted',
      model: 'wire-model',
      endpoint: 'https://api.example.com/v1',
      classification: 'remote',
      provenance: ['agent'],
    });
    // A recommendation entry names a provider and no model at all.
    expect(result.challenge.destinations[1].model).toBe('');
    expect(result.challenge.destinations[1].provenance).toEqual([
      'agent',
      'agent (recommendation)',
    ]);
  });

  it('accepts 256 destinations and a hop at exactly the byte limit', () => {
    const result = parseSettingsApplyResult(
      consentRequired(
        challengeOf(
          ...Array.from({ length: 255 }, () => destination()),
          destination({ provenance: ['a'.repeat(MAX_HOP_BYTES)] })
        )
      )
    );
    if (result.status !== 'consent_required') throw new Error('expected consent_required');
    expect(result.challenge.destinations).toHaveLength(256);
  });

  it.each(badChallenges)('rejects a challenge with %s', (_name, challenge) => {
    expect(() => parseSettingsApplyResult(consentRequired(challenge))).toThrow(GolemContractError);
  });

  it('rejects a challenge on a status that does not own one', () => {
    expect(() =>
      parseSettingsApplyResult({ status: 'busy', challenge: challengeOf(destination()) })
    ).toThrow(GolemContractError);
  });

  it('rejects consent_required with no challenge', () => {
    expect(() => parseSettingsApplyResult({ status: 'consent_required' })).toThrow(
      GolemContractError
    );
  });
});

// ---------------------------------------------------------------------------
// The grant-only result (spec D13): eight statuses, no projection, no
// diagnostics, and a challenge present iff the status is consent_required.
// ---------------------------------------------------------------------------

describe('parseDestinationGrantsResult', () => {
  const STATUSES: DestinationGrantsStatus[] = [
    'none',
    'consent_required',
    'granted',
    'uncertain',
    'conflict',
    'busy',
    'unavailable',
    'config_invalid',
  ];

  it.each(STATUSES)('accepts %s', (status) => {
    const value =
      status === 'consent_required'
        ? { status, challenge: challengeOf(destination()) }
        : { status };
    expect(parseDestinationGrantsResult(value).status).toBe(status);
  });

  it('returns the parsed challenge on consent_required', () => {
    const { status, challenge } = parseDestinationGrantsResult({
      status: 'consent_required',
      challenge: challengeOf(destination(), destination({ model: '' })),
    });
    expect(status).toBe('consent_required');
    if (challenge === undefined) throw new Error('expected a challenge');
    expect(challenge.destinations).toHaveLength(2);
    expect(challenge.token).toBe('opaque-challenge-token');
  });

  it('leaves the challenge absent on every other status', () => {
    expect(parseDestinationGrantsResult({ status: 'granted' }).challenge).toBeUndefined();
  });

  it('rejects a status outside the union', () => {
    expect(() => parseDestinationGrantsResult({ status: 'applied' })).toThrow(GolemContractError);
  });

  it('rejects consent_required with no challenge', () => {
    expect(() => parseDestinationGrantsResult({ status: 'consent_required' })).toThrow(
      GolemContractError
    );
  });

  it.each(STATUSES.filter((status) => status !== 'consent_required'))(
    'rejects a challenge carried by %s',
    (status) => {
      expect(() =>
        parseDestinationGrantsResult({ status, challenge: challengeOf(destination()) })
      ).toThrow(GolemContractError);
    }
  );

  it('rejects a member the result never owns', () => {
    expect(() =>
      parseDestinationGrantsResult({ status: 'granted', projection: { state: 'ready' } })
    ).toThrow(GolemContractError);
  });

  it.each(badChallenges)('rejects a consent_required challenge with %s', (_name, challenge) => {
    expect(() => parseDestinationGrantsResult({ status: 'consent_required', challenge })).toThrow(
      GolemContractError
    );
  });

  it('rejects a non-record', () => {
    expect(() => parseDestinationGrantsResult(null)).toThrow(GolemContractError);
  });
});

describe('parseCancelSettingsApplyResult', () => {
  it('accepts the single success variant', () => {
    expect(parseCancelSettingsApplyResult({ status: 'cancelled' }).status).toBe('cancelled');
  });
  it('rejects anything else', () => {
    expect(() => parseCancelSettingsApplyResult({ status: 'cancelling' })).toThrow(
      GolemContractError
    );
  });
});

describe('parseGolemProfileLoadResult', () => {
  it('returns the draft projection and its provenance', () => {
    const result = parseGolemProfileLoadResult(
      readFixture('accept-profile-load-loaded.json').value
    );
    if (result.status !== 'loaded') throw new Error('expected loaded');
    expect(result.profileId).toBe('curated/local');
    expect(result.projection.providers[0].credentialState).toBe('none');
  });
});

// ---------------------------------------------------------------------------
// Draft reducer, key lifecycle, and provenance
// ---------------------------------------------------------------------------

const REVISION_A = '0123456789abcdef'.repeat(4);

const appliedResult = () =>
  parseSettingsApplyResult(readFixture('accept-result-applied.json').value);
const resultEvent = (file: string): DraftEvent => ({
  kind: 'result',
  result: parseSettingsApplyResult(readFixture(file).value),
});

const vaultOf = (entries: readonly (readonly [string, string])[] = []): KeyVault =>
  new KeyVault(new Map(entries));

const routeChange = (over: Partial<RouteChange> = {}): RouteChange => ({
  kind: 'route',
  useCase: 'chat',
  modelFacts: { provider: 'hosted', model: 'gpt-5-mini', type: 'dense' },
  capabilityFacts: { caps: ['chat', 'stream'], knownCaps: [...CAPABILITY_NAMES] },
  exposedCaps: ['chat', 'stream'],
  thinkMode: '',
  confirmUnknown: false,
  ...over,
});

const modelRow = (over: Partial<ModelProjection> = {}): ModelProjection => ({
  role: 'chat-role',
  modelName: 'gpt-5-mini',
  provider: 'hosted',
  type: 'dense',
  effectiveCapabilities: ['chat', 'stream'],
  capabilityFacts: { caps: ['chat', 'stream'], knownCaps: [...CAPABILITY_NAMES] },
  exposedCapabilities: ['chat', 'stream'],
  thinkMode: '',
  routedUseCases: ['chat'],
  hasThinkTags: false,
  hasSlots: false,
  removable: false,
  ...over,
});

const emptyBase: DraftBaseProjection = { routes: [], models: [] };

const stage = (changes: readonly Change[], vault: KeyVault = vaultOf()): Draft =>
  changes.reduce((draft, change) => stageChange(draft, change, vault), cleanDraft(REVISION_A));

const selectorFields = (change: Change) => {
  if (change.kind !== 'route') throw new Error('expected a route change');
  return {
    exposedCaps: change.exposedCaps,
    capabilityFacts: change.capabilityFacts,
    thinkMode: change.thinkMode,
    confirmUnknown: change.confirmUnknown,
    confirmUnknownUseCases: change.confirmUnknownUseCases,
  };
};

describe('draft reducer', () => {
  it('replaces a restaged identity and keeps the newest values', () => {
    const draft = stage([routeChange({ thinkMode: 'auto' }), routeChange({ thinkMode: 'always' })]);
    expect(draft.changes).toHaveLength(1);
    expect(selectorFields(draft.changes[0]).thinkMode).toBe('always');
    expect(draftChangeCount(draft)).toBe(1);
  });

  it('treats a source replacement as dirty with no staged rows', () => {
    const clean = cleanDraft(REVISION_A);
    expect(isDraftDirty(clean)).toBe(false);
    expect(draftChangeCount(clean)).toBe(0);

    const profile = replaceSource(
      clean,
      { kind: 'profile', profileId: 'curated/local', sourceRevision: REVISION_A },
      vaultOf()
    );
    expect(isDraftDirty(profile)).toBe(true);
    expect(draftChangeCount(profile)).toBe(1);
    expect(draftChangeCount(stage([routeChange()], vaultOf()))).toBe(1);
  });

  it('keeps a provider add and its key set as independent identities', () => {
    const vault = vaultOf();
    vault.set('hosted', 'sk-literal');
    const draft = stage(
      [
        { kind: 'provider-add', name: 'hosted', endpoint: 'https://api.example.com' },
        { kind: 'provider-key-set', name: 'hosted' },
      ],
      vault
    );
    expect(draft.changes.map(changeStableID)).toEqual(['provider:hosted', 'provider-key:hosted']);
    expect(vault.has('hosted')).toBe(true);
  });

  it('evicts a staged key change and its vault entry when the provider is removed', () => {
    const vault = vaultOf();
    vault.set('hosted', 'sk-literal');
    const staged = stage([{ kind: 'provider-key-set', name: 'hosted' }], vault);
    const removed = stageChange(staged, { kind: 'provider-remove', name: 'hosted' }, vault);
    expect(removed.changes.map(changeStableID)).toEqual(['provider:hosted']);
    expect(vault.has('hosted')).toBe(false);
    expect(vault.extractForApply()).toEqual({});
  });

  it('adopts a reloaded revision while the retained changes stand', () => {
    const draft = setTargetRevision(
      stage([{ kind: 'route-unassign', useCase: 'chat' }]),
      'b'.repeat(64)
    );
    expect(draft.targetRevision).toBe('b'.repeat(64));
    expect(draft.changes).toHaveLength(1);
  });

  it('unstaging a key set drops its vault entry', () => {
    const vault = vaultOf();
    vault.set('hosted', 'sk-literal');
    const draft = unstageChange(
      stage([{ kind: 'provider-key-set', name: 'hosted' }], vault),
      'provider-key:hosted',
      vault
    );
    expect(draft.changes).toHaveLength(0);
    expect(vault.has('hosted')).toBe(false);
  });
});

describe('projected draft normalization', () => {
  it('coalesces selector-wide fields once across every staged route on one selector', () => {
    const draft = stage([
      routeChange({ useCase: 'chat', exposedCaps: ['chat'], thinkMode: 'auto' }),
      routeChange({ useCase: 'summarize', exposedCaps: ['chat', 'stream'], thinkMode: 'always' }),
    ]);
    const projected = projectDraft(emptyBase, draft);
    const [first, second] = projected.changes;
    expect(selectorFields(first)).toEqual(selectorFields(second));
    expect(selectorFields(first).exposedCaps).toEqual(['chat', 'stream']);
    expect(selectorFields(first).thinkMode).toBe('always');
  });

  it('replaces a staged change where it stands, so its selector group keeps its authority', () => {
    // summarize is staged last, so it is the group's authority (Think auto).
    // Restaging chat through stageChange would move it last and hand the group
    // chat's Think; replacing it in place must not.
    const draft = {
      ...stage([
        routeChange({ useCase: 'chat', thinkMode: 'always' }),
        routeChange({ useCase: 'summarize', thinkMode: 'auto' }),
      ]),
      needsReview: ['route:chat', 'route:summarize'],
    };
    const chat = draft.changes[0] as RouteChange;

    const next = replaceStagedChanges(draft, [{ ...chat, confirmDrops: ['think_tags'] }]);

    expect(next.changes.map(changeStableID)).toEqual(['route:chat', 'route:summarize']);
    expect((next.changes[0] as RouteChange).confirmDrops).toEqual(['think_tags']);
    expect(next.needsReview).toEqual(['route:summarize']);
    const [first, second] = projectDraft(emptyBase, next).changes;
    expect(selectorFields(first).thinkMode).toBe('auto');
    expect(selectorFields(second).thinkMode).toBe('auto');
  });

  it('leaves distinct selectors independent', () => {
    const draft = stage([
      routeChange({ useCase: 'chat', thinkMode: 'auto' }),
      routeChange({
        useCase: 'agent',
        modelFacts: { provider: 'hosted', model: 'gpt-5', type: 'dense' },
        exposedCaps: ['chat', 'stream', 'tool_call'],
        thinkMode: 'none',
      }),
    ]);
    const projected = projectDraft(emptyBase, draft);
    expect(selectorFields(projected.changes[0]).thinkMode).toBe('auto');
    expect(selectorFields(projected.changes[1]).thinkMode).toBe('none');
  });

  it('derives confirmUnknownUseCases as the sorted floorless union of the selector group', () => {
    const draft = stage([
      routeChange({ useCase: 'chat' }),
      routeChange({ useCase: 'summarize' }),
      routeChange({ useCase: 'briefing' }),
    ]);
    const projected = projectDraft(emptyBase, draft);
    for (const change of projected.changes) {
      expect(selectorFields(change).confirmUnknownUseCases).toEqual(['briefing', 'summarize']);
    }
  });

  it('omits confirmUnknownUseCases when every affected use case has a floor', () => {
    const draft = stage([routeChange({ useCase: 'chat' })]);
    const projected = projectDraft(emptyBase, draft);
    expect(projected.changes[0]).not.toHaveProperty('confirmUnknownUseCases');
  });

  it('widens the affected set to the use cases the current role already serves', () => {
    const base: DraftBaseProjection = {
      routes: [
        { useCase: 'chat', role: 'chat-role' },
        { useCase: 'summarize', role: 'chat-role' },
      ],
      models: [modelRow({ routedUseCases: ['chat', 'summarize'] })],
    };
    const projected = projectDraft(base, stage([routeChange({ useCase: 'chat' })]));
    expect(projected.selectorUseCases.get('chat')).toEqual(['chat', 'summarize']);
    expect(selectorFields(projected.changes[0]).confirmUnknownUseCases).toEqual(['summarize']);
    // An override sits on the selector the current role is on, so it governs
    // summarize too — every override that is actually staged is applied
    // through SetRoleOverrides, which gates every role on the selector (the
    // editor never stages one that changes nothing: #311); a fork onto a
    // selector nobody is on governs chat alone and summarize is
    // confirmation-only (the source role is left as it was).
    expect(projected.governedUseCases.get('chat')).toEqual(['chat', 'summarize']);
    const forked = projectDraft(
      base,
      stage([
        routeChange({
          useCase: 'chat',
          modelFacts: { provider: 'hosted', model: 'gpt-5', type: 'dense' },
        }),
      ])
    );
    expect(forked.selectorUseCases.get('chat')).toEqual(['chat', 'summarize']);
    expect(forked.governedUseCases.get('chat')).toEqual(['chat']);
  });

  it('marks a same-model sibling only when the override changes its model, inheriting Needs review', () => {
    const base: DraftBaseProjection = {
      routes: [
        { useCase: 'chat', role: 'chat-role' },
        { useCase: 'summarize', role: 'chat-role' },
      ],
      models: [modelRow({ routedUseCases: ['chat', 'summarize'] })],
    };
    // Identical exposure and Think: the override changes nothing on the model, so the
    // sibling is confirmation-only — acknowledged, never marked.
    const same = projectDraft(base, stage([routeChange({ useCase: 'chat' })]));
    expect(same.routeRows.get('chat')?.modified).toBe(true);
    expect(same.routeRows.has('summarize')).toBe(false);
    expect(same.selectorUseCases.get('chat')).toEqual(['chat', 'summarize']);
    // A real delta reaches the sibling, and it inherits the group's review state.
    const draft = stage([
      routeChange({ useCase: 'chat', exposedCaps: ['chat', 'stream', 'generate'] }),
    ]);
    expect(projectDraft(base, draft).routeRows.get('summarize')?.needsReview).toBe(false);
    // …through the real settle path: a conflict result marks the group for review.
    const conflicted = settleDraft(
      draft,
      {
        kind: 'result',
        result: { status: 'conflict', conflict: 'target', consentOutcome: 'unchanged' },
      },
      vaultOf()
    );
    const projected = projectDraft(base, conflicted);
    expect(projected.routeRows.get('chat')?.needsReview).toBe(true);
    expect(projected.routeRows.get('summarize')).toMatchObject({
      modified: true,
      needsReview: true,
    });
    expect(projected.routeReach.get('summarize')?.reach).toBe('same-model');
  });

  it('marks provider rows Modified and Key staged separately', () => {
    const vault = vaultOf([['hosted', 'sk-literal']]);
    const draft = stage(
      [
        { kind: 'provider-update', name: 'hosted', endpoint: 'https://api.example.com' },
        { kind: 'provider-key-set', name: 'hosted' },
        { kind: 'role-remove', role: 'orphan' },
      ],
      vault
    );
    const projected = projectDraft(emptyBase, draft);
    expect(projected.providerRows.get('hosted')).toEqual({
      modified: true,
      keyStaged: true,
      needsReview: false,
      affected: false,
    });
    expect(projected.roleRows.get('orphan')?.modified).toBe(true);
  });
});

describe('buildApplyRequest', () => {
  it('builds an exact 1:1 key map for staged key sets', () => {
    const vault = vaultOf([['hosted', 'sk-literal']]);
    const draft = stage([{ kind: 'provider-key-set', name: 'hosted' }], vault);
    const request = buildApplyRequest(emptyBase, draft, vault, 'apply');
    expect(request.keys).toEqual({ hosted: 'sk-literal' });
    expect(request.targetRevision).toBe(REVISION_A);
  });

  it('refuses a vault entry with no matching key-set change', () => {
    const vault = vaultOf([['hosted', 'sk-literal']]);
    const draft = stage([{ kind: 'route-unassign', useCase: 'chat' }]);
    expect(() => buildApplyRequest(emptyBase, draft, vault, 'apply')).toThrow(GolemContractError);
  });

  it('refuses a key-set change with no vault entry', () => {
    const vault = vaultOf();
    const draft = stage([{ kind: 'provider-key-set', name: 'hosted' }], vault);
    expect(() => buildApplyRequest(emptyBase, draft, vault, 'apply')).toThrow(GolemContractError);
  });

  it('sends the normalized selector-wide changes', () => {
    const vault = vaultOf();
    const draft = stage(
      [
        routeChange({ useCase: 'chat', exposedCaps: ['chat'] }),
        routeChange({ useCase: 'summarize', exposedCaps: ['chat', 'stream'] }),
      ],
      vault
    );
    const request = buildApplyRequest(emptyBase, draft, vault, 'apply');
    expect(selectorFields(request.changes[0])).toEqual(selectorFields(request.changes[1]));
  });

  it('omits targetRevision on create', () => {
    const vault = vaultOf();
    const draft = replaceSource(
      stage([routeChange({ useCase: 'agent' })], vault),
      { kind: 'blank' },
      vault
    );
    const request = buildApplyRequest(
      emptyBase,
      stageChange(draft, routeChange({ useCase: 'agent' }), vault),
      vault,
      'create'
    );
    expect(request).not.toHaveProperty('targetRevision');
    expect(request.source.kind).toBe('blank');
  });
});

describe('key lifecycle', () => {
  const keyedDraft = (vault: KeyVault): Draft => {
    vault.set('hosted', 'sk-literal');
    return stage(
      [
        { kind: 'provider-add', name: 'hosted', endpoint: 'https://api.example.com' },
        { kind: 'provider-key-set', name: 'hosted' },
      ],
      vault
    );
  };

  it.each([
    ['consent_required', () => resultEvent('accept-result-consent-required.json')],
    [
      'drop_confirmation_required',
      () => resultEvent('accept-result-drop-confirmation-required.json'),
    ],
    ['busy', (): DraftEvent => ({ kind: 'result', result: { status: 'busy' } })],
  ])('retains key refs across %s and extracts repeatably', (_name, build) => {
    const vault = vaultOf();
    const draft = keyedDraft(vault);
    const event = build();
    expect(retainsKeys(event)).toBe(true);
    const before = vault.extractForApply();
    const settled = settleDraft(draft, event, vault);
    expect(vault.extractForApply()).toEqual(before);
    expect(vault.extractForApply()).toEqual({ hosted: 'sk-literal' });
    expect(settled.changes.map(changeStableID)).toEqual(draft.changes.map(changeStableID));
    expect(buildApplyRequest(emptyBase, settled, vault, 'apply').keys).toEqual({
      hosted: 'sk-literal',
    });
  });

  it.each([
    ['applied', (): DraftEvent => ({ kind: 'result', result: appliedResult() })],
    [
      'conflict',
      (): DraftEvent => ({
        kind: 'result',
        result: { status: 'conflict', conflict: 'target', consentOutcome: 'unchanged' },
      }),
    ],
    ['diagnostics', () => resultEvent('accept-result-diagnostics.json')],
    ['limited', () => resultEvent('accept-result-limited.json')],
    ['expiry', (): DraftEvent => ({ kind: 'expired' })],
    ['cancel', (): DraftEvent => ({ kind: 'cancelled' })],
    ['discard', (): DraftEvent => ({ kind: 'discard' })],
    ['teardown', (): DraftEvent => ({ kind: 'teardown' })],
    ['transport rejection', (): DraftEvent => ({ kind: 'rejected' })],
  ])('clears key refs and key changes on %s', (_name, build) => {
    const vault = vaultOf();
    const draft = keyedDraft(vault);
    const event = build();
    expect(retainsKeys(event)).toBe(false);
    const settled = settleDraft(draft, event, vault);
    expect(vault.extractForApply()).toEqual({});
    expect(vault.has('hosted')).toBe(false);
    expect(
      settled.changes.some((change) => changeStableID(change).startsWith('provider-key:'))
    ).toBe(false);
  });

  it('resets the draft on applied and adopts the new revision', () => {
    const vault = vaultOf();
    const settled = settleDraft(
      keyedDraft(vault),
      { kind: 'result', result: appliedResult() },
      vault
    );
    expect(settled.changes).toHaveLength(0);
    expect(settled.source).toEqual({ kind: 'applied' });
    expect(settled.needsReview).toHaveLength(0);
    expect(isDraftDirty(settled)).toBe(false);
    expect(settled.targetRevision).toBe(
      '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef'
    );
  });

  it('retains every explicit non-key change as Needs review on conflict and blocks Apply', () => {
    const vault = vaultOf();
    const draft = keyedDraft(vault);
    const settled = settleDraft(
      draft,
      {
        kind: 'result',
        result: { status: 'conflict', conflict: 'target', consentOutcome: 'unchanged' },
      },
      vault
    );
    expect(settled.changes.map(changeStableID)).toEqual(['provider:hosted']);
    expect(settled.needsReview).toEqual(['provider:hosted']);
    expect(canApplyDraft(settled)).toBe(false);
    expect(isDraftDirty(settled)).toBe(true);

    const restaged = stageChange(
      settled,
      { kind: 'provider-add', name: 'hosted', endpoint: 'https://api.example.com' },
      vault
    );
    expect(restaged.needsReview).toHaveLength(0);
    expect(canApplyDraft(restaged)).toBe(true);
  });

  it('clears Needs review when the retained change is discarded instead', () => {
    const vault = vaultOf();
    const settled = settleDraft(
      keyedDraft(vault),
      {
        kind: 'result',
        result: { status: 'conflict', conflict: 'target', consentOutcome: 'unchanged' },
      },
      vault
    );
    const discarded = unstageChange(settled, 'provider:hosted', vault);
    expect(discarded.needsReview).toHaveLength(0);
    expect(isDraftDirty(discarded)).toBe(false);
  });

  it('drops the profile source on an outcome-unknown rejection', () => {
    const vault = vaultOf();
    const profile = replaceSource(
      keyedDraft(vault),
      { kind: 'profile', profileId: 'curated/local', sourceRevision: REVISION_A },
      vault
    );
    const staged = stageChange(
      profile,
      { kind: 'provider-add', name: 'hosted', endpoint: 'https://api.example.com' },
      vault
    );
    const settled = settleDraft(staged, { kind: 'rejected' }, vault);
    expect(settled.source).toEqual({ kind: 'applied' });
    expect(settled.needsReview).toEqual(['provider:hosted']);
    expect(canApplyDraft(settled)).toBe(false);
  });

  it('never validates or drops what the vault is given', () => {
    const vault = vaultOf();
    vault.set('hosted', '');
    vault.set('other', '${OPENAI_API_KEY}');
    expect(vault.extractForApply()).toEqual({ hosted: '', other: '${OPENAI_API_KEY}' });
  });
});

describe('active profile provenance', () => {
  beforeEach(() => {
    window.localStorage.clear();
  });

  const seed = () =>
    window.localStorage.setItem(
      ACTIVE_PROFILE_KEY,
      JSON.stringify({ version: 1, profileId: 'user/mine', appliedRevision: REVISION_A })
    );

  it('records an acknowledged profile-origin apply', () => {
    recordApplyProvenance(
      { kind: 'profile', profileId: 'curated/local', sourceRevision: REVISION_A },
      { kind: 'result', result: appliedResult() }
    );
    expect(readActiveProfile()).toEqual({
      version: 1,
      profileId: 'curated/local',
      appliedRevision: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    });
  });

  it('clears provenance for a blank-origin apply', () => {
    seed();
    recordApplyProvenance({ kind: 'blank' }, { kind: 'result', result: appliedResult() });
    expect(readActiveProfile()).toBeNull();
  });

  it('retains provenance for an applied-origin edit', () => {
    seed();
    recordApplyProvenance({ kind: 'applied' }, { kind: 'result', result: appliedResult() });
    expect(readActiveProfile()?.profileId).toBe('user/mine');
  });

  it('clears provenance when the outcome is unknown', () => {
    seed();
    recordApplyProvenance(
      { kind: 'profile', profileId: 'curated/local', sourceRevision: REVISION_A },
      { kind: 'rejected' }
    );
    expect(readActiveProfile()).toBeNull();
  });

  it('retains provenance when nothing was written', () => {
    seed();
    recordApplyProvenance(
      { kind: 'profile', profileId: 'curated/local', sourceRevision: REVISION_A },
      resultEvent('accept-result-diagnostics.json')
    );
    expect(readActiveProfile()?.profileId).toBe('user/mine');
  });

  it.each([
    ['a non-JSON value', 'not-json'],
    [
      'a future schema version',
      '{"version":2,"profileId":"user/mine","appliedRevision":"' + REVISION_A + '"}',
    ],
    [
      'an unknown member',
      '{"version":1,"profileId":"user/mine","appliedRevision":"' + REVISION_A + '","extra":1}',
    ],
    ['an invalid revision', '{"version":1,"profileId":"user/mine","appliedRevision":"nope"}'],
    [
      'an invalid profile id',
      '{"version":1,"profileId":"User/Mine","appliedRevision":"' + REVISION_A + '"}',
    ],
  ])('reads %s as no provenance', (_name, raw) => {
    window.localStorage.setItem(ACTIVE_PROFILE_KEY, raw);
    expect(readActiveProfile()).toBeNull();
  });

  it('survives a throwing storage accessor', () => {
    const getItem = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage denied');
    });
    const setItem = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage denied');
    });
    try {
      expect(readActiveProfile()).toBeNull();
      expect(() =>
        recordApplyProvenance(
          { kind: 'profile', profileId: 'curated/local', sourceRevision: REVISION_A },
          { kind: 'result', result: appliedResult() }
        )
      ).not.toThrow();
    } finally {
      getItem.mockRestore();
      setItem.mockRestore();
    }
  });
});

describe('type-derived capabilities', () => {
  const rows = JSON.parse(
    fs.readFileSync(
      path.resolve(__dirname, '../../../../internal/ai/testdata/settings_type_capabilities.json'),
      'utf8'
    )
  ) as { type: ModelType; capabilities: CapabilityName[] }[];

  it('mirrors what go-llm derives for a model type with no explicit list', () => {
    // #311: the backend asserts a capability override only when the exposure
    // differs from this set (on a selector no role owns); the reducer must
    // widen the governed set under the same rule.
    expect(Object.keys(TYPE_DERIVED_CAPABILITIES)).toHaveLength(rows.length);
    expect(new Set(rows.map((row) => row.type)).size).toBe(rows.length);
    for (const row of rows) {
      expect(TYPE_DERIVED_CAPABILITIES[row.type]).toEqual(row.capabilities);
    }
  });
});

describe('governed set under the asserted-override rule (#311)', () => {
  // The v0.14.0 smoke shape: agent runs on agent-role (an owner) and falls
  // back to pro-role, which falls back to mimo-role; analysis runs on pro-role.
  // pro-role and mimo-role derive their sets from their types.
  const OWNED: CapabilityName[] = ['chat', 'stream', 'tool_call'];
  const DERIVED: CapabilityName[] = ['chat', 'generate', 'stream'];
  const owner = modelRow({
    role: 'agent-role',
    modelName: 'agent-model',
    effectiveCapabilities: OWNED,
    capabilityFacts: { caps: OWNED, knownCaps: [...CAPABILITY_NAMES] },
    exposedCapabilities: OWNED,
    capabilityOverride: OWNED,
    routedUseCases: ['agent'],
    fallbacks: ['pro-role'],
  });
  const pro = modelRow({
    role: 'pro-role',
    modelName: 'deepseek',
    effectiveCapabilities: DERIVED,
    capabilityFacts: { caps: DERIVED, knownCaps: [...CAPABILITY_NAMES] },
    exposedCapabilities: DERIVED,
    routedUseCases: ['agent', 'analysis'],
    fallbacks: ['mimo-role'],
  });
  const mimo = modelRow({
    role: 'mimo-role',
    modelName: 'mimo',
    type: 'moe',
    effectiveCapabilities: DERIVED,
    capabilityFacts: { caps: DERIVED, knownCaps: [...CAPABILITY_NAMES] },
    exposedCapabilities: DERIVED,
    routedUseCases: ['agent'],
  });
  const base: DraftBaseProjection = {
    routes: [
      { useCase: 'agent', role: 'agent-role' },
      { useCase: 'analysis', role: 'pro-role' },
    ],
    models: [owner, pro, mimo],
  };
  const draft = cleanDraft(REVISION_A);

  it('governs the edited use case alone when a join exposes what the type derives on an unowned selector', () => {
    // The backend sends no override for this exposure, so upstream gates the
    // new role alone; agent's chain through mimo-role is not in play. The
    // confirmation set stays the wide one gateRolesFor asks for.
    const probe = probeRouteChange('analysis', mimo);
    expect(probe.exposedCaps).toEqual(DERIVED);
    expect(governedUseCasesOf(base, draft, probe)).toEqual(['analysis']);
    expect(affectedUseCases(base, draft, probe)).toEqual(['analysis', 'agent']);
  });

  it('widens to the selector once a join exposes something other than the derived set', () => {
    const probe = {
      ...probeRouteChange('analysis', mimo),
      exposedCaps: ['chat', 'stream'] as CapabilityName[],
    };
    expect(governedUseCasesOf(base, draft, probe)).toEqual(['analysis', 'agent']);
  });

  it('widens to an owned selector even when the exposure equals the owner set', () => {
    // The owner's set is not the derived one, so a join exposing it carries
    // the explicit list (the backend sends nil only beside a role holding the
    // derived list, or none), and upstream gates every role on the selector.
    const probe = probeRouteChange('analysis', owner);
    expect(probe.exposedCaps).toEqual(OWNED);
    expect(governedUseCasesOf(base, draft, probe)).toEqual(['analysis', 'agent']);
  });

  it('does not count a role holding the list the join type derives, the one every earlier Firn wrote', () => {
    // Firn before #311 wrote the exposed set as an explicit list on every
    // move, so a selector it ever moved onto reads as owned by the derived
    // set. The backend sends nil beside such a list (the role resolves the
    // same set either way), so the join governs itself alone. A role holding
    // any other list, or an exposure other than the derived one, still widens.
    const written = modelRow({ ...mimo, capabilityOverride: DERIVED });
    const writtenBase: DraftBaseProjection = { ...base, models: [owner, pro, written] };
    const probe = probeRouteChange('analysis', written);
    expect(probe.exposedCaps).toEqual(DERIVED);
    expect(governedUseCasesOf(writtenBase, draft, probe)).toEqual(['analysis']);
    expect(affectedUseCases(writtenBase, draft, probe)).toEqual(['analysis', 'agent']);

    const NARROW: CapabilityName[] = ['chat', 'stream'];
    const narrower = modelRow({
      ...mimo,
      effectiveCapabilities: NARROW,
      capabilityFacts: { caps: NARROW, knownCaps: [...CAPABILITY_NAMES] },
      exposedCapabilities: NARROW,
      capabilityOverride: NARROW,
    });
    const narrowerBase: DraftBaseProjection = { ...base, models: [owner, pro, narrower] };
    expect(governedUseCasesOf(narrowerBase, draft, { ...probe, exposedCaps: DERIVED })).toEqual([
      'analysis',
      'agent',
    ]);
    expect(governedUseCasesOf(writtenBase, draft, { ...probe, exposedCaps: NARROW })).toEqual([
      'analysis',
      'agent',
    ]);
  });

  it('counts the edited route own role when a retarget in place would take the selector only list with it', () => {
    // chat runs on own-role, the only role on shared-model holding a list,
    // the derived one. A type change in place is a retarget, and the backend
    // re-sends the list rather than let SetRoleModel clear the selector's
    // only explicit list, so the gate widens to the selector's roles. Beside
    // a sibling holding the same list nothing is taken: the join governs
    // itself alone.
    const own = modelRow({
      role: 'own-role',
      modelName: 'shared-model',
      effectiveCapabilities: DERIVED,
      capabilityFacts: { caps: DERIVED, knownCaps: [...CAPABILITY_NAMES] },
      exposedCapabilities: DERIVED,
      capabilityOverride: DERIVED,
      routedUseCases: ['chat'],
    });
    const side = modelRow({
      role: 'side-role',
      modelName: 'shared-model',
      effectiveCapabilities: DERIVED,
      capabilityFacts: { caps: DERIVED, knownCaps: [...CAPABILITY_NAMES] },
      exposedCapabilities: DERIVED,
      routedUseCases: ['agent'],
    });
    const retype = routeChange({
      useCase: 'chat',
      modelFacts: { provider: 'hosted', model: 'shared-model', type: 'moe' },
      capabilityFacts: { caps: DERIVED, knownCaps: [...CAPABILITY_NAMES] },
      exposedCaps: DERIVED,
    });
    const routes = [
      { useCase: 'chat', role: 'own-role' },
      { useCase: 'agent', role: 'side-role' },
    ];
    expect(governedUseCasesOf({ routes, models: [own, side] }, draft, retype)).toEqual([
      'chat',
      'agent',
    ]);
    const sideHolding = modelRow({ ...side, capabilityOverride: DERIVED });
    expect(governedUseCasesOf({ routes, models: [own, sideHolding] }, draft, retype)).toEqual([
      'chat',
    ]);
  });

  it('counts list holders as the backend meets them, after earlier departures and in-place rewrites of the group', () => {
    // Two roles hold the derived list on shared-model; agent reaches it
    // through a fallback and needs tool_call. route:analysis sorts before
    // route:chat. When analysis leaves first, chat is the sole holder by the
    // time its retype runs, so the backend re-sends its list and gates the
    // selector: agent is governed. When analysis is instead retyped in place
    // first (not sole then: its list goes), chat is again sole at its turn.
    const holder = (role: string, useCase: string): ModelProjection =>
      modelRow({
        role,
        modelName: 'shared-model',
        effectiveCapabilities: DERIVED,
        capabilityFacts: { caps: DERIVED, knownCaps: [...CAPABILITY_NAMES] },
        exposedCapabilities: DERIVED,
        capabilityOverride: DERIVED,
        routedUseCases: [useCase],
      });
    const chatHolder = holder('chat-role', 'chat');
    const analysisHolder = holder('analysis-role', 'analysis');
    // spare-role derives its set, routes nothing itself, and is how agent
    // reaches the selector (a holder listed as a fallback would be forked,
    // never let go).
    const spareRole = modelRow({
      role: 'spare-role',
      modelName: 'shared-model',
      effectiveCapabilities: DERIVED,
      capabilityFacts: { caps: DERIVED, knownCaps: [...CAPABILITY_NAMES] },
      exposedCapabilities: DERIVED,
      routedUseCases: ['agent'],
    });
    const agentRole = modelRow({
      ...owner,
      role: 'agent-role',
      modelName: 'agent-model',
      routedUseCases: ['agent'],
      fallbacks: ['spare-role'],
    });
    const routes = [
      { useCase: 'agent', role: 'agent-role' },
      { useCase: 'analysis', role: 'analysis-role' },
      { useCase: 'chat', role: 'chat-role' },
    ];
    const seqBase: DraftBaseProjection = {
      routes,
      models: [agentRole, analysisHolder, chatHolder, spareRole],
    };
    const retypeChat = routeChange({
      useCase: 'chat',
      modelFacts: { provider: 'hosted', model: 'shared-model', type: 'moe' },
      capabilityFacts: { caps: DERIVED, knownCaps: [...CAPABILITY_NAMES] },
      exposedCaps: DERIVED,
    });
    // Nothing else staged: two holders, chat's retype in place is not sole.
    expect(governedUseCasesOf(seqBase, draft, retypeChat)).toEqual(['chat']);
    // analysis leaves for another model first: chat is the sole holder by then.
    const analysisAway = routeChange({
      useCase: 'analysis',
      modelFacts: { provider: 'hosted', model: 'elsewhere', type: 'dense' },
      capabilityFacts: { caps: DERIVED, knownCaps: [...CAPABILITY_NAMES] },
      exposedCaps: DERIVED,
    });
    expect(governedUseCasesOf(seqBase, stage([analysisAway, retypeChat]), retypeChat)).toEqual([
      'chat',
      'agent',
    ]);
    // analysis is retyped in place first: not sole at its turn, so its list
    // goes, and chat is sole at its own turn. analysis-role is still on the
    // selector then, so analysis is gated too.
    const retypeAnalysis = routeChange({
      useCase: 'analysis',
      modelFacts: { provider: 'hosted', model: 'shared-model', type: 'moe' },
      capabilityFacts: { caps: DERIVED, knownCaps: [...CAPABILITY_NAMES] },
      exposedCaps: DERIVED,
    });
    expect(governedUseCasesOf(seqBase, stage([retypeAnalysis, retypeChat]), retypeChat)).toEqual([
      'chat',
      'agent',
      'analysis',
    ]);
    // The group gates as one, on the coalesced exposure: once chat's retype
    // asserts, the analysis change staged with it is governed wide too, even
    // though at its own turn it was not sole (the backend gates only its role
    // then; the wider set only ever shows more).
    expect(
      governedUseCasesOf(seqBase, stage([retypeAnalysis, retypeChat]), retypeAnalysis)
    ).toEqual(['analysis', 'agent', 'chat']);
  });

  it.each([
    ['earlier departure', 'analysis', 'other-model', false, ['chat', 'agent']],
    ['later departure', 'summary', 'other-model', false, ['chat']],
    ['earlier retype', 'analysis', 'shared-model', false, ['chat', 'agent', 'analysis']],
    ['forked departure', 'analysis', 'other-model', true, ['chat']],
    ['forked retype', 'analysis', 'shared-model', true, ['chat', 'analysis']],
  ] as const)(
    'counts list holders at mutation time after an %s',
    (_name, peerUseCase, destination, referenced, expected) => {
      const own = modelRow({
        role: 'own-role',
        modelName: 'shared-model',
        effectiveCapabilities: DERIVED,
        capabilityFacts: { caps: DERIVED, knownCaps: [...CAPABILITY_NAMES] },
        exposedCapabilities: DERIVED,
        capabilityOverride: DERIVED,
        routedUseCases: ['chat'],
      });
      const peer = modelRow({ ...own, role: 'peer-role', routedUseCases: [peerUseCase] });
      const fallback = modelRow({
        ...own,
        role: 'fallback-role',
        capabilityOverride: undefined,
        routedUseCases: ['agent'],
      });
      const primary = modelRow({ ...owner, fallbacks: ['fallback-role'] });
      const referrer = modelRow({ role: 'unrouted', routedUseCases: [], fallbacks: ['peer-role'] });
      const currentBase: DraftBaseProjection = {
        routes: [
          { useCase: 'chat', role: own.role },
          { useCase: peerUseCase, role: peer.role },
          { useCase: 'agent', role: primary.role },
        ],
        models: [own, peer, fallback, primary, ...(referenced ? [referrer] : [])],
      };
      const retype = routeChange({
        useCase: 'chat',
        modelFacts: { provider: 'hosted', model: 'shared-model', type: 'moe' },
        capabilityFacts: { caps: DERIVED, knownCaps: [...CAPABILITY_NAMES] },
        exposedCaps: DERIVED,
      });
      const prior = {
        ...retype,
        useCase: peerUseCase,
        modelFacts: { ...retype.modelFacts, model: destination },
      };
      expect(governedUseCasesOf(currentBase, { ...draft, changes: [prior] }, retype)).toEqual(
        expected
      );
    }
  );

  it('governs every route on the selector for an override, changed or not', () => {
    // Whatever is staged as an override is applied through SetRoleOverrides,
    // which gates every role on the selector; the EDITOR is what keeps an
    // override that changes nothing from being staged at all.
    const held = probeRouteChange('analysis', pro);
    expect(governedUseCasesOf(base, draft, held)).toEqual(['analysis', 'agent']);
    const narrowed: RouteChange = { ...held, exposedCaps: ['chat', 'stream'] };
    expect(governedUseCasesOf(base, draft, narrowed)).toEqual(['analysis', 'agent']);
  });

  it('counts an owner only while it is still on the selector when the join runs', () => {
    // Ownership is judged at the join's place in stable-id order, as the
    // backend sees the document then: an owner whose only route a staged
    // retarget moves away BEFORE the join is gone (the selector is unowned,
    // the derived exposure asserts nothing, the join governs itself alone);
    // one whose route leaves only AFTER the join is still there (the explicit
    // list is sent, every role on the selector is gated).
    const sharedOwner = (role: string, useCase: string): ModelProjection =>
      modelRow({
        role,
        modelName: 'shared',
        effectiveCapabilities: OWNED,
        capabilityFacts: { caps: OWNED, knownCaps: [...CAPABILITY_NAMES] },
        exposedCapabilities: OWNED,
        capabilityOverride: OWNED,
        routedUseCases: [useCase],
      });
    // spare-role derives its set, routes nothing itself, and is agent-role's fallback.
    const spare = modelRow({
      role: 'spare-role',
      modelName: 'shared',
      effectiveCapabilities: DERIVED,
      capabilityFacts: { caps: DERIVED, knownCaps: [...CAPABILITY_NAMES] },
      exposedCapabilities: OWNED,
      routedUseCases: ['agent'],
    });
    const agentRole = modelRow({ ...owner, modelName: 'agent-model', fallbacks: ['spare-role'] });
    const away = (useCase: string): RouteChange =>
      routeChange({
        useCase,
        modelFacts: { provider: 'hosted', model: 'elsewhere', type: 'dense' },
        capabilityFacts: { caps: OWNED, knownCaps: [...CAPABILITY_NAMES] },
        exposedCaps: OWNED,
      });
    const joinChat: RouteChange = { ...probeRouteChange('chat', spare), exposedCaps: DERIVED };

    // `route:analysis` sorts before `route:chat`: the owner has left.
    const earlier: DraftBaseProjection = {
      routes: [
        { useCase: 'agent', role: 'agent-role' },
        { useCase: 'analysis', role: 'analysis-role' },
        { useCase: 'chat', role: 'chat-role' },
      ],
      models: [agentRole, sharedOwner('analysis-role', 'analysis'), spare, modelRow()],
    };
    expect(governedUseCasesOf(earlier, stage([away('analysis')]), joinChat)).toEqual(['chat']);

    // `route:planning` sorts after `route:chat`: the owner is still there.
    const later: DraftBaseProjection = {
      routes: [
        { useCase: 'agent', role: 'agent-role' },
        { useCase: 'chat', role: 'chat-role' },
        { useCase: 'planning', role: 'plan-role' },
      ],
      models: [agentRole, sharedOwner('plan-role', 'planning'), spare, modelRow()],
    };
    expect(governedUseCasesOf(later, stage([away('planning')]), joinChat)).toEqual([
      'chat',
      'agent',
    ]);
  });
});

describe('governed set across a coalesced selector group (#311, round 2)', () => {
  const OWNED: CapabilityName[] = ['chat', 'stream', 'tool_call'];
  const DERIVED: CapabilityName[] = ['chat', 'generate', 'stream'];
  const WIDE: CapabilityName[] = ['chat', 'generate', 'stream', 'tool_call'];
  const deriving = (over: Partial<ModelProjection>): ModelProjection =>
    modelRow({
      effectiveCapabilities: DERIVED,
      capabilityFacts: { caps: DERIVED, knownCaps: [...CAPABILITY_NAMES] },
      exposedCapabilities: DERIVED,
      ...over,
    });
  const onto = (useCase: string, model: string, exposedCaps: CapabilityName[]): RouteChange =>
    routeChange({
      useCase,
      modelFacts: { provider: 'hosted', model, type: 'dense' },
      capabilityFacts: { caps: DERIVED, knownCaps: [...CAPABILITY_NAMES] },
      exposedCaps,
    });

  it('gates by the group authority exposure, not by what each change asserted before coalescing', () => {
    // analysis joined mimo asserting tool_call; summarize then joined with the
    // derived set and became the authority, so BOTH changes are sent with the
    // derived set and the backend asserts nothing: agent, which reaches
    // mimo-role through its chain, is not gated.
    const base: DraftBaseProjection = {
      routes: [
        { useCase: 'agent', role: 'agent-role' },
        { useCase: 'analysis', role: 'analysis-role' },
        { useCase: 'summarize', role: 'summarize-role' },
      ],
      models: [
        modelRow({
          role: 'agent-role',
          modelName: 'agent-model',
          effectiveCapabilities: OWNED,
          capabilityFacts: { caps: OWNED, knownCaps: [...CAPABILITY_NAMES] },
          exposedCapabilities: OWNED,
          capabilityOverride: OWNED,
          routedUseCases: ['agent'],
          fallbacks: ['mimo-role'],
        }),
        deriving({ role: 'mimo-role', modelName: 'mimo', routedUseCases: ['agent'] }),
        deriving({ role: 'analysis-role', modelName: 'alpha', routedUseCases: ['analysis'] }),
        deriving({ role: 'summarize-role', modelName: 'beta', routedUseCases: ['summarize'] }),
      ],
    };
    const projected = projectDraft(
      base,
      stage([onto('analysis', 'mimo', WIDE), onto('summarize', 'mimo', DERIVED)])
    );
    expect(selectorFields(projected.changes[0]).exposedCaps).toEqual(DERIVED);
    expect(projected.governedUseCases.get('analysis')).toEqual(['analysis', 'summarize']);
    expect(projected.governedUseCases.get('summarize')).toEqual(['analysis', 'summarize']);
    // The other way round the authority asserts tool_call, and agent is gated.
    const asserting = projectDraft(
      base,
      stage([onto('summarize', 'mimo', DERIVED), onto('analysis', 'mimo', WIDE)])
    );
    expect(asserting.governedUseCases.get('summarize')).toEqual(['agent', 'analysis', 'summarize']);
  });

  it('keeps an owner that an unrouted role lists as a fallback: the backend forks it, it never leaves', () => {
    // analysis-role owns the shared selector and routes analysis alone, but
    // idle-role (routed by nothing) names it as a fallback: moving analysis
    // forks the role (fallbacks[role]) and the owner stays, so a later join
    // meets it and is gated on agent through spare-role.
    const base: DraftBaseProjection = {
      routes: [
        { useCase: 'agent', role: 'agent-role' },
        { useCase: 'analysis', role: 'analysis-role' },
        { useCase: 'chat', role: 'chat-role' },
      ],
      models: [
        modelRow({
          role: 'agent-role',
          modelName: 'agent-model',
          effectiveCapabilities: OWNED,
          capabilityFacts: { caps: OWNED, knownCaps: [...CAPABILITY_NAMES] },
          exposedCapabilities: OWNED,
          capabilityOverride: OWNED,
          routedUseCases: ['agent'],
          fallbacks: ['spare-role'],
        }),
        modelRow({
          role: 'analysis-role',
          modelName: 'shared',
          effectiveCapabilities: OWNED,
          capabilityFacts: { caps: OWNED, knownCaps: [...CAPABILITY_NAMES] },
          exposedCapabilities: OWNED,
          capabilityOverride: OWNED,
          routedUseCases: ['analysis'],
        }),
        deriving({
          role: 'spare-role',
          modelName: 'shared',
          exposedCapabilities: OWNED,
          routedUseCases: ['agent'],
        }),
        deriving({
          role: 'idle-role',
          modelName: 'idle',
          routedUseCases: [],
          removable: true,
          fallbacks: ['analysis-role'],
        }),
        modelRow(),
      ],
    };
    const away = onto('analysis', 'elsewhere', OWNED);
    const joinChat: RouteChange = {
      ...probeRouteChange('chat', base.models[2]),
      exposedCaps: DERIVED,
    };
    // The fork leaves analysis-role bound to analysis until the binds phase,
    // so analysis is gated too, beside agent through spare-role.
    expect(governedUseCasesOf(base, stage([away]), joinChat)).toEqual([
      'chat',
      'agent',
      'analysis',
    ]);
    expect(retargetOf(base, stagedRoutes([away]), base.models[1])).toBeUndefined();
  });
});

describe('use-case floors', () => {
  const rows = JSON.parse(
    fs.readFileSync(
      path.resolve(__dirname, '../../../../internal/ai/testdata/settings_use_case_floors.json'),
      'utf8'
    )
  ) as { useCase: string; capabilities: CapabilityName[] }[];

  it('mirrors the Go floor table exactly', () => {
    expect(USE_CASE_FLOORS.size).toBe(rows.length);
    for (const row of rows) {
      expect(USE_CASE_FLOORS.get(row.useCase)).toEqual(row.capabilities);
    }
  });

  it.each([
    ['agent', ['chat', 'stream'], false],
    ['agent', ['chat', 'stream', 'tool_call'], true],
    ['chat', ['chat', 'stream'], true],
    ['embedding', ['embed'], true],
    ['embedding', ['chat'], false],
    ['summarize', [], true],
    ['planning', ['chat', 'stream'], false],
    ['planning', ['chat', 'stream', 'tool_call'], true],
  ])('meetsUseCaseFloor(%s, %j) is %s', (useCase, caps, expected) => {
    expect(meetsUseCaseFloor(useCase as string, caps as CapabilityName[])).toBe(expected);
  });
});

describe('effectiveRoutes / providerUsage (one derived view)', () => {
  const base: DraftBaseProjection = {
    routes: [
      { useCase: 'agent', role: 'a' },
      { useCase: 'chat', role: 'c' },
    ],
    models: [
      // The fallback-inclusive claim each model carries has to AGREE with the
      // routes above, or the fold [X3] applies would credit a use case the base
      // never routed there. `modelRow` defaults to `['chat']`.
      modelRow({ role: 'a', provider: 'llama-swap', modelName: 'm1', routedUseCases: ['agent'] }),
      modelRow({ role: 'c', provider: 'zen', modelName: 'm2' }),
    ],
  };

  it('reflects staged moves and unassigns, not only the base', () => {
    const changes: Change[] = [
      {
        kind: 'route',
        useCase: 'agent',
        modelFacts: { provider: 'zen', model: 'm3', type: 'dense' },
        capabilityFacts: { caps: [], knownCaps: [] },
        exposedCaps: [],
        thinkMode: '',
        confirmUnknown: false,
      },
      { kind: 'route-unassign', useCase: 'chat' },
    ];
    const routes = effectiveRoutes(base, changes);
    expect(routes.get('agent')).toEqual({ provider: 'zen', model: 'm3' });
    expect(routes.get('chat')).toBeNull();
    expect(providerUsage(routes, base, changes)).toEqual(new Map([['zen', ['agent']]]));
  });

  it('with no changes equals the base', () => {
    expect(providerUsage(effectiveRoutes(base, []), base, [])).toEqual(
      new Map([
        ['llama-swap', ['agent']],
        ['zen', ['chat']],
      ])
    );
  });

  it('credits a provider reached only through a fallback chain', () => {
    // [X3] `agent` routes DIRECTLY to provider A, but the backend resolved its
    // fallback chain onto provider B and says so on B's model (`routedUseCases`).
    // Counting only direct routes would report B as `not routed`.
    const withFallback: DraftBaseProjection = {
      routes: [{ useCase: 'agent', role: 'a' }],
      models: [
        modelRow({ role: 'a', provider: 'A', modelName: 'm1', routedUseCases: ['agent'] }),
        modelRow({ role: 'b', provider: 'B', modelName: 'm2', routedUseCases: ['agent'] }),
      ],
    };
    expect(providerUsage(effectiveRoutes(withFallback, []), withFallback, [])).toEqual(
      new Map([
        ['A', ['agent']],
        ['B', ['agent']],
      ])
    );
  });

  it('lets a staged route override the base claim on that use case', () => {
    // The fold answers only use cases this draft is NOT restaging: once `agent` is
    // retargeted, the applied models' claim on it is exactly what Apply replaces.
    const withFallback: DraftBaseProjection = {
      routes: [{ useCase: 'agent', role: 'a' }],
      models: [
        modelRow({ role: 'a', provider: 'A', modelName: 'm1', routedUseCases: ['agent'] }),
        modelRow({ role: 'b', provider: 'B', modelName: 'm2', routedUseCases: ['agent'] }),
      ],
    };
    const changes: Change[] = [
      {
        kind: 'route',
        useCase: 'agent',
        modelFacts: { provider: 'C', model: 'm3', type: 'dense' },
        capabilityFacts: { caps: [], knownCaps: [] },
        exposedCaps: [],
        thinkMode: '',
        confirmUnknown: false,
      },
    ];
    expect(providerUsage(effectiveRoutes(withFallback, changes), withFallback, changes)).toEqual(
      new Map([['C', ['agent']]])
    );
  });
});

describe('floors across a selector (wave 4c)', () => {
  // Transport order (routes by use case, models by role), as a real projection arrives.
  const base: DraftBaseProjection = {
    routes: [
      { useCase: 'agent', role: 'agent-role' },
      { useCase: 'chat', role: 'chat-role' },
      { useCase: 'reasoning', role: 'reason-role' },
    ],
    models: [
      modelRow({
        role: 'agent-role',
        modelName: 'gpt-5',
        effectiveCapabilities: ['chat', 'stream', 'tool_call'],
        capabilityFacts: {
          caps: ['chat', 'stream', 'tool_call'],
          knownCaps: [...CAPABILITY_NAMES],
        },
        exposedCapabilities: ['chat', 'stream', 'tool_call'],
        routedUseCases: ['agent'],
      }),
      modelRow({ routedUseCases: ['chat'] }),
      // agent reaches reason-role through a fallback chain: routedUseCases is
      // fallback-inclusive (internal/ai/settings.go roleUsage).
      modelRow({
        role: 'reason-role',
        modelName: 'deepseek',
        routedUseCases: ['agent', 'reasoning'],
      }),
    ],
  };
  const byRole = (role: string): ModelProjection => {
    const found = base.models.find((model) => model.role === role);
    if (found === undefined) throw new Error(`no model role ${role}`);
    return found;
  };

  it('unions the floors of the use cases named, in canonical order', () => {
    expect(unionFloor(['reasoning'])).toEqual([]);
    expect(unionFloor(['reasoning', 'agent', 'embedding'])).toEqual([
      'chat',
      'stream',
      'embed',
      'tool_call',
    ]);
  });

  it('lists what a candidate asks the user to confirm, the edited use case first', () => {
    // reasoning's current role also serves agent; gpt-5's selector serves agent directly.
    expect(
      affectedUseCases(
        base,
        cleanDraft(REVISION_A),
        probeRouteChange('reasoning', byRole('agent-role'))
      )
    ).toEqual(['reasoning', 'agent']);
    // A card on chat-role's selector adds chat to the set.
    expect(
      affectedUseCases(
        base,
        cleanDraft(REVISION_A),
        probeRouteChange('reasoning', byRole('chat-role'))
      )
    ).toEqual(['reasoning', 'agent', 'chat']);
  });

  it('lists what a candidate governs: the changed use case, then the target selector routes', () => {
    // agent-role is on gpt-5's selector, so a fork of reasoning onto it governs agent…
    expect(
      governedUseCasesOf(
        base,
        cleanDraft(REVISION_A),
        probeRouteChange('reasoning', byRole('agent-role'))
      )
    ).toEqual(['reasoning', 'agent']);
    // …while on chat-role's selector agent — reached only through reasoning's
    // CURRENT role — is confirmation-only: the fork leaves that role as it is.
    const ontoChat = probeRouteChange('reasoning', byRole('chat-role'));
    expect(governedUseCasesOf(base, cleanDraft(REVISION_A), ontoChat)).toEqual([
      'reasoning',
      'chat',
    ]);
    expect(affectedUseCases(base, cleanDraft(REVISION_A), ontoChat)).toEqual([
      'reasoning',
      'agent',
      'chat',
    ]);
  });

  it('folds a staged change on the same selector into the set', () => {
    const draft = stage([
      routeChange({
        useCase: 'chat',
        modelFacts: { provider: 'hosted', model: 'gpt-5', type: 'dense' },
        exposedCaps: ['chat', 'stream', 'tool_call'],
      }),
    ]);
    expect(
      affectedUseCases(base, draft, probeRouteChange('reasoning', byRole('agent-role')))
    ).toEqual(['reasoning', 'agent', 'chat']);
  });

  it('names each missing capability with the use cases that need it', () => {
    expect(floorShortfalls(['chat', 'stream'], ['reasoning', 'agent', 'chat'])).toEqual([
      { cap: 'tool_call', useCases: ['agent'] },
    ]);
    expect(floorShortfalls(['embed'], ['chat', 'agent'])).toEqual([
      { cap: 'chat', useCases: ['chat', 'agent'] },
      { cap: 'stream', useCases: ['chat', 'agent'] },
      { cap: 'tool_call', useCases: ['agent'] },
    ]);
    expect(floorShortfalls(['chat', 'stream', 'tool_call'], ['reasoning', 'agent'])).toEqual([]);
  });

  it("carries every optional fact and the model's own exposure into the probe", () => {
    const probe = probeRouteChange('agent', modelRow({ parameters: '7b', contextWindow: 4096 }));
    expect(probe.modelFacts).toEqual({
      provider: 'hosted',
      model: 'gpt-5-mini',
      type: 'dense',
      parameters: '7b',
      contextWindow: 4096,
    });
    // What the card exposes, nothing added: the floor it misses is the verdict, not the probe.
    expect(probe.exposedCaps).toEqual(['chat', 'stream']);
    expect(probe.thinkMode).toBe('');
  });

  it('drops a sibling the draft already moves off the selector from the governed set', () => {
    // [W4-10] agent sits on gpt-5 today. A draft that routes it onto ANOTHER
    // selector leaves nothing of it on gpt-5 for chat to govern; a draft that
    // routes it ONTO gpt-5 is in chat's own selector group.
    const gpt5 = byRole('agent-role');
    const twoRoutes: DraftBaseProjection = {
      routes: [
        { useCase: 'agent', role: 'agent-role' },
        { useCase: 'chat', role: 'chat-role' },
      ],
      models: [gpt5, modelRow({ routedUseCases: ['chat'] })],
    };
    const probe = probeRouteChange('chat', gpt5);
    const agentOnto = (model: string): RouteChange =>
      routeChange({
        useCase: 'agent',
        modelFacts: { provider: 'hosted', model, type: 'dense' },
        exposedCaps: ['chat', 'stream', 'tool_call'],
      });
    expect(governedUseCasesOf(twoRoutes, stage([agentOnto('claude')]), probe)).toEqual(['chat']);
    expect(governedUseCasesOf(twoRoutes, stage([agentOnto('gpt-5')]), probe)).toEqual([
      'chat',
      'agent',
    ]);

    // An unassign is NOT a departure: the unbind runs after every route plan,
    // so the sibling's route is still bound when the join is gated. (agent is
    // Firn's run path and can never be unassigned; the sibling routes planning.)
    const planRole: ModelProjection = { ...gpt5, role: 'plan-role', routedUseCases: ['planning'] };
    const withPlanning: DraftBaseProjection = {
      routes: [
        { useCase: 'chat', role: 'chat-role' },
        { useCase: 'planning', role: 'plan-role' },
      ],
      models: [modelRow({ routedUseCases: ['chat'] }), planRole],
    };
    expect(
      governedUseCasesOf(
        withPlanning,
        stage([{ kind: 'route-unassign', useCase: 'planning' }]),
        probeRouteChange('chat', planRole)
      )
    ).toEqual(['chat', 'planning']);
  });

  it('keeps every use case a fork source still serves once one of its routes leaves', () => {
    // pair-role routes planning AND summarize on gpt-5: forking planning away
    // leaves pair-role's Defaults bound to BOTH until the binds phase, so
    // chat joining gpt-5 still gates on everything pair-role still serves.
    const gpt5 = byRole('agent-role');
    const pairRole: ModelProjection = {
      ...gpt5,
      role: 'pair-role',
      routedUseCases: ['planning', 'summarize'],
    };
    const forked: DraftBaseProjection = {
      routes: [
        { useCase: 'planning', role: 'pair-role' },
        { useCase: 'summarize', role: 'pair-role' },
        { useCase: 'chat', role: 'chat-role' },
      ],
      models: [pairRole, modelRow({ routedUseCases: ['chat'] })],
    };
    const planningAway = routeChange({
      useCase: 'planning',
      modelFacts: { provider: 'hosted', model: 'claude', type: 'dense' },
      exposedCaps: ['chat', 'stream', 'tool_call'],
    });
    expect(
      governedUseCasesOf(forked, stage([planningAway]), probeRouteChange('chat', pairRole))
    ).toEqual(['chat', 'planning', 'summarize']);
  });

  it('keeps a route the draft moves off a role it reaches only as a fallback', () => {
    // routedUseCases is fallback-inclusive: agent reaches judge-role through
    // agent-role's chain. Retargeting agent rewrites (or forks) agent-role, its
    // OWN role; judge-role stays on gpt-5, still on agent's chain, so agent
    // still gates a join there.
    const gpt5 = byRole('agent-role');
    const judge: ModelProjection = { ...gpt5, role: 'judge-role', modelName: 'gpt-5' };
    const viaFallback: DraftBaseProjection = {
      routes: [
        { useCase: 'agent', role: 'agent-role' },
        { useCase: 'chat', role: 'chat-role' },
      ],
      models: [
        { ...gpt5, modelName: 'claude-opus' },
        modelRow({ routedUseCases: ['chat'] }),
        judge,
      ],
    };
    const agentAway = routeChange({
      useCase: 'agent',
      modelFacts: { provider: 'hosted', model: 'claude', type: 'dense' },
      exposedCaps: ['chat', 'stream', 'tool_call'],
    });
    expect(
      governedUseCasesOf(viaFallback, stage([agentAway]), probeRouteChange('chat', judge))
    ).toEqual(['chat', 'agent']);
  });
});

describe('retargetOf', () => {
  const chatRole = modelRow({ role: 'chat-role', routedUseCases: ['chat'] });
  const base: DraftBaseProjection = {
    routes: [{ useCase: 'chat', role: 'chat-role' }],
    models: [chatRole],
  };

  it('returns the route for a single-use-case role moved to another selector', () => {
    const away = routeChange({
      useCase: 'chat',
      modelFacts: { provider: 'hosted', model: 'claude', type: 'dense' },
    });
    expect(retargetOf(base, stagedRoutes([away]), chatRole)).toBe(away);
  });

  it('returns undefined for a fork source routing more than one use case', () => {
    const pairRole = modelRow({ role: 'pair-role', routedUseCases: ['chat', 'summarize'] });
    const forkBase: DraftBaseProjection = {
      routes: [
        { useCase: 'chat', role: 'pair-role' },
        { useCase: 'summarize', role: 'pair-role' },
      ],
      models: [pairRole],
    };
    const away = routeChange({
      useCase: 'chat',
      modelFacts: { provider: 'hosted', model: 'claude', type: 'dense' },
    });
    expect(retargetOf(forkBase, stagedRoutes([away]), pairRole)).toBeUndefined();
  });

  it('returns undefined for a route staying on the same selector', () => {
    const sameSelector = routeChange({
      useCase: 'chat',
      modelFacts: { provider: chatRole.provider, model: chatRole.modelName, type: chatRole.type },
      thinkMode: 'always',
    });
    expect(retargetOf(base, stagedRoutes([sameSelector]), chatRole)).toBeUndefined();
  });
});

describe('reach (wave 6): what a staged model change reaches, by projected configuration', () => {
  const caps = (list: CapabilityName[]) => ({
    effectiveCapabilities: list,
    capabilityFacts: { caps: list, knownCaps: [...CAPABILITY_NAMES] },
    exposedCapabilities: list,
  });
  const GPT5: CapabilityName[] = ['chat', 'stream', 'tool_call', 'thinking'];
  const gpt5 = { provider: 'hosted', model: 'gpt-5', type: 'dense' } as const;
  // chat-role serves chat AND summarize (a shared role); agent-role and
  // analysis-role share gpt-5; completion reaches gpt-5 only through its
  // fallback chain (analysis-role lists it); coding-role is its own model.
  const base: DraftBaseProjection = {
    routes: [
      { useCase: 'agent', role: 'agent-role' },
      { useCase: 'analysis', role: 'analysis-role' },
      { useCase: 'chat', role: 'chat-role' },
      { useCase: 'completion', role: 'coding-role' },
      { useCase: 'summarize', role: 'chat-role' },
    ],
    models: [
      modelRow({
        role: 'agent-role',
        modelName: 'gpt-5',
        ...caps(GPT5),
        routedUseCases: ['agent'],
      }),
      modelRow({
        role: 'analysis-role',
        modelName: 'gpt-5',
        ...caps(GPT5),
        routedUseCases: ['analysis', 'completion'],
      }),
      modelRow({ routedUseCases: ['chat', 'summarize'] }),
      modelRow({ role: 'coding-role', modelName: 'gpt-coder', routedUseCases: ['completion'] }),
    ],
  };
  const override = (over: Partial<RouteChange> = {}) =>
    routeChange({
      useCase: 'agent',
      modelFacts: gpt5,
      capabilityFacts: { caps: GPT5, knownCaps: [...CAPABILITY_NAMES] },
      exposedCaps: [...GPT5, 'generate'],
      ...over,
    });
  const groupOf = (projected: ProjectedDraft, model: string) => {
    const group = projected.reachGroups.find((candidate) => candidate.model === model);
    if (group === undefined) throw new Error(`no reach group for ${model}`);
    return group;
  };

  it('marks the changed sibling and the fallback-reached route, and nothing else, for an override', () => {
    const projected = projectDraft(base, stage([override()]));
    const group = groupOf(projected, 'gpt-5');
    expect(group.edited).toEqual([{ useCase: 'agent', was: null }]);
    expect(group.joins).toEqual([]);
    expect(group.addedCaps).toEqual(['generate']);
    expect(group.removedCaps).toEqual([]);
    expect(group.think).toBeNull();
    expect(group.selectorHadRoles).toBe(true);
    // analysis-role sits on gpt-5 and takes the override; completion only falls back to it.
    expect(group.sameModel).toEqual(['analysis']);
    expect(group.fallback).toEqual(['completion']);
    expect(projected.routeReach.get('agent')?.reach).toBe('edited');
    expect(projected.routeReach.get('analysis')?.reach).toBe('same-model');
    expect(projected.routeReach.get('completion')?.reach).toBe('fallback');
    expect(projected.routeRows.get('analysis')?.modified).toBe(true);
    expect(projected.routeRows.get('completion')).toMatchObject({
      modified: false,
      affected: true,
    });
    // The confirmation set is still what the backend asks to acknowledge…
    expect(projected.selectorUseCases.get('agent')).toEqual(['agent', 'analysis', 'completion']);
    // …but chat and summarize are outside every reach: no mark at all.
    expect(projected.routeReach.has('chat')).toBe(false);
    expect(projected.routeRows.has('summarize')).toBe(false);
  });

  it('leaves a fork source sibling unmarked while marking the destination siblings it joins', () => {
    // chat-role serves chat and summarize: retargeting chat forks it (summarize keeps
    // gpt-5-mini, confirmation-only). The join asserts generate on gpt-5, so the
    // roles ALREADY there change — agent and analysis directly, completion via fallback.
    const projected = projectDraft(base, stage([override({ useCase: 'chat' })]));
    const group = groupOf(projected, 'gpt-5');
    expect(group.edited).toEqual([
      { useCase: 'chat', was: { provider: 'hosted', model: 'gpt-5-mini' } },
    ]);
    expect(group.joins).toEqual(['chat']);
    expect(group.sameModel).toEqual(['agent', 'analysis']);
    expect(group.fallback).toEqual(['completion']);
    expect(projected.routeReach.has('summarize')).toBe(false);
    expect(projected.routeRows.has('summarize')).toBe(false);
    expect(projected.selectorUseCases.get('chat')).toContain('summarize');
  });

  it('reaches nobody but the edited route when a join asserts what the selector already exposes', () => {
    const projected = projectDraft(base, stage([override({ useCase: 'chat', exposedCaps: GPT5 })]));
    const group = groupOf(projected, 'gpt-5');
    expect(group.addedCaps).toEqual([]);
    expect(group.sameModel).toEqual([]);
    expect(group.fallback).toEqual([]);
    expect(projected.routeReach.get('chat')?.reach).toBe('edited');
    expect(projected.routeRows.has('agent')).toBe(false);
    expect(projected.routeRows.has('completion')).toBe(false);
  });

  // Two roles on one selector can only DIFFER in exposure while neither carries an
  // explicit override — the projection derives each role's exposure from its TYPE
  // (dense: chat, generate, stream; embedding: embed). An explicit override folds
  // across the selector, and go-llm refuses non-embedding capabilities on an
  // embedding role, so the ONLY eligible mutation onto such a selector is a JOIN
  // from elsewhere: the joining dense role takes the explicit capabilities and the
  // projection folds that exposure across the selector.
  const DENSE: CapabilityName[] = ['chat', 'generate', 'stream'];
  const twoTypes: DraftBaseProjection = {
    routes: [
      { useCase: 'agent', role: 'agent-role' },
      { useCase: 'chat', role: 'chat-role' },
      { useCase: 'embedding', role: 'vector-role' },
    ],
    models: [
      modelRow({
        role: 'agent-role',
        modelName: 'gpt-agent',
        ...caps(GPT5),
        routedUseCases: ['agent'],
      }),
      modelRow({ routedUseCases: ['chat'] }),
      // gpt-5 holds an unrouted derived dense role and a derived embedding role that
      // the embedding route falls back to.
      modelRow({ role: 'spare-dense', modelName: 'gpt-5', ...caps(DENSE), routedUseCases: [] }),
      modelRow({
        role: 'embed-role',
        modelName: 'gpt-5',
        type: 'embedding',
        ...caps(['embed']),
        routedUseCases: ['embedding'],
      }),
      modelRow({
        role: 'vector-role',
        modelName: 'qwen-embed',
        type: 'embedding',
        ...caps(['embed']),
        routedUseCases: ['embedding'],
      }),
    ],
  };
  /**
   * chat joins gpt-5 from gpt-5-mini, asserting `exposed`. The exposure must keep
   * `embed`: the embedding route reaches the selector through embed-role and Firn's
   * floor for it is `embed`, so a join dropping it is ineligible and never staged.
   */
  const joinChat = (exposed: CapabilityName[]) =>
    override({
      useCase: 'chat',
      capabilityFacts: { caps: DENSE, knownCaps: [...CAPABILITY_NAMES] },
      exposedCaps: exposed,
    });

  it("scopes a fallback row's delta to the roles that actually list it", () => {
    // Both roles change, differently: spare-dense gains embed and loses generate,
    // embed-role gains chat and stream. The embedding route reaches gpt-5 through
    // embed-role ONLY, so its delta is embed-role's — never the group's union.
    const projected = projectDraft(twoTypes, stage([joinChat(['chat', 'stream', 'embed'])]));
    const group = groupOf(projected, 'gpt-5');
    expect(group.addedCaps).toEqual(['chat', 'stream', 'embed']);
    expect(group.removedCaps).toEqual(['generate']);
    expect(group.affectedRoles).toEqual(['spare-dense']);
    expect(group.fallback).toEqual(['embedding']);
    expect(group.fallbackDeltas.get('embedding')).toEqual({
      addedCaps: ['chat', 'stream'],
      removedCaps: [],
      think: null,
    });
  });

  it("scopes a fallback row's Think to its contributing role", () => {
    // analysis-role already Thinks auto; agent-role does not. The override to auto
    // (with generate) changes both — so the GROUP names a Think delta — but
    // completion's chain meets analysis-role only, whose Think does not move.
    const analysisAuto = base.models.map((model) =>
      model.role === 'analysis-role' ? { ...model, thinkMode: 'auto' as const } : model
    );
    const projected = projectDraft(
      { ...base, models: analysisAuto },
      stage([override({ thinkMode: 'auto' })])
    );
    const group = groupOf(projected, 'gpt-5');
    expect(group.think).toBe('auto');
    expect(group.fallbackDeltas.get('completion')).toEqual({
      addedCaps: ['generate'],
      removedCaps: [],
      think: null,
    });
    // Contrast: when the contributing role's Think does move, the row's delta says so.
    const moving = projectDraft(base, stage([override({ thinkMode: 'auto' })]));
    expect(groupOf(moving, 'gpt-5').fallbackDeltas.get('completion')?.think).toBe('auto');
    // Several contributing roles: the row's delta is THEIR union. agent-role (already
    // auto, listed first) and analysis-role ('') both list completion; only the LATER
    // contributor moves Think, so an implementation reading the first alone fails.
    const both = projectDraft(
      {
        ...base,
        models: base.models.map((model) =>
          model.role === 'agent-role'
            ? { ...model, thinkMode: 'auto' as const, routedUseCases: ['agent', 'completion'] }
            : model
        ),
      },
      stage([override({ thinkMode: 'auto' })])
    );
    expect(groupOf(both, 'gpt-5').fallbackDeltas.get('completion')).toEqual({
      addedCaps: ['generate'],
      removedCaps: [],
      think: 'auto',
    });
  });

  it('marks a defined model nothing routes as affected when its selector is overridden', () => {
    // spare-role sits on gpt-5 and routes nothing: SetRoleOverrides still rewrites it
    // (the override is keyed by selector), so its Defined-models row must say so.
    const withSpare: DraftBaseProjection = {
      ...base,
      models: [
        ...base.models,
        modelRow({ role: 'spare-role', modelName: 'gpt-5', ...caps(GPT5), routedUseCases: [] }),
      ],
    };
    const draft = stage([override()]);
    const projected = projectDraft(withSpare, draft);
    expect(groupOf(projected, 'gpt-5').affectedRoles).toEqual(['spare-role']);
    expect(projected.roleRows.get('spare-role')).toMatchObject({ affected: true, modified: false });
    expect(
      projectDraft(withSpare, { ...draft, needsReview: ['route:agent'] }).roleRows.get('spare-role')
        ?.needsReview
    ).toBe(true);
    // Contrast: when every role on gpt-5 already exposes what the override asserts
    // (one explicit override, folded across the selector), nothing changes.
    const already = projectDraft(
      {
        ...withSpare,
        models: withSpare.models.map((m) =>
          m.modelName === 'gpt-5' ? { ...m, ...caps([...GPT5, 'generate']) } : m
        ),
      },
      draft
    );
    expect(groupOf(already, 'gpt-5').affectedRoles).toEqual([]);
    expect(already.roleRows.has('spare-role')).toBe(false);
  });

  it('names the model facts a same-name change declares, and nothing for an override or a join', () => {
    // Same provider+model as chat-role, different parameters: not an override (the
    // facts differ), not a join (the role is already there).
    const facts = projectDraft(
      base,
      stage([
        routeChange({
          modelFacts: { provider: 'hosted', model: 'gpt-5-mini', type: 'dense', parameters: '7b' },
        }),
      ])
    );
    expect(groupOf(facts, 'gpt-5-mini').factsChanged).toEqual(['parameters 7b']);
    // An override shares every fact; a join's applied role is elsewhere.
    expect(groupOf(projectDraft(base, stage([override()])), 'gpt-5').factsChanged).toEqual([]);
    expect(
      groupOf(projectDraft(base, stage([override({ useCase: 'chat' })])), 'gpt-5').factsChanged
    ).toEqual([]);
  });

  it('reads a selector as empty when its only role is leaving', () => {
    // coding-role (completion only) retargets off gpt-coder while chat joins it: at
    // override time nothing sits there, so the join "routes chat" — not "also".
    const projected = projectDraft(
      base,
      stage([
        override({
          useCase: 'completion',
          modelFacts: { provider: 'hosted', model: 'gpt-6', type: 'dense' },
          capabilityFacts: { caps: ['chat', 'stream'], knownCaps: [...CAPABILITY_NAMES] },
          exposedCaps: ['chat', 'stream'],
        }),
        override({
          useCase: 'chat',
          modelFacts: { provider: 'hosted', model: 'gpt-coder', type: 'dense' },
          capabilityFacts: { caps: ['chat', 'stream'], knownCaps: [...CAPABILITY_NAMES] },
          exposedCaps: ['chat', 'stream'],
        }),
      ])
    );
    expect(groupOf(projected, 'gpt-coder').selectorHadRoles).toBe(false);
    expect(groupOf(projected, 'gpt-coder').joins).toEqual(['chat']);
    // Contrast: with completion staying, the selector had a role.
    const staying = projectDraft(
      base,
      stage([
        override({
          useCase: 'chat',
          modelFacts: { provider: 'hosted', model: 'gpt-coder', type: 'dense' },
          capabilityFacts: { caps: ['chat', 'stream'], knownCaps: [...CAPABILITY_NAMES] },
          exposedCaps: ['chat', 'stream'],
        }),
      ])
    );
    expect(groupOf(staying, 'gpt-coder').selectorHadRoles).toBe(true);
  });

  it('carries Think as a model delta only for an override group', () => {
    const joined = projectDraft(
      base,
      stage([override({ useCase: 'chat', exposedCaps: GPT5, thinkMode: 'always' })])
    );
    expect(groupOf(joined, 'gpt-5').think).toBeNull();
    expect(groupOf(joined, 'gpt-5').sameModel).toEqual([]);
    const overridden = projectDraft(
      base,
      stage([override({ exposedCaps: GPT5, thinkMode: 'always' })])
    );
    const group = groupOf(overridden, 'gpt-5');
    expect(group.addedCaps).toEqual([]);
    expect(group.think).toBe('always');
    expect(group.sameModel).toEqual(['analysis']);
    expect(group.fallback).toEqual(['completion']);
  });

  it('names a removal-only delta and a cleared Think', () => {
    const narrowed = projectDraft(
      base,
      stage([override({ exposedCaps: ['chat', 'stream', 'tool_call'] })])
    );
    expect(groupOf(narrowed, 'gpt-5').removedCaps).toEqual(['thinking']);
    expect(groupOf(narrowed, 'gpt-5').sameModel).toEqual(['analysis']);
    const thinking: DraftBaseProjection = {
      ...base,
      models: base.models.map((model) =>
        model.modelName === 'gpt-5' ? { ...model, thinkMode: 'auto' } : model
      ),
    };
    const cleared = projectDraft(thinking, stage([override({ exposedCaps: GPT5, thinkMode: '' })]));
    expect(groupOf(cleared, 'gpt-5').think).toBe('');
    expect(groupOf(cleared, 'gpt-5').sameModel).toEqual(['analysis']);
  });

  it('describes a join onto an empty selector by the configuration it sets', () => {
    const projected = projectDraft(
      base,
      stage([
        override({
          useCase: 'chat',
          modelFacts: { provider: 'hosted', model: 'gpt-6', type: 'dense' },
          thinkMode: 'auto',
        }),
      ])
    );
    const group = groupOf(projected, 'gpt-6');
    expect(group.selectorHadRoles).toBe(false);
    expect(group.staged).toEqual({
      exposedCaps: CAPABILITY_NAMES.filter((cap) => [...GPT5, 'generate'].includes(cap)),
      thinkMode: 'auto',
    });
    expect(group.addedCaps).toEqual([]);
    expect(group.think).toBeNull();
    expect(group.joins).toEqual(['chat']);
    expect(group.sameModel).toEqual([]);
    expect(group.fallback).toEqual([]);
  });

  it("keeps a route moving off an overridden selector out of that selector's reach", () => {
    // analysis leaves gpt-5 for gpt-5-mini while agent overrides gpt-5. analysis-role
    // still routes completion, so it forks and stays: completion is still reached.
    const projected = projectDraft(
      base,
      stage([
        override(),
        override({
          useCase: 'analysis',
          modelFacts: { provider: 'hosted', model: 'gpt-5-mini', type: 'dense' },
          exposedCaps: ['chat', 'stream'],
        }),
      ])
    );
    const gpt5Group = groupOf(projected, 'gpt-5');
    expect(gpt5Group.sameModel).toEqual([]);
    expect(gpt5Group.fallback).toEqual(['completion']);
    expect(projected.routeReach.get('analysis')).toMatchObject({ reach: 'edited' });
    expect(projected.routeReach.get('analysis')?.group.model).toBe('gpt-5-mini');
  });

  it('gives a route reached by two groups its highest reach, once', () => {
    // chat-role also lists analysis as a fallback; overriding both selectors reaches
    // analysis directly on gpt-5 and as a fallback on gpt-5-mini: same-model wins.
    const chained: DraftBaseProjection = {
      ...base,
      models: base.models.map((model) =>
        model.role === 'chat-role'
          ? { ...model, routedUseCases: ['chat', 'summarize', 'analysis'] }
          : model
      ),
    };
    const projected = projectDraft(
      chained,
      stage([
        override(),
        override({
          useCase: 'chat',
          modelFacts: { provider: 'hosted', model: 'gpt-5-mini', type: 'dense' },
          capabilityFacts: { caps: ['chat', 'stream'], knownCaps: [...CAPABILITY_NAMES] },
          exposedCaps: ['chat', 'stream', 'generate'],
        }),
      ])
    );
    expect(groupOf(projected, 'gpt-5').sameModel).toEqual(['analysis']);
    expect(groupOf(projected, 'gpt-5-mini').fallback).toEqual(['analysis']);
    expect(groupOf(projected, 'gpt-5-mini').sameModel).toEqual(['summarize']);
    expect(projected.routeReach.get('analysis')?.reach).toBe('same-model');
    expect(projected.routeRows.get('analysis')).toMatchObject({ modified: true, affected: true });
    const reached = new Set(
      projected.reachGroups.flatMap((group) => [
        ...group.edited.map((edit) => edit.useCase),
        ...group.sameModel,
        ...group.fallback,
      ])
    );
    expect([...reached].sort()).toEqual(['agent', 'analysis', 'chat', 'completion', 'summarize']);
  });

  it('keeps a staged unassignment on its own marker, outside every group', () => {
    const projected = projectDraft(base, stage([{ kind: 'route-unassign', useCase: 'chat' }]));
    expect(projected.reachGroups).toEqual([]);
    expect(projected.routeRows.get('chat')).toMatchObject({ modified: true, affected: false });
    expect(projected.routeReach.has('chat')).toBe(false);
  });

  it('ORs review state over every group that reaches a row', () => {
    const draft = stage([override()]);
    const projected = projectDraft({ ...base }, { ...draft, needsReview: ['route:agent'] });
    expect(projected.routeRows.get('analysis')?.needsReview).toBe(true);
    expect(projected.routeRows.get('completion')?.needsReview).toBe(true);
  });

  // Codex round-2 (plan rev 3): a staged route keeps its role's fallbacks
  // (SetRoleModel preserves them, ForkRoleModel copies them), so a use case
  // edited onto T is still reached through a changed role on S its chain meets.
  it('keeps a route edited elsewhere in the fallback reach of a selector its chain still meets', () => {
    // completion retargets coding-role (completion only) onto gpt-6 while agent
    // overrides gpt-5 with generate. analysis-role changes and still lists completion.
    const draft = stage([
      override(),
      override({
        useCase: 'completion',
        modelFacts: { provider: 'hosted', model: 'gpt-6', type: 'dense' },
        capabilityFacts: { caps: ['chat', 'stream'], knownCaps: [...CAPABILITY_NAMES] },
        exposedCaps: ['chat', 'stream'],
      }),
    ]);
    const projected = projectDraft(base, draft);
    expect(groupOf(projected, 'gpt-5').fallback).toEqual(['completion']);
    expect(groupOf(projected, 'gpt-6').edited).toEqual([
      { useCase: 'completion', was: { provider: 'hosted', model: 'gpt-coder' } },
    ]);
    // Its own edit wins the row; both memberships mark it; K counts it once.
    expect(projected.routeReach.get('completion')?.reach).toBe('edited');
    expect(projected.routeRows.get('completion')).toMatchObject({ modified: true, affected: true });
    const reached = new Set(
      projected.reachGroups.flatMap((group) => [
        ...group.edited.map((edit) => edit.useCase),
        ...group.sameModel,
        ...group.fallback,
      ])
    );
    expect([...reached].sort()).toEqual(['agent', 'analysis', 'completion']);
    // Review on gpt-5 alone reaches completion through the fallback membership.
    const reviewed = projectDraft(base, { ...draft, needsReview: ['route:agent'] });
    expect(reviewed.routeRows.get('completion')?.needsReview).toBe(true);
    // Contrast: an UNASSIGNED route leaves every chain, so it is in no group.
    const unassigned = projectDraft(
      base,
      stage([override(), { kind: 'route-unassign', useCase: 'completion' }])
    );
    expect(groupOf(unassigned, 'gpt-5').fallback).toEqual([]);
    expect(unassigned.routeReach.has('completion')).toBe(false);
  });

  it('reaches a route through a changed fallback role even when its own role shares the selector', () => {
    // agent-role and analysis-role both sit on gpt-5. analysis-role lists agent as a
    // fallback. agent-role already Thinks auto, so analysis's override to auto (with
    // the selector's own exposure) leaves agent-role unchanged — yet agent still
    // falls back to analysis-role, which changes. Fallback is decided by the
    // CONTRIBUTING ROLE's identity, never by the selectors differing.
    const listsAgent = (model: ModelProjection): ModelProjection =>
      model.role === 'analysis-role'
        ? { ...model, routedUseCases: ['agent', 'analysis', 'completion'] }
        : model;
    const shared: DraftBaseProjection = {
      ...base,
      models: base.models.map((model) =>
        model.role === 'agent-role' ? { ...model, thinkMode: 'auto' } : listsAgent(model)
      ),
    };
    const change = override({ useCase: 'analysis', exposedCaps: GPT5, thinkMode: 'auto' });
    const projected = projectDraft(shared, stage([change]));
    const group = groupOf(projected, 'gpt-5');
    expect(group.think).toBe('auto');
    expect(group.sameModel).toEqual([]);
    expect(group.fallback).toEqual(['agent', 'completion']);
    expect(projected.routeReach.get('agent')?.reach).toBe('fallback');
    // Contrast: when agent-role's own Think changes too, agent is same-model, not fallback.
    const own = projectDraft({ ...base, models: base.models.map(listsAgent) }, stage([change]));
    expect(groupOf(own, 'gpt-5').sameModel).toEqual(['agent']);
    expect(groupOf(own, 'gpt-5').fallback).toEqual(['completion']);
  });

  it('leaves a role departing the selector out of the Think delta', () => {
    // agent-role (agent only) retargets to gpt-6 keeping Think ''; analysis overrides
    // gpt-5 with generate at Think auto, which analysis-role already has. The
    // departing role's '' → auto is not a change on gpt-5: nothing staying changes Think.
    const auto: DraftBaseProjection = {
      ...base,
      models: base.models.map((model) =>
        model.role === 'analysis-role' ? { ...model, thinkMode: 'auto' } : model
      ),
    };
    const departing = stage([
      override({
        modelFacts: { provider: 'hosted', model: 'gpt-6', type: 'dense' },
        exposedCaps: GPT5,
      }),
      override({ useCase: 'analysis', thinkMode: 'auto' }),
    ]);
    const projected = projectDraft(auto, departing);
    const group = groupOf(projected, 'gpt-5');
    expect(group.think).toBeNull();
    expect(group.addedCaps).toEqual(['generate']);
    expect(group.sameModel).toEqual([]);
    expect(group.fallback).toEqual(['completion']);
    // Contrast: with agent-role staying, its '' → auto IS the selector's Think delta.
    const staying = projectDraft(
      auto,
      stage([override({ useCase: 'analysis', thinkMode: 'auto' })])
    );
    expect(groupOf(staying, 'gpt-5').think).toBe('auto');
    expect(groupOf(staying, 'gpt-5').sameModel).toEqual(['agent']);
  });
});

describe('reachOf (#311)', () => {
  // a falls back to b then c; b to d; c back to a (a cycle) and to d. d is on
  // selector X. The shortest chain wins, ties in authored order, and a cycle
  // terminates; an unrouted use case reaches nothing and a direct route has
  // no "via".
  const X = { provider: 'hosted', model: 'x-model' };
  const row = (role: string, modelName: string, fallbacks?: string[]): ModelProjection =>
    modelRow({
      role,
      modelName,
      routedUseCases: [],
      ...(fallbacks === undefined ? {} : { fallbacks }),
    });
  const base: DraftBaseProjection = {
    routes: [
      { useCase: 'agent', role: 'a' },
      { useCase: 'chat', role: 'd' },
    ],
    models: [
      row('a', 'a-model', ['b', 'c']),
      row('b', 'b-model', ['d']),
      row('c', 'c-model', ['a', 'd']),
      row('d', 'x-model'),
    ],
  };

  it('finds the shortest chain in authored order and terminates on a cycle', () => {
    expect(reachOf(base, 'agent', X)).toEqual(['a', 'b', 'd']);
  });

  it('reaches nothing for an unrouted use case, and attaches no via to a direct route', () => {
    expect(reachOf(base, 'planning', X)).toEqual([]);
    expect(reachOf(base, 'chat', X)).toEqual(['d']);
    expect(withReach([{ cap: 'tool_call', useCases: ['chat'] }], base, X)[0].via).toBeUndefined();
  });

  it('attaches no chain to a use case the change itself routes onto the selector', () => {
    // Promoting a fallback model to the use case's own: after the change it
    // runs there directly, so its applied chain is not how it gets there.
    expect(
      withReach([{ cap: 'tool_call', useCases: ['agent'] }], base, X)[0].via?.get('agent')
    ).toEqual(['a', 'b', 'd']);
    expect(
      withReach([{ cap: 'tool_call', useCases: ['agent'] }], base, X, ['agent'])[0].via
    ).toBeUndefined();
  });
});

describe('reach of a route edit, not its gate (#307)', () => {
  // The #307 reproduction: agent, analysis, chat, completion and reasoning run
  // on cloud-pro, which falls back to cloud-flash, which falls back to
  // cloud-mimo, so every one of them reaches cloud-mimo. cloud-mimo holds the
  // list its type derives, the one an older Firn wrote on every move.
  // code-review and embedding run on models no chain reaches.
  const DERIVED: CapabilityName[] = ['chat', 'generate', 'stream'];
  const REACHED = ['agent', 'analysis', 'chat', 'completion', 'reasoning'];
  const chainRow = (role: string, modelName: string, over: Partial<ModelProjection> = {}) =>
    modelRow({
      role,
      modelName,
      provider: 'opencode',
      type: 'moe',
      effectiveCapabilities: DERIVED,
      capabilityFacts: { caps: DERIVED, knownCaps: [...CAPABILITY_NAMES] },
      exposedCapabilities: DERIVED,
      routedUseCases: REACHED,
      ...over,
    });
  const pro = chainRow('cloud-pro', 'deepseek-v4-pro', { fallbacks: ['cloud-flash'] });
  const flash = chainRow('cloud-flash', 'deepseek-v4-flash', { fallbacks: ['cloud-mimo'] });
  const mimo = chainRow('cloud-mimo', 'mimo-v2.5', { capabilityOverride: DERIVED });
  const base: DraftBaseProjection = {
    routes: [
      ...REACHED.map((useCase) => ({ useCase, role: 'cloud-pro' })),
      { useCase: 'code-review', role: 'review-role' },
      { useCase: 'embedding', role: 'embed-role' },
    ],
    models: [
      pro,
      flash,
      mimo,
      chainRow('review-role', 'glm-review', { routedUseCases: ['code-review'] }),
      chainRow('embed-role', 'embed-model', {
        type: 'embedding',
        effectiveCapabilities: ['embed'],
        capabilityFacts: { caps: ['embed'], knownCaps: [...CAPABILITY_NAMES] },
        exposedCapabilities: ['embed'],
        routedUseCases: ['embedding'],
      }),
    ],
  };
  const marked = (projected: ProjectedDraft) =>
    [...projected.routeRows]
      .filter(([, markers]) => markers.modified || markers.affected === true)
      .map(([useCase, markers]) => [useCase, markers.modified ? 'modified' : 'affected']);

  it('marks only the edited route when the join changes nothing on the model it picks', () => {
    // Regression pin for #307's first defect, which no longer reproduces: rows
    // are marked by reach (the destination selector's changed roles), not by
    // the confirmation set, which still names the fork source's use cases and
    // cloud-mimo's because Go's verifyRouteConfirmations compares it whole.
    const join = probeRouteChange('analysis', mimo);
    const projected = projectDraft(base, stage([join]));
    expect(marked(projected)).toEqual([['analysis', 'modified']]);
    expect(projected.selectorUseCases.get('analysis')).toEqual(REACHED);
  });

  it('marks the routes that fall back to the model affected, never modified, once the join changes it', () => {
    const join = {
      ...probeRouteChange('analysis', mimo),
      exposedCaps: [...DERIVED, 'tool_call'] as CapabilityName[],
    };
    const projected = projectDraft(base, stage([join]));
    expect(marked(projected)).toEqual([
      ['analysis', 'modified'],
      ['agent', 'affected'],
      ['chat', 'affected'],
      ['completion', 'affected'],
      ['reasoning', 'affected'],
    ]);
  });

  it('reports what the edit changes, which the gate it is checked against can exceed', () => {
    const draft = cleanDraft(REVISION_A);
    const noOp = probeRouteChange('analysis', mimo);
    const reach = editReachFor(base, draft, noOp);
    expect(reach?.group).toMatchObject({ model: 'mimo-v2.5', sameModel: [], fallback: [] });
    expect(reach?.group.affectedRoles).toEqual([]);

    const widened = { ...noOp, exposedCaps: [...DERIVED, 'tool_call'] as CapabilityName[] };
    expect(editReachFor(base, draft, widened)?.group.fallback).toEqual([
      'agent',
      'chat',
      'completion',
      'reasoning',
    ]);

    // An owner's set is not the derived one, so a join exposing exactly it is
    // gated against every route on the selector, yet changes none of them.
    const OWNED: CapabilityName[] = ['chat', 'stream', 'tool_call'];
    const owned = chainRow('cloud-mimo', 'mimo-v2.5', {
      effectiveCapabilities: OWNED,
      exposedCapabilities: OWNED,
      capabilityOverride: OWNED,
    });
    const ownedBase: DraftBaseProjection = { ...base, models: [pro, flash, owned] };
    const join = probeRouteChange('analysis', owned);
    expect(governedUseCasesOf(ownedBase, draft, join)).toEqual([
      'analysis',
      'agent',
      'chat',
      'completion',
      'reasoning',
    ]);
    expect(editReachFor(ownedBase, draft, join)?.group).toMatchObject({
      sameModel: [],
      fallback: [],
    });
  });

  it('reaches no other role on the model when the join writes no capability list there', () => {
    // Codex round 1: embedding and an unrouted role sit on mixed-model and
    // derive embed from their type. chat joins it declared dense, exposing what
    // dense derives, so the backend sends no list and both keep embed. Neither
    // the rows nor the editor may say they change.
    const embedRow = (role: string, routedUseCases: string[]) =>
      modelRow({
        role,
        modelName: 'mixed-model',
        type: 'embedding',
        effectiveCapabilities: ['embed'],
        capabilityFacts: { caps: ['embed'], knownCaps: [...CAPABILITY_NAMES] },
        exposedCapabilities: ['embed'],
        routedUseCases,
      });
    const mixed: DraftBaseProjection = {
      routes: [
        { useCase: 'chat', role: 'chat-role' },
        { useCase: 'embedding', role: 'embed-role' },
      ],
      models: [modelRow(), embedRow('embed-role', ['embedding']), embedRow('unused-embed', [])],
    };
    const join = routeChange({
      modelFacts: { provider: 'hosted', model: 'mixed-model', type: 'dense' },
      capabilityFacts: { caps: DERIVED, knownCaps: [...CAPABILITY_NAMES] },
      exposedCaps: DERIVED,
    });
    const projected = projectDraft(mixed, stage([join]));
    expect(marked(projected)).toEqual([['chat', 'modified']]);
    expect(projected.roleRows.size).toBe(0);
    expect(editReachFor(mixed, cleanDraft(REVISION_A), join)?.group).toMatchObject({
      sameModel: [],
      affectedRoles: [],
    });
    // An empty exposure (hand-built only; the editor never stages one) writes
    // no list either, as selectorGroups' gates skips it.
    const empty = projectDraft(mixed, stage([{ ...join, exposedCaps: [] }]));
    expect(marked(empty)).toEqual([['chat', 'modified']]);
    expect(empty.roleRows.size).toBe(0);
    // A list it does write reaches both.
    const asserted = { ...join, exposedCaps: ['chat', 'stream'] as CapabilityName[] };
    expect(projectDraft(mixed, stage([asserted])).reachGroups[0]).toMatchObject({
      sameModel: ['embedding'],
      affectedRoles: ['unused-embed'],
    });
  });

  it('reaches the roles a departing owner leaves to derive their own set, when the join writes no list', () => {
    // Project review round 2: agent-role is gpt-5's only list holder (OWN) and
    // routes only agent; planning-role derives and shows the folded OWN.
    // agent retargets to claude, so the list leaves with it, and chat joins
    // gpt-5 with the derived set, which the backend sends without a list:
    // after Apply planning-role derives DERIVED, and its row says so.
    const OWN: CapabilityName[] = ['chat', 'stream', 'tool_call'];
    const onGpt5 = (over: Partial<ModelProjection>) =>
      modelRow({
        modelName: 'gpt-5',
        capabilityFacts: { caps: DERIVED, knownCaps: [...CAPABILITY_NAMES] },
        effectiveCapabilities: DERIVED,
        exposedCapabilities: OWN,
        ...over,
      });
    const leaving: DraftBaseProjection = {
      routes: [
        { useCase: 'agent', role: 'agent-role' },
        { useCase: 'chat', role: 'chat-role' },
        { useCase: 'planning', role: 'planning-role' },
      ],
      models: [
        onGpt5({
          role: 'agent-role',
          effectiveCapabilities: OWN,
          capabilityOverride: OWN,
          routedUseCases: ['agent'],
        }),
        modelRow(),
        onGpt5({ role: 'planning-role', routedUseCases: ['planning'] }),
      ],
    };
    const retarget = routeChange({
      useCase: 'agent',
      modelFacts: { provider: 'hosted', model: 'claude', type: 'dense' },
      exposedCaps: OWN,
    });
    const join = routeChange({
      modelFacts: { provider: 'hosted', model: 'gpt-5', type: 'dense' },
      capabilityFacts: { caps: DERIVED, knownCaps: [...CAPABILITY_NAMES] },
      exposedCaps: DERIVED,
    });
    expect(projectDraft(leaving, stage([retarget, join])).routeRows.get('planning')).toMatchObject({
      modified: true,
    });
    // The editor measures from the rest of the draft, where the retarget
    // already takes the list away: the join itself moves nothing more.
    expect(editReachFor(leaving, stage([retarget]), join)?.group.sameModel).toEqual([]);
    // With the owner staying, a join must expose its set (another is refused
    // as a selector conflict, #335) and changes nothing for planning.
    expect(
      projectDraft(leaving, stage([{ ...join, exposedCaps: OWN }])).routeRows.get('planning')
    ).toBeUndefined();
  });

  it('derives a role retyped in place from its new type once the model has no list left', () => {
    // Codex round 3: analysis-role (dense) and summary-role (embedding) both
    // hold embed on shared-model. analysis is retyped in place to embedding
    // without a list (the other holder still holds embed), then summarize
    // leaves. After Apply analysis-role derives embed from its NEW type: no
    // capability changes on the model.
    const EMBED: CapabilityName[] = ['embed'];
    const holder = (role: string, type: ModelType, useCase: string) =>
      modelRow({
        role,
        modelName: 'shared-model',
        type,
        effectiveCapabilities: EMBED,
        capabilityFacts: { caps: EMBED, knownCaps: [...CAPABILITY_NAMES] },
        exposedCapabilities: EMBED,
        capabilityOverride: EMBED,
        routedUseCases: [useCase],
      });
    const twoHolders: DraftBaseProjection = {
      routes: [
        { useCase: 'analysis', role: 'analysis-role' },
        { useCase: 'summarize', role: 'summary-role' },
      ],
      models: [
        holder('analysis-role', 'dense', 'analysis'),
        holder('summary-role', 'embedding', 'summarize'),
      ],
    };
    const retype = routeChange({
      useCase: 'analysis',
      modelFacts: { provider: 'hosted', model: 'shared-model', type: 'embedding' },
      capabilityFacts: { caps: EMBED, knownCaps: [...CAPABILITY_NAMES] },
      exposedCaps: EMBED,
    });
    const departure = routeChange({
      useCase: 'summarize',
      modelFacts: { provider: 'hosted', model: 'gpt-5-mini', type: 'dense' },
    });
    const group = projectDraft(twoHolders, stage([retype, departure])).reachGroups.find(
      (candidate) => candidate.model === 'shared-model'
    );
    expect(group).toMatchObject({ addedCaps: [], removedCaps: [], sameModel: [] });
  });

  it('names the capability change of an in-place retype on a model that holds no list', () => {
    // Codex round 4: analysis-role, the only role on solo-model, derives
    // chat, generate, stream as dense. Retyped in place to embedding with
    // embed (what embedding derives), it sends no list, and after Apply it
    // derives embed: the Apply summary names that delta, as develop did.
    const base: DraftBaseProjection = {
      routes: [{ useCase: 'analysis', role: 'analysis-role' }],
      models: [
        modelRow({
          role: 'analysis-role',
          modelName: 'solo-model',
          effectiveCapabilities: DERIVED,
          capabilityFacts: { caps: DERIVED, knownCaps: [...CAPABILITY_NAMES] },
          exposedCapabilities: DERIVED,
          routedUseCases: ['analysis'],
        }),
      ],
    };
    const retype = routeChange({
      useCase: 'analysis',
      modelFacts: { provider: 'hosted', model: 'solo-model', type: 'embedding' },
      capabilityFacts: { caps: ['embed'], knownCaps: [...CAPABILITY_NAMES] },
      exposedCaps: ['embed'],
    });
    expect(projectDraft(base, stage([retype])).reachGroups[0]).toMatchObject({
      addedCaps: ['embed'],
      removedCaps: ['chat', 'generate', 'stream'],
    });
  });

  it('measures the edit from the rest of the draft, not from the applied document', () => {
    // planning runs on gpt-5, which derives its set from its type. agent is
    // already staged onto gpt-5 with a list of its own, so the draft already
    // shows planning that list. chat joining with the same values changes
    // nothing more; chat joining with the derived set takes the list off
    // again, which moves planning and the staged agent back.
    const OWN: CapabilityName[] = ['chat', 'stream', 'tool_call'];
    const gpt5 = { provider: 'hosted', model: 'gpt-5', type: 'dense' } as const;
    const onGpt5: DraftBaseProjection = {
      routes: [
        { useCase: 'agent', role: 'agent-role' },
        { useCase: 'chat', role: 'chat-role' },
        { useCase: 'planning', role: 'planning-role' },
      ],
      models: [
        modelRow({ role: 'agent-role', modelName: 'gpt-4o', routedUseCases: ['agent'] }),
        modelRow(),
        modelRow({
          role: 'planning-role',
          modelName: 'gpt-5',
          effectiveCapabilities: DERIVED,
          capabilityFacts: { caps: DERIVED, knownCaps: [...CAPABILITY_NAMES] },
          exposedCapabilities: DERIVED,
          routedUseCases: ['planning'],
        }),
      ],
    };
    const join = (useCase: string, exposedCaps: CapabilityName[]) =>
      routeChange({
        useCase,
        modelFacts: gpt5,
        capabilityFacts: { caps: DERIVED, knownCaps: [...CAPABILITY_NAMES] },
        exposedCaps,
      });
    const draft = stage([join('agent', OWN)]);
    // Against the applied document planning changes either way.
    expect(projectDraft(onGpt5, stage([join('agent', OWN), join('chat', OWN)]))).toMatchObject({
      reachGroups: [{ sameModel: ['planning'] }],
    });

    expect(editReachFor(onGpt5, draft, join('chat', OWN))).toMatchObject({
      group: { sameModel: [], fallback: [], affectedRoles: [] },
      peersChange: false,
    });
    expect(editReachFor(onGpt5, draft, join('chat', DERIVED))).toMatchObject({
      group: { sameModel: ['planning'] },
      peersChange: true,
    });
  });
});
