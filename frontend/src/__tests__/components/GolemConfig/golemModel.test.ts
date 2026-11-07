import fs from 'fs';
import path from 'path';
import { golemModelVerdict, GOLEM_FLOOR } from '../../../components/GolemConfig/golemModel';
import { roleChain } from '../../../components/GolemConfig/routingRows';
import { CAPABILITY_NAMES, type ModelProjection } from '../../../types/golem';
import { cssRule } from '../../helpers/cssRule';

const model = (over: Partial<ModelProjection> = {}): ModelProjection => ({
  role: 'r',
  modelName: 'm',
  provider: 'p',
  type: 'dense',
  effectiveCapabilities: ['chat', 'generate', 'stream'],
  capabilityFacts: { caps: ['chat', 'generate', 'stream'], knownCaps: [...CAPABILITY_NAMES] },
  exposedCapabilities: ['chat', 'generate', 'stream'],
  thinkMode: '',
  routedUseCases: [],
  hasThinkTags: false,
  hasSlots: false,
  removable: false,
  ...over,
});

describe('golemModelVerdict', () => {
  it("states agent's floor", () => {
    expect(GOLEM_FLOOR).toEqual(['chat', 'stream', 'tool_call']);
  });

  it('lets a model with no shortfall run Golem', () => {
    expect(golemModelVerdict(model(), [])).toEqual({ eligible: true });
  });

  it('says a missing tool_call is not verified, never that the model lacks it', () => {
    expect(golemModelVerdict(model(), [{ cap: 'tool_call', useCases: ['agent'] }])).toEqual({
      eligible: false,
      reason: 'Tool support not verified',
    });
  });

  it('names an embedding model by its type', () => {
    const embedding = model({
      type: 'embedding',
      capabilityFacts: { caps: ['embed'], knownCaps: [...CAPABILITY_NAMES] },
      exposedCapabilities: ['embed'],
    });
    const short = (['chat', 'stream', 'tool_call'] as const).map((cap) => ({
      cap,
      useCases: ['agent'],
    }));
    expect(golemModelVerdict(embedding, short)).toEqual({
      eligible: false,
      reason: "Embedding model: can't chat",
    });
  });

  it('names every other missing capability in canonical order', () => {
    expect(
      golemModelVerdict(model(), [
        { cap: 'chat', useCases: ['agent'] },
        { cap: 'stream', useCases: ['agent'] },
        { cap: 'tool_call', useCases: ['agent'] },
      ])
    ).toEqual({ eligible: false, reason: "Can't chat · Can't stream · Tool support not verified" });
  });
});

describe('roleChain', () => {
  const role = (name: string, fallbacks?: string[]) =>
    model({ role: name, modelName: `${name}-model`, ...(fallbacks ? { fallbacks } : {}) });

  it('walks fallbacks depth first in declared order and names each role once', () => {
    // The mockup fixture's diamond: general reaches lightweight directly and
    // through fast; RoleChain keeps its first place.
    const models = [
      role('general', ['fast', 'lightweight', 'cc-pro']),
      role('fast', ['lightweight', 'cc-coder']),
      role('lightweight'),
      role('cc-coder', ['cc-pro']),
      role('cc-pro', ['cc-flash']),
      role('cc-flash'),
    ];
    expect(roleChain('general', models)).toEqual([
      'fast',
      'lightweight',
      'cc-coder',
      'cc-pro',
      'cc-flash',
    ]);
  });

  it('reads an empty chain for a role with no fallbacks or an unknown role', () => {
    expect(roleChain('solo', [role('solo')])).toEqual([]);
    expect(roleChain('missing', [])).toEqual([]);
  });

  it('skips a role whose model is already in the chain, as the resolver does, but walks its fallbacks', () => {
    // go-llm RoleChain dedupes provider/model selectors, not role names.
    const models = [
      model({ role: 'main', modelName: 'same', fallbacks: ['alias'] }),
      model({ role: 'alias', modelName: 'same', fallbacks: ['backup'] }),
      model({ role: 'backup', modelName: 'other' }),
    ];
    expect(roleChain('main', models)).toEqual(['backup']);
  });

  it("starts from a staged model when one replaces the role's own", () => {
    const models = [
      model({ role: 'fast', modelName: 'qwen', fallbacks: ['light', 'coder'] }),
      model({ role: 'light', modelName: 'glm' }),
      model({ role: 'coder', modelName: 'kimi' }),
    ];
    // Staged onto glm, the role keeps its fallbacks; light's glm is already first.
    expect(roleChain('fast', models, { provider: 'p', model: 'glm' })).toEqual(['coder']);
    expect(roleChain('fast', models)).toEqual(['light', 'coder']);
  });

  it('never revisits the role it starts from', () => {
    expect(roleChain('a', [role('a', ['b']), role('b', ['a'])])).toEqual(['b']);
  });
});

describe('the folds #490 hides with the hidden attribute', () => {
  // jsdom loads no stylesheet, so a fold whose class sets `display` would
  // read as hidden in a test and still show in the WebView: the author
  // `display` beats the user agent's `[hidden] { display: none }`.
  const css = fs.readFileSync(
    path.resolve(__dirname, '../../../components/GolemConfig/GolemConfig.module.css'),
    'utf8'
  );
  it.each(['.cardBody', '.golemPicker', '.cannotList', '.answers'])(
    '%s[hidden] is display: none',
    (selector) => {
      expect(cssRule(css, `${selector}[hidden]`)).toMatch(/display:\s*none/);
    }
  );
});
