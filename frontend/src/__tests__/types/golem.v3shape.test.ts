import fs from 'fs';
import path from 'path';
import { ai } from '../../wails/bindings';
import { parseSettingsProjection } from '../../types/golem';
import {
  parseCancelSettingsApplyResult,
  parseConfirmSettingsApplyRequest,
  parseGolemProfileLoadResult,
  parseSettingsApplyRequest,
  parseSettingsApplyResult,
  type ApplyMode,
} from '../../types/golemConfig';

// Wails v3 hands every binding result back as a generated CLASS instance, not
// the plain object v2 delivered. tsconfig sets useDefineForClassFields, so every
// declared optional field ("revision"?: string) is an OWN property valued
// `undefined` on every instance -- absent on the wire, present to Object.hasOwn.
// These tests pin the boundary validators to wire semantics: parsing a generated
// instance must match parsing the same JSON as a plain object, byte for byte.

const projectionCorpus = path.resolve(
  __dirname,
  '../../../../internal/ai/testdata/settings_contract'
);
const applyCorpus = path.resolve(
  __dirname,
  '../../../../internal/ai/testdata/settings_apply_contract'
);

type ProjectionFixture = { verdict: string; projection: Record<string, unknown> };
type ApplyFixture = { verdict: string; document: string; mode?: string; value: unknown };

// createFrom rewrites nested members on the object it is handed, so every call
// site gets its own copy -- and the copy is the exact JSON the wire would carry.
const wireCopy = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

const readFixture = <T>(dir: string, file: string): T =>
  JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')) as T;

const acceptFiles = (dir: string): string[] =>
  fs.readdirSync(dir).filter((file) => file.startsWith('accept-') && file.endsWith('.json'));

const fixtureMode = (fixture: ApplyFixture): ApplyMode => {
  if (fixture.mode !== 'apply' && fixture.mode !== 'create') {
    throw new Error(`${fixture.document}: unknown mode ${JSON.stringify(fixture.mode)}`);
  }
  return fixture.mode;
};

const parseDocument = (fixture: ApplyFixture, value: unknown): unknown => {
  switch (fixture.document) {
    case 'apply_request':
      return parseSettingsApplyRequest(value, fixtureMode(fixture));
    case 'confirm_request':
      return parseConfirmSettingsApplyRequest(value, fixtureMode(fixture));
    case 'apply_result':
      return parseSettingsApplyResult(value);
    case 'cancel_result':
      return parseCancelSettingsApplyResult(value);
    case 'profile_load_result':
      return parseGolemProfileLoadResult(value);
    default:
      throw new Error(`unknown document ${fixture.document}`);
  }
};

const instantiate = (fixture: ApplyFixture): unknown => {
  const source = wireCopy(fixture.value);
  switch (fixture.document) {
    case 'apply_request':
      return ai.SettingsApplyRequest.createFrom(source);
    case 'confirm_request':
      return ai.ConfirmSettingsApplyRequest.createFrom(source);
    case 'apply_result':
      return ai.SettingsApplyResult.createFrom(source);
    case 'cancel_result':
      return ai.CancelSettingsApplyResult.createFrom(source);
    case 'profile_load_result':
      return ai.GolemProfileLoadResult.createFrom(source);
    default:
      throw new Error(`unknown document ${fixture.document}`);
  }
};

describe('v3 generated class instances at the Golem boundary', () => {
  it('carries an absent optional as an own key valued undefined', () => {
    const fixture = readFixture<ProjectionFixture>(projectionCorpus, 'accept-missing-state.json');
    expect(Object.hasOwn(fixture.projection, 'revision')).toBe(false);

    const instance = ai.SettingsProjection.createFrom(wireCopy(fixture.projection));
    expect(Object.hasOwn(instance, 'revision')).toBe(true);
    expect(instance.revision).toBeUndefined();
  });

  describe('settings projection corpus', () => {
    const files = acceptFiles(projectionCorpus);

    it('has accept fixtures', () => {
      expect(files.length).toBeGreaterThan(0);
    });

    it.each(files)('%s parses the same as a SettingsProjection instance', (file) => {
      const fixture = readFixture<ProjectionFixture>(projectionCorpus, file);
      const fromWire = parseSettingsProjection(wireCopy(fixture.projection));
      const instance = ai.SettingsProjection.createFrom(wireCopy(fixture.projection));

      expect(() => parseSettingsProjection(instance)).not.toThrow();
      expect(parseSettingsProjection(instance)).toEqual(fromWire);
    });
  });

  describe('settings apply corpus', () => {
    const files = acceptFiles(applyCorpus);

    it('has accept fixtures', () => {
      expect(files.length).toBeGreaterThan(0);
    });

    it.each(files)('%s parses the same as a generated instance', (file) => {
      const fixture = readFixture<ApplyFixture>(applyCorpus, file);
      const fromWire = parseDocument(fixture, wireCopy(fixture.value));
      const instance = instantiate(fixture);

      expect(() => parseDocument(fixture, instance)).not.toThrow();
      expect(parseDocument(fixture, instance)).toEqual(fromWire);
    });
  });
});
