import fs from 'fs';
import path from 'path';
import {
  parseSettingsProjection,
  parseSettingsReloadResult,
  GolemContractError,
  type SettingsProjection,
} from '../../types/golem';

const validProjection = (): Record<string, unknown> => ({
  state: 'ready',
  sourceOrigin: 'user_config',
  routes: [{ useCase: 'agent', role: 'agent-m' }],
  models: [
    {
      role: 'agent-m',
      modelName: 'wire-model',
      provider: 'hosted',
      type: 'dense',
      effectiveCapabilities: ['chat', 'stream', 'tool_call'],
      thinkMode: '',
    },
  ],
  providers: [
    {
      name: 'hosted',
      endpoint: 'https://api.example.com:8443/v1',
      classification: 'remote',
      apiFormat: 'openai-compat',
      credentialState: 'available',
    },
  ],
  diagnostics: [{ code: 'agent_role_missing', subjectKind: '', subjectName: '', blocking: true }],
});

describe('parseSettingsProjection', () => {
  it('accepts a full valid projection', () => {
    const p: SettingsProjection = parseSettingsProjection(validProjection());
    expect(p.state).toBe('ready');
    expect(p.providers[0].classification).toBe('remote');
  });

  it.each([
    [
      'unknown state',
      (v: Record<string, unknown>) => {
        v.state = 'weird';
      },
    ],
    [
      'unknown sourceOrigin',
      (v: Record<string, unknown>) => {
        v.sourceOrigin = 'somewhere';
      },
    ],
    [
      'null collections',
      (v: Record<string, unknown>) => {
        v.routes = null;
      },
    ],
    [
      'missing collections',
      (v: Record<string, unknown>) => {
        delete v.diagnostics;
      },
    ],
    [
      'null nested capabilities',
      (v: Record<string, unknown>) => {
        (v.models as Record<string, unknown>[])[0].effectiveCapabilities = null;
      },
    ],
    [
      'missing nested key',
      (v: Record<string, unknown>) => {
        delete (v.routes as Record<string, unknown>[])[0].useCase;
      },
    ],
    [
      'unknown classification',
      (v: Record<string, unknown>) => {
        (v.providers as Record<string, unknown>[])[0].classification = 'lan';
      },
    ],
    [
      'unknown credentialState',
      (v: Record<string, unknown>) => {
        (v.providers as Record<string, unknown>[])[0].credentialState = 'maybe';
      },
    ],
    [
      'unknown capability',
      (v: Record<string, unknown>) => {
        (v.models as Record<string, unknown>[])[0].effectiveCapabilities = ['chat', 'telepathy'];
      },
    ],
    [
      'eight capabilities',
      (v: Record<string, unknown>) => {
        (v.models as Record<string, unknown>[])[0].effectiveCapabilities = [
          'chat',
          'chat',
          'chat',
          'chat',
          'chat',
          'chat',
          'chat',
          'chat',
        ];
      },
    ],
    [
      'unknown diagnostic code',
      (v: Record<string, unknown>) => {
        (v.diagnostics as Record<string, unknown>[])[0].code = 'future_code';
      },
    ],
    [
      'empty provider name',
      (v: Record<string, unknown>) => {
        (v.providers as Record<string, unknown>[])[0].name = '';
      },
    ],
    [
      'oversized routes',
      (v: Record<string, unknown>) => {
        v.routes = Array.from({ length: 257 }, (_, i) => ({ useCase: `u${i}`, role: 'r' }));
      },
    ],
    [
      'oversized endpoint',
      (v: Record<string, unknown>) => {
        (v.providers as Record<string, unknown>[])[0].endpoint = `http://h/${'a'.repeat(1024)}`;
      },
    ],
    [
      'identifier over byte bound via multibyte',
      (v: Record<string, unknown>) => {
        (v.routes as Record<string, unknown>[])[0].role = 'é'.repeat(129); // 258 UTF-8 bytes
      },
    ],
    [
      'unknown top-level key',
      (v: Record<string, unknown>) => {
        v.extra = 1;
      },
    ],
    [
      'unknown provider key',
      (v: Record<string, unknown>) => {
        (v.providers as Record<string, unknown>[])[0].timeout = 5;
      },
    ],
    [
      'bidi override in an identifier',
      (v: Record<string, unknown>) => {
        (v.routes as Record<string, unknown>[])[0].role = 'agent\u202Em'; // RLO
      },
    ],
    [
      'control character in an identifier',
      (v: Record<string, unknown>) => {
        (v.providers as Record<string, unknown>[])[0].name = 'lo\u0007cal'; // BEL
      },
    ],
  ])('rejects %s', (_name, mutate) => {
    const value = validProjection();
    mutate(value);
    expect(() => parseSettingsProjection(value)).toThrow(GolemContractError);
  });

  it('accepts explicit empty useCase and role (go-llm permits empty map keys)', () => {
    const value = validProjection();
    (value.routes as Record<string, unknown>[])[0].useCase = '';
    (value.routes as Record<string, unknown>[])[0].role = '';
    (value.models as Record<string, unknown>[])[0].role = '';
    expect(() => parseSettingsProjection(value)).not.toThrow();
  });

  it('accepts an identifier at exactly 256 bytes, multibyte included', () => {
    const value = validProjection();
    (value.routes as Record<string, unknown>[])[0].role = 'é'.repeat(128); // 256 UTF-8 bytes
    expect(() => parseSettingsProjection(value)).not.toThrow();
  });

  it('accepts 257 diagnostics (worst case) and rejects 258', () => {
    const diag = {
      code: 'provider_endpoint_unsupported',
      subjectKind: 'provider',
      subjectName: 'p',
      blocking: false,
    };
    const at = validProjection();
    at.diagnostics = Array.from({ length: 257 }, () => ({ ...diag }));
    expect(() => parseSettingsProjection(at)).not.toThrow();
    const over = validProjection();
    over.diagnostics = Array.from({ length: 258 }, () => ({ ...diag }));
    expect(() => parseSettingsProjection(over)).toThrow(GolemContractError);
  });

  it('treats empty collections as empty arrays', () => {
    const value = { ...validProjection(), routes: [], models: [], providers: [], diagnostics: [] };
    expect(parseSettingsProjection(value).routes).toEqual([]);
  });
});

