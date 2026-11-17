/**
 * [#355] What a remote-destination approval actually covers. Consent is keyed
 * by provider and endpoint, never by model, so approving a destination that
 * names one model approves every model at that endpoint.
 */
export const endpointScope = (model: string): string =>
  model === ''
    ? 'Covers every model at this endpoint.'
    : `Covers every model at this endpoint, not just ${model}.`;
