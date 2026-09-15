import {
  effectiveThink,
  pendingOf,
  snapshotOf,
  type Seed,
} from '../../../components/GolemConfig/routeEdit';
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
  inactiveThink: seed({ think: 'auto' }),
  provider: seed({ provider: 'lan', defined: model({ provider: 'lan' }) }),
  otherModel: seed({ defined: model({ role: 'other-role', modelName: 'gpt-5' }) }),
  sameNameTwin: seed({ defined: model({ role: 'twin-role', parameters: '7B' }) }),
  declaredSameName: seed({
    defined: null,
    manual: { model: 'gpt-5-mini', type: 'dense', caps: ['chat', 'stream'] },
  }),
  declaredOtherType: seed({
    defined: null,
    manual: { model: 'gpt-5-mini', type: 'moe', caps: ['chat', 'stream'] },
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
        const differs = snapshotOf(now) !== snapshotOf(was);
        const named = pendingOf(now, was).length > 0;
        expect({ now: a, was: b, named }).toEqual({ now: a, was: b, named: differs });
      }
    }
  });

  it('compares model facts, never the role: a second role on the same selector is no edit', () => {
    expect(snapshotOf(variants.otherRoleSameFacts)).toBe(snapshotOf(base));
    expect(pendingOf(variants.otherRoleSameFacts, base)).toEqual([]);
  });

  it('counts Think only while thinking is exposed: a value left behind an untick is no edit', () => {
    expect(effectiveThink(variants.inactiveThink)).toBe('');
    expect(snapshotOf(variants.inactiveThink)).toBe(snapshotOf(base));
    expect(pendingOf(variants.inactiveThink, base)).toEqual([]);
  });

  it('says what Done clears when thinking is unticked, and what the select reads while it is on', () => {
    expect(pendingOf(base, variants.thinkOn)).toEqual(['− thinking', 'Think cleared (was Auto)']);
    expect(pendingOf(variants.thinkOnDefault, variants.thinkOn)).toEqual([
      'Think Default (was Auto)',
    ]);
    expect(pendingOf(variants.thinkOn, variants.thinkOnDefault)).toEqual([
      'Think Auto (was Default)',
    ]);
  });

  it('tells two same-named list models apart by their facts', () => {
    expect(pendingOf(variants.sameNameTwin, base)).toEqual(['Model gpt-5-mini 7B (was —)']);
    expect(pendingOf(base, variants.sameNameTwin)).toEqual(['Model gpt-5-mini — (was 7B)']);
  });

  it('names a hand declaration of the same name, and its type and declared caps', () => {
    expect(pendingOf(variants.declaredSameName, base)).toEqual([
      'Model gpt-5-mini declared by hand',
    ]);
    expect(pendingOf(base, variants.declaredSameName)).toEqual(['Model gpt-5-mini from the list']);
    expect(pendingOf(variants.declaredOtherType, base)).toEqual([
      'Model gpt-5-mini declared by hand',
      'Type moe (was dense)',
    ]);
    expect(pendingOf(variants.declaredMoreCaps, variants.declaredSameName)).toEqual([
      'Declares + tool_call',
    ]);
    expect(pendingOf(variants.declaredSameName, variants.declaredMoreCaps)).toEqual([
      'Declares − tool_call',
    ]);
  });

  it('lets the Model clause carry another model’s facts: no Declares clause for a pick', () => {
    expect(pendingOf(variants.otherModel, base)).toEqual(['Model gpt-5 (was gpt-5-mini)']);
    expect(pendingOf(variants.declaredMoreCaps, variants.otherModel)).toEqual([
      'Model gpt-5-mini (was gpt-5)',
    ]);
  });

  it('reads the placeholders for an empty editor', () => {
    expect(pendingOf(variants.nothing, base)).toEqual([
      'Provider — (was hosted)',
      'Model — (was gpt-5-mini)',
      'Type — (was dense)',
      '− chat, stream',
    ]);
    expect(pendingOf(variants.providerOnly, variants.nothing)).toEqual(['Provider hosted (was —)']);
    expect(pendingOf(variants.declaredNoName, variants.nothing)).toEqual([
      'Model — declared by hand',
    ]);
  });

  it('names the acknowledgements both ways', () => {
    expect(pendingOf(variants.ackUnknown, base)).toEqual(['Apply anyway acknowledged']);
    expect(pendingOf(base, variants.ackUnknown)).toEqual(['Apply anyway withdrawn']);
    expect(pendingOf(variants.ackDrops, base)).toEqual(['Removal acknowledged']);
    expect(pendingOf(base, variants.ackDrops)).toEqual(['Removal acknowledgement withdrawn']);
  });
});
