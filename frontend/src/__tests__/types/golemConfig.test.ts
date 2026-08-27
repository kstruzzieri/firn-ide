import fs from 'fs';
import path from 'path';
import { GolemContractError } from '../../types/golem';
import {
  parseCancelSettingsApplyResult,
  parseConfirmSettingsApplyRequest,
  parseGolemProfileLoadResult,
  parseSettingsApplyRequest,
  parseSettingsApplyResult,
  type ApplyMode,
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
    expect(result.challenge.destination.classification).toBe('remote');
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
