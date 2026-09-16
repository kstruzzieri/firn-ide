import { pendingOf, snapshotOf, type Seed } from '../../../components/GolemConfig/routeEdit';
import { CAPABILITY_NAMES, type ModelProjection } from '../../../types/golem';

const model = (over: Partial<ModelProjection> = {}): ModelProjection => ({
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

const seed = (over: Partial<Seed> = {}): Seed => ({
  provider: 'hosted',
  defined: model(),
  manual: null,
  exposed: ['chat', 'stream'],
  think: '',
  ackUnknown: false,
  ackDrops: false,
  ...over,
});

/**
 * One seed per facet `snapshotOf` compares, each differing from `base` in
 * exactly that facet, plus the two states that must NOT count as edits (a
 * second role on the same selector; a Think value left behind an unticked
 * `thinking`).
 */
const base = seed();
const variants: Record<string, Seed> = {
  base,
  otherRoleSameFacts: seed({ defined: model({ role: 'completion-role', routedUseCases: [] }) }),
  // The picker's one card for a selector may carry another role's resolved set.
  otherRoleOtherCaps: seed({
    defined: model({
      role: 'completion-role',
      routedUseCases: [],
      capabilityFacts: { caps: ['chat', 'stream', 'tool_call'], knownCaps: [...CAPABILITY_NAMES] },
    }),
  }),
  inactiveThink: seed({ think: 'auto' }),
  provider: seed({ provider: 'lan', defined: model({ provider: 'lan' }) }),
  otherModel: seed({ defined: model({ role: 'other-role', modelName: 'gpt-5' }) }),
  sameNameTwin: seed({ defined: model({ role: 'twin-role', parameters: '7B' }) }),
  // 256000 and 262144 both format as "256K ctx": the picker keeps two cards.
  ctxDecimal: seed({ defined: model({ role: 'dec-role', contextWindow: 256000 }) }),
  ctxBinary: seed({ defined: model({ role: 'bin-role', contextWindow: 262144 }) }),
  // Two embedding twins differing in dimensions only.
  dims768: seed({ defined: model({ role: 'd768', type: 'embedding', dimensions: 768 }) }),
  dims1024: seed({ defined: model({ role: 'd1024', type: 'embedding', dimensions: 1024 }) }),
  // The same name on another provider is another model: the Provider clause says so.
  otherProviderSameName: seed({
    provider: 'lan',
    defined: model({ role: 'lan-role', provider: 'lan', parameters: '7B' }),
  }),
  declaredSameName: seed({
    defined: null,
    manual: { model: 'gpt-5-mini', type: 'dense', caps: ['chat', 'stream'] },
  }),
  declaredOtherType: seed({
    defined: null,
    manual: { model: 'gpt-5-mini', type: 'moe', caps: ['chat', 'stream'] },
  }),
  declaredNoType: seed({
    defined: null,
    manual: { model: 'gpt-5-mini', type: '', caps: ['chat', 'stream'] },
  }),
  declaredMoreCaps: seed({
    defined: null,
    manual: { model: 'gpt-5-mini', type: 'dense', caps: ['chat', 'stream', 'tool_call'] },
  }),
  exposure: seed({ exposed: ['chat', 'stream', 'tool_call'] }),
  thinkOn: seed({ exposed: ['chat', 'stream', 'thinking'], think: 'auto' }),
  thinkOnDefault: seed({ exposed: ['chat', 'stream', 'thinking'] }),
  ackUnknown: seed({ ackUnknown: true }),
  ackDrops: seed({ ackDrops: true }),
  nothing: seed({ provider: '', defined: null, exposed: [] }),
  providerOnly: seed({ defined: null, exposed: [] }),
  // Assign on a floor-less use case, no provider: declare a name, then clear it.
  declaredNoName: seed({
    provider: '',
    defined: null,
    manual: { model: '', type: '', caps: [] },
    exposed: [],
  }),
};

describe('routeEdit', () => {
  it('names a pending change exactly when the snapshots differ, for every pair of states', () => {
    const names = Object.keys(variants);
    for (const a of names) {
      for (const b of names) {
        const now = variants[a];
        const was = variants[b];
        const differs = snapshotOf(now, 'stage') !== snapshotOf(was, 'row');
        const named = pendingOf(now, was).length > 0;
        expect({ now: a, was: b, named }).toEqual({ now: a, was: b, named: differs });
      }
    }
  });

  it('compares model facts, never the role: a second role on the same selector is no edit', () => {
    expect(snapshotOf(variants.otherRoleSameFacts, 'stage')).toBe(snapshotOf(base, 'row'));
    expect(pendingOf(variants.otherRoleSameFacts, base)).toEqual([]);
    // …unless the card carries another role's resolved capabilities.
    expect(pendingOf(variants.otherRoleOtherCaps, base)).toEqual(['Declares: + tool_call']);
  });

  it('stages Think only while thinking is exposed, but the row holds it raw', () => {
    // A value left behind an untick is nothing Done would stage: no edit.
    expect(snapshotOf(variants.inactiveThink, 'stage')).toBe(snapshotOf(base, 'row'));
    expect(pendingOf(variants.inactiveThink, base)).toEqual([]);
    // A row holding `auto` behind an unexposed thinking: Done clears it, and
    // says so before a single edit.
    expect(pendingOf(base, variants.inactiveThink)).toEqual(['Think mode: cleared (was Auto)']);
    expect(pendingOf(variants.inactiveThink, variants.inactiveThink)).toEqual([
      'Think mode: cleared (was Auto)',
    ]);
  });

  it('says what Done clears when thinking is unticked, and what the select reads while it is on', () => {
    expect(pendingOf(base, variants.thinkOn)).toEqual([
      'Capabilities: − thinking',
      'Think mode: cleared (was Auto)',
    ]);
    expect(pendingOf(variants.thinkOnDefault, variants.thinkOn)).toEqual([
      'Think mode: Default (was Auto)',
    ]);
    expect(pendingOf(variants.thinkOn, variants.thinkOnDefault)).toEqual([
      'Think mode: Auto (was Default)',
    ]);
  });

  it('tells two same-named list models apart by their facts, raw when the lines read alike', () => {
    expect(pendingOf(variants.sameNameTwin, base)).toEqual(['Model: gpt-5-mini 7B (was —)']);
    expect(pendingOf(base, variants.sameNameTwin)).toEqual(['Model: gpt-5-mini — (was 7B)']);
    expect(pendingOf(variants.ctxDecimal, base)).toEqual(['Model: gpt-5-mini 256K ctx (was —)']);
    expect(snapshotOf(variants.ctxBinary, 'stage')).not.toBe(
      snapshotOf(variants.ctxDecimal, 'row')
    );
    expect(pendingOf(variants.ctxBinary, variants.ctxDecimal)).toEqual([
      'Model: gpt-5-mini 262144 ctx (was 256000 ctx)',
    ]);
    expect(pendingOf(variants.dims1024, variants.dims768)).toEqual([
      'Model: gpt-5-mini 1024 dim (was 768 dim)',
    ]);
    // Another provider's same-named model: one clause, the model implied — its
    // facts, declaration and type included.
    expect(pendingOf(variants.otherProviderSameName, base)).toEqual(['Provider: lan (was hosted)']);
    expect(pendingOf(variants.provider, variants.otherRoleOtherCaps)).toEqual([
      'Provider: lan (was hosted)',
    ]);
    expect(pendingOf(variants.provider, variants.declaredOtherType)).toEqual([
      'Provider: lan (was hosted)',
    ]);
  });

  it('reads a hand declaration that repeats a list model as clean: Done would stage the same', () => {
    expect(snapshotOf(variants.declaredSameName, 'stage')).toBe(snapshotOf(base, 'row'));
    expect(pendingOf(variants.declaredSameName, base)).toEqual([]);
    expect(pendingOf(variants.declaredOtherType, base)).toEqual([
      'Type: Mixture of experts (was Dense)',
    ]);
    expect(pendingOf(variants.declaredNoType, base)).toEqual(['Type: — (was Dense)']);
    expect(pendingOf(variants.declaredMoreCaps, base)).toEqual(['Declares: + tool_call']);
    expect(pendingOf(variants.declaredSameName, variants.declaredMoreCaps)).toEqual([
      'Declares: − tool_call',
    ]);
    // Provenance words the clause once the facts differ.
    expect(pendingOf(variants.declaredSameName, variants.sameNameTwin)).toEqual([
      'Model: gpt-5-mini declared by hand (was 7B)',
    ]);
    expect(pendingOf(variants.sameNameTwin, variants.declaredSameName)).toEqual([
      'Model: gpt-5-mini 7B (was declared by hand)',
    ]);
  });

  it('lets the Model clause carry another model’s facts and type: no Declares or Type clause for a pick', () => {
    expect(pendingOf(variants.otherModel, base)).toEqual(['Model: gpt-5 (was gpt-5-mini)']);
    expect(pendingOf(variants.declaredMoreCaps, variants.otherModel)).toEqual([
      'Model: gpt-5-mini (was gpt-5)',
    ]);
    expect(
      pendingOf(seed({ defined: model({ role: 'moe-role', modelName: 'mix', type: 'moe' }) }), base)
    ).toEqual(['Model: mix (was gpt-5-mini)']);
  });

  it('reads the placeholders for an empty editor', () => {
    expect(pendingOf(variants.nothing, base)).toEqual([
      'Provider: — (was hosted)',
      'Model: — (was gpt-5-mini)',
      'Capabilities: − chat, stream',
    ]);
    expect(pendingOf(variants.providerOnly, variants.nothing)).toEqual([
      'Provider: hosted (was —)',
    ]);
    // Assigning a thinking model onto an unbound row: the row showed no Think.
    expect(pendingOf(variants.thinkOn, variants.nothing)).toEqual([
      'Provider: hosted (was —)',
      'Model: gpt-5-mini (was —)',
      'Capabilities: + chat, stream, thinking',
      'Think mode: Auto (was —)',
    ]);
    // An empty declare form with nothing chosen stages nothing either: clean.
    expect(snapshotOf(variants.declaredNoName, 'stage')).toBe(snapshotOf(variants.nothing, 'row'));
    expect(pendingOf(variants.declaredNoName, variants.nothing)).toEqual([]);
  });

  it('names each side a checklist gains or loses, and the Think a hidden select would clear', () => {
    expect(pendingOf(variants.exposure, variants.thinkOn)).toEqual([
      'Capabilities: + tool_call',
      'Capabilities: − thinking',
      'Think mode: cleared (was Auto)',
    ]);
  });

  it('names the acknowledgements both ways', () => {
    expect(pendingOf(variants.ackUnknown, base)).toEqual(['Apply anyway: acknowledged']);
    expect(pendingOf(base, variants.ackUnknown)).toEqual(['Apply anyway: not acknowledged']);
    expect(pendingOf(variants.ackDrops, base)).toEqual(['Removal: acknowledged']);
    expect(pendingOf(base, variants.ackDrops)).toEqual(['Removal: not acknowledged']);
  });
});
