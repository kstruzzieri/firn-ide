/**
 * #493: the frontend half of the shared gate fixture
 * (internal/ai/testdata/apply_gates). apply_gates_test.go runs the same cases
 * through Apply; here the same projections run through what the editor and
 * the Golem model picker read, so the picker never offers a model Apply would
 * refuse and both ends ask about the same use cases.
 */

import fs from 'fs';
import path from 'path';
import {
  CAPABILITY_NAMES,
  parseSettingsProjection,
  type CapabilityName,
  type ModelProjection,
  type ModelType,
} from '../../types/golem';
import {
  KeyVault,
  USE_CASE_FLOORS,
  affectedUseCases,
  cleanDraft,
  floorShortfalls,
  governedUseCasesOf,
  projectDraft,
  stageChange,
  touchedUseCasesOf,
  type DraftBaseProjection,
  type RouteChange,
} from '../../types/golemConfig';
import { golemModelVerdict } from '../../components/GolemConfig/golemModel';

const fixtureDir = path.resolve(__dirname, '../../../../internal/ai/testdata/apply_gates');
const read = <T>(name: string): T =>
  JSON.parse(fs.readFileSync(path.join(fixtureDir, name), 'utf8')) as T;

interface GateCase {
  name: string;
  base: string;
  useCase: string;
  card: { provider: string; model: string; type: ModelType; exposedCaps: CapabilityName[] };
  touched: string[];
  asks: string[];
  refused: string[];
  picker: string[];
  refusedForEveryCard?: string;
}

const { cases } = read<{ cases: GateCase[] }>('cases.json');
const projections = read<Record<string, unknown>>('projections.json');

const baseOf = (name: string): DraftBaseProjection => {
  const { routes, models } = parseSettingsProjection(projections[name]);
  return { routes, models };
};

/** The change the editor stages for the card, before any acknowledgement. */
const changeOf = ({ useCase, card }: GateCase): RouteChange => ({
  kind: 'route',
  useCase,
  modelFacts: { provider: card.provider, model: card.model, type: card.type },
  capabilityFacts: { caps: [...card.exposedCaps], knownCaps: [...CAPABILITY_NAMES] },
  exposedCaps: CAPABILITY_NAMES.filter((cap) => card.exposedCaps.includes(cap)),
  thinkMode: '',
  confirmUnknown: false,
});

const sorted = (values: Iterable<string>): string[] => [...values].sort();

describe('the shared gate fixture', () => {
  it.each(cases.map((gate) => [gate.name, gate] as const))('%s', (_name, gate) => {
    const base = baseOf(gate.base);
    const draft = cleanDraft();
    const change = changeOf(gate);

    expect(sorted(touchedUseCasesOf(base, [change]))).toEqual(gate.touched);

    // The acknowledgement the editor asks for, and the one Apply sends.
    const asks = affectedUseCases(base, draft, change).filter(
      (useCase) => !USE_CASE_FLOORS.has(useCase)
    );
    expect(sorted(asks)).toEqual(gate.asks);
    const [sent] = projectDraft(base, stageChange(draft, change, new KeyVault(new Map())))
      .changes as RouteChange[];
    expect(sent.confirmUnknownUseCases).toEqual(gate.asks.length > 0 ? gate.asks : undefined);

    // The picker's verdict for the card.
    const short = floorShortfalls(change.exposedCaps, governedUseCasesOf(base, draft, change));
    expect(sorted(new Set(short.flatMap(({ useCases }) => useCases)))).toEqual(gate.picker);
    const card = { type: gate.card.type } as ModelProjection;
    expect(golemModelVerdict(card, short).eligible).toBe(gate.picker.length === 0);
    if (gate.refusedForEveryCard === undefined) expect(gate.picker).toEqual(gate.refused);
  });
});
