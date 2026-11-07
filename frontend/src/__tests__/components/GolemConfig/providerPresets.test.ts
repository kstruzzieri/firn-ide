import {
  CUSTOM_PRESET_ID,
  PROVIDER_PRESETS,
  type ProviderPreset,
} from '../../../components/GolemConfig/providerPresets';
import { API_FORMATS, isIdentifier } from '../../../types/golem';

/**
 * The #322 coverage test: the embedded table is the only source of a preset's
 * facts, so a row missing one fails here rather than as a half-filled form.
 */
describe('provider preset coverage', () => {
  const enabled = PROVIDER_PRESETS.filter((preset) => preset.disabledReason === undefined);
  const hosted = enabled.filter((preset) => preset.id !== CUSTOM_PRESET_ID);

  it('ends with exactly one Custom preset', () => {
    expect(PROVIDER_PRESETS.filter((preset) => preset.id === CUSTOM_PRESET_ID)).toHaveLength(1);
    expect(PROVIDER_PRESETS[PROVIDER_PRESETS.length - 1].id).toBe(CUSTOM_PRESET_ID);
  });

  it('gives every preset a unique id and label', () => {
    expect(new Set(PROVIDER_PRESETS.map((preset) => preset.id)).size).toBe(PROVIDER_PRESETS.length);
    expect(new Set(PROVIDER_PRESETS.map((preset) => preset.label)).size).toBe(
      PROVIDER_PRESETS.length
    );
  });

  it.each(hosted.map((preset) => [preset.label, preset] as [string, ProviderPreset]))(
    'fills a format, an endpoint, a name and a listing value for %s',
    (_label, preset) => {
      expect(API_FORMATS).toContain(preset.apiFormat);
      expect(preset.endpoint).toMatch(/^https?:\/\/[^/\s]+/);
      // go-llm appends /v1/models and /v1/chat/completions itself.
      expect(preset.endpoint).not.toMatch(/\/v1\/?$/);
      expect(preset.endpoint).not.toMatch(/\/$/);
      expect(isIdentifier(preset.name)).toBe(true);
      expect(['account', 'catalog', 'none', 'unknown']).toContain(preset.listing);
      expect(typeof preset.keyRequired).toBe('boolean');
      // A preset that needs a key says where the provider issues one.
      if (preset.keyRequired) expect(preset.keyHint.trim()).not.toBe('');
    }
  );

  it('lets Custom leave the format and endpoint blank', () => {
    const custom = PROVIDER_PRESETS.find((preset) => preset.id === CUSTOM_PRESET_ID)!;
    expect(custom.disabledReason).toBeUndefined();
    expect(custom.apiFormat).toBeNull();
    expect(custom.endpoint).toBe('');
    expect(custom.name).toBe('');
  });

  it('makes every disabled preset carry its reason as text', () => {
    for (const preset of PROVIDER_PRESETS) {
      if (preset.disabledReason !== undefined) expect(preset.disabledReason.trim()).not.toBe('');
    }
    expect(PROVIDER_PRESETS.find((preset) => preset.id === 'gemini')?.disabledReason).toBe(
      'needs a Golem update'
    );
  });

  it('gives the Anthropic preset its three facts', () => {
    const notes = PROVIDER_PRESETS.find((preset) => preset.id === 'anthropic')?.notes ?? [];
    expect(notes).toHaveLength(3);
    expect(notes[0]).toMatch(/Anthropic’s OpenAI compatibility layer/);
    expect(notes[1]).toMatch(/scoped to a workspace/);
    expect(notes[2]).toMatch(/No prompt caching, and no thinking output/);
  });

  it('never carries a key, a capability list or a price', () => {
    for (const preset of PROVIDER_PRESETS) {
      expect(Object.keys(preset).sort()).toEqual(
        expect.not.arrayContaining(['key', 'apiKey', 'capabilities', 'price', 'prices'])
      );
    }
  });
});
