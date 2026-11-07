/**
 * Provider presets for the Add provider form (#322, design §5.5).
 *
 * One embedded table, no network: picking a preset fills the form and nothing
 * else. A preset never carries a key, a capability list (detection owns those)
 * or a price (they go stale).
 *
 * go-llm v0.5.0 accepts only `openai-compat` and `ollama` (`config/config.go`),
 * so every hosted preset is its provider's OpenAI-compatible endpoint. go-llm
 * trims a trailing slash and appends `/v1/models` and `/v1/chat/completions`
 * itself (`provider/openaicompat/client.go`, `openaicompat.go`), so each
 * endpoint is the documented base URL WITHOUT its `/v1`.
 *
 * Sources, checked 2026-11-07:
 * - Command Code: commandcode.ai/docs/provider (base `…/provider/v1`, keys,
 *   "Every plan except the Go plan has API access"); listing left `unknown`
 *   until a consented listing is inspected (design decision 9).
 * - OpenCode Go: a working profile's `https://opencode.ai/zen/go` (#322, #505).
 *   The docs now show `/inference/go/...` paths whose model list does not sit
 *   under the chat prefix, so the working endpoint stays until one is checked.
 * - OpenRouter: openrouter.ai/docs (base `https://openrouter.ai/api/v1`, keys at
 *   openrouter.ai/keys, `GET /models` lists all models).
 * - OpenAI: developers.openai.com/api/reference (base `https://api.openai.com/v1`,
 *   keys at platform.openai.com/settings/organization/api-keys).
 * - Anthropic: platform.claude.com/docs/en/cli-sdks-libraries/libraries/openai-sdk
 *   (base `https://api.anthropic.com/v1/`; no prompt caching; "The response
 *   doesn't include Claude's thinking"; a key not scoped to a workspace needs
 *   the `anthropic-workspace-id` header, which go-llm cannot send). Live
 *   check passed 2026-11-07: claude-sonnet-5-5, workspace-scoped personal key,
 *   one tool call and its result through go-llm v0.5.0's openai-compat client.
 * - OpenRouter: not checked (no key), so it ships disabled.
 * - Gemini: its compatible API lives under `/v1beta/openai/`, so no base URL
 *   works until go-llm accepts one that carries its own version path (#322).
 * - llama.cpp: `common/common.h` `port = 9931`, host 127.0.0.1.
 * - llama-swap: its README's Homebrew and MacPorts examples `--listen localhost:8080`.
 * - Ollama: 11434 (docs.ollama.com); go-llm's ollama client appends `/api/*`.
 * - LM Studio: lmstudio.ai/docs "assume the server port is 1234".
 */

import type { APIFormat } from '../../types/golem';

/**
 * What a provider's model list shows, for #495 to read later:
 * - `account`: the models this key (or this local server) can use;
 * - `catalog`: a global catalog, some of which the key's plan may not include;
 * - `none`: no model list; models are added by exact name;
 * - `unknown`: not yet checked.
 */
export type PresetListing = 'account' | 'catalog' | 'none' | 'unknown';

export interface ProviderPreset {
  /** The dropdown's option value. */
  id: string;
  label: string;
  /** The default provider name; it stays editable. Blank for Custom. */
  name: string;
  /** Null only where the preset has none to give: Custom, and disabled Gemini. */
  apiFormat: APIFormat | null;
  /** Blank only for Custom and for a disabled preset with no working endpoint. */
  endpoint: string;
  listing: PresetListing;
  /** Null for Custom: whether a key is needed is as entered. */
  keyRequired: boolean | null;
  /** Plain text saying where the provider issues keys. Shown, never fetched. */
  keyHint: string;
  /** Facts the form shows as visible text once the preset is picked. */
  notes?: readonly string[];
  /** Present on a preset that cannot be picked; shown as visible text. */
  disabledReason?: string;
}

export const CUSTOM_PRESET_ID = 'custom';

/** Until its live check passes (#322): one chat turn with a tool call. */
const UNCHECKED = 'not yet checked with Golem';

