import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ApplyBar } from '../../../components/GolemConfig/ApplyBar';
import { CAPABILITY_NAMES, type CapabilityName, type ModelProjection } from '../../../types/golem';
import {
  KeyVault,
  cleanDraft,
  projectDraft,
  stageChange,
  type Change,
  type DraftBaseProjection,
  type RouteChange,
} from '../../../types/golemConfig';

// ---------------------------------------------------------------------------
// Wave 6: the bar groups route changes by the model they land on and says
// what each group reaches — edited, same model, fallback — with K counted once.
// ---------------------------------------------------------------------------

const GPT5: CapabilityName[] = ['chat', 'stream', 'tool_call', 'thinking'];
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
const caps = (list: CapabilityName[]) => ({
  effectiveCapabilities: list,
  capabilityFacts: { caps: list, knownCaps: [...CAPABILITY_NAMES] },
  exposedCapabilities: list,
});
// agent-role and analysis-role share gpt-5; completion reaches gpt-5 only through
// analysis-role's chain; chat-role serves chat and summarize on gpt-5-mini.
const base: DraftBaseProjection = {
  routes: [
    { useCase: 'agent', role: 'agent-role' },
    { useCase: 'analysis', role: 'analysis-role' },
    { useCase: 'chat', role: 'chat-role' },
    { useCase: 'completion', role: 'coding-role' },
    { useCase: 'summarize', role: 'chat-role' },
  ],
  models: [
    modelRow({ role: 'agent-role', modelName: 'gpt-5', ...caps(GPT5), routedUseCases: ['agent'] }),
    modelRow({
      role: 'analysis-role',
      modelName: 'gpt-5',
      ...caps(GPT5),
      thinkMode: 'auto',
      routedUseCases: ['analysis', 'completion'],
    }),
    modelRow({ routedUseCases: ['chat', 'summarize'] }),
    modelRow({ role: 'coding-role', modelName: 'gpt-coder', routedUseCases: ['completion'] }),
  ],
};
const route = (over: Partial<RouteChange> = {}): RouteChange => ({
  kind: 'route',
  useCase: 'agent',
  modelFacts: { provider: 'hosted', model: 'gpt-5', type: 'dense' },
  capabilityFacts: { caps: GPT5, knownCaps: [...CAPABILITY_NAMES] },
  exposedCaps: [...GPT5, 'generate'],
  thinkMode: 'auto',
  confirmUnknown: false,
  ...over,
});
const toGpt6 = (useCase: string): RouteChange =>
  route({
    useCase,
    modelFacts: { provider: 'hosted', model: 'gpt-6', type: 'dense' },
    capabilityFacts: { caps: ['chat', 'stream'], knownCaps: [...CAPABILITY_NAMES] },
    exposedCaps: ['chat', 'stream'],
    thinkMode: 'auto',
  });

function renderBar(...changes: Change[]) {
  const draft = changes.reduce(
    (current, change) => stageChange(current, change, new KeyVault(new Map())),
    cleanDraft('0'.repeat(64))
  );
  const projected = projectDraft(base, draft);
  const onOpenChange = jest.fn();
  render(
    <ApplyBar
      source={draft.source}
      changes={projected.changes}
      reach={projected.reachGroups}
      count={changes.length}
      blocked={null}
      locked={false}
      discardLocked={false}
      onApply={() => {}}
      onDiscard={() => {}}
      onOpenChange={onOpenChange}
      onOpenSource={() => {}}
    />
  );
  return { onOpenChange, bar: screen.getByTestId('golem-config-draft') };
}

const group = (model: string) => screen.getByTestId(`reach-group-${model}`);
const badgeNames = (model: string) =>
  within(group(model))
    .getAllByRole('button')
    .slice(1) // the header is the first button
    .map((badge) => badge.textContent);