describe('parseSettingsReloadResult', () => {
  it('accepts busy + projection', () => {
    const r = parseSettingsReloadResult({ busy: true, projection: validProjection() });
    expect(r.busy).toBe(true);
  });
  it('rejects a missing projection', () => {
    expect(() => parseSettingsReloadResult({ busy: false })).toThrow(GolemContractError);
  });
  it('rejects a non-boolean busy', () => {
    expect(() => parseSettingsReloadResult({ busy: 'yes', projection: validProjection() })).toThrow(
      GolemContractError
    );
  });
  it('rejects an unknown key', () => {
    expect(() =>
      parseSettingsReloadResult({ busy: false, projection: validProjection(), extra: true })
    ).toThrow(GolemContractError);
  });
});

describe('cross-language contract corpus', () => {
  const corpusDir = path.resolve(__dirname, '../../../../internal/ai/testdata/settings_contract');
  const files = fs.readdirSync(corpusDir).filter((f) => f.endsWith('.json'));
  it('corpus exists', () => {
    expect(files.length).toBeGreaterThanOrEqual(15);
  });
  it.each(files)('%s parses to its recorded verdict', (file) => {
    const entry = JSON.parse(fs.readFileSync(path.join(corpusDir, file), 'utf8')) as {
      verdict: 'accept' | 'reject';
      projection: unknown;
    };
    if (entry.verdict === 'accept') {
      expect(() => parseSettingsProjection(entry.projection)).not.toThrow();
    } else {
      expect(() => parseSettingsProjection(entry.projection)).toThrow(GolemContractError);
    }
  });
});