export const PROVIDER_PRESETS: readonly ProviderPreset[] = [
  {
    id: 'commandcode',
    label: 'Command Code',
    name: 'commandcode',
    apiFormat: 'openai-compat',
    endpoint: 'https://api.commandcode.ai/provider',
    listing: 'unknown',
    keyRequired: true,
    keyHint:
      'Command Code issues keys on its API keys page in Studio, commandcode.ai/settings/keys. Its Go plan has no API access.',
  },
  {
    id: 'opencode-go',
    label: 'OpenCode Go',
    name: 'opencode',
    apiFormat: 'openai-compat',
    endpoint: 'https://opencode.ai/zen/go',
    listing: 'unknown',
    keyRequired: true,
    keyHint: 'OpenCode issues keys in its console, opencode.ai/console, once you subscribe to Go.',
  },
  {
    id: 'openrouter',
    label: 'OpenRouter',
    name: 'openrouter',
    apiFormat: 'openai-compat',
    endpoint: 'https://openrouter.ai/api',
    listing: 'catalog',
    keyRequired: true,
    keyHint: 'OpenRouter issues keys at openrouter.ai/keys.',
    disabledReason: UNCHECKED,
  },
  {
    id: 'openai',
    label: 'OpenAI',
    name: 'openai',
    apiFormat: 'openai-compat',
    endpoint: 'https://api.openai.com',
    listing: 'account',
    keyRequired: true,
    keyHint: 'OpenAI issues keys at platform.openai.com/settings/organization/api-keys.',
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    name: 'anthropic',
    apiFormat: 'openai-compat',
    endpoint: 'https://api.anthropic.com',
    listing: 'unknown',
    keyRequired: true,
    keyHint: 'Anthropic issues keys in the Claude Console, platform.claude.com/settings/keys.',
    notes: [
      'Uses Anthropic’s OpenAI compatibility layer, not its native API.',
      'Needs a key scoped to a workspace: Golem cannot send the workspace header.',
      'No prompt caching, and no thinking output.',
    ],
  },
  {
    id: 'gemini',
    label: 'Gemini',
    name: 'gemini',
    apiFormat: null,
    endpoint: '',
    listing: 'unknown',
    keyRequired: true,
    keyHint: '',
    disabledReason: 'needs a Golem update',
  },
  {
    id: 'llamacpp',
    label: 'llama.cpp',
    name: 'llamacpp',
    apiFormat: 'openai-compat',
    endpoint: 'http://127.0.0.1:9931',
    listing: 'account',
    keyRequired: false,
    keyHint: '',
  },
  {
    id: 'llama-swap',
    label: 'llama-swap',
    name: 'llama-swap',
    apiFormat: 'openai-compat',
    endpoint: 'http://127.0.0.1:8080',
    listing: 'account',
    keyRequired: false,
    keyHint: '',
  },
  {
    id: 'ollama',
    label: 'Ollama',
    name: 'ollama',
    apiFormat: 'ollama',
    endpoint: 'http://127.0.0.1:11434',
    listing: 'account',
    keyRequired: false,
    keyHint: '',
  },
  {
    id: 'lmstudio',
    label: 'LM Studio',
    name: 'lmstudio',
    apiFormat: 'openai-compat',
    endpoint: 'http://127.0.0.1:1234',
    listing: 'account',
    keyRequired: false,
    keyHint: '',
  },
  {
    id: CUSTOM_PRESET_ID,
    label: 'Custom',
    name: '',
    apiFormat: null,
    endpoint: '',
    listing: 'unknown',
    keyRequired: null,
    keyHint: '',
  },
];

/** The listing line (design §5.5); a keyless local server has no key to scope it. */
export function listingLine(preset: ProviderPreset): string {
  switch (preset.listing) {
    case 'account':
      return preset.keyRequired
        ? 'Lists the models your key can see.'
        : 'Lists the models the server serves.';
    case 'catalog':
      return 'Lists its whole catalog; some may not be on your plan.';
    case 'none':
      return 'Has no model list; you add models by name.';
    case 'unknown':
      return 'Not yet known whether it lists models, or which ones.';
  }
}

export function keyLine(preset: ProviderPreset): string {
  return preset.keyRequired ? `Needs an API key. ${preset.keyHint}` : 'Needs no API key.';
}