describe('Apply bar reach groups (wave 6)', () => {
  it('groups route changes by model: header with the delta, badges in a fixed order, WAS on a retarget', () => {
    const { bar } = renderBar(route(), toGpt6('chat'));
    expect(within(bar).getByText('2 staged changes')).toBeInTheDocument();
    // agent (edited), analysis (same model), completion (fallback), chat (edited): 4 routes.
    expect(within(bar).getByText('2 models · 4 routes affected')).toBeInTheDocument();

    const gpt5 = group('gpt-5');
    const header = within(gpt5).getAllByRole('button')[0];
    expect(header).toHaveTextContent('gpt-5');
    expect(header).toHaveTextContent('hosted');
    expect(header).toHaveTextContent('capabilities + generate');
    // No Think delta: analysis-role already Thinks auto; agent-role's '' → auto is a delta…
    // …so the header names it. (Per-role baselines; the override writes Think selector-wide.)
    expect(header).toHaveTextContent('Think auto');
    expect(badgeNames('gpt-5')).toEqual([
      'agentedited',
      'analysissame model',
      'completionfallback',
    ]);
    expect(within(gpt5).getByRole('button', { name: /^completion/ })).toHaveAttribute(
      'data-kind',
      'fallback'
    );
    // A divider sits between the same-model badges and the fallback ones.
    expect(within(gpt5).getByTestId('reach-divider')).toBeInTheDocument();

    // The empty selector describes what the new route sets, not a delta.
    const gpt6 = group('gpt-6');
    expect(within(gpt6).getAllByRole('button')[0]).toHaveTextContent(
      'routes chat · capabilities chat, stream · Think auto'
    );
    expect(within(gpt6).getByRole('button', { name: /^chat/ })).toHaveTextContent(
      'chatwasgpt-5-miniedited'
    );
    expect(within(gpt6).queryByTestId('reach-divider')).not.toBeInTheDocument();
  });

  it('opens the right row from a header, a same-model badge and a fallback badge', async () => {
    const { onOpenChange } = renderBar(route());
    const gpt5 = group('gpt-5');
    await userEvent.click(within(gpt5).getAllByRole('button')[0]);
    expect(onOpenChange).toHaveBeenLastCalledWith('route:agent');
    await userEvent.click(within(gpt5).getByRole('button', { name: /^analysis/ }));
    expect(onOpenChange).toHaveBeenLastCalledWith('route:analysis');
    await userEvent.click(within(gpt5).getByRole('button', { name: /^completion/ }));
    expect(onOpenChange).toHaveBeenLastCalledWith('route:completion');
  });

  it('counts a route reached by two groups once, and keeps an unassign outside K', () => {
    // completion is edited on gpt-6 AND a fallback member of gpt-5 (its role keeps its chain).
    const { bar } = renderBar(route(), toGpt6('completion'), {
      kind: 'route-unassign',
      useCase: 'summarize',
    });
    expect(within(bar).getByText('3 staged changes')).toBeInTheDocument();
    expect(within(bar).getByText('2 models · 3 routes affected')).toBeInTheDocument();
    expect(badgeNames('gpt-5')).toEqual([
      'agentedited',
      'analysissame model',
      'completionfallback',
    ]);
    expect(badgeNames('gpt-6')).toEqual(['completionwasgpt-coderedited']);
    // Non-route chips keep their grammar and follow the groups.
    const chip = within(bar).getByRole('button', { name: 'summarize · unassigned' });
    expect(
      group('gpt-6').compareDocumentPosition(chip) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('names a removal-only delta and a cleared Think', () => {
    renderBar(route({ exposedCaps: ['chat', 'stream', 'tool_call'], thinkMode: '' }));
    const header = within(group('gpt-5')).getAllByRole('button')[0];
    expect(header).toHaveTextContent('− thinking · Think cleared');
    expect(header).not.toHaveTextContent('capabilities +');
  });

  it('prints no reach line and no group when only non-route changes are staged', () => {
    const { bar } = renderBar({ kind: 'provider-key-set', name: 'hosted' });
    expect(within(bar).getByText('1 staged change')).toBeInTheDocument();
    expect(within(bar).queryByText(/routes affected/)).not.toBeInTheDocument();
    expect(screen.queryByTestId(/^reach-group-/)).not.toBeInTheDocument();
    expect(within(bar).getByRole('button', { name: 'hosted · API key' })).toBeInTheDocument();
  });
});
